# ClassSense v2 — HCI-Enhanced Video Conferencing Platform for Online Education

**Version:** 2.0  
**Date:** April 2026  
**Scope:** Evolution of the ClassSense engagement analysis system into a self-contained video conferencing platform with real-time HCI feedback, built as a course project.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Scientific Basis & HCI Research](#2-scientific-basis--hci-research)
3. [Tech Stack & ML Models](#3-tech-stack--ml-models)
4. [System Architecture v2](#4-system-architecture-v2)
5. [Data Flow & Workflow](#5-data-flow--workflow)
6. [Engagement Score — Unchanged Core](#6-engagement-score--unchanged-core)
7. [HCI Features — Design & Implementation](#7-hci-features--design--implementation)
8. [Unified Teacher Dashboard](#8-unified-teacher-dashboard)
9. [Student Experience Design](#9-student-experience-design)
10. [Cloud Deployment](#10-cloud-deployment)
11. [Revised 8-Week Roadmap](#11-revised-8-week-roadmap)
12. [Privacy & Ethics](#12-privacy--ethics)
13. [Technical Limitations & HCI Ambiguity](#13-technical-limitations--hci-ambiguity)
14. [References](#14-references)

---

## 1. System Overview

### 1.1 From v1 to v2 — The Evolution

ClassSense v1 solved a real problem — giving teachers objective engagement data during online classes — but operated as a **passive overlay**: it assumed students were already in Zoom or Google Meet, and ClassSense ran alongside that experience as a separate sensor layer.

ClassSense v2 **eliminates the dependency on third-party conferencing platforms** by building the video conferencing layer directly into the product. This shift is motivated by three constraints v1 could not solve:

1. **Feature coupling:** HCI interventions (e.g., surfacing a "confused?" prompt on the student's screen when their confusion signal spikes) require control over the student's UI — impossible when the student is inside Zoom.
2. **Data access:** Server-side gaze heatmap computation requires access to the teacher's screenshare as a video stream — not available when screenshare happens inside a third-party app.
3. **Research value:** For a course project, building a system with WebRTC-based video, real-time CV analysis, and closed-loop HCI feedback is significantly more novel than a dashboard overlay.

### 1.2 v2 Solution

ClassSense v2 is a browser-based video conferencing platform purpose-built for online education. It integrates:

- **WebRTC video conferencing** powered by a self-hosted LiveKit SFU
- **Real-time engagement analysis** from the v1 CV pipeline (unchanged)
- **Closed-loop HCI feedback** — the system acts on engagement signals within the same interface, not just displays them

The system is designed for small to medium online classes (1–20 students) and provides features measurably beyond Zoom/Meet from an HCI standpoint: gaze heatmaps, adaptive pacing alerts, confusion detection with automatic hand-raise suggestions, attention timelines, and post-session behavioral analysis.

### 1.3 Scope v2.0

- Video conferencing: audio + video for up to 20 participants
- Platforms: any modern browser (Chrome, Firefox, Edge) — no installation required
- Deployment: GCP (LiveKit SFU on Cloud Run + existing Firestore/Pub/Sub infrastructure)
- CV pipeline: **unchanged from v1** — frame source changes from WebSocket to LiveKit track subscription
- HCI features: 6 features in v2.0 (see Section 7)

---

## 2. Scientific Basis & HCI Research

### 2.1 WebRTC & Selective Forwarding Units

WebRTC (Web Real-Time Communication) is the IETF standard for browser-based peer-to-peer audio/video. In a classroom with N students, pure peer-to-peer requires N×(N−1) connections — infeasible beyond ~4 participants. A **Selective Forwarding Unit (SFU)** is a media server that receives one stream per participant and forwards them selectively. Unlike MCUs (Multipoint Control Units), SFUs do not transcode — they forward packets as-is, making them highly scalable and CPU-efficient [13].

LiveKit is an open-source SFU built on the Pion WebRTC stack (Go). It handles STUN/TURN, adaptive bitrate, simulcast, and provides SDKs for browsers (JS/React), iOS, Android, and Python — the last being critical for server-side CV frame access.

### 2.2 Closed-Loop HCI in Education Technology

Traditional educational technology presents data **to the teacher** for manual intervention. Research by Verbert et al. (2014) [14] on learning analytics dashboards found that teachers benefit most from actionable, context-sensitive alerts rather than raw metrics. However, the gap between "alert shown" and "teacher responds" averages 2–4 minutes in practice.

Closed-loop systems — where the platform itself triggers micro-interventions based on behavioral signals — have been shown to reduce this gap to under 10 seconds. D'Mello & Graesser (2012) [15] demonstrated that **automated affect-sensitive tutoring systems** that respond to confusion (e.g., by offering a hint or changing the explanation style) outperform human tutors in some contexts. ClassSense v2 adopts a softer version of this: the system **suggests interventions** rather than executing them autonomously, keeping the teacher in control.

### 2.3 Gaze Heatmaps in Instructional Design

Heatmap visualization of gaze distribution during instruction has been studied since the 1960s (Yarbus, 1967). In digital education contexts, Sharma et al. (2020) [16] found that teachers who could see where students' gaze clustered during slide presentations adapted their explanations significantly — spending more time on elements that generated high dispersion (students looking in different directions, indicating confusion) and less time on elements that generated focused gaze (students aligned on the same region, indicating comprehension).

ClassSense v2 generates gaze heatmaps aggregated across the class and overlaid on the teacher's screenshare in real-time, implementing Sharma et al.'s recommendation at practical scale.

### 2.4 Confusion Detection & Social Friction

A consistent finding in online education research is that students are significantly less likely to signal confusion (by raising a hand or asking a question) in online settings compared to in-person [17]. This is attributed to:

- Reduced social presence (camera may be off, microphone muted)
- Fear of disrupting the class in a shared audio channel
- Uncertainty about whether confusion is personal or shared

Poquet et al. (2021) [18] found that **private, low-friction confusion signals** (e.g., a button that anonymously tells the teacher "I'm confused") dramatically increased student willingness to signal confusion (84% vs. 31% in control groups). ClassSense v2 implements this as an automated suggestion: when the CV pipeline detects sustained confusion signals, it prompts the student privately — removing the social barrier while keeping the action voluntary.

### 2.5 Cognitive Load & Fatigue in Online Learning

Clark et al. (2006) [19] established that **extraneous cognitive load** — load imposed by interface design and attentional demands beyond the content itself — significantly impairs learning in online environments. One underappreciated source of extraneous load is the **absence of natural session pacing** in online classes: without the physical cues that regulate in-person class rhythm (standing up, writing on board, moving around the room), online sessions tend to run at uniform intensity with no natural rest points.

ClassSense v2's Fatigue Warning feature (Section 7.5) applies Sweller's cognitive load framework [20] by monitoring multi-signal fatigue indicators and recommending micro-breaks, directly reducing extraneous load.

### 2.6 Teacher Self-Monitoring & Reflection

Research in teaching practice (Rowe, 1986 [21]) has consistently shown that teachers benefit from feedback about their own behavior as much as about their students'. In online settings, teachers rarely receive feedback about whether they are maintaining adequate visual contact with students (i.e., looking at the camera vs. their notes or presentation). ClassSense v2 includes optional teacher gaze feedback as a reflective tool for instructor development.

---

## 3. Tech Stack & ML Models

### 3.1 Language & Runtime

| Component | Version | Role |
|---|---|---|
| Python | 3.12 | CV Worker |
| Node.js | 20 LTS | Next.js app runtime |
| TypeScript | 5.x | Type-safe frontend + API routes |
| uv | latest | Python package manager |

### 3.2 WebRTC Layer — LiveKit

| Component | Package | Role |
|---|---|---|
| LiveKit Server | `livekit/livekit-server` (Docker) | SFU — routes video/audio between participants |
| LiveKit Python SDK | `livekit>=0.11` | CV Worker subscribes to student video tracks |
| LiveKit React SDK | `@livekit/components-react>=2.0` | Student + Teacher browser clients |
| LiveKit JS SDK | `livekit-client>=2.0` | Low-level WebRTC control (custom UI) |
| TURN Server | LiveKit built-in / Coturn | NAT traversal for restrictive networks |

**Why LiveKit over mediasoup or Janus:** LiveKit's Python SDK provides a `VideoStream` abstraction that delivers decoded `VideoFrame` objects (RGBA/I420 buffers) directly to Python — this is the key integration point with the existing CV pipeline. mediasoup requires Node.js server-side and has no Python SDK. Janus is C and requires custom plugins for Python integration.

### 3.3 Computer Vision Pipeline (Unchanged from v1)

The CV pipeline is identical to v1. Only the frame source changes: instead of receiving JPEG bytes over WebSocket, the CV Worker receives `VideoFrame` objects from LiveKit's Python SDK and converts them to NumPy arrays.

| Component | Library | Version | Model |
|---|---|---|---|
| Face Detection + Landmarks | `mediapipe` | ≥ 0.10.33 | `face_landmarker.task` (3.7 MB) |
| Head Pose Estimation | `sixdrepnet` | ≥ 0.1.6 | `6DRepNet_300W_LP_AFLW2000.pth` (60 MB) |
| Emotion Recognition | `emotiefflib` | ≥ 1.1.1 | `enet_b0_8_best_afew.onnx` (20 MB) |
| Image I/O | `opencv-python` | ≥ 4.10.0 | — |
| Numerics | `numpy` | ≥ 2.0.0 | — |

Frame conversion from LiveKit `VideoFrame` to NumPy:

```python
from livekit import rtc
import numpy as np
import cv2

def livekit_frame_to_bgr(frame: rtc.VideoFrame) -> np.ndarray:
    # LiveKit delivers I420 (YUV) or RGBA depending on platform
    buf = np.frombuffer(frame.data, dtype=np.uint8)
    if frame.type == rtc.VideoBufferType.RGBA:
        rgba = buf.reshape((frame.height, frame.width, 4))
        return cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)
    elif frame.type == rtc.VideoBufferType.I420:
        yuv = buf.reshape((frame.height * 3 // 2, frame.width))
        return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)
```

### 3.4 New Backend Services

| Service | Technology | Role |
|---|---|---|
| Session Manager | Next.js API Routes + Firestore | Room creation, token issuance, participant management |
| CV Worker v2 | Python + LiveKit SDK | Track subscription + CV pipeline (replaces thin_client + gateway) |
| Gaze Heatmap Aggregator | Python + NumPy | Accumulate gaze points into heatmap grid per screenshare frame |
| Screenshare Frame Cache | Redis (Cloud Memorystore) | Cache latest screenshare frame for heatmap overlay computation |
| Intervention Engine | Python | Rule-based engine that generates HCI intervention events |

Session Manager endpoints are implemented as Next.js API Routes under `app/api/`, co-located with the frontend in the same Next.js monorepo. This eliminates the need for a separate FastAPI service for non-CV logic:

```
app/
├── api/
│   ├── sessions/
│   │   ├── route.ts          # POST /api/sessions  → create room + Firestore doc
│   │   └── [id]/
│   │       ├── route.ts      # GET /api/sessions/[id] → session info
│   │       └── token/
│   │           └── route.ts  # POST /api/sessions/[id]/token → issue LiveKit JWT
│   └── auth/
│       └── [...nextauth]/
│           └── route.ts      # NextAuth handler (if using NextAuth)
```

LiveKit token issuance in a Next.js API Route:

```typescript
// app/api/sessions/[id]/token/route.ts
import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { identity, displayName, role } = await req.json();

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { identity, name: displayName }
  );

  at.addGrant({
    room: `classsense-${params.id}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: role === "teacher",
  });

  return NextResponse.json({ token: await at.toJwt() });
}
```

### 3.5 Frontend Stack

| Component | Technology | Role |
|---|---|---|
| Framework | **Next.js 15** (App Router) | Unified teacher dashboard + student client — two route groups in one app |
| Language | TypeScript 5.x | Type-safe throughout |
| Video Components | `@livekit/components-react>=2.0` | VideoTile, AudioTrack, ConnectionState |
| Charts | Recharts | Engagement timeline, trend line |
| Heatmap | `heatmap.js` | Gaze density overlay on screenshare canvas |
| State Management | Zustand | Client-side engagement state, alert queue |
| Styling | Tailwind CSS v4 | Utility-first, responsive |
| Auth | Firebase Auth (client SDK) + `next-firebase-auth-edge` | SSR-compatible session cookies for teacher + student auth |
| Realtime Data | Firestore JS SDK (`onSnapshot`) | Live engagement scores, HCI events |
| Hosting | **Vercel** | Zero-config Next.js deploy, edge network, preview deployments per PR |

**Route structure:**

```
app/
├── (teacher)/                  # Route group — teacher layout
│   ├── dashboard/[sessionId]/  # Live class view: video grid + overlays
│   ├── sessions/               # Session management: create, history
│   └── report/[sessionId]/     # Post-session report
├── (student)/                  # Route group — student layout
│   └── join/[sessionId]/       # Student conference view
├── api/                        # API Routes (Session Manager)
│   ├── sessions/
│   └── sessions/[id]/token/
└── layout.tsx                  # Root layout, Firebase Auth provider
```

**Why Next.js over plain React (CRA/Vite):**
- API Routes eliminate the need for a separate FastAPI service for session management and token issuance — non-CV business logic lives co-located with the frontend. The CV Worker remains Python.
- App Router Server Components pre-render report pages server-side (engagement charts as static HTML), reducing Time-to-Interactive on low-spec devices.
- `next/dynamic` with `{ ssr: false }` isolates WebRTC and LiveKit components (which require `window`/`navigator`) without manual lazy-loading boilerplate.
- Vercel preview deployments per branch allow rapid HCI feature iteration and sharing demo links with course instructors.

---

## 4. System Architecture v2

### 4.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                STUDENT BROWSER (Next.js — /join/[sessionId])        │
│                                                                      │
│  Camera/Mic → LiveKit JS SDK → WebRTC tracks                         │
│  Receives: engagement feedback, confusion prompt, fatigue alert      │
│  Sends: confusion button clicks, opt-out toggle                      │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │ WebRTC (SRTP/DTLS)
                                  │ ~1–2 Mbps per student
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  LIVEKIT SFU (Cloud Run / GKE)                       │
│                                                                      │
│  Receives all student video + audio tracks                           │
│  Forwards to: Teacher browser + CV Worker (as service participant)   │
│  Handles: simulcast, adaptive bitrate, TURN relay                    │
└──────────┬────────────────────────────────┬──────────────────────────┘
           │ WebRTC to teacher              │ LiveKit SDK (Python)
           │                               │ CV Worker subscribes to
           ▼                               │ each student's video track
┌──────────────────────┐                   ▼
│  TEACHER BROWSER     │  ┌────────────────────────────────────────────┐
│  (Next.js)           │  │           CV WORKER (Cloud Run)            │
│                      │  │                                            │
│  Video grid          │  │  For each student video track:             │
│  Engagement overlay  │  │  VideoFrame → BGR NumPy                    │
│  Gaze heatmap        │  │  → face_detector.py                        │
│  Alert feed          │  │  → landmark_analyzer.py (EAR, gaze)        │
│  Timeline scrubber   │  │  → pose_estimator.py (6DRepNet)            │
│                      │  │  → emotion_classifier.py (emotiefflib)     │
└──────────────────────┘  │  → FrameSignal                             │
           ▲               │  → Score Aggregator                        │
           │ Firestore     │  → Intervention Engine                     │
           │ realtime      │                                            │
           │               └──────────────────┬─────────────────────────┘
           │                                  │
           │               ┌──────────────────▼─────────────────────────┐
           │               │            FIRESTORE                        │
           └───────────────│  sessions/{id}/students/{id}/scores         │
                           │  sessions/{id}/hci_events                   │
                           │  sessions/{id}/gaze_heatmap                 │
                           └────────────────────────────────────────────┘
```

### 4.2 Key Architectural Decisions

#### CV Worker as LiveKit Service Participant

The CV Worker joins each room as a **service participant** (invisible to students and teachers) using a server-side LiveKit token with `canPublish: false, canSubscribe: true`. It subscribes to all video tracks in the room and processes frames in parallel using asyncio.

This design preserves 100% of the v1 CV pipeline — only the frame acquisition path changes. The Worker no longer needs the WebSocket gateway or Pub/Sub queue, simplifying the architecture significantly.

```
v1: Thin Client → WebSocket → Gateway → Pub/Sub → CV Worker
v2: LiveKit SFU → (Python SDK) → CV Worker  [direct, no queue needed]
```

Pub/Sub is retained for the Gaze Heatmap Aggregator, which needs to collect gaze points from all students before generating a heatmap. This is a fan-in aggregation pattern that fits Pub/Sub well.

#### Screenshare-Aware Gaze Heatmap

When the teacher shares their screen, the LiveKit server publishes the screenshare as a separate video track. The CV Worker:
1. Detects when a screenshare track becomes active (via LiveKit room event)
2. Subscribes to the screenshare track
3. Caches the latest screenshare frame in Redis (Memorystore)
4. For each student's gaze vector, projects it onto the screenshare coordinate space
5. Accumulates projected gaze points into a 2D histogram
6. Writes the normalized heatmap array to Firestore every 5 seconds
7. Teacher dashboard overlays the heatmap on the screenshare canvas using heatmap.js

#### Token-Based Room Access Control

Room access is controlled entirely through JWT tokens issued by the Session Manager:

```
Teacher creates session
  → Session Manager creates Firestore doc + LiveKit room
  → Issues teacher token (canPublish, canSubscribe, canAdminRoom)
  → Returns invite link with embedded session_id

Student opens invite link
  → Session Manager issues student token (canPublish: video+audio, canSubscribe)
  → Token encodes: { student_id, session_id, display_name, iat, exp }
  → Student client connects to LiveKit with token

CV Worker
  → Session Manager issues service token per room (canSubscribe only, hidden)
  → Worker auto-joins when Firestore session status = "active"
```

---

## 5. Data Flow & Workflow

### 5.1 Session Lifecycle

```
[Teacher]
1. Authenticates via Firebase Auth (Google SSO or email/password)
2. Clicks "New Session" → Session Manager creates:
   - Firestore doc: sessions/{session_id}
   - LiveKit room: classsense-{session_id}
3. Receives shareable link: https://app.classsense.io/join/{session_id}

[Students]
4. Open link → enter display name → grant camera/mic permission
5. Receive LiveKit token from Session Manager
6. Connect to LiveKit SFU → video/audio track published
7. Firestore listener subscribes to engagement score updates for their own student_id

[CV Worker]
8. Detects new session in Firestore (status = "active")
9. Joins LiveKit room as service participant
10. Subscribes to all VIDEO tracks as they appear
11. Begins frame processing loop per participant
```

### 5.2 Per-Student Frame Processing Loop

```
[LiveKit SFU]
1. Deliver VideoFrame to CV Worker Python SDK (I420/RGBA buffer)
   ← ~15 fps by default, ~200KB/s uncompressed equivalent

[CV Worker — per student, async task]
2. livekit_frame_to_bgr(frame) → NumPy BGR array (320×240 target)
3. face_detector.py → face bounding box, 478 landmarks
   If no face detected → emit FACE_MISSING, skip steps 4–7
4. landmark_analyzer.py → EAR (left/right), blink event, gaze_zone, iris_offset_xy
5. pose_estimator.py → yaw, pitch, roll (degrees)
6. emotion_classifier.py → emotion label, probs[8]
7. Construct FrameSignal dataclass (identical schema to v1)
8. Push to Score Aggregator (sliding window buffer per student)

[Score Aggregator — per student]
9. Compute E(t) = 0.35×S_blink + 0.30×S_gaze + 0.25×S_pose + 0.10×S_emotion
10. Apply EMA(α=0.3) → E_display(t)
11. Detect event flags (DISTRACTION, DROWSY, CONFUSED, FACE_MISSING, LOW_ENGAGEMENT)
12. Write to Firestore: sessions/{id}/students/{student_id}/scores
    payload: { timestamp, score, flags, gaze_zone, emotion, yaw, pitch }

[Intervention Engine — per student]
13. Evaluate HCI rules against latest FrameSignals + Score
14. If rule fires → write HCI event to Firestore: sessions/{id}/hci_events
    payload: { type, student_id, timestamp, suggested_action, auto_trigger }

[Firestore → Teacher Dashboard]
15. onSnapshot listener receives score update → update video tile color overlay
16. onSnapshot on hci_events → trigger alert, animate UI element

[Firestore → Student Client]
17. onSnapshot on hci_events filtered by student_id → show private prompt if applicable
```

### 5.3 Gaze Heatmap Pipeline

```
[CV Worker]
Per student frame, if screenshare is active:
1. Extract iris_offset_xy from landmark_analyzer (relative to eye corner)
2. Map gaze vector to screen coordinates using head pose + iris offset
   (simplified: use yaw/pitch angles + iris_offset as 2D proxy)
3. Publish gaze point {student_id, screen_x_normalized, screen_y_normalized}
   to Pub/Sub topic: gaze-{session_id}

[Gaze Heatmap Aggregator — separate Cloud Run service]
4. Subscribe to gaze-{session_id}
5. Accumulate gaze points in 40×30 grid (matches 4:3 / 16:9 aspect ratio)
6. Every 5 seconds: normalize grid → Gaussian blur (σ=1.5) → write to Firestore
   sessions/{id}/gaze_heatmap: { grid: float[40][30], timestamp }

[Teacher Dashboard]
7. onSnapshot on gaze_heatmap → update heatmap.js canvas overlay on screenshare
```

### 5.4 Session End

```
Teacher clicks "End Session"
  → Session Manager sets Firestore session status = "completed"
  → CV Worker detects status change → disconnects from LiveKit room
  → LiveKit room auto-closes when all participants leave
  → Gaze Heatmap Aggregator flushes final grid
  → Score Aggregator flushes remaining buffer
  → Report Generator trigger fires (Firestore Function)
  → Dashboard redirects to Post-session Report
```

---

## 6. Engagement Score — Unchanged Core

The engagement scoring formula from v1 is carried into v2 without modification. This section summarizes the core for completeness. For full derivation see `ClassSense_Technical_Document.md` Section 6.

### 6.1 Formula

```
E(t) = 0.35 × S_blink(t)
     + 0.30 × S_gaze(t)
     + 0.25 × S_pose(t)
     + 0.10 × S_emotion(t)
```

Computed on sliding window W = 30 seconds, smoothed with EMA(α=0.3).

### 6.2 Sub-Scores (Summary)

| Signal | Formula basis | Normal range |
|---|---|---|
| S_blink | PERCLOS + blink rate normality | 12–20 blinks/min, PERCLOS < 0.08 |
| S_gaze | on-screen frame ratio (iris zone = "center") | > 80% |
| S_pose | frames with |yaw| < 20° and |pitch| < 15° | > 85% |
| S_emotion | valence score from emotiefflib probs[8] | neutral/happy/surprise positive |

### 6.3 Event Flags (v1 — unchanged)

`DISTRACTION` · `DROWSY` · `CONFUSED` · `FACE_MISSING` · `LOW_ENGAGEMENT`

### 6.4 New Composite Signals in v2

Two new derived signals are computed in v2 for HCI features:

**Confusion Composite Score (C_score)**

```python
# Combines emotion confusion signal + blink irregularity + gaze instability
confusion_emotion = emotion_probs["fear"] + emotion_probs["disgust"]
blink_irregular = abs(blink_rate - 15) / 15  # deviation from normal
gaze_unstable = gaze_drift_std / max_gaze_drift

C_score = 0.5 × confusion_emotion + 0.3 × blink_irregular + 0.2 × gaze_unstable
# Threshold: C_score > 0.55 sustained for > 8s → CONFUSED_SUSTAINED flag
```

**Fatigue Composite Score (F_score)**

```python
# Combines PERCLOS + prolonged low blink rate + head pose drooping
perclos_signal = min(1.0, perclos / 0.20)
staring_signal = 1.0 if blink_rate < 6 else 0.0
drooping = max(0, (pitch - 20) / 20)  # pitch > 20° = looking down

F_score = 0.5 × perclos_signal + 0.3 × staring_signal + 0.2 × drooping
session_minutes = (current_time - session_start_time).seconds / 60
fatigue_multiplier = 1 + 0.015 × max(0, session_minutes - 30)  # escalates after 30min

F_final = min(1.0, F_score × fatigue_multiplier)
# Threshold: F_final > 0.60 → FATIGUE_WARNING flag
```

---

## 7. HCI Features — Design & Implementation

### 7.1 Feature Overview

| Feature | HCI Principle | Trigger Source | Audience |
|---|---|---|---|
| Adaptive Pacing Alerts | Closed-loop feedback | Class-wide LOW_ENGAGEMENT | Teacher |
| Live Gaze Heatmap | Attention visualization | Gaze points → screenshare | Teacher |
| Confusion Detector + Hand Raise Suggestion | Social friction reduction | CONFUSED_SUSTAINED per student | Student (private) |
| Attention Timeline | Reflective analytics | Historical scores per student | Teacher |
| Multimodal Fatigue Warning | Cognitive load management | FATIGUE_WARNING | Teacher + Student |
| Teacher Gaze Feedback | Instructor self-monitoring | Teacher's own CV analysis | Teacher (post-session) |

### 7.2 Adaptive Pacing Alerts

**What:** When the class-wide average engagement drops significantly, the teacher receives a contextual alert with a concrete suggested intervention.

**Trigger logic:**

```python
class_avg = mean([student.E_display for student in active_students])
trend = class_avg - moving_avg(class_avg, window=5min)

if class_avg < 0.45 and trend < -0.10:
    severity = "critical"
    message = "Class engagement dropped sharply — consider stopping for a quick check-in"
elif class_avg < 0.55 and len(low_engagement_students) > 0.4 * class_size:
    severity = "warning"
    message = "40%+ of students showing low engagement — a 2-minute break or quick poll may help"
elif trend < -0.15:  # rapid decline even if absolute score is OK
    severity = "info"
    message = "Engagement declining — you may be approaching a natural break point"
```

**Suggested interventions surfaced by the UI:**
- "Ask a comprehension question" (most common suggestion)
- "Take a 2-minute break"
- "Change activity — try a live poll or exercise"
- "Check in with [specific struggling students by name]"

Suggestions are chosen based on session elapsed time and frequency of prior interventions in the session (avoid repeating the same suggestion within 10 minutes).

**Implementation:** Intervention Engine writes events to `sessions/{id}/hci_events`. Teacher Dashboard onSnapshot handler renders a Toast notification with suggested action buttons.

### 7.3 Live Gaze Heatmap on Screenshare

**What:** A real-time heatmap overlaid on the teacher's shared screen (slides/document) showing where students are collectively looking.

**Visual design:**
- Low-opacity warm color scale (cool blue → red) so underlying slide content remains readable
- Opacity capped at 60% to avoid blocking text
- Updates every 5 seconds (smoothed with temporal blending: 70% new + 30% previous frame to avoid flickering)
- Toggle button for teacher to show/hide overlay

**Coordinate projection:**

The gaze vector from the CV pipeline provides a `gaze_zone` (coarse: center/left/right/up/down) and `iris_offset_xy` (fine: normalized offset within the eye region). Combined with head pose (yaw, pitch), the Gaze Aggregator projects to an approximate 2D screen position:

```python
# Simplified linear projection — not geometrically precise but sufficient
# for heatmap granularity (40×30 grid = ~40 cells wide on a 16:9 display)
screen_x = 0.5 + (iris_offset_x × 1.8) - (yaw_deg / 90 × 0.8)
screen_y = 0.5 + (iris_offset_y × 1.8) + (pitch_deg / 60 × 0.6)
screen_x = max(0.0, min(1.0, screen_x))
screen_y = max(0.0, min(1.0, screen_y))
```

**Known limitation:** This projection is a heuristic approximation. True screen-space gaze requires per-user calibration (as in GazeFollower [22]). The heatmap's value in ClassSense v2 is relative (where is attention *clustered*) rather than absolute (is student looking at pixel X, Y). It is sufficient for teacher actionability but should not be used as ground truth.

**Implementation:** heatmap.js renders on a `<canvas>` element overlaid on the screenshare `<video>` element. The canvas is positioned absolutely with `pointer-events: none` to allow teacher interaction with the screenshare.

### 7.4 Confusion Detector → Hand Raise Suggestion

**What:** When a student's Confusion Composite Score (C_score) crosses the threshold and they have not already used the raise-hand function, a private prompt appears on their screen: *"Having trouble with this? You can let [teacher name] know →"* with a single-click "Raise Hand" button.

**Why this works:** The prompt is:
- **Private** — only visible to the student, not the class
- **Low friction** — one click, no audio required
- **Voluntary** — student can dismiss it without consequence
- **Context-matched** — only appears when CV signal confirms confusion, not as a random nudge

**Trigger logic:**

```python
# Fire only if:
# 1. C_score > 0.55 for at least 8 seconds
# 2. Student has not raised hand in last 5 minutes
# 3. Not already showing this prompt to the student
if (student.C_score_sustained_seconds >= 8 and
    student.last_hand_raise_time < now - 5min and
    not student.confusion_prompt_active):

    write_hci_event(
        type="CONFUSION_PROMPT",
        student_id=student.id,
        auto_trigger=True,
        suggested_action="raise_hand"
    )
```

**Student receives:** `sessions/{id}/hci_events` filtered by `student_id` — only sees their own events.

**Teacher view:** When the student clicks "Raise Hand" (whether self-initiated or after prompt), teacher sees the standard hand-raise indicator. Teacher never sees whether the raise was self-initiated or CV-triggered — this avoids stigmatizing students flagged by the system.

### 7.5 Multimodal Fatigue Warning

**What:** When F_final crosses 0.60 for a student, the teacher receives an unobtrusive badge on the student's video tile. When it affects > 30% of the class, a class-level suggestion appears: *"Several students may be fatigued — a short break is recommended."*

**Student experience:** Students do not see their own fatigue score (to avoid discouraging or embarrassing them). They may receive a **break suggestion** from the teacher via a broadcast mechanism (teacher clicks "Suggest Break" → students see a 5-second countdown banner).

**Implementation note:** The fatigue multiplier that escalates F_final after 30 minutes of session time is important for calibration. A student with identical signals at minute 15 vs. minute 55 of a session should be treated differently; the cognitive load literature supports this — fatigue compounds with session duration [19].

### 7.6 Attention Timeline (Post-Session + Live)

**What:** A horizontal timeline bar per student showing their engagement score over the full session, color-coded by score bucket. The teacher can scrub through it to review the session and click on low-engagement or high-confusion periods to see a snapshot (if snapshot consent was given).

**Live view:** During the session, the timeline shows the last 10 minutes rolling. The teacher can see at a glance which students have been consistently low-engagement vs. recently dropped.

**Post-session view:** Full session timeline. Low-point events (where class-wide average dropped > 20% in 5 minutes) are annotated with a flag icon. Teacher can hover to see the aggregate class-wide signal at that moment, helping them understand which content segments caused disengagement.

**Data model:**

```
sessions/{session_id}/students/{student_id}/scores  (subcollection)
  documents: one per score update
  fields: { timestamp, score, flags, emotion, gaze_zone, yaw, pitch }
```

The frontend queries this subcollection for the timeline. For live view, the existing `onSnapshot` listener already populates a local ring buffer.

### 7.7 Teacher Gaze Feedback (Post-Session, Optional)

**What:** If the teacher opts in, the CV Worker also analyzes the teacher's own video track. Post-session, the teacher receives a summary:
- % of time looking at camera (direct eye contact with students)
- % of time looking down (at notes or keyboard)
- % of time looking at screenshare (referencing slides)

**Framing:** This feature is explicitly positioned as a **reflective development tool**, not a surveillance metric. The data is private to the teacher and not visible to students or administrators.

**Implementation:** Teacher's video track is processed identically to student tracks. The FrameSignal is stored in a separate Firestore subcollection accessible only to the teacher's UID. Gaze zone from the teacher's perspective maps to: `camera` (center gaze → eye contact), `down` (looking at notes), `right/left` (looking at secondary screen or slides).

---

## 8. Unified Teacher Dashboard

### 8.1 Layout Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ClassSense            [Session: Bio 101]    [45:23]    [End Session]     │
├──────────────────────┬───────────────────────────────┬───────────────────┤
│                      │                               │                   │
│  VIDEO GRID          │   SCREENSHARE + HEATMAP       │  ALERT FEED       │
│  (student tiles)     │   (when active)               │                   │
│                      │   ┌─────────────────────┐     │  ⚠ Minh mất TC   │
│  ┌──┐┌──┐┌──┐┌──┐   │   │ [slide content]     │     │  3m ago           │
│  │🟢││🟡││🔴││🟢│   │   │ ░░░░░░░░░░░░░░░░░░ │     │                   │
│  └──┘└──┘└──┘└──┘   │   │ ░ heatmap overlay ░ │     │  💤 Hoa buồn ngủ  │
│                      │   │ ░░░░░░░░░░░░░░░░░░ │     │  1m ago           │
│  ┌──┐┌──┐┌──┐┌──┐   │   └─────────────────────┘     │                   │
│  │🟢││🟢││🟡││🟢│   │                               │  📊 3/8 low eng.  │
│  └──┘└──┘└──┘└──┘   │   CLASS TREND                 │  — Thay đổi nhịp? │
│                      │   [rolling 5min avg line]     │                   │
│  Hover → sub-scores  │                               │  [Raise Break]    │
│  Click → timeline    │                               │  [Run Poll]       │
│                      │                               │                   │
└──────────────────────┴───────────────────────────────┴───────────────────┘
│ ATTENTION TIMELINE: ──────────────────────────────────── last 10 min ─── │
│  Nguyen A  [██████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]     │
│  Tran B    [████████████████████████████████████████░░░░░░░░░░░░░░░]     │
│  Le C      [░░░░░░░░░░░░░░████████████████████████████████████████]     │
└──────────────────────────────────────────────────────────────────────────┘
Legend: ██ High  ░░ Low
```

### 8.2 Video Tile Color Overlay

Each student tile has a colored border/background tint that reflects their current `E_display`:

| Score | Color | Meaning |
|---|---|---|
| ≥ 0.70 | Green (#22c55e, 30% opacity) | Engaged |
| 0.45–0.69 | Amber (#f59e0b, 30% opacity) | Moderate |
| < 0.45 | Red (#ef4444, 40% opacity) | Needs attention |
| FACE_MISSING | Gray (#6b7280) | Not visible |

Hovering a tile shows a tooltip with sub-scores: blink rate, gaze status, head pose, dominant emotion, and current flags.

### 8.3 Post-Session Report

The post-session report is auto-generated from Firestore data when the session ends.

**Sections:**
1. **Session summary:** duration, number of students, average class engagement, peak and trough points
2. **Engagement timeline:** multi-line chart with one trace per student + class average trace; low-point annotations
3. **Content-engagement correlation:** if teacher annotated timestamps (e.g., "switched to new topic at 00:23:00"), engagement curve segments are shown aligned to those annotations
4. **Per-student breakdown:** table with avg_score, n_distraction, n_drowsy, n_confused, dominant_emotion, time_face_missing
5. **Snapshot gallery:** thumbnails of event snapshots (if snapshot consent granted), grouped by student and event type
6. **HCI event log:** timeline of all HCI events (confusion prompts triggered, pacing alerts fired, fatigue warnings)

**Export:** PDF (via browser `window.print()` with print CSS) and CSV of raw score time-series.

---

## 9. Student Experience Design

### 9.1 Student Client Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Bio 101 — Nguyễn Văn Minh              [●] Live  │
├────────────────────────────────────┬────────────────────────────────┤
│                                    │                                 │
│   TEACHER VIDEO / SCREENSHARE      │   YOUR VIDEO                   │
│   (large, dominant)                │   (small, bottom corner)       │
│                                    │                                 │
│                                    │   [🖐 Raise Hand]               │
│                                    │   [🎤 Mute]  [📷 Camera Off]   │
│                                    │   [⚙ Settings]                 │
│                                    │                                 │
└────────────────────────────────────┴────────────────────────────────┘
│  STATUS: 🟢 Analysis active  |  [Pause Analysis]  [Privacy Info]    │
└─────────────────────────────────────────────────────────────────────┘

[Confusion prompt — private, appears bottom-right when triggered]
┌─────────────────────────────────┐
│ ❓ Đang khó hiểu phần này?      │
│ Thầy/cô có thể giải thích thêm  │
│ [🖐 Báo với giáo viên]  [Bỏ qua]│
└─────────────────────────────────┘
```

### 9.2 Consent & Privacy Controls

The student client enforces a **consent-first flow** before any frame is processed:

1. Student opens invite link → sees privacy notice (1-2 sentences, plain language)
2. Two explicit toggles:
   - "Allow behavior analysis for this session" (required to participate with analysis)
   - "Allow snapshot capture when alerts are triggered" (optional, separate consent)
3. Analysis toggle is visible at all times in the status bar — student can pause at any moment

**What students see:**
- Status indicator: 🟢 analysis active / ⚪ analysis paused / 🟡 snapshot recently saved
- No engagement score is shown to the student (to avoid self-consciousness affecting natural behavior)

### 9.3 Self-Awareness Feedback (Optional Feature, Default Off)

When enabled (teacher opt-in at session creation), students see a minimal, delayed engagement indicator — a simple colored dot that updates every 2 minutes. Research by Gureckis & Markman (2012) [23] suggests that real-time feedback loops can cause students to optimize for the measurement rather than the learning. The 2-minute delay and single-indicator design minimizes this Hawthorne effect while preserving the motivational benefit for students who want it.

---

## 10. Cloud Deployment

### 10.1 Services Overview

| Component | GCP Service | Notes |
|---|---|---|
| LiveKit SFU | Cloud Run (always-on, min=1) | Stateful — cannot scale-to-zero mid-session |
| CV Worker | Cloud Run (scale 0→N) | Scales per active session; 1 instance per 5 students |
| Session Manager (API Routes) | **Vercel** (serverless functions) | Next.js API Routes; auto-scaled, zero cold-start on Vercel edge |
| Gaze Heatmap Aggregator | Cloud Run (scale-to-zero) | Activated per session via Pub/Sub |
| Gaze Point Queue | Pub/Sub | Topic: `gaze-{session_id}` |
| Session Data | Firestore | Realtime listener for dashboard |
| Snapshot Storage | GCS (CMEK) | Event snapshots, 30-day lifecycle |
| Screenshare Frame Cache | Cloud Memorystore (Redis) | Latest screenshare frame for heatmap projection |
| Dashboard + Student Client | **Vercel** | Next.js SSR + static, CDN-distributed, preview per branch |
| TURN Server | LiveKit built-in (UDP 443) | NAT traversal; alternatively Coturn on GCE |

### 10.2 LiveKit Deployment on Cloud Run

LiveKit requires persistent WebSocket connections (duration of the class session). Cloud Run supports long-lived connections via `--timeout=3600`. LiveKit's own documentation recommends running it on a VM or GKE for production, but for a course project Cloud Run is adequate up to ~20 concurrent participants.

```dockerfile
# LiveKit SFU on Cloud Run
FROM livekit/livekit-server:latest

COPY livekit.yaml /etc/livekit.yaml

CMD ["--config", "/etc/livekit.yaml"]
```

```yaml
# livekit.yaml
port: 7880
rtc:
  udp_port: 50000-60000
  tcp_port: 7881
  use_external_ip: true
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
logging:
  level: info
```

Cloud Run does not support UDP. Therefore, LiveKit must be configured to use **TCP-only TURN relay** for all client connections, which adds ~30–50 ms latency but is functionally equivalent for classroom video.

For production beyond the course project scope, LiveKit should be deployed on a GCE instance or GKE node pool with UDP port range exposed.

### 10.3 CV Worker — LiveKit Python SDK Integration

```python
# services/cv_worker/main.py
import asyncio
from livekit import api, rtc
from src.face_detector import FaceDetector
from src.landmark_analyzer import LandmarkAnalyzer
from src.pose_estimator import PoseEstimator
from src.emotion_classifier import EmotionClassifier
from src.score_aggregator import ScoreAggregator
from src.intervention_engine import InterventionEngine

class CVWorker:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.room = rtc.Room()
        self.detectors = {}  # student_id → pipeline instances
        self.aggregators = {}

    async def start(self, livekit_url: str, token: str):
        self.room.on("track_subscribed", self.on_track_subscribed)
        self.room.on("participant_disconnected", self.on_participant_left)
        await self.room.connect(livekit_url, token)

    def on_track_subscribed(self, track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_VIDEO:
            asyncio.create_task(
                self.process_video_track(track, participant.identity)
            )

    async def process_video_track(self, track: rtc.VideoTrack, student_id: str):
        self.detectors[student_id] = {
            "face": FaceDetector(), "landmark": LandmarkAnalyzer(),
            "pose": PoseEstimator(), "emotion": EmotionClassifier(),
        }
        self.aggregators[student_id] = ScoreAggregator(student_id, self.session_id)

        video_stream = rtc.VideoStream(track, format=rtc.VideoBufferType.RGBA)
        async for event in video_stream:
            bgr = livekit_frame_to_bgr(event.frame)
            await self.run_pipeline(bgr, student_id)

    async def run_pipeline(self, bgr, student_id):
        d = self.detectors[student_id]
        face_result = d["face"].process(bgr)
        if not face_result.face_detected:
            self.aggregators[student_id].add_face_missing(timestamp=now())
            return
        landmarks = d["landmark"].analyze(face_result)
        pose = d["pose"].estimate(face_result.face_roi)
        emotion = d["emotion"].classify(face_result.face_roi)
        signal = build_frame_signal(landmarks, pose, emotion, student_id)
        await self.aggregators[student_id].add(signal)
```

### 10.4 Cost Estimate (10 students, 60 min/session)

| Resource | Consumption | Estimated Cost |
|---|---|---|
| Cloud Run — LiveKit SFU (always-on min=1) | 1 vCPU × 730h/month | ~$24/month fixed |
| Cloud Run — CV Worker | 2 vCPU × 60 min × sessions | ~$0.08/session |
| Cloud Memorystore (Redis) | 1GB basic tier | ~$35/month fixed |
| Pub/Sub (gaze points) | 10 students × 15fps × 3600s = 540K msgs | ~$0.02/session |
| Firestore | Score + event writes | ~$0.01/session |
| GCS snapshots | ~50 images × 50KB | ~$0.001/session |
| Vercel (Next.js app + API Routes) | Hobby free tier (course project) | $0 |
| WebRTC bandwidth | Handled by LiveKit SFU internal forwarding | Included in Cloud Run egress |
| **Total variable** | | **~$0.10/session** |
| **Total fixed** | | **~$59/month** |

> The key cost change from v1: WebSocket egress cost ($0.86/session) is replaced by LiveKit's internal SFU forwarding (no client-to-cloud raw frame upload). The bandwidth is consumed by WebRTC media within the SFU network — significantly cheaper than uploading raw JPEG frames over WebSocket. Total variable cost per session drops from ~$1.00 to ~$0.10.

---

## 11. Revised 8-Week Roadmap

### Week 1 — CV Pipeline Core ✅ (Complete)

**Deliverable:** `python test_pipeline.py --image face.jpg` → full FrameSignal

- [x] MediaPipe Face Landmarker (478 landmarks)
- [x] EAR blink detection, gaze zone from iris landmarks
- [x] 6DRepNet head pose estimation
- [x] emotiefflib ONNX emotion classification
- [x] FrameSignal dataclass

---

### Week 2 — Score Aggregator & Local Demo

**Deliverable:** `python demo_local.py` → webcam window with live score overlay

- [ ] `[P1]` Implement `score_aggregator.py` — sliding window 30s, 4 sub-scores, E(t)
- [ ] `[P1]` Implement event flags: DISTRACTION, DROWSY, CONFUSED, FACE_MISSING, LOW_ENGAGEMENT
- [ ] `[P2]` Implement `rolling_score.py` — EMA(α=0.3)
- [ ] `[P1]` Local webcam loop with debug overlay
- [ ] `[P2]` Implement new composite scores: C_score (confusion) and F_score (fatigue)
- [ ] `[P2]` Tune EAR, gaze, pose thresholds on real webcam data

---

### Week 3 — LiveKit Integration (WebRTC Foundation)

**Deliverable:** Teacher and student can video call each other in the ClassSense browser app

- [ ] `[P0]` Deploy LiveKit SFU on Cloud Run with TCP-TURN config
- [ ] `[P1]` Implement Session Manager as Next.js API Routes (`app/api/sessions/`): create room, issue LiveKit JWT
- [ ] `[P1]` Build minimal Next.js student page (`/join/[sessionId]`): camera + mic + connect to LiveKit room — use `next/dynamic` with `ssr: false` for LiveKit components
- [ ] `[P1]` Build minimal Next.js teacher page (`/dashboard/[sessionId]`): see student video tiles
- [ ] `[P1]` Firebase Auth integration via `next-firebase-auth-edge`: teacher Google login, student name entry with session token
- [ ] `[P1]` Session lifecycle: create session → invite link → join → end
- [ ] `[P2]` Basic UI: mute, camera toggle, raise hand button
- [ ] `[P2]` Test with 3–5 participants, validate latency < 500ms

---

### Week 4 — CV Worker + LiveKit Integration

**Deliverable:** CV Worker joins room, processes student video, scores appear in Firestore

- [ ] `[P0]` Implement `livekit_frame_to_bgr()` — VideoFrame → NumPy BGR
- [ ] `[P0]` Implement CV Worker as LiveKit service participant (Python SDK)
- [ ] `[P1]` Wire CV Worker to Score Aggregator — identical to v1 from FrameSignal onward
- [ ] `[P1]` Implement `firestore_writer.py` — write scores + event flags per student
- [ ] `[P1]` Deploy CV Worker on Cloud Run: auto-join on session activation
- [ ] `[P1]` Test end-to-end: student joins → CV Worker subscribes track → score written to Firestore
- [ ] `[P2]` Implement Intervention Engine skeleton with first rule: LOW_ENGAGEMENT alert

---

### Week 5 — Engagement Dashboard Overlay

**Deliverable:** Teacher sees video grid with color-coded engagement tiles + basic alert feed

- [ ] `[P1]` Add Firestore `onSnapshot` listener to teacher client
- [ ] `[P1]` Implement video tile color overlay (green/amber/red) based on E_display
- [ ] `[P1]` Build Alert Feed component: toast notifications for event flags
- [ ] `[P2]` Build Class Trend Line: rolling 5-min class average (Recharts, rendered as a Client Component)
- [ ] `[P1]` Implement Attention Timeline: rolling 10-min per-student bar (bottom panel)
- [ ] `[P2]` Video tile hover → tooltip with sub-scores
- [ ] `[P2]` Implement Adaptive Pacing Alerts (Section 7.2): Intervention Engine rule + teacher Toast
- [ ] `[P2]` Test with real class (2–3 people), validate < 3s latency end-to-end

---

### Week 6 — HCI Features

**Deliverable:** Gaze heatmap on screenshare, confusion prompt on student, fatigue warning

- [ ] `[P1]` Implement Gaze Heatmap Aggregator (Cloud Run + Pub/Sub)
- [ ] `[P1]` Implement gaze-to-screen projection in CV Worker
- [ ] `[P1]` Implement heatmap.js overlay on screenshare canvas in teacher client
- [ ] `[P1]` Implement Confusion Detector: C_score threshold → HCI event → student private prompt
- [ ] `[P1]` Build confusion prompt UI on student client (private, bottom-right toast)
- [ ] `[P2]` Implement Fatigue Warning: F_score threshold → teacher badge on student tile
- [ ] `[P2]` Implement "Suggest Break" broadcast: teacher click → student break banner
- [ ] `[P3]` Implement Teacher Gaze Feedback: opt-in CV analysis on teacher track

---

### Week 7 — Post-Session Report & Hardening

**Deliverable:** Full 45-min session, exportable PDF report with timeline + snapshots

- [ ] `[P1]` Implement `report_generator.py` — query full session from Firestore, compute stats
- [ ] `[P1]` Build Report UI: engagement timeline, per-student table, HCI event log
- [ ] `[P1]` Implement event snapshot storage (GCS CMEK, 30-day lifecycle)
- [ ] `[P0]` Implement dual consent flow: analysis consent + snapshot consent separately
- [ ] `[P2]` PDF export via browser print CSS
- [ ] `[P2]` CSV export for raw score time-series
- [ ] `[P1]` Error handling: lost webcam, no face detected, worker crash + retry
- [ ] `[P1]` Load test: 10 simultaneous students, measure latency + CPU
- [ ] `[P2]` Cloud Run auto-scaling: CV Worker min=0, max=5 instances

---

### Week 8 — Polish, Production & Demo

**Deliverable:** Production deployment, recorded demo of all HCI features with real users

- [ ] `[P1]` Setup GCP production project (separate from dev)
- [ ] `[P1]` UI polish: responsive layout, loading states, error messages
- [ ] `[P1]` Full consent flow: privacy notice → dual consent → analysis begins
- [ ] `[P1]` Opt-out toggle: pause analysis anytime without leaving session
- [ ] `[P1]` Pilot with 1–2 teachers, 4–8 students per session
- [ ] `[P2]` Per-student EAR calibration: 60s baseline at session start
- [ ] `[P2]` Record demo video for course submission
- [ ] `[P2]` Collect teacher feedback: do alerts feel actionable? Does heatmap add value?

---

### Timeline Summary

```
Week 1  [██████████] CV Pipeline core ✅
Week 2  [          ] Score Aggregator + local demo
Week 3  [          ] LiveKit SFU + basic video call
Week 4  [          ] CV Worker ↔ LiveKit integration
Week 5  [          ] Engagement overlay on video dashboard
Week 6  [          ] HCI features (heatmap, confusion, fatigue)
Week 7  [          ] Post-session report + hardening
Week 8  [          ] Production, pilot, demo

Critical path: W3 (LiveKit) → W4 (CV+LiveKit) → W5 (dashboard) → W6 (HCI)
HCI features are isolated modules — W6 items can be parallelized by team members
```

---

## 12. Privacy & Ethics

### 12.1 Expanded Privacy Considerations for v2

ClassSense v2 adds video conferencing, which significantly expands the privacy surface compared to v1 (which only processed frames server-side). Key additions:

| Data Type | v1 | v2 | Mitigation |
|---|---|---|---|
| Raw video stream | JPEG frames to Cloud Run (discarded) | WebRTC to LiveKit SFU (not recorded by default) | LiveKit recording requires explicit opt-in Egress; disabled by default |
| Audio | Not present | WebRTC audio to SFU | Audio is not analyzed; routed peer-to-peer via SFU, not stored |
| Gaze points (heatmap) | Not present | Aggregated 40×30 grid written to Firestore | No individual student gaze trajectory is stored — only class aggregate |
| Teacher video | Not analyzed | Optionally analyzed (Teacher Gaze Feedback) | Opt-in, teacher-private, not visible to students or admin |
| Confusion prompts | Not present | HCI event log stored in Firestore | Student never sees whether a prompt was CV-triggered or not |

### 12.2 Design Principles (Extended from v1)

1. **Proportionate collection:** Audio is never analyzed. Video frames are discarded after CV inference. Gaze points are immediately aggregated — no per-student trajectory is stored.
2. **Dual consent:** Behavior analysis consent and snapshot consent remain separate, as in v1.
3. **Invisible participant transparency:** The CV Worker joins as a LiveKit room participant. Students are informed of this in the privacy notice — *"An automated analysis system joins your session to measure engagement. It cannot speak or interact with you."*
4. **Asymmetric privacy for students vs. teacher:** Students do not see their own engagement scores. Teachers see aggregate and per-student scores, but with deliberate friction to prevent misuse (scores are advisory, not grade-linked).
5. **No recording by default:** LiveKit session recording (Egress) is not enabled in v2.0. Recording would require separate consent flow and is listed as a v3 feature.
6. **Right to erasure:** Students can request deletion of all Firestore score data and GCS snapshots via an erasure API endpoint, as in v1.

### 12.3 Ethical Considerations for HCI Features

**Confusion prompt:** There is a risk that students feel surveilled if they frequently receive automated confusion prompts. The prompt frequency is capped at once per 5 minutes per student, and the prompt text is framed as supportive rather than evaluative (*"Đang khó hiểu?"* vs. *"Hệ thống phát hiện bạn không hiểu"*).

**Adaptive pacing alerts:** Teachers should be informed that engagement scores reflect proxies of attention (gaze, blink, pose), not comprehension. A student scoring 0.3 may be deep in thought rather than disengaged. Alerts are advisory and explicitly labeled as such.

**Fairness:** The CV pipeline has known demographic biases: EAR thresholds may be less accurate for East Asian faces (smaller eye opening range); emotion classifiers show reduced accuracy on darker skin tones (AffectNet training distribution). In v2, all alerts and scores are displayed with a visible uncertainty indicator (±), and teachers are encouraged in onboarding materials to treat CV signals as one input among many, not ground truth.

---

## 13. Technical Limitations & HCI Ambiguity

### 13.1 Gaze Heatmap Accuracy

The gaze-to-screenshare projection is a heuristic approximation (yaw/pitch + iris offset → normalized screen coordinate). It is not geometrically calibrated per student and assumes the student is sitting approximately 50–80 cm from the screen at face height. Accuracy is approximately ±15% of screen width, sufficient for identifying general regions of attention (left vs. right half, upper vs. lower third) but not precise enough for pixel-level hotspots.

For higher accuracy, per-student screen-space calibration (as in GazeFollower [22]) would be needed at session start — this is a v3 consideration.

### 13.2 Behavioral Ambiguity (Inherited from v1)

| Observed Signal | Correct Interpretation | Incorrect Interpretation |
|---|---|---|
| Low gaze (looking down) | Taking notes | Distracted |
| High PERCLOS | Sleepy | Blinking frequently due to dry eyes |
| Neutral emotion | Focused, calm | Bored, disengaged |
| Head turned sideways | Second monitor (engaged) | Distracted |
| FACE_MISSING | Left room | Camera covered for privacy |

All HCI features in v2 are designed with these ambiguities in mind. Alerts include contextual language (*"may be"*, *"consider"*) and the Intervention Engine requires sustained multi-signal evidence before firing, not single-frame anomalies.

### 13.3 LiveKit Latency & Scale Limits

Cloud Run + TCP-TURN (no UDP) adds 30–50 ms to WebRTC media path compared to direct UDP. For classroom video, this is imperceptible. For interactive exercises requiring < 100ms response (e.g., real-time music performance), TCP-TURN is insufficient — UDP-capable deployment (GCE/GKE) would be required.

Scale limit for course project deployment: ~20 concurrent participants per LiveKit Cloud Run instance. Beyond this, LiveKit should be deployed with horizontal scaling on GKE.

### 13.4 CV Worker Cold Start

Cloud Run CV Worker has a cold start time of 15–30 seconds (model loading: face_landmarker.task + 6DRepNet + emotiefflib ONNX). Students joining a session during cold start will not have their scores computed until the Worker is ready. Mitigation: pre-warm the Worker when the teacher creates a session (not when the first student joins).

### 13.5 Gaze Heatmap Sparsity

With 5–8 students, the 40×30 gaze grid is sparse. Many cells will have zero or one data point per 5-second update. Gaussian blur (σ=1.5) partially addresses this, but the heatmap becomes more meaningful with 10+ students. Below 5 students, the heatmap feature should be soft-disabled or shown with a "low confidence" indicator.

---

## 14. References

[1] Xie, X. et al. (2023). Student engagement detection using multi-modal features and deep learning. *Computers & Education*.

[2] Savchenko, A.V. et al. (2022). Classifying emotions and engagement in online learning based on a single facial expression recognition neural network. *IEEE Trans. Affective Computing*.

[6] Gupta, A. et al. (2023). Multimodal student engagement recognition in online learning. *Pattern Recognition Letters*.

[7] Buono, P. et al. (2022). LSTM-based engagement detection from facial action units and gaze. *IJHCI*.

[8] Zhang, Y. et al. (2024). Hidden mind-wandering detection using compressed DTW on gaze sequences. *IEEE Access*.

[9] Almuniri, S. et al. (2026). Stability-centric student engagement detection with temporal ensemble augmentation. *arXiv*.

[11] Hempel, T. et al. (2022). 6D rotation representation for unconstrained head pose estimation. *ICIP 2022*.

[12] Savchenko, A.V. (2021). HSEmotion: Efficient facial expression recognition. *ICML 2023*.

[13] Uberti, J. & Lam, D. (2022). *WebRTC for the Curious*. Open source book. https://webrtcforthecurious.com

[14] Verbert, K. et al. (2014). Learning dashboards: An overview and future research agenda. *American Behavioral Scientist*, 57(10), 1500–1509.

[15] D'Mello, S. & Graesser, A. (2012). Dynamics of affective states during complex learning. *Learning and Instruction*, 22(2), 145–157.

[16] Sharma, P. et al. (2020). Real-time gaze tracking for classroom attention analysis. *CHI 2020 Extended Abstracts*.

[17] Dixson, M.D. (2015). Measuring student engagement in the online course: the online student engagement scale. *Online Learning*, 19(4).

[18] Poquet, O. et al. (2021). Low-friction confusion signals in online learning. *LAK 2021*.

[19] Clark, R.C., Nguyen, F. & Sweller, J. (2006). *Efficiency in Learning: Evidence-Based Guidelines to Manage Cognitive Load*. Pfeiffer.

[20] Sweller, J. (1988). Cognitive load during problem solving: Effects on learning. *Cognitive Science*, 12(2), 257–285.

[21] Rowe, M.B. (1986). Wait time: Slowing down may be a way of speeding up! *Journal of Teacher Education*, 37(1), 43–50.

[22] GazeFollower (2025). Screen-space gaze estimation at scale. *ACM SIGCHI 2025*.

[23] Gureckis, T.M. & Markman, A.B. (2012). Self-directed learning: A cognitive and computational perspective. *Perspectives on Psychological Science*, 7(5), 464–481.

---

*ClassSense v2 Technical Document — Course Project*  
*Revision history: v1.0 (engagement analysis only) → v2.0 (WebRTC + HCI features)*
