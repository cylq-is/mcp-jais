FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8000

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev
COPY jaapi ./jaapi

RUN useradd --system --no-create-home app
USER app

EXPOSE 8000
# --proxy-headers takes the client IP (used for rate limiting) from
# X-Forwarded-For, but only from addresses in FORWARDED_ALLOW_IPS.
CMD ["sh", "-c", "exec uvicorn jaapi.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
