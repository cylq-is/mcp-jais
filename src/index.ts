import { createMcpHandler } from "agents/mcp/server";
import { JaClient } from "./client";
import { buildMcp } from "./mcp";
import * as service from "./service";

export interface Env {
  CACHE_TTL_SECONDS?: string;
}

// Module scope, so the response cache is shared by every request this isolate serves.
let ja: JaClient | undefined;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

/** Mirrors FastAPI's `response_model_exclude_none` on the REST search route. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, withoutNulls(v)]),
    );
  }
  return value;
}

function errorResponse(err: unknown): Response {
  if (err instanceof service.InvalidInput) return json({ detail: err.message }, 422);
  if (err instanceof service.EntityNotFound) return json({ detail: err.message }, 404);
  if (err instanceof service.UpstreamError) return json({ detail: err.message }, 502);
  throw err;
}

async function rest(request: Request, client: JaClient): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ detail: "Method Not Allowed" }, 405);

  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (url.pathname === "/health") return json({ status: "ok" });

    if (url.pathname === "/search") {
      const q = url.searchParams.get("q") ?? "";
      const startParam = url.searchParams.get("start");
      const start = startParam === null ? null : Number(startParam);
      if (start !== null && !Number.isInteger(start)) throw new service.InvalidInput("`start` must be an integer");
      return json(withoutNulls(await service.search(client, q, url.searchParams.get("type"), start)));
    }

    if (parts[0] === "people" && parts.length === 2) {
      return json(await service.getPerson(client, decodeURIComponent(parts[1])));
    }

    if (parts[0] === "businesses" && (parts.length === 2 || parts.length === 3)) {
      const [, clusterKey, hashid] = parts.map(decodeURIComponent);
      return json(await service.getBusiness(client, clusterKey, hashid ?? null));
    }
  } catch (err) {
    return errorResponse(err);
  }
  return json({ detail: "Not Found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    ja ??= new JaClient(undefined, { cacheTtlSeconds: Number(env.CACHE_TTL_SECONDS ?? "600") });
    const client = ja;

    if (new URL(request.url).pathname === "/mcp") {
      // The handler builds a fresh, stateless MCP server for every request.
      return createMcpHandler(() => buildMcp(client))(request, env, ctx);
    }
    return rest(request, client);
  },
} satisfies ExportedHandler<Env>;
