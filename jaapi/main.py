import os
from contextlib import asynccontextmanager
from enum import Enum
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from mcp.server.transport_security import TransportSecuritySettings

from . import service
from .client import JaClient
from .mcp_server import build_mcp
from .models import Entity, SearchResponse
from .ratelimit import RateLimitMiddleware

RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "60"))

ja = JaClient(cache_ttl=float(os.environ.get("CACHE_TTL_SECONDS", "600")))
mcp = build_mcp(ja)
mcp_app = mcp.streamable_http_app(
    streamable_http_path="/mcp",
    # Stateless JSON responses: no server-side sessions, so any instance can
    # answer any request and it works behind ordinary HTTP load balancers.
    stateless_http=True,
    json_response=True,
    # DNS-rebinding protection guards servers on localhost. This one is public
    # and unauthenticated, so a Host allowlist would add nothing.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield
    await ja.aclose()


app = FastAPI(
    title="Já API",
    description="REST and MCP wrapper around ja.is search and listing pages. MCP endpoint: `/mcp`.",
    lifespan=lifespan,
)
app.add_middleware(RateLimitMiddleware, per_minute=RATE_LIMIT_PER_MINUTE)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["mcp-session-id", "mcp-protocol-version"],
)


def _raise_http(exc: Exception):
    if isinstance(exc, service.InvalidInput):
        raise HTTPException(422, str(exc))
    if isinstance(exc, service.EntityNotFound):
        raise HTTPException(404, str(exc))
    if isinstance(exc, service.UpstreamError):
        raise HTTPException(502, str(exc))
    raise exc


HashId = Annotated[str, Path(pattern=service.HASHID_PATTERN)]
ClusterKey = Annotated[str, Path(pattern=service.CLUSTER_KEY_PATTERN)]


class SearchType(str, Enum):
    people = "people"
    businesses = "businesses"


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.get("/search", response_model=SearchResponse, response_model_exclude_none=True)
async def search(
    q: Annotated[str, Query(min_length=1, max_length=200)],
    type: Annotated[
        SearchType | None,
        Query(description="Restrict to one section. Required for paging with `start`."),
    ] = None,
    start: Annotated[
        int | None,
        Query(ge=1, description="1-based item to start from; use `next_start` from a previous page."),
    ] = None,
):
    try:
        return await service.search(ja, q, type.value if type else None, start)
    except Exception as exc:
        _raise_http(exc)


@app.get("/people/{hashid}", response_model=Entity)
async def get_person(hashid: HashId):
    try:
        return await service.get_person(ja, hashid)
    except Exception as exc:
        _raise_http(exc)


@app.get("/businesses/{cluster_key}", response_model=Entity)
async def get_business(cluster_key: ClusterKey):
    try:
        return await service.get_business(ja, cluster_key)
    except Exception as exc:
        _raise_http(exc)


@app.get("/businesses/{cluster_key}/{hashid}", response_model=Entity)
async def get_business_branch(cluster_key: ClusterKey, hashid: HashId):
    try:
        return await service.get_business(ja, cluster_key, hashid)
    except Exception as exc:
        _raise_http(exc)


# Mounted last so the REST routes above take precedence; it serves only /mcp.
app.mount("/", mcp_app)
