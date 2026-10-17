"""Operations shared by the REST API and the MCP server."""

import re

import httpx

from .client import JaClient, NotFound
from .models import Entity, SearchResponse
from .parsing import parse_businesses, parse_entity, parse_people

SEARCH_TYPES = ("people", "businesses")

# ja.is ids are short alphanumeric hashids and slug-like cluster keys. Keeping the
# patterns strict stops callers from steering requests to arbitrary ja.is paths.
HASHID_PATTERN = r"^[A-Za-z0-9]{1,32}$"
CLUSTER_KEY_PATTERN = r"^[A-Za-z0-9_-]{1,128}$"

# ja.is finds a kennitala written as digits only; the usual "DDMMYY-NNNN" form
# matches nothing.
KENNITALA_PATTERN = r"\d{6}[- ]\d{4}"


class InvalidInput(Exception):
    pass


class EntityNotFound(Exception):
    pass


class UpstreamError(Exception):
    pass


def _check(value: str, pattern: str, what: str) -> None:
    if not re.fullmatch(pattern, value):
        raise InvalidInput(f"Invalid {what}: {value!r}")


async def search(ja: JaClient, q: str, type: str | None = None, start: int | None = None) -> SearchResponse:
    q = q.strip()
    if not q or len(q) > 200:
        raise InvalidInput("Query must be between 1 and 200 characters")
    if re.fullmatch(KENNITALA_PATTERN, q):
        q = re.sub(r"\D", "", q)
    if type is not None and type not in SEARCH_TYPES:
        raise InvalidInput(f"type must be one of {SEARCH_TYPES}")
    if start is not None:
        if type is None:
            raise InvalidInput("`start` requires `type` (people or businesses)")
        if start < 1:
            raise InvalidInput("`start` must be 1 or greater")

    try:
        data = await ja.search(q, scope=type, start=start)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"ja.is search failed: {exc}") from exc

    if type == "people":
        return SearchResponse(query=q, people=parse_people(data))
    if type == "businesses":
        return SearchResponse(query=q, businesses=parse_businesses(data))
    return SearchResponse(
        query=q,
        people=parse_people(data.get("people") or {}),
        businesses=parse_businesses(data.get("businesses") or {}),
    )


async def _fetch_entity(ja: JaClient, page_path: str, kind: str, entity_id: str) -> Entity:
    try:
        html, url = await ja.get_page(page_path)
    except NotFound:
        raise EntityNotFound(f"No {kind} found for {entity_id!r}")
    except httpx.HTTPError as exc:
        raise UpstreamError(f"ja.is request failed: {exc}") from exc

    entity = parse_entity(html, kind, entity_id, url)
    if entity is None:
        raise UpstreamError("Could not parse the ja.is page; the layout may have changed")
    return entity


async def get_person(ja: JaClient, hashid: str) -> Entity:
    _check(hashid, HASHID_PATTERN, "person id")
    return await _fetch_entity(ja, f"/e/{hashid}/", "person", hashid)


async def get_business(ja: JaClient, cluster_key: str, hashid: str | None = None) -> Entity:
    _check(cluster_key, CLUSTER_KEY_PATTERN, "cluster key")
    if hashid is None:
        return await _fetch_entity(ja, f"/{cluster_key}/", "business", cluster_key)
    _check(hashid, HASHID_PATTERN, "branch id")
    return await _fetch_entity(ja, f"/{cluster_key}/{hashid}/", "business", hashid)
