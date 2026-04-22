import asyncio
import unittest
from dataclasses import dataclass

import numpy as np

from src.worker.cv_worker import CVWorker, CVWorkerLifecycleRunner


@dataclass
class _Settings:
    livekit_url: str = "wss://example"
    redis_url: str = "redis://localhost:6379/0"
    frame_format: str = "auto"
    target_width: int = 0
    target_height: int = 0
    max_stream_capacity: int = 2
    publish_gaze_points: bool = True
    web_base_url: str = "http://web:3000"
    worker_identity: str = "cv-worker"
    worker_retry_base_ms: int = 1
    worker_retry_max_ms: int = 2
    session_lifecycle_channel: str = "session:lifecycle"


class _FakeDetector:
    def __init__(self, has_face=True):
        self.has_face = has_face

    def detect(self, _):
        if not self.has_face:
            return None, None
        return object(), np.zeros((16, 16, 3), dtype=np.uint8)


class _FakeAnalyzer:
    def analyze(self, _):
        return {
            "ear_left": 0.3,
            "ear_right": 0.3,
            "blink_detected": False,
            "gaze_zone": "center",
            "gaze_x": 0.0,
            "gaze_y": 0.0,
        }


class _FakePose:
    def predict(self, _):
        return 1.0, 2.0, 3.0


class _FakeEmotion:
    def predict(self, _):
        return "neutral", [0, 0, 0, 0, 0, 1, 0, 0], 0.0, 0.0


class _FakeSignalClient:
    def __init__(self):
        self.scores = []
        self.hci = []
        self.gaze = []
        self.heatmap = []

    async def connect(self):
        return None

    async def close(self):
        return None

    async def publish_score(self, session_id, payload):
        self.scores.append((session_id, payload))
        return 1

    async def publish_hci(self, session_id, payload):
        self.hci.append((session_id, payload))
        return 1

    async def publish_gaze(self, session_id, payload):
        self.gaze.append((session_id, payload))
        return 1

    async def publish_heatmap(self, session_id, payload):
        self.heatmap.append((session_id, payload))
        return 1


class _AlwaysEventEngine:
    def evaluate(self, score_result):
        from src.intervention_engine import InterventionEvent

        return [
            InterventionEvent(
                type="PACING_ALERT",
                student_id=score_result.student_id,
                timestamp=score_result.timestamp,
                suggested_action="test",
                auto_trigger=False,
                metadata={},
            )
        ]


class _StubWorker:
    def __init__(self, settings, **kwargs):
        self.session_id = kwargs["session_id"]
        self.connect_calls = 0
        self.close_calls = 0
        self.raise_on_connect = kwargs.get("raise_on_connect", False)

    async def connect(self):
        self.connect_calls += 1
        if self.raise_on_connect:
            raise RuntimeError("connect failed")

    async def close(self):
        self.close_calls += 1


class TestCVWorkerSmoke(unittest.TestCase):
    def test_lifecycle_livekit_url_resolution_prefers_settings_for_localhost(self):
        settings = _Settings(livekit_url="ws://livekit:7880")
        runner = CVWorkerLifecycleRunner(
            settings, worker_factory=lambda *args, **kwargs: None
        )

        resolved = runner._resolve_worker_livekit_url(
            {"livekitUrl": "ws://localhost:7880"}
        )
        self.assertEqual(resolved, "ws://livekit:7880")

        resolved_non_local = runner._resolve_worker_livekit_url(
            {"livekitUrl": "wss://cloud.livekit.io"}
        )
        self.assertEqual(resolved_non_local, "wss://cloud.livekit.io")

        resolved_empty = runner._resolve_worker_livekit_url({"livekitUrl": ""})
        self.assertEqual(resolved_empty, "ws://livekit:7880")

    def test_process_bgr_frame_publishes_score_hci_gaze_and_heatmap(self):
        async def _run():
            settings = _Settings()
            publisher = _FakeSignalClient()
            worker = CVWorker(
                settings,
                face_detector=_FakeDetector(has_face=True),
                landmark_analyzer=_FakeAnalyzer(),
                pose_estimator=_FakePose(),
                emotion_classifier=_FakeEmotion(),
                signal_client=publisher,
                intervention_engine=_AlwaysEventEngine(),
            )
            frame = np.zeros((64, 64, 3), dtype=np.uint8)
            await worker._process_bgr_frame("student-a", frame)

            self.assertEqual(len(publisher.scores), 1)
            self.assertEqual(publisher.scores[0][0], "sess-1")
            self.assertEqual(len(publisher.hci), 1)
            self.assertEqual(publisher.hci[0][1]["type"], "PACING_ALERT")
            self.assertEqual(len(publisher.gaze), 1)
            self.assertEqual(len(publisher.heatmap), 1)

        asyncio.run(_run())

    def test_lifecycle_created_then_completed_starts_and_stops_worker(self):
        async def _run():
            settings = _Settings()
            created_workers = []

            def _factory(s, **kwargs):
                w = _StubWorker(s, **kwargs)
                created_workers.append(w)
                return w

            runner = CVWorkerLifecycleRunner(settings, worker_factory=_factory)

            async def _fake_fetch(session_id):
                return {
                    "token": "token-1",
                    "livekitUrl": "wss://lk",
                    "sessionId": session_id,
                }

            runner._fetch_service_token = _fake_fetch

            await runner._handle_lifecycle_message(
                '{"type":"session.created","sessionId":"sess-1"}'
            )
            self.assertEqual(len(created_workers), 1)
            self.assertEqual(created_workers[0].connect_calls, 1)

            await runner._handle_lifecycle_message(
                '{"type":"session.completed","sessionId":"sess-1"}'
            )
            self.assertEqual(created_workers[0].close_calls, 1)

        asyncio.run(_run())

    def test_lifecycle_unexpected_disconnect_triggers_reconnect(self):
        async def _run():
            settings = _Settings()
            created_workers = []

            def _factory(s, **kwargs):
                w = _StubWorker(s, **kwargs)
                created_workers.append(w)
                return w

            runner = CVWorkerLifecycleRunner(settings, worker_factory=_factory)

            async def _fake_fetch(session_id):
                return {
                    "token": "token-1",
                    "livekitUrl": "wss://lk",
                    "sessionId": session_id,
                }

            runner._fetch_service_token = _fake_fetch

            await runner._handle_lifecycle_message(
                '{"type":"session.created","sessionId":"sess-1"}'
            )
            self.assertEqual(len(created_workers), 1)

            await runner._on_unexpected_disconnect("sess-1")
            await asyncio.sleep(0.01)

            self.assertEqual(len(created_workers), 2)
            self.assertEqual(created_workers[0].close_calls, 1)
            self.assertEqual(created_workers[1].connect_calls, 1)

            await runner.stop()

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
