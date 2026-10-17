from pathlib import Path

import httpx
import pytest
from mcp import Client

from jaapi.client import BASE_URL, JaClient
from jaapi.mcp_server import build_mcp

FIXTURES = Path(__file__).parent / "fixtures"

SEARCH_RESPONSE = {
    "people": {"meta": {"first_item": None, "last_item": None, "total_items": 0}, "items": []},
    "businesses": {
        "meta": {"first_item": 1, "last_item": 1, "total_items": 1},
        "items": [{"name": "Domino's Pizza", "cluster_key": "dominos", "hashid": "80yqW", "is_branch": False}],
    },
}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def upstream():
    """Fake ja.is that records every request it receives."""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/liveresult/":
            return httpx.Response(200, json=SEARCH_RESPONSE)
        if request.url.path == "/dominos/9XMkg/":
            return httpx.Response(200, text=(FIXTURES / "business_branch.html").read_text(encoding="utf-8"))
        return httpx.Response(404)

    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return JaClient(http), requests


@pytest.mark.anyio
async def test_tools_are_read_only(upstream):
    ja, _ = upstream
    async with Client(build_mcp(ja)) as client:
        tools = (await client.list_tools()).tools
    assert {t.name for t in tools} == {"search_phonebook", "get_person", "get_business"}
    assert all(t.annotations.read_only_hint for t in tools)


@pytest.mark.anyio
async def test_search_and_get_business(upstream):
    ja, requests = upstream
    async with Client(build_mcp(ja)) as client:
        result = await client.call_tool("search_phonebook", {"query": "dominos"})
        assert not result.is_error
        hit = result.structured_content["businesses"]["items"][0]
        assert hit["cluster_key"] == "dominos"

        result = await client.call_tool("get_business", {"cluster_key": "dominos", "branch_id": "9XMkg"})
        assert not result.is_error
        assert result.structured_content["phones"][0]["number"] == "5812345"

    assert requests[0].url.params["h"]  # search requests are signed


@pytest.mark.anyio
@pytest.mark.parametrize("query", ["450199-3389", "450199 3389", "4501993389"])
async def test_kennitala_query_is_sent_as_digits(upstream, query):
    ja, requests = upstream
    async with Client(build_mcp(ja)) as client:
        result = await client.call_tool("search_phonebook", {"query": query})
    assert not result.is_error
    assert requests[0].url.params["q"] == "4501993389"


@pytest.mark.anyio
async def test_responses_are_cached(upstream):
    ja, requests = upstream
    async with Client(build_mcp(ja)) as client:
        for _ in range(3):
            await client.call_tool("get_business", {"cluster_key": "dominos", "branch_id": "9XMkg"})
    assert len(requests) == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "tool, args, message",
    [
        ("get_person", {"id": "../kort"}, "Invalid person id"),
        ("get_business", {"cluster_key": "dominos/../kort"}, "Invalid cluster key"),
        ("get_business", {"cluster_key": "dominos", "branch_id": "a/b"}, "Invalid branch id"),
        ("get_person", {"id": "missing"}, "No person found"),
        ("search_phonebook", {"query": "x", "start": 5}, "requires `type`"),
    ],
)
async def test_bad_input_is_a_tool_error(upstream, tool, args, message):
    ja, requests = upstream
    async with Client(build_mcp(ja)) as client:
        result = await client.call_tool(tool, args)
    assert result.is_error
    assert message in result.content[0].text
    assert all(".." not in r.url.path for r in requests)
