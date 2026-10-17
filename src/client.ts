/**
 * Thin client for ja.is.
 *
 * Search goes through the JSON endpoint the ja.is frontend uses (`/liveresult/`).
 * Entity details are only available as server-rendered HTML, so those pages are
 * fetched raw and handed to `parsing.ts`.
 */

import { createHash } from "node:crypto";

export const BASE_URL = "https://ja.is";

// The frontend signs search requests with md5(q + key + start + salt). The salt
// is hidden behind JSFuck-style obfuscation in the app bundle.
const HASH_SALT = "gagnatorg.ja.is";

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
  "accept-language": "is,en-US;q=0.9,en;q=0.8",
};

export class NotFound extends Error {}

/** A non-2xx answer or a network failure talking to ja.is. */
export class HttpError extends Error {}

// String concatenation in JS turns a missing value into "undefined" — which is
// exactly what the frontend does.
export function searchHash(q: string, key?: string, start?: number): string {
  return createHash("md5").update(`${q}${key}${start}${HASH_SALT}`).digest("hex");
}

/** Small LRU cache with per-entry expiry. */
class TTLCache<V> {
  private data = new Map<string, { expires: number; value: V }>();

  constructor(
    private ttlMs: number,
    private maxSize: number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    this.data.delete(key);
    if (entry.expires < Date.now()) return undefined;
    this.data.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) return;
    this.data.delete(key);
    this.data.set(key, { expires: Date.now() + this.ttlMs, value });
    while (this.data.size > this.maxSize) this.data.delete(this.data.keys().next().value!);
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class JaClient {
  // The cache lives in the Worker isolate's memory, so it is per data centre
  // and lost whenever Cloudflare recycles the isolate. It still saves repeated
  // lookups within a conversation, which is the common case.
  private cache: TTLCache<unknown>;

  constructor(
    private fetcher: Fetch = (input, init) => fetch(input, init),
    { cacheTtlSeconds = 600, cacheSize = 500 } = {},
  ) {
    this.cache = new TTLCache(cacheTtlSeconds * 1000, cacheSize);
  }

  private async get(path: string, params: Record<string, string> | null, accept: string): Promise<Response> {
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    try {
      return await this.fetcher(url.toString(), {
        headers: { ...DEFAULT_HEADERS, accept },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new HttpError(String(err));
    }
  }

  /**
   * Raw `/liveresult/` response.
   *
   * Without `scope` the response holds the first page of every section
   * (`people`, `businesses`, ...). With `scope` it holds a single section
   * (`meta`, `items`) starting at item number `start` (1-based).
   */
  async search(q: string, scope?: string, start?: number): Promise<any> {
    const params: Record<string, string> = { live: "false", q };
    if (scope) params.scope = scope;
    if (start) params.start = String(start);
    params.h = searchHash(q, undefined, start);
    const cacheKey = `search:${JSON.stringify(Object.entries(params).sort())}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const response = await this.get("/liveresult/", params, "application/json, text/plain, */*");
    if (!response.ok) throw new HttpError(`ja.is answered ${response.status}`);
    const data = await response.json();
    this.cache.set(cacheKey, data);
    return data;
  }

  /**
   * Return [html, finalUrl] for a ja.is page path. Pages are not cached here:
   * parsing one costs more CPU than the free plan allows to repeat, so callers
   * cache the parsed result with `cached`.
   */
  async getPage(path: string): Promise<[string, string]> {
    const response = await this.get(path, null, "text/html");
    if (response.status === 404) throw new NotFound(path);
    if (!response.ok) throw new HttpError(`ja.is answered ${response.status}`);
    return [await response.text(), response.url || new URL(path, BASE_URL).toString()];
  }

  /** Return the cached value for `key`, or load and cache it. Failures are not cached. */
  async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit as T;
    const value = await load();
    this.cache.set(key, value);
    return value;
  }
}
