import { createMcpHandler } from "agents/mcp/server";
import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import businessBranch from "../../tests/fixtures/business_branch.html?raw";
import { JaClient } from "../src/client";
import { buildMcp } from "../src/mcp";

const SEARCH_RESPONSE = {
  people: { meta: { first_item: null, last_item: null, total_items: 0 }, items: [] },
  businesses: {
    meta: { first_item: 1, last_item: 1, total_items: 1 },
    items: [{ name: "Domino's Pizza", cluster_key: "dominos", hashid: "80yqW", is_branch: false }],
  },
};

/** Fake ja.is that records every request it receives. */
function upstream() {
  const requests: URL[] = [];
  const ja = new JaClient(async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === "/liveresult/") return Response.json(SEARCH_RESPONSE);
    if (url.pathname === "/dominos/9XMkg/") return new Response(businessBranch);
    return new Response("", { status: 404 });
  });
  return { ja, requests };
}

let nextId = 1;

async function rpc(ja: JaClient, method: string, params: object = {}) {
  const request = new Request("http://localhost/mcp", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const response = await createMcpHandler(() => buildMcp(ja))(request, env, createExecutionContext());
  const text = await response.text();
  expect(response.status, text).toBe(200);
  // A response may come back as plain JSON or as a single server-sent event.
  const body = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
  const message = JSON.parse(body);
  expect(message.error).toBeUndefined();
  return message.result;
}

const callTool = (ja: JaClient, name: string, args: object) => rpc(ja, "tools/call", { name, arguments: args });

describe("MCP server", () => {
  it("exposes read-only tools", async () => {
    const { tools } = await rpc(upstream().ja, "tools/list");
    expect(new Set(tools.map((t: any) => t.name))).toEqual(new Set(["search_phonebook", "get_person", "get_business"]));
    expect(tools.every((t: any) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("searches and fetches a business", async () => {
    const { ja, requests } = upstream();
    let result = await callTool(ja, "search_phonebook", { query: "dominos" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.businesses.items[0].cluster_key).toBe("dominos");

    result = await callTool(ja, "get_business", { cluster_key: "dominos", branch_id: "9XMkg" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.phones[0].number).toBe("5812345");

    expect(requests[0].searchParams.get("h")).toBeTruthy(); // search requests are signed
  });

  it.each(["450199-3389", "450199 3389", "4501993389"])("sends kennitala %s as digits", async (query) => {
    const { ja, requests } = upstream();
    const result = await callTool(ja, "search_phonebook", { query });
    expect(result.isError).toBeFalsy();
    expect(requests[0].searchParams.get("q")).toBe("4501993389");
  });

  it("caches responses", async () => {
    const { ja, requests } = upstream();
    for (let i = 0; i < 3; i++) await callTool(ja, "get_business", { cluster_key: "dominos", branch_id: "9XMkg" });
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["get_person", { id: "../kort" }, "Invalid person id"],
    ["get_business", { cluster_key: "dominos/../kort" }, "Invalid cluster key"],
    ["get_business", { cluster_key: "dominos", branch_id: "a/b" }, "Invalid branch id"],
    ["get_person", { id: "missing" }, "No person found"],
    ["search_phonebook", { query: "x", start: 5 }, "requires `type`"],
  ])("reports bad input to %s as a tool error", async (tool, args, message) => {
    const { ja, requests } = upstream();
    const result = await callTool(ja, tool, args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(requests.every((r) => !r.pathname.includes(".."))).toBe(true);
  });
});
