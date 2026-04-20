import unittest

from src.adapters.classsense_mapper import (
    frame_signal_to_gaze_payload,
    score_result_to_payload,
)
from src.frame_signal import FrameSignal
from src.score_aggregator import ScoreResult


class TestClasssenseMapper(unittest.TestCase):
    def test_score_result_payload_fields(self):
        result = ScoreResult(
            student_id="stu-1",
            timestamp=123.45,
            E_raw=0.4,
            E_display=0.5,
            S_blink=0.1,
            S_gaze=0.2,
            S_pose=0.3,
            S_emotion=0.4,
            C_score=0.6,
            F_score=0.7,
            flags=["LOW_ENGAGEMENT"],
            dominant_emotion="neutral",
            gaze_zone="center",
            yaw=1.2,
            pitch=-0.8,
            window_size=5,
        )
        payload = score_result_to_payload(result)
        self.assertEqual(payload["student_id"], "stu-1")
        self.assertEqual(payload["score"], 0.5)
        self.assertEqual(payload["emotion"], "neutral")
        self.assertIn("S_blink", payload)
        self.assertIn("C_score", payload)

    def test_frame_signal_gaze_payload_fields(self):
        signal = FrameSignal(
            student_id="stu-2",
            timestamp=1.0,
            ear_left=0.3,
            ear_right=0.3,
            blink_detected=False,
            gaze_zone="left",
            gaze_x=-0.2,
            gaze_y=0.1,
            yaw=2.0,
            pitch=3.0,
            roll=0.0,
            emotion="happiness",
            emotion_probs=[0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            valence=0.4,
            arousal=0.2,
            face_missing=False,
        )
        payload = frame_signal_to_gaze_payload(signal)
        self.assertEqual(payload["student_id"], "stu-2")
        self.assertEqual(payload["gaze_zone"], "left")
        self.assertEqual(payload["yaw"], 2.0)
        self.assertEqual(payload["emotion"], "happiness")


if __name__ == "__main__":
    unittest.main()
