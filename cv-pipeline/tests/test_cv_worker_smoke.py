import asyncio
import unittest
from dataclasses import dataclass

import numpy as np

from src.worker.cv_worker import CVWorker


@dataclass
class _Settings:
    livekit_url: str = "wss://example"
    livekit_token: str = "token"
    session_id: str = "sess-1"
    redis_url: str = "redis://localhost:6379/0"
    frame_format: str = "auto"
    target_width: int = 0
    target_height: int = 0
    max_stream_capacity: int = 2
    publish_gaze_points: bool = True


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


class TestCVWorkerSmoke(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
