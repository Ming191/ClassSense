from __future__ import annotations

import asyncio
import contextlib
import json
import time
from dataclasses import asdict
from typing import Any, Callable
from urllib import request
from urllib.parse import urlparse

from src.adapters.classsense_mapper import (
    frame_signal_to_gaze_payload,
    score_result_to_payload,
)
from src.frame_signal import FrameSignal
from src.intervention_engine import InterventionEngine
from src.score_aggregator import ScoreAggregator


class CVWorker:
    def __init__(
        self,
        settings,
        *,
        face_detector=None,
        landmark_analyzer=None,
        pose_estimator=None,
        emotion_classifier=None,
        signal_client=None,
        intervention_engine: InterventionEngine | None = None,
        aggregator_factory: Callable[[str], Any] | None = None,
        session_id: str | None = None,
        livekit_url: str | None = None,
        livekit_token: str | None = None,
        on_unexpected_disconnect: Callable[[str], Any] | None = None,
    ) -> None:
        self.settings = settings
        self.session_id = (session_id or "").strip()
        self.livekit_url = (livekit_url or settings.livekit_url or "").strip()
        self.livekit_token = (livekit_token or "").strip()
        self._on_unexpected_disconnect = on_unexpected_disconnect

        self.face_detector = (
            face_detector if face_detector is not None else self._make_face_detector()
        )
        self.landmark_analyzer = (
            landmark_analyzer
            if landmark_analyzer is not None
            else self._make_landmark_analyzer()
        )
        self.pose_estimator = (
            pose_estimator
            if pose_estimator is not None
            else self._make_pose_estimator()
        )
        self.emotion_classifier = (
            emotion_classifier
            if emotion_classifier is not None
            else self._make_emotion_classifier()
        )

        if signal_client is None:
            from src.adapters.classsense_signal_client import ClassSenseSignalClient

            signal_client = ClassSenseSignalClient(settings.redis_url)
        self.signal_client = signal_client

        self.intervention_engine = intervention_engine or InterventionEngine()
        self.aggregator_factory = (
            aggregator_factory
            if aggregator_factory is not None
            else (
                lambda student_id: ScoreAggregator(
                    student_id=student_id, session_id=self.session_id
                )
            )
        )

        self._aggregators: dict[str, Any] = {}
        self._frame_counts: dict[str, int] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._streams: dict[str, Any] = {}
        self._room = None
        self._video_stream_cls = None
        self._stopped = True
        self._disconnect_notified = False

    async def connect(self) -> None:
        try:
            from livekit import rtc
        except Exception as exc:
            raise RuntimeError(
                "livekit package is required at runtime. Install `livekit>=0.11`."
            ) from exc

        self._video_stream_cls = rtc.VideoStream
        self._room = rtc.Room()
        self._register_room_callbacks(self._room)
        await self.signal_client.connect()
        await self._room.connect(self.livekit_url, self.livekit_token)
        self._stopped = False
        self._disconnect_notified = False

    async def close(self) -> None:
        self._stopped = True
        for task in list(self._tasks.values()):
            task.cancel()
        for task in list(self._tasks.values()):
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()

        for stream in list(self._streams.values()):
            await self._maybe_close(stream)
        self._streams.clear()

        if self._room is not None:
            with contextlib.suppress(Exception):
                await self._room.disconnect()
            self._room = None

        await self.signal_client.close()

    def _register_room_callbacks(self, room) -> None:
        on = getattr(room, "on", None)
        if callable(on):
            on("track_subscribed", self._on_track_subscribed)
            on("track_unsubscribed", self._on_track_unsubscribed)
            on("disconnected", self._on_room_disconnected)

    def _on_room_disconnected(self, *_) -> None:
        if self._stopped or self._disconnect_notified:
            return
        self._disconnect_notified = True
        callback = self._on_unexpected_disconnect
        if callback is None:
            return
        asyncio.create_task(self._notify_unexpected_disconnect())

    async def _notify_unexpected_disconnect(self) -> None:
        callback = self._on_unexpected_disconnect
        if callback is None:
            return
        try:
            result = callback(self.session_id)
            if asyncio.iscoroutine(result):
                await result
        except Exception:
            pass

    def _on_track_subscribed(
        self, track, publication=None, participant=None, *_
    ) -> None:
        if self._stopped:
            return
        if not self._is_video_track(track):
            return
        student_id = self._student_id(participant, publication, track)
        if student_id in self._tasks:
            return
        task = asyncio.create_task(
            self._consume_video_track(student_id, track), name=f"cv-track-{student_id}"
        )
        self._tasks[student_id] = task

    def _on_track_unsubscribed(
        self, track, publication=None, participant=None, *_
    ) -> None:
        student_id = self._student_id(participant, publication, track)
        task = self._tasks.pop(student_id, None)
        if task is not None:
            task.cancel()
        stream = self._streams.pop(student_id, None)
        if stream is not None:
            asyncio.create_task(self._maybe_close(stream))

    async def _consume_video_track(self, student_id: str, track) -> None:
        from src.adapters.livekit_frame_adapter import resize_bgr, video_frame_to_bgr

        stream = self._video_stream_cls(
            track=track, capacity=self.settings.max_stream_capacity
        )
        self._streams[student_id] = stream
        try:
            async for item in stream:
                frame = getattr(item, "frame", item)
                try:
                    bgr = video_frame_to_bgr(frame)
                    bgr = resize_bgr(
                        bgr, self.settings.target_width, self.settings.target_height
                    )
                    await self._process_bgr_frame(student_id, bgr)
                except Exception:
                    continue
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        finally:
            await self._maybe_close(stream)
            self._streams.pop(student_id, None)
            self._tasks.pop(student_id, None)
            self._frame_counts.pop(student_id, None)

    async def _process_bgr_frame(self, student_id: str, frame_bgr) -> None:
        now = time.time()
        try:
            mp_result, face_roi = self.face_detector.detect(frame_bgr)
        except Exception:
            mp_result, face_roi = None, None

        if mp_result is None or face_roi is None:
            signal = FrameSignal.face_missing_signal(student_id)
        else:
            metrics = self.landmark_analyzer.analyze(mp_result)
            yaw, pitch, roll = self.pose_estimator.predict(face_roi)
            emotion, emotion_probs, valence, arousal = self.emotion_classifier.predict(
                face_roi
            )
            signal = FrameSignal(
                student_id=student_id,
                timestamp=now,
                ear_left=float(metrics["ear_left"]),
                ear_right=float(metrics["ear_right"]),
                blink_detected=bool(metrics["blink_detected"]),
                gaze_zone=str(metrics["gaze_zone"]),
                gaze_x=float(metrics["gaze_x"]),
                gaze_y=float(metrics["gaze_y"]),
                yaw=float(yaw),
                pitch=float(pitch),
                roll=float(roll),
                emotion=str(emotion),
                emotion_probs=list(emotion_probs),
                valence=float(valence),
                arousal=float(arousal),
                face_missing=False,
            )

        aggregator = self._aggregators.get(student_id)
        if aggregator is None:
            aggregator = self.aggregator_factory(student_id)
            self._aggregators[student_id] = aggregator

        score_result = aggregator.push(signal)

        frame_count = self._frame_counts.get(student_id, 0) + 1
        self._frame_counts[student_id] = frame_count
        if frame_count == 1:
            print(f"[cv-worker] first-frame student={student_id}", flush=True)
        elif frame_count % 30 == 0:
            print(
                "[cv-worker] score"
                f" student={student_id}"
                f" E_display={score_result.E_display:.3f}"
                f" flags={','.join(score_result.flags) if score_result.flags else 'none'}",
                flush=True,
            )

        await self.signal_client.publish_score(
            self.session_id,
            score_result_to_payload(score_result),
        )

        for event in self.intervention_engine.evaluate(score_result):
            await self.signal_client.publish_hci(self.session_id, asdict(event))

        if self.settings.publish_gaze_points:
            gaze_payload = frame_signal_to_gaze_payload(signal)
            await self.signal_client.publish_gaze(self.session_id, gaze_payload)
            publish_heatmap = getattr(self.signal_client, "publish_heatmap", None)
            if callable(publish_heatmap):
                await publish_heatmap(self.session_id, gaze_payload)

    @staticmethod
    def _student_id(participant, publication, track) -> str:
        for obj in (participant, publication, track):
            for attr in ("identity", "sid", "name"):
                value = getattr(obj, attr, None)
                if value:
                    return str(value)
        return "unknown"

    @staticmethod
    def _is_video_track(track) -> bool:
        kind = getattr(track, "kind", None)
        if kind is None:
            return True

        if isinstance(kind, int):
            return kind == 2

        name = getattr(kind, "name", str(kind)).upper()
        return "VIDEO" in name or name == "2" or name == "KIND_VIDEO"

    @staticmethod
    async def _maybe_close(resource) -> None:
        for method_name in ("aclose", "close"):
            method = getattr(resource, method_name, None)
            if callable(method):
                result = method()
                if asyncio.iscoroutine(result):
                    with contextlib.suppress(Exception):
                        await result
                break

    @staticmethod
    def _make_face_detector():
        from src.face_detector import FaceDetector

        return FaceDetector()

    @staticmethod
    def _make_landmark_analyzer():
        from src.landmark_analyzer import LandmarkAnalyzer

        return LandmarkAnalyzer()

    @staticmethod
    def _make_pose_estimator():
        from src.pose_estimator import PoseEstimator

        return PoseEstimator()

    @staticmethod
    def _make_emotion_classifier():
        from src.emotion_classifier import EmotionClassifier

        return EmotionClassifier()


class CVWorkerLifecycleRunner:
    def __init__(self, settings, *, worker_factory: Callable[..., CVWorker] = CVWorker):
        self.settings = settings
        self.worker_factory = worker_factory
        self._worker: CVWorker | None = None
        self._active_session_id: str | None = None
        self._stopping = False
        self._redis = None
        self._pubsub = None
        self._state_lock = asyncio.Lock()
        self._reconnect_task: asyncio.Task | None = None

    async def run(self, stop_event: asyncio.Event) -> None:
        import redis.asyncio as redis

        self._redis = redis.from_url(self.settings.redis_url, decode_responses=True)
        self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
        await self._pubsub.subscribe(self.settings.session_lifecycle_channel)
        try:
            while not stop_event.is_set() and not self._stopping:
                msg = await self._pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if not msg:
                    continue
                data = msg.get("data")
                if not data:
                    continue
                await self._handle_lifecycle_message(data)
        finally:
            await self.stop()

    async def stop(self) -> None:
        self._stopping = True
        if self._reconnect_task is not None:
            self._reconnect_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._reconnect_task
            self._reconnect_task = None
        await self._stop_worker()
        if self._pubsub is not None:
            with contextlib.suppress(Exception):
                await self._pubsub.unsubscribe(self.settings.session_lifecycle_channel)
            with contextlib.suppress(Exception):
                await self._pubsub.close()
            self._pubsub = None
        if self._redis is not None:
            aclose = getattr(self._redis, "aclose", None)
            with contextlib.suppress(Exception):
                if callable(aclose):
                    await aclose()
                else:
                    await self._redis.close()
            self._redis = None

    async def _handle_lifecycle_message(self, payload_raw: str) -> None:
        try:
            payload = json.loads(payload_raw)
        except Exception:
            print(f"[cv-worker] invalid lifecycle payload: {payload_raw!r}", flush=True)
            return

        event_type = str(payload.get("type") or payload.get("event") or "").strip()
        session_id = str(
            payload.get("sessionId") or payload.get("session_id") or ""
        ).strip()
        if not event_type or not session_id:
            return

        if event_type == "session.created":
            await self._on_session_created(session_id)
        elif event_type == "session.completed":
            await self._on_session_completed(session_id)

    async def _on_session_created(self, session_id: str) -> None:
        async with self._state_lock:
            if self._active_session_id == session_id and self._worker is not None:
                return
            if self._worker is not None and self._active_session_id != session_id:
                # Single-worker local demo behavior: switch active session gracefully.
                await self._stop_worker()
            if self._reconnect_task is not None:
                self._reconnect_task.cancel()
                self._reconnect_task = None

        await self._connect_for_session(session_id)

    async def _on_session_completed(self, session_id: str) -> None:
        async with self._state_lock:
            if self._active_session_id != session_id:
                return
            if self._reconnect_task is not None:
                self._reconnect_task.cancel()
                self._reconnect_task = None
            await self._stop_worker()

    async def _on_unexpected_disconnect(self, session_id: str) -> None:
        async with self._state_lock:
            if self._stopping or self._active_session_id != session_id:
                return
            if self._reconnect_task is not None and not self._reconnect_task.done():
                return
            self._reconnect_task = asyncio.create_task(
                self._reconnect_loop(session_id), name=f"cv-reconnect-{session_id}"
            )

    async def _stop_worker(self, *, clear_session: bool = True) -> None:
        if self._worker is not None:
            with contextlib.suppress(Exception):
                await self._worker.close()
        self._worker = None
        if clear_session:
            self._active_session_id = None

    async def _reconnect_loop(self, session_id: str) -> None:
        print(
            f"[cv-worker] disconnected unexpectedly; reconnecting session={session_id}",
            flush=True,
        )
        while not self._stopping:
            async with self._state_lock:
                if self._active_session_id != session_id:
                    self._reconnect_task = None
                    return
                if self._worker is not None:
                    await self._stop_worker(clear_session=False)
            try:
                await self._connect_for_session(session_id)
                async with self._state_lock:
                    self._reconnect_task = None
                print(f"[cv-worker] reconnected session={session_id}", flush=True)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(
                    f"[cv-worker] reconnect failed session={session_id}: {exc}",
                    flush=True,
                )
                await asyncio.sleep(self.settings.worker_retry_base_ms / 1000.0)

    async def _connect_for_session(self, session_id: str) -> None:
        token_payload = await self._retry(
            lambda: self._fetch_service_token(session_id),
            op_name=f"token fetch for session={session_id}",
        )
        livekit_url = self._resolve_worker_livekit_url(token_payload)
        token = str(token_payload.get("token") or "").strip()
        resolved_session_id = str(token_payload.get("sessionId") or session_id).strip()
        if not livekit_url:
            raise RuntimeError(
                "livekitUrl is missing from token response and LIVEKIT_URL is unset"
            )
        if not token:
            raise RuntimeError("token is missing from token response")

        worker = self.worker_factory(
            self.settings,
            session_id=resolved_session_id,
            livekit_url=livekit_url,
            livekit_token=token,
            on_unexpected_disconnect=self._on_unexpected_disconnect,
        )
        try:
            await self._retry(
                worker.connect,
                op_name=f"worker connect for session={resolved_session_id}",
            )
        except Exception:
            with contextlib.suppress(Exception):
                await worker.close()
            raise

        async with self._state_lock:
            if self._stopping:
                with contextlib.suppress(Exception):
                    await worker.close()
                raise RuntimeError("stopped before worker became active")
            self._worker = worker
            self._active_session_id = resolved_session_id
        print(f"[cv-worker] connected session={resolved_session_id}", flush=True)

    def _resolve_worker_livekit_url(self, token_payload: dict[str, Any]) -> str:
        token_url = str(token_payload.get("livekitUrl") or "").strip()
        settings_url = (self.settings.livekit_url or "").strip()

        if not token_url:
            return settings_url
        if self._is_localhost_url(token_url) and settings_url:
            return settings_url
        return token_url

    @staticmethod
    def _is_localhost_url(url: str) -> bool:
        host = (urlparse(url).hostname or "").strip().lower()
        return host in {"localhost", "127.0.0.1", "::1"}

    async def _fetch_service_token(self, session_id: str) -> dict[str, Any]:
        url = (
            f"{self.settings.web_base_url.rstrip('/')}/api/sessions/{session_id}/token"
        )
        body = {
            "identity": self.settings.worker_identity,
            "displayName": "CV Worker",
            "role": "service",
        }

        def _do_request() -> dict[str, Any]:
            req = request.Request(
                url,
                method="POST",
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with request.urlopen(req, timeout=10) as resp:
                data = resp.read()
            parsed = json.loads(data.decode("utf-8") or "{}")
            if not isinstance(parsed, dict):
                raise RuntimeError("Unexpected token response type")
            return parsed

        return await asyncio.to_thread(_do_request)

    async def _retry(self, fn: Callable[[], Any], *, op_name: str):
        delay_ms = self.settings.worker_retry_base_ms
        while not self._stopping:
            try:
                result = fn()
                if asyncio.iscoroutine(result):
                    return await result
                return result
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"[cv-worker] retrying {op_name}: {exc}", flush=True)
                await asyncio.sleep(delay_ms / 1000.0)
                delay_ms = min(delay_ms * 2, self.settings.worker_retry_max_ms)
        raise RuntimeError(f"Stopped while retrying {op_name}")
