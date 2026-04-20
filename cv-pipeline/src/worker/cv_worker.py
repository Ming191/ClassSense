from __future__ import annotations

import asyncio
import contextlib
import time
from dataclasses import asdict
from typing import Any, Callable

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
    ) -> None:
        self.settings = settings

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
                    student_id=student_id, session_id=settings.session_id
                )
            )
        )

        self._aggregators: dict[str, Any] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._streams: dict[str, Any] = {}
        self._room = None
        self._video_stream_cls = None
        self._stopped = True

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
        await self._room.connect(self.settings.livekit_url, self.settings.livekit_token)
        self._stopped = False

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
        await self.signal_client.publish_score(
            self.settings.session_id,
            score_result_to_payload(score_result),
        )

        for event in self.intervention_engine.evaluate(score_result):
            await self.signal_client.publish_hci(
                self.settings.session_id, asdict(event)
            )

        if self.settings.publish_gaze_points:
            await self.signal_client.publish_gaze(
                self.settings.session_id,
                frame_signal_to_gaze_payload(signal),
            )

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
        name = getattr(kind, "name", str(kind)).lower()
        return "video" in name

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
