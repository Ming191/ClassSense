# ClassSense v2 — HCI-Enhanced Video Conferencing Platform

**ClassSense v2** is an HCI-enhanced video conferencing platform built for online education. Moving beyond traditional passive monitoring, ClassSense acts as a fully self-contained conferencing system with **real-time Computer Vision (CV) analysis** and **closed-loop Human-Computer Interaction (HCI) feedback** to improve student engagement and teacher responsiveness.

This platform was developed organically as an evolution from a passive dashboard overlay (v1) into a fully-fledged WebRTC media platform (v2).

## Key Features

*   **Self-Contained Video Conferencing**: Built on LiveKit, supporting audio, video, and screenshare without needing third-party platforms like Zoom or Meet.
*   **Real-time CV Pipeline**: Analyzes facial landmarks, head pose, blink rates, and emotions to calculate an ongoing "Engagement Score" (processed locally).
*   **Live Gaze Heatmap**: Overlays a gaze density map directly onto the teacher's screenshare to visualize where the class's attention is focused.
*   **Adaptive Pacing Alerts**: Detects drops in class-wide engagement and suggests context-aware interventions to the teacher (e.g., taking a break or running a poll).
*   **Confusion & Fatigue Detection**: Privately prompts students to raise their hands if confusion is detected, and flags potential fatigue to both students and teachers.
*   **Attention Timeline**: Provides teachers with live and post-session scrubbing of class engagement trends to analyze instructional effectiveness.

## Tech Stack

*   **Frontend**: Next.js 15 (App Router), React, TypeScript, Tailwind CSS v4, Zustand.
*   **WebRTC Layer**: LiveKit (`livekit-server`).
*   **Backend & DB**: Next.js API Routes + Prisma (SQLite).
*   **CV Worker**: Python 3.12, OpenCV, MediaPipe, SixDRepNet, emotiefflib.
*   **Realtime Interactivity**: Redis Pub/Sub & Server-Sent Events (SSE).

## High-Level Architecture

ClassSense uses **Docker Compose** to run all services locally. The pipeline operates as follows:

1.  Students and teachers connect to the **LiveKit SFU** via their browsers.
2.  The **CV Worker** automatically joins active room sessions as a hidden service participant.
3.  The CV Worker processes video frames (extracting metrics) and continually publishes **Engagement Scores** and **HCI Events** into **Redis**.
4.  The Next.js backend reads off Redis and streams realtime score overlays and heatmap data to the Teacher Dashboard via SSE.

## Local Quick Start (Docker)

ClassSense v2 is designed for fully local deployment using Docker Compose. Make sure you have Docker and Python installed.

### 1. Prepare Environment
Set up your environment variables and download the ML models required for the vision pipeline.

```bash
# Copy example env variables
cp .env.example .env

# Download open-source CV weights (creates /models folder)
python cv-pipeline/scripts/download_models.py
```
*(Ensure `.env` contains `DATABASE_URL=file:/app/prisma/dev.db`)*

### 2. Start Core Infrastructure
Bring up the frontend web app, Redis cache, and livekit media server:

```bash
docker compose up -d --build livekit redis web
```

### 3. Start the Computer Vision Worker
Bring up the CV pipeline worker:

```bash
docker compose up -d --build cv-worker
```
The CV worker runs in an automatic lifecycle mode: it listens for Redis lifecycle events and will auto-attach to sessions when they are created via the web platform.

### 4. Create and Run a Class
1. Navigate to the web frontend at `http://localhost:3000` (or your `$HOST_IP`).
2. Create a new session through the Dashboard. 
3. Distribute the generated join link. The CV worker will seamlessly begin operating in the background once the session starts!

## Comprehensive Documentation

For a multi-page deep dive into the scientific background, algorithmic scoring formulas, and granular details of the system architecture, check out the main design document:
*   [ClassSense v2 Technical Document](./ClassSense_v2_Technical_Document_LocalDocker.md)
