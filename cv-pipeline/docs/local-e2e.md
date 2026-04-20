# Local non-mock E2E (real CV pipeline -> ClassSense signals)

This flow validates end-to-end signal ingestion using **real** CV outputs (face detection + aggregator engagement).

## 1) Start the Next.js app

From `class-sense/`:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## 2) Browser heuristic publisher has been removed

The old browser-side heuristic signal publisher was removed from the room flow.

## 3) Create/join session as host and open dashboard

1. Create or join a room as host in the web app.
2. Open the host dashboard for that room.
3. Copy the room/session code (used as `--session-id` below).

## 4) Set worker secret for service token endpoint

In `class-sense/.env.local` (or runtime env), set:

```env
WORKER_AUTH_SECRET=dev-worker-secret
```

Restart Next.js server after changing env vars.

## 5) Run LiveKit CV service worker (recommended core flow)

From `cv-pipeline/`:

```bash
python scripts/livekit_worker_e2e.py --session-id JBGTEM85 --base-url http://localhost:3000 --worker-secret dev-worker-secret
```

What this does:
- Requests `POST /api/sessions/{id}/worker-token`
- Joins LiveKit as hidden subscribe-only participant
- Subscribes student video tracks
- Converts LiveKit `VideoFrame` -> BGR ndarray
- Runs CV pipeline + score aggregator
- Publishes to `POST /api/sessions/{id}/signals`

## 6) Run worker in Docker (service mode)

From repo root (`ClassSense/`):

```bash
docker compose -f docker-compose.cv-worker.yml up --build
```

Required environment variables (PowerShell example):

```powershell
$env:CLASSSENSE_SESSION_ID = "JBGTEM85"
$env:WORKER_AUTH_SECRET = "dev-worker-secret"
```

Optional:

```powershell
$env:CLASSSENSE_BASE_URL = "http://host.docker.internal:3000"
$env:LIVEKIT_URL_OVERRIDE = "ws://livekit:7880"
$env:PUBLISH_INTERVAL = "3.0"
```

This compose stack runs:
- `livekit` (local SFU)
- `cv-worker` (service participant)

The worker still publishes signals to your Next.js app running on host (`localhost:3000`).

## 7) Optional: run local webcam CV student publisher

From `cv-pipeline/`:

```bash
python scripts/local_student_e2e.py --session-id JBGTEM85 --base-url http://localhost:3000 --show-preview
```

Optional tuning:

```bash
python scripts/local_student_e2e.py --session-id <ROOM_CODE> --camera-index 0 --width 640 --height 480 --fps 20 --publish-interval 3.0
```

## 8) Expected behavior

- Script logs every publish interval with values like:
  - timestamp
  - engagement
  - face_detected
  - emotion
  - yaw/pitch
- Host dashboard updates should reflect CV-driven signal changes.
- If face is not visible, `faceDetected` should switch false and engagement may drop.
