from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass(slots=True)
class InterventionEvent:
    type: str
    student_id: str
    timestamp: float
    suggested_action: str
    auto_trigger: bool
    metadata: dict = field(default_factory=dict)


class InterventionEngine:
    def __init__(self, refractory_seconds: float = 300.0) -> None:
        self.refractory_seconds = float(refractory_seconds)
        self._last_fired: dict[tuple[str, str], float] = {}

    def evaluate(self, score_result) -> list[InterventionEvent]:
        flags = set(getattr(score_result, "flags", []) or [])
        student_id = getattr(score_result, "student_id", "unknown")
        ts = float(getattr(score_result, "timestamp", time.time()))

        events: list[InterventionEvent] = []
        rules = (
            (
                "CONFUSION_PROMPT",
                "CONFUSED_SUSTAINED",
                "Offer a short clarification check-in.",
                False,
            ),
            (
                "FATIGUE_WARNING",
                "FATIGUE_WARNING",
                "Suggest a brief pause and attention reset.",
                True,
            ),
            (
                "PACING_ALERT",
                "LOW_ENGAGEMENT",
                "Consider slowing pace and asking a quick question.",
                False,
            ),
        )

        for event_type, trigger_flag, action, auto_trigger in rules:
            if trigger_flag not in flags:
                continue
            if not self._should_emit(student_id, event_type, ts):
                continue
            event = InterventionEvent(
                type=event_type,
                student_id=student_id,
                timestamp=ts,
                suggested_action=action,
                auto_trigger=auto_trigger,
                metadata={"trigger_flag": trigger_flag},
            )
            events.append(event)
            self._last_fired[(student_id, event_type)] = ts

        return events

    def _should_emit(self, student_id: str, event_type: str, now: float) -> bool:
        last = self._last_fired.get((student_id, event_type))
        if last is None:
            return True
        return (now - last) >= self.refractory_seconds
