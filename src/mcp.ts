/** MCP server exposing ja.is lookups as tools. */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { JaClient } from "./client";
import * as service from "./service";

const INSTRUCTIONS = `\
Look up people and businesses in Já (ja.is), the Icelandic phone directory.

Start with \`search_phonebook\`. Each hit has an \`id\` (and businesses a \`cluster_key\`);
pass those to \`get_person\` or \`get_business\` to get phone numbers, email, website,
kennitala, coordinates, opening hours and branches.

Phones with \`marketing_ban: true\` are marked "bannmerkt": the owner has opted out of
marketing contact, so they must not be used for sales or marketing.

Searching:
- Search names in the nominative (nefnifall): "Jón Jónsson", not "Jóni Jónssyni".
  Other cases still match, but the exact person ranks lower.
- Most Icelanders have a patronymic (-son/-dóttir), not a family name, so search by
  full name rather than surname alone. Narrow common names with a place or
  occupation: "Jón Jónsson Akureyri", "Jón Jónsson pípari".
- Missing accents are fine ("Gudrun Thordardottir"). Phone numbers work in any
  format, with or without +354. A kennitala can be searched directly.
- Businesses can be found by trade and place ("pizza Akureyri", "píparar"). Icelandic
  trade words match best.

Results are in Icelandic as ja.is shows them: day names (Mánudagur … Sunnudagur),
"Lokað" = closed, "og" = and, and \`fields\` keys such as Heimilisfang (address),
Staður (postcode and town) and Sími (phone). \`open_status\` was true when the page was
fetched, which may be a few minutes ago. Answer in the user's language, and don't
translate names or addresses.
`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: true };

async function call(op: Promise<object>) {
  try {
    const result = await op;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (err) {
    if (
      err instanceof service.InvalidInput ||
      err instanceof service.EntityNotFound ||
      err instanceof service.UpstreamError
    ) {
      return { content: [{ type: "text" as const, text: err.message }], isError: true };
    }
    throw err;
  }
}

export function buildMcp(ja: JaClient): McpServer {
  const mcp = new McpServer(
    { name: "ja-is", title: "Já phone directory", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  mcp.registerTool(
    "search_phonebook",
    {
      description:
        "Search Já, the Icelandic phone directory (símaskrá), for people and businesses (einstaklingar og fyrirtæki).\n\n" +
        "Without `type`, returns the first page of both sections. Results include name, address and " +
        "occupation but not phone numbers; use get_person or get_business for those.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Name (in the nominative, e.g. 'Jón Jónsson'), company, trade, address, " +
              "phone number or kennitala; may include a place, e.g. 'pizza Akureyri'",
          ),
        type: z
          .enum(service.SEARCH_TYPES)
          .optional()
          .describe("Restrict to one section. Required for paging with `start`."),
        start: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based item to start from; use `next_start` from a previous result"),
      }),
      annotations: READ_ONLY,
    },
    ({ query, type, start }) => call(service.search(ja, query, type, start)),
  );

  mcp.registerTool(
    "get_person",
    {
      description: "Get a person's listing: phone numbers (símanúmer), address (heimilisfang), email and location.",
      inputSchema: z.object({ id: z.string().describe("Person `id` from search_phonebook") }),
      annotations: READ_ONLY,
    },
    ({ id }) => call(service.getPerson(ja, id)),
  );

  mcp.registerTool(
    "get_business",
    {
      description:
        "Get a business listing (fyrirtæki): phones, website, kennitala, opening hours (opnunartími), location and branches (útibú).",
      inputSchema: z.object({
        cluster_key: z.string().describe("Business `cluster_key` from search_phonebook"),
        branch_id: z
          .string()
          .optional()
          .describe("Branch `id`, for results with `is_branch: true` or from a business's `branches`"),
      }),
      annotations: READ_ONLY,
    },
    ({ cluster_key, branch_id }) => call(service.getBusiness(ja, cluster_key, branch_id)),
  );

  return mcp;
}
