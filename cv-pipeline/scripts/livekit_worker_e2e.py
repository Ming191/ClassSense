from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import sys
import time
from dataclasses import dataclass
from typing import Any

import cv2
from livekit import rtc

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, PROJECT_ROOT)

from src.adapters.classsense_mapper import map_score_result_to_payload
from src.adapters.classsense_signal_client import (
    ClassSenseClientConfig,
    ClassSenseSignalClient,
)
from src.adapters.livekit_frame_adapter import livekit_frame_to_bgr
from src.emotion_classifier import EmotionClassifier
from src.face_detector import FaceDetector
from src.frame_signal import EMOTION_LABELS, FrameSignal
from src.landmark_analyzer import LandmarkAnalyzer
from src.pose_estimator import PoseEstimator
from src.score_aggregator import ScoreAggregator


def _neutral_probs() -> list[float]:
    probs = [0.0] * len(EMOTION_LABELS)
    probs[EMOTION_LABELS.index("neutral")] = 1.0
    return probs


def _now_stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _parse_role(metadata_raw: str | None) -> str | None:
    if not metadata_raw:
        return None

    try:
        payload = json.loads(metadata_raw)
    except Exception:
        return None

    role = payload.get("role")
    if isinstance(role, str) and role.strip():
        return role.strip().upper()

    return None


def _should_process_participant(
    participant: rtc.RemoteParticipant,
    worker_identity: str,
) -> bool:
    if participant.identity == worker_identity:
        return False

    role = _parse_role(getattr(participant, "metadata", None))
    if role in {"HOST", "CO_HOST", "SERVICE_WORKER"}:
        return False

    return True


@dataclass
class TrackRuntime:
    participant_id: str
    participant_name: str
    detector: FaceDetector
    landmark: LandmarkAnalyzer
    pose: PoseEstimator
    emotion: EmotionClassifier
    aggregator: ScoreAggregator
    next_publish_at: float

    def close(self) -> None:
        self.detector.close()


class LiveKitCvWorker:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.worker_identity = (
            args.worker_identity or f"cv-worker-{args.session_id.lower()}"
        )
        self.worker_name = args.worker_name

        self.client = ClassSenseSignalClient(
            ClassSenseClientConfig(
                base_url=args.base_url,
                session_id=args.session_id,
                participant_name=self.worker_name,
                participant_email=args.worker_email,
                worker_secret=args.worker_secret,
            )
        )

        self.room = rtc.Room()
        self.shutdown_event = asyncio.Event()
        self.track_tasks: dict[str, asyncio.Task[None]] = {}
        self._register_room_handlers()

    def request_shutdown(self) -> None:
        self.shutdown_event.set()

    def _register_room_handlers(self) -> None:
        @self.room.on("connected")
        def _on_connected() -> None:
            print(f"[{_now_stamp()}] LiveKit worker connected")

        @self.room.on("disconnected")
        def _on_disconnected(reason: Any) -> None:
            print(f"[{_now_stamp()}] LiveKit worker disconnected: {reason}")
            self.request_shutdown()

        @self.room.on("reconnecting")
        def _on_reconnecting() -> None:
            print(f"[{_now_stamp()}] Reconnecting to LiveKit...")

        @self.room.on("reconnected")
        def _on_reconnected() -> None:
            print(f"[{_now_stamp()}] Reconnected to LiveKit")

        @self.room.on("participant_connected")
        def _on_participant_connected(participant: rtc.RemoteParticipant) -> None:
            print(
                f"[{_now_stamp()}] Participant joined: "
                f"id={participant.identity} name={participant.name or 'N/A'}"
            )

        @self.room.on("participant_disconnected")
        def _on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
            print(
                f"[{_now_stamp()}] Participant left: "
                f"id={participant.identity} name={participant.name or 'N/A'}"
            )

        @self.room.on("track_subscribed")
        def _on_track_subscribed(
            track: rtc.Track,
            publication: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
            if track.kind != rtc.TrackKind.KIND_VIDEO:
                return

            if not _should_process_participant(participant, self.worker_identity):
                return

            track_key = self._track_key(participant, publication, track)
            if track_key in self.track_tasks:
                return

            task = asyncio.create_task(
                self._process_video_track(
                    track=track,
                    participant_id=participant.identity,
                    participant_name=participant.name or participant.identity,
                    track_key=track_key,
                )
            )
            self.track_tasks[track_key] = task

            def _on_done(done_task: asyncio.Task[None], key: str = track_key) -> None:
                self.track_tasks.pop(key, None)
                if done_task.cancelled():
                    return
                exc = done_task.exception()
                if exc is not None:
                    print(f"[{_now_stamp()}] Track task failed ({key}): {exc}")

            task.add_done_callback(_on_done)

        @self.room.on("track_unsubscribed")
        def _on_track_unsubscribed(
            track: rtc.Track,
            publication: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
            track_key = self._track_key(participant, publication, track)
            task = self.track_tasks.pop(track_key, None)
            if task is not None:
                task.cancel()

    @staticmethod
    def _track_key(
        participant: rtc.RemoteParticipant,
        publication: rtc.RemoteTrackPublication,
        track: rtc.Track,
    ) -> str:
        publication_sid = getattr(publication, "sid", "") or ""
        if publication_sid:
            return publication_sid

        return f"{participant.identity}:{id(track)}"

    async def start(self) -> None:
        print(
            f"[{_now_stamp()}] Requesting worker token for session={self.args.session_id} "
            f"identity={self.worker_identity}"
        )
        token_payload = await asyncio.to_thread(
            self.client.issue_worker_token,
            self.worker_identity,
            self.worker_name,
        )

        token = token_payload.get("token")
        server_url = token_payload.get("serverUrl")
        room = token_payload.get("room") or {}

        if not token or not server_url:
            raise RuntimeError("Worker token response missing token/serverUrl")

        self.worker_identity = (token_payload.get("worker") or {}).get(
            "identity"
        ) or self.worker_identity

        if self.args.livekit_url_override:
            server_url = self.args.livekit_url_override

        print(
            f"[{_now_stamp()}] Connecting worker to room={room.get('livekitRoomName') or room.get('code')} "
            f"server={server_url}"
        )

        await self.room.connect(server_url, token)
        print(f"[{_now_stamp()}] Worker active. Waiting for video tracks...")

        await self.shutdown_event.wait()
        await self.stop()

    async def stop(self) -> None:
        print(f"[{_now_stamp()}] Shutting down worker...")

        for task in list(self.track_tasks.values()):
            task.cancel()

        if self.track_tasks:
            await asyncio.gather(*self.track_tasks.values(), return_exceptions=True)
        self.track_tasks.clear()

        try:
            await self.room.disconnect()
        except Exception:
            pass

        print(f"[{_now_stamp()}] Worker stopped")

    async def _process_video_track(
        self,
        track: rtc.Track,
        participant_id: str,
        participant_name: str,
        track_key: str,
    ) -> None:
        print(
            f"[{_now_stamp()}] Subscribed video track={track_key} "
            f"participant={participant_name} ({participant_id})"
        )

        detector = FaceDetector(model_path=self.args.face_model_path)
        landmark = LandmarkAnalyzer(min_blink_frames=1)
        pose = PoseEstimator(model_path=self.args.pose_model_path)
        emotion = EmotionClassifier(device=self.args.emotion_device)
        aggregator = ScoreAggregator(
            student_id=participant_id, session_id=self.args.session_id
        )

        runtime = TrackRuntime(
            participant_id=participant_id,
            participant_name=participant_name,
            detector=detector,
            landmark=landmark,
            pose=pose,
            emotion=emotion,
            aggregator=aggregator,
            next_publish_at=time.time(),
        )

        stream: rtc.VideoStream | None = None

        try:
            stream = rtc.VideoStream(track, format=rtc.VideoBufferType.RGBA)
            async for event in stream:
                if self.shutdown_event.is_set():
                    break

                await self._process_frame(runtime, event.frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(
                f"[{_now_stamp()}] Track processing error "
                f"participant={participant_id} track={track_key}: {exc}"
            )
        finally:
            if stream is not None:
                try:
                    await stream.aclose()
                except Exception:
                    pass
            runtime.close()
            print(
                f"[{_now_stamp()}] Unsubscribed video track={track_key} "
                f"participant={participant_name} ({participant_id})"
            )

    async def _process_frame(
        self, runtime: TrackRuntime, frame: rtc.VideoFrame
    ) -> None:
        now_ts = time.time()
        bgr = livekit_frame_to_bgr(frame)

        if self.args.target_width > 0 and self.args.target_height > 0:
            bgr = cv2.resize(
                bgr,
                (self.args.target_width, self.args.target_height),
                interpolation=cv2.INTER_AREA,
            )

        detected, face_roi = runtime.detector.detect(bgr)
        has_face = bool(detected and detected.face_landmarks)

        yaw = 0.0
        pitch = 0.0
        roll = 0.0
        emotion_label = "neutral"
        emotion_probs = _neutral_probs()
        valence = 0.0
        arousal = 0.0

        if has_face:
            metrics = runtime.landmark.analyze(detected)

            if face_roi is not None and face_roi.size > 0:
                yaw, pitch, roll = runtime.pose.predict(face_roi)
                emotion_label, probs, valence, arousal = runtime.emotion.predict(
                    face_roi
                )
                if probs and len(probs) == len(EMOTION_LABELS):
                    emotion_probs = [float(p) for p in probs]

            frame_signal = FrameSignal(
                student_id=runtime.participant_id,
                timestamp=now_ts,
                ear_left=metrics["ear_left"],
                ear_right=metrics["ear_right"],
                blink_detected=metrics["blink_detected"],
                gaze_zone=metrics["gaze_zone"],
                gaze_x=metrics["gaze_x"],
                gaze_y=metrics["gaze_y"],
                yaw=float(yaw),
                pitch=float(pitch),
                roll=float(roll),
                emotion=str(emotion_label),
                emotion_probs=emotion_probs,
                valence=float(valence),
                arousal=float(arousal),
                face_missing=False,
            )
        else:
            runtime.landmark.reset()
            frame_signal = FrameSignal.face_missing_signal(runtime.participant_id)
            frame_signal.timestamp = now_ts

        score_result = runtime.aggregator.push(frame_signal)

        if now_ts < runtime.next_publish_at:
            return

        payload = map_score_result_to_payload(
            frame_signal=frame_signal,
            score_result=score_result,
            participant_id=runtime.participant_id,
            camera_enabled=True,
            microphone_enabled=False,
        )

        await asyncio.to_thread(
            self.client.publish_signal,
            payload["participantId"],
            payload["engagementScore"],
            payload["faceDetected"],
            payload.get("emotion"),
            payload.get("yaw"),
            payload.get("pitch"),
            payload.get("roll"),
            payload["cameraEnabled"],
            payload["microphoneEnabled"],
        )

        print(
            f"[{_now_stamp()}] participant={runtime.participant_name} ({runtime.participant_id}) "
            f"engagement={payload['engagementScore']:.3f} "
            f"face_detected={payload['faceDetected']} emotion={payload.get('emotion')} "
            f"yaw={float(payload.get('yaw') or 0.0):+.1f} "
            f"pitch={float(payload.get('pitch') or 0.0):+.1f}"
        )

        runtime.next_publish_at = now_ts + max(self.args.publish_interval, 0.2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="LiveKit service worker: subscribe room video -> CV pipeline -> ClassSense signals"
    )
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--worker-identity", default="")
    parser.add_argument("--worker-name", default="CV Worker")
    parser.add_argument("--worker-email", default="cv-worker@classsense.local")
    parser.add_argument(
        "--worker-secret",
        default=os.getenv("WORKER_AUTH_SECRET", ""),
        help="Secret for /worker-token endpoint (or set WORKER_AUTH_SECRET env)",
    )
    parser.add_argument(
        "--face-model-path",
        default=os.path.join(PROJECT_ROOT, "models", "face_landmarker.task"),
    )
    parser.add_argument(
        "--pose-model-path",
        default=os.path.join(PROJECT_ROOT, "models", "6DRepNet_300W_LP_AFLW2000.pth"),
    )
    parser.add_argument("--emotion-device", default="cpu")
    parser.add_argument("--publish-interval", type=float, default=3.0)
    parser.add_argument(
        "--livekit-url-override",
        default=os.getenv("LIVEKIT_URL_OVERRIDE", ""),
        help="Override LiveKit URL from token response (for Docker networking).",
    )
    parser.add_argument("--target-width", type=int, default=320)
    parser.add_argument("--target-height", type=int, default=240)
    return parser.parse_args()


async def _async_main(args: argparse.Namespace) -> None:
    if not args.worker_secret:
        raise RuntimeError(
            "Missing worker secret. Pass --worker-secret or set WORKER_AUTH_SECRET env."
        )

    worker = LiveKitCvWorker(args)
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, worker.request_shutdown)
        except NotImplementedError:
            # Windows event loop may not support signal handlers.
            pass

    await worker.start()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(_async_main(args))
    except KeyboardInterrupt:
        print(f"[{_now_stamp()}] Interrupted")


if __name__ == "__main__":
    main()
