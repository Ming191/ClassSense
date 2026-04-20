import unittest

from src.intervention_engine import InterventionEngine
from src.score_aggregator import ScoreResult


class TestInterventionEngine(unittest.TestCase):
    def _result(self, ts, flags):
        return ScoreResult(
            student_id="s1",
            timestamp=ts,
            E_raw=0.0,
            E_display=0.0,
            S_blink=0.0,
            S_gaze=0.0,
            S_pose=0.0,
            S_emotion=0.0,
            C_score=0.0,
            F_score=0.0,
            flags=flags,
        )

    def test_rule_triggering(self):
        engine = InterventionEngine(refractory_seconds=300)
        result = self._result(1000.0, ["CONFUSED_SUSTAINED", "LOW_ENGAGEMENT"])
        events = engine.evaluate(result)
        types = {e.type for e in events}
        self.assertIn("CONFUSION_PROMPT", types)
        self.assertIn("PACING_ALERT", types)

    def test_debounce(self):
        engine = InterventionEngine(refractory_seconds=300)
        first = self._result(1000.0, ["FATIGUE_WARNING"])
        second = self._result(1100.0, ["FATIGUE_WARNING"])
        third = self._result(1401.0, ["FATIGUE_WARNING"])

        self.assertEqual(len(engine.evaluate(first)), 1)
        self.assertEqual(len(engine.evaluate(second)), 0)
        self.assertEqual(len(engine.evaluate(third)), 1)


if __name__ == "__main__":
    unittest.main()
