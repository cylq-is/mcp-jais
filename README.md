# mcp-jais

MCP server and REST API for [ja.is](https://ja.is), the Icelandic phone directory,
running on Cloudflare Workers.

Live at https://mcp.mcp-jais.workers.dev — MCP endpoint:
`https://mcp.mcp-jais.workers.dev/mcp`.

## Run locally

Requires Node.js.

```sh
npm install
npx wrangler dev   # http://localhost:8787
```

- REST: http://localhost:8787/search?q=dominos
- MCP endpoint (Streamable HTTP): http://localhost:8787/mcp

## Deploy

```sh
npx wrangler login   # once
npx wrangler deploy
```

| Variable (in `wrangler.jsonc`) | Default | Description |
| --- | --- | --- |
| `CACHE_TTL_SECONDS` | `600` | How long parsed ja.is responses are cached. `0` disables caching. |

The cache is in memory, so it is per Worker isolate: separate in each Cloudflare
data centre and lost whenever Cloudflare recycles the isolate. (The Cache API does
nothing on `workers.dev` hostnames.) There is no rate limiting.

## MCP

The server is stateless, so any Worker instance can answer any request. There is no
authentication.

| Tool | Description |
| --- | --- |
| `search_phonebook(query, type?, start?)` | Search people and businesses |
| `get_person(id)` | Person details |
| `get_business(cluster_key, branch_id?)` | Business details, or a single branch |

To check it with the MCP Inspector, run `npx @modelcontextprotocol/inspector`,
choose the **Streamable HTTP** transport and enter the `/mcp` URL.

### Adding it to Claude

**Claude Code:**

```sh
claude mcp add --transport http ja-is https://mcp.mcp-jais.workers.dev/mcp
```

Run `/mcp` inside Claude Code to check that it's connected.

**Claude apps (claude.ai, Desktop, mobile):** go to **Settings → Connectors → Add
custom connector**, enter the `/mcp` URL, leave the OAuth fields empty and click
**Add**. Then turn on the connector for a chat from the **+** menu. On Team and
Enterprise plans an Owner adds it under **Admin settings → Connectors**, and members
connect to it from their own Settings → Connectors.

### Adding it to ChatGPT

Custom MCP connectors need developer mode, which is available on Plus, Pro,
Business, Enterprise and Edu plans in the web app.

1. Go to **Settings → Apps & Connectors → Advanced settings** and turn on
   **Developer mode**. On Business and Enterprise a workspace admin may have to
   allow custom connectors first.
2. Under **Apps & Connectors**, click **Create**. Enter a name (e.g. "Já"), the
   `/mcp` URL, and set **Authentication** to **No authentication**.
3. Tick the box confirming you trust the app and click **Create**.
4. In a chat, enable the connector from the **+ → Developer mode** menu.

The exact menu labels in both apps change from time to time.

## REST

| Method | Path | Description |
| --- | --- | --- |
| GET | `/search?q=jon` | First page of people and businesses |
| GET | `/search?q=jon&type=people&start=17` | Page through one section (`start` = `next_start` from the previous page) |
| GET | `/people/{id}` | Person details |
| GET | `/businesses/{cluster_key}` | Business details, including its branches |
| GET | `/businesses/{cluster_key}/{id}` | A single business branch |
| GET | `/health` | Liveness check |

Every search hit has a `detail_path` that points to the matching detail endpoint.

Detail responses include `phones` (with a `marketing_ban` flag for numbers marked
*bannmerkt*), `email`, `website`, `kennitala`, `location` (lat/lon), `opening_hours`,
`branches`, and `fields`, which holds every raw label/value pair from the info box.

## How it talks to ja.is

- **Search** uses `/liveresult/`, the JSON endpoint the ja.is frontend calls. Requests
  are signed with `h = md5(q + key + start + "gagnatorg.ja.is")`, where missing values
  are the string `"undefined"` (see `src/client.ts`). The salt is obfuscated in the
  ja.is JS bundle and may change.
- **Details** have no JSON API. The server-rendered pages (`/e/<hashid>/` for people,
  `/<cluster_key>/[<hashid>/]` for businesses) are scraped in `src/parsing.ts`.
  If ja.is changes its markup, the parser tests in `test/` should catch it.

Pages are parsed by a small regex tokenizer (`src/html.ts`) rather than
HTMLRewriter: HTMLRewriter hands every element and text chunk to JavaScript, which
took large business pages to 15–20 ms of CPU per request; the tokenizer keeps them
at a few milliseconds.

## Tests

```sh
npm test         # runs in the Workers runtime
npm run typecheck
```
