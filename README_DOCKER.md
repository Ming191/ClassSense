# Docker Quickstart (Local)

## 1) Prepare environment

```bash
cp .env.example .env
python cv-pipeline/scripts/download_models.py
```

Edit `.env` as needed.

Required for Prisma (web container):

- `DATABASE_URL=file:/app/prisma/dev.db`
- Web container now runs `prisma db push` automatically on startup.

## 2) Start core services (web + livekit + redis)

```bash
docker compose up -d --build livekit redis web
```

## 3) Start cv-worker (lifecycle mode)

```bash
docker compose up -d --build cv-worker
```

The worker subscribes to Redis lifecycle events and auto-attaches to new sessions.

## 4) Create a session from web flow

Use the web UI/API to create a session as usual. When `session.created` is emitted,
the worker fetches its own service token from `WEB_BASE_URL` and connects automatically.
When `session.completed` is emitted, the worker disconnects automatically.

If you update env/config and the worker is already running:

```bash
docker compose restart cv-worker
```

## Notes

- Current web session state is in-memory and will reset when the web container restarts.
- Score/HCI event persistence is handled by a singleton web ingestor process (Redis -> Prisma), so DB writes no longer depend on an active dashboard SSE connection.
- CV worker requires local model files under `cv-pipeline/models` (downloaded by step 1 above), mounted into container as `/app/models`.
- In Docker, keep `LIVEKIT_URL` for the worker on the internal network (for example `ws://livekit:7880`). The worker now prefers this value when token `livekitUrl` points to localhost.
