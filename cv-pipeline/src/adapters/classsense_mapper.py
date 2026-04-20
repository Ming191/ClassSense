from __future__ import annotations

from typing import Any


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def map_score_result_to_payload(
    frame_signal: Any,
    score_result: Any,
    participant_id: str,
    camera_enabled: bool = True,
    microphone_enabled: bool = False,
) -> dict:
    """Map real CV pipeline outputs to ClassSense signal payload shape."""
    dominant_emotion = getattr(score_result, "dominant_emotion", None)
    fallback_emotion = getattr(frame_signal, "emotion", None)

    return {
        "participantId": participant_id,
        "engagementScore": _clamp01(getattr(score_result, "E_display", 0.0)),
        "faceDetected": not bool(getattr(frame_signal, "face_missing", True)),
        "emotion": dominant_emotion or fallback_emotion,
        "yaw": float(getattr(frame_signal, "yaw", 0.0)),
        "pitch": float(getattr(frame_signal, "pitch", 0.0)),
        "roll": float(getattr(frame_signal, "roll", 0.0)),
        "cameraEnabled": bool(camera_enabled),
        "microphoneEnabled": bool(microphone_enabled),
    }
