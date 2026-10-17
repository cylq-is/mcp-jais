/** Operations shared by the REST API and the MCP server. */

import { HttpError, type JaClient, NotFound } from "./client";
import type { Entity, SearchResponse } from "./models";
import { parseBusinesses, parseEntity, parsePeople } from "./parsing";

export const SEARCH_TYPES = ["people", "businesses"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

// ja.is ids are short alphanumeric hashids and slug-like cluster keys. Keeping the
// patterns strict stops callers from steering requests to arbitrary ja.is paths.
export const HASHID_PATTERN = /^[A-Za-z0-9]{1,32}$/;
export const CLUSTER_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// ja.is finds a kennitala written as digits only; the usual "DDMMYY-NNNN" form
// matches nothing.
const KENNITALA_PATTERN = /^\d{6}[- ]\d{4}$/;

export class InvalidInput extends Error {}
export class EntityNotFound extends Error {}
export class UpstreamError extends Error {}

function check(value: string, pattern: RegExp, what: string): void {
  if (!pattern.test(value)) throw new InvalidInput(`Invalid ${what}: ${JSON.stringify(value)}`);
}

export async function search(
  ja: JaClient,
  query: string,
  type?: string | null,
  start?: number | null,
): Promise<SearchResponse> {
  let q = query.trim();
  if (!q || q.length > 200) throw new InvalidInput("Query must be between 1 and 200 characters");
  if (KENNITALA_PATTERN.test(q)) q = q.replace(/\D/g, "");
  if (type != null && !(SEARCH_TYPES as readonly string[]).includes(type)) {
    throw new InvalidInput(`type must be one of ${SEARCH_TYPES.join(", ")}`);
  }
  if (start != null) {
    if (type == null) throw new InvalidInput("`start` requires `type` (people or businesses)");
    if (!Number.isInteger(start) || start < 1) throw new InvalidInput("`start` must be 1 or greater");
  }

  let data: any;
  try {
    data = await ja.search(q, type ?? undefined, start ?? undefined);
  } catch (err) {
    if (err instanceof HttpError) throw new UpstreamError(`ja.is search failed: ${err.message}`);
    throw err;
  }

  if (type === "people") return { query: q, people: parsePeople(data) };
  if (type === "businesses") return { query: q, businesses: parseBusinesses(data) };
  return {
    query: q,
    people: parsePeople(data?.people ?? {}),
    businesses: parseBusinesses(data?.businesses ?? {}),
  };
}

function fetchEntity(ja: JaClient, pagePath: string, kind: Entity["kind"], entityId: string): Promise<Entity> {
  return ja.cached(`entity:${pagePath}`, async () => {
    let html: string;
    let url: string;
    try {
      [html, url] = await ja.getPage(pagePath);
    } catch (err) {
      if (err instanceof NotFound) throw new EntityNotFound(`No ${kind} found for ${JSON.stringify(entityId)}`);
      if (err instanceof HttpError) throw new UpstreamError(`ja.is request failed: ${err.message}`);
      throw err;
    }

    const entity = parseEntity(html, kind, entityId, url);
    if (!entity) throw new UpstreamError("Could not parse the ja.is page; the layout may have changed");
    return entity;
  });
}

export async function getPerson(ja: JaClient, hashid: string): Promise<Entity> {
  check(hashid, HASHID_PATTERN, "person id");
  return fetchEntity(ja, `/e/${hashid}/`, "person", hashid);
}

export async function getBusiness(ja: JaClient, clusterKey: string, hashid?: string | null): Promise<Entity> {
  check(clusterKey, CLUSTER_KEY_PATTERN, "cluster key");
  if (hashid == null) return fetchEntity(ja, `/${clusterKey}/`, "business", clusterKey);
  check(hashid, HASHID_PATTERN, "branch id");
  return fetchEntity(ja, `/${clusterKey}/${hashid}/`, "business", hashid);
}
