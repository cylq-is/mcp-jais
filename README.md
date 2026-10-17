# jaapi

REST API and MCP server for [ja.is](https://ja.is), the Icelandic phone directory.

## Run

Requires [uv](https://docs.astral.sh/uv/).

```sh
uv run uvicorn jaapi.main:app --reload
```

- REST docs: http://localhost:8000/docs
- MCP endpoint (Streamable HTTP): http://localhost:8000/mcp

## MCP

The server is stateless with JSON responses, so it needs no session affinity and
can run behind any HTTP load balancer. There is no authentication.

| Tool | Description |
| --- | --- |
| `search_phonebook(query, type?, start?)` | Search people and businesses |
| `get_person(id)` | Person details |
| `get_business(cluster_key, branch_id?)` | Business details, or a single branch |

### Running the MCP server locally

The MCP server is part of the same app, so starting the app starts it:

```sh
uv run uvicorn jaapi.main:app --reload --port 8000
```

It listens at `http://localhost:8000/mcp`. To check it with the MCP Inspector, run
`npx @modelcontextprotocol/inspector`, choose the **Streamable HTTP** transport and
enter that URL.

### Adding it to Claude

**Claude Code** can reach your machine, so a local URL works:

```sh
claude mcp add --transport http ja-is http://localhost:8000/mcp
# or, once deployed:
claude mcp add --transport http ja-is https://<your-host>/mcp
```

Run `/mcp` inside Claude Code to check that it's connected.

**Claude apps (claude.ai, Desktop, mobile):** go to **Settings → Connectors → Add
custom connector**, enter `https://<your-host>/mcp`, leave the OAuth fields empty
and click **Add**. Then turn on the connector for a chat from the **+** menu. On Team
and Enterprise plans an Owner adds it under **Admin settings → Connectors**, and
members connect to it from their own Settings → Connectors.

### Adding it to ChatGPT

Custom MCP connectors need developer mode, which is available on Plus, Pro,
Business, Enterprise and Edu plans in the web app.

1. Go to **Settings → Apps & Connectors → Advanced settings** and turn on
   **Developer mode**. On Business and Enterprise a workspace admin may have to
   allow custom connectors first.
2. Under **Apps & Connectors**, click **Create**. Enter a name (e.g. "Já"), the URL
   `https://<your-host>/mcp`, and set **Authentication** to **No authentication**.
3. Tick the box confirming you trust the app and click **Create**.
4. In a chat, enable the connector from the **+ → Developer mode** menu.

The exact menu labels in both apps change from time to time.

### Testing the Claude and ChatGPT apps against a local server

Claude's apps and ChatGPT connect from their own cloud, so they can't reach
`localhost` and need a public HTTPS URL. To try them before deploying, open a
temporary tunnel to the local server, e.g. with
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

```sh
cloudflared tunnel --url http://localhost:8000
```

Then use the printed `https://<random>.trycloudflare.com/mcp` as the connector URL.
All tunnelled traffic arrives from the tunnel's local address and shares one rate
limit, which is fine for testing. Anyone with the URL can use the server while the
tunnel is open.

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

## Deploying

```sh
docker build -t jaapi .
docker run -p 8000:8000 jaapi
```

The container listens on `$PORT` (default 8000).

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | `60` | Requests per client IP per minute, across REST and MCP. `0` disables it. |
| `CACHE_TTL_SECONDS` | `600` | How long ja.is responses are cached. `0` disables caching. |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies trusted to set `X-Forwarded-For`. Set it to your proxy's address, or `*` if only the proxy can reach the container. Otherwise every caller shares the proxy's IP and its rate limit. |

The rate limit and cache are in memory, so each instance enforces its own.
Outgoing requests to ja.is are capped at 4 at a time per instance.

## Cloudflare Workers

`worker/` is a TypeScript port of the same server (the REST routes and the MCP
endpoint) that runs on the Cloudflare Workers free plan. It is live at
https://jaapi.jaapi-worker.workers.dev (MCP: `https://jaapi.jaapi-worker.workers.dev/mcp`).

```sh
cd worker
npm install
npm test          # runs in the Workers runtime; includes a parity check against the Python parser
npx wrangler dev  # http://localhost:8787
npx wrangler deploy
```

Differences from the Python server:

- No per-IP rate limit.
- Parsed results are cached in memory per Worker isolate, so the cache is per data
  centre and is lost whenever Cloudflare recycles the isolate. (The Cache API does
  nothing on `workers.dev` hostnames.)
- Pages are parsed by a small regex tokenizer (`worker/src/html.ts`) instead of
  BeautifulSoup. HTMLRewriter was too slow for the free plan's 10 ms CPU limit
  because every element and text chunk crosses into JavaScript.

## How it talks to ja.is

- **Search** uses `/liveresult/`, the JSON endpoint the ja.is frontend calls. Requests
  are signed with `h = md5(q + key + start + "gagnatorg.ja.is")`, where missing values
  are the string `"undefined"` (see `jaapi/client.py`). The salt is obfuscated in the
  ja.is JS bundle and may change.
- **Details** have no JSON API. The server-rendered pages (`/e/<hashid>/` for people,
  `/<cluster_key>/[<hashid>/]` for businesses) are scraped in `jaapi/parsing.py`.
  If ja.is changes its markup, the parser tests in `tests/` should catch it.

## Tests

```sh
uv run pytest
```
