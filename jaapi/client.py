"""Thin async client for ja.is.

Search goes through the JSON endpoint the ja.is frontend uses (`/liveresult/`).
Entity details are only available as server-rendered HTML, so those pages are
fetched raw and handed to `jaapi.parsing`.
"""

import asyncio
import hashlib
import time
from collections import OrderedDict

import httpx

BASE_URL = "https://ja.is"

# The frontend signs search requests with md5(q + key + start + salt). The salt
# is hidden behind JSFuck-style obfuscation in the app bundle.
HASH_SALT = "gagnatorg.ja.is"

DEFAULT_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
    ),
    "accept-language": "is,en-US;q=0.9,en;q=0.8",
}


class NotFound(Exception):
    pass


def _js_str(value) -> str:
    # String concatenation in JS turns a missing value into "undefined".
    return "undefined" if value is None else str(value)


def search_hash(q: str, key: str | None = None, start: int | None = None) -> str:
    raw = f"{q}{_js_str(key)}{_js_str(start)}{HASH_SALT}"
    return hashlib.md5(raw.encode()).hexdigest()


class TTLCache:
    """Small LRU cache with per-entry expiry."""

    def __init__(self, ttl: float, max_size: int):
        self.ttl = ttl
        self.max_size = max_size
        self._data: OrderedDict = OrderedDict()

    def get(self, key):
        entry = self._data.get(key)
        if entry is None:
            return None
        expires, value = entry
        if expires < time.monotonic():
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key, value) -> None:
        if self.ttl <= 0:
            return
        self._data[key] = (time.monotonic() + self.ttl, value)
        self._data.move_to_end(key)
        while len(self._data) > self.max_size:
            self._data.popitem(last=False)


class JaClient:
    def __init__(
        self,
        http: httpx.AsyncClient | None = None,
        *,
        cache_ttl: float = 600,
        cache_size: int = 500,
        max_concurrency: int = 4,
    ):
        self._http = http or httpx.AsyncClient(
            base_url=BASE_URL,
            headers=DEFAULT_HEADERS,
            timeout=15.0,
            follow_redirects=True,
        )
        # Keeps load on ja.is low however many callers this service has.
        self._cache = TTLCache(cache_ttl, cache_size)
        self._limit = asyncio.Semaphore(max_concurrency)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _get(self, path: str, params: dict | None, accept: str) -> httpx.Response:
        async with self._limit:
            return await self._http.get(path, params=params, headers={"accept": accept})

    async def search(self, q: str, scope: str | None = None, start: int | None = None) -> dict:
        """Raw `/liveresult/` response.

        Without `scope` the response holds the first page of every section
        (`people`, `businesses`, ...). With `scope` it holds a single section
        (`meta`, `items`) starting at item number `start` (1-based).
        """
        params = {"live": "false", "q": q}
        if scope:
            params["scope"] = scope
        if start:
            params["start"] = start
        params["h"] = search_hash(q, start=start)
        cache_key = ("search", tuple(sorted(params.items())))
        if (cached := self._cache.get(cache_key)) is not None:
            return cached

        response = await self._get("/liveresult/", params, "application/json, text/plain, */*")
        response.raise_for_status()
        data = response.json()
        self._cache.set(cache_key, data)
        return data

    async def get_page(self, path: str) -> tuple[str, str]:
        """Return (html, final_url) for a ja.is page path."""
        cache_key = ("page", path)
        if (cached := self._cache.get(cache_key)) is not None:
            return cached

        response = await self._get(path, None, "text/html")
        if response.status_code == 404:
            raise NotFound(path)
        response.raise_for_status()
        result = (response.text, str(response.url))
        self._cache.set(cache_key, result)
        return result
