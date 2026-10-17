"""Per-client sliding-window rate limit.

State is in memory, so limits apply per process. Behind a reverse proxy, run
uvicorn with --proxy-headers so the client address is the real caller.
"""

import json
import time
from collections import defaultdict, deque

WINDOW_SECONDS = 60.0
_PRUNE_AT = 10_000


class RateLimitMiddleware:
    def __init__(self, app, per_minute: int):
        self.app = app
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or self.per_minute <= 0:
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        key = client[0] if client else "unknown"
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= WINDOW_SECONDS:
            hits.popleft()

        if len(hits) >= self.per_minute:
            retry_after = max(1, int(WINDOW_SECONDS - (now - hits[0])) + 1)
            await self._reject(send, retry_after)
            return

        hits.append(now)
        if len(self._hits) > _PRUNE_AT:
            self._prune(now)
        await self.app(scope, receive, send)

    def _prune(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or now - v[-1] >= WINDOW_SECONDS]:
            del self._hits[key]

    @staticmethod
    async def _reject(send, retry_after: int) -> None:
        body = json.dumps({"detail": "Rate limit exceeded"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"retry-after", str(retry_after).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
