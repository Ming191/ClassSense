# Docker Quickstart (Local)

## 1) Prepare environment

```bash
cp .env.example .env
```

Edit `.env` as needed.

## 2) Start core services (web + livekit + redis)

```bash
docker compose up -d --build livekit redis web
```

## 3) Create session and service token

Use the web API flow to:

1. Create a LiveKit session/room (capture its `session_id` / room name).
2. Request a token with `role=service` for the cv worker.

## 4) Set worker env values

Update `.env` with:

- `SESSION_ID=<your_session_id>`
- `LIVEKIT_TOKEN=<service_token>`

## 5) Start or restart cv-worker

```bash
docker compose up -d --build cv-worker
```

If the worker is already running:

```bash
docker compose restart cv-worker
```

## Notes

- Current web session state is in-memory and will reset when the web container restarts.
