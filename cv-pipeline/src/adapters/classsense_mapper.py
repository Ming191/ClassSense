from __future__ import annotations

from dataclasses import asdict, is_dataclass


def score_result_to_payload(result) -> dict:
    src = (
        asdict(result)
        if is_dataclass(result)
        else dict(getattr(result, "__dict__", {}))
    )
    payload = {
        "student_id": src.get("student_id"),
        "timestamp": src.get("timestamp"),
        "score": src.get("E_display", src.get("score")),
        "flags": src.get("flags", []),
        "gaze_zone": src.get("gaze_zone", "center"),
        "emotion": src.get("dominant_emotion", src.get("emotion", "neutral")),
        "yaw": src.get("yaw", 0.0),
        "pitch": src.get("pitch", 0.0),
    }

    for key in (
        "E_raw",
        "E_display",
        "S_blink",
        "S_gaze",
        "S_pose",
        "S_emotion",
        "C_score",
        "F_score",
        "window_size",
        "session_id",
    ):
        if key in src:
            payload[key] = src[key]

    return payload


def frame_signal_to_gaze_payload(signal) -> dict:
    src = (
        asdict(signal)
        if is_dataclass(signal)
        else dict(getattr(signal, "__dict__", {}))
    )
    return {
        "student_id": src.get("student_id"),
        "timestamp": src.get("timestamp"),
        "gaze_zone": src.get("gaze_zone", "center"),
        "gaze_x": src.get("gaze_x", 0.0),
        "gaze_y": src.get("gaze_y", 0.0),
        "yaw": src.get("yaw", 0.0),
        "pitch": src.get("pitch", 0.0),
        "emotion": src.get("emotion", "neutral"),
        "flags": src.get("flags", []),
    }
