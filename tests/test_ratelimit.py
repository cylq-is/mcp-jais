from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from jaapi.ratelimit import RateLimitMiddleware


def make_client(per_minute: int) -> TestClient:
    app = Starlette(routes=[Route("/", lambda request: PlainTextResponse("ok"))])
    app.add_middleware(RateLimitMiddleware, per_minute=per_minute)
    return TestClient(app)


def test_rejects_after_limit():
    client = make_client(3)
    assert [client.get("/").status_code for _ in range(4)] == [200, 200, 200, 429]
    response = client.get("/")
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_zero_disables_limit():
    client = make_client(0)
    assert all(client.get("/").status_code == 200 for _ in range(20))
