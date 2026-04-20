from __future__ import annotations

import os
from dataclasses import dataclass


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value: str | None, default: int) -> int:
    if value is None or value.strip() == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"Expected integer value, got: {value!r}") from exc


@dataclass(slots=True)
class Settings:
    livekit_url: str
    livekit_token: str
    session_id: str
    redis_url: str
    frame_format: str = "bgr"
    target_width: int = 0
    target_height: int = 0
    max_stream_capacity: int = 2
    publish_gaze_points: bool = False


def load_settings() -> Settings:
    settings = Settings(
        livekit_url=(os.getenv("LIVEKIT_URL") or "").strip(),
        livekit_token=(os.getenv("LIVEKIT_TOKEN") or "").strip(),
        session_id=(os.getenv("SESSION_ID") or "").strip(),
        redis_url=(os.getenv("REDIS_URL") or "redis://localhost:6379/0").strip(),
        frame_format=(os.getenv("FRAME_FORMAT") or "bgr").strip().lower(),
        target_width=_as_int(os.getenv("TARGET_WIDTH"), 0),
        target_height=_as_int(os.getenv("TARGET_HEIGHT"), 0),
        max_stream_capacity=max(1, _as_int(os.getenv("MAX_STREAM_CAPACITY"), 2)),
        publish_gaze_points=_as_bool(os.getenv("PUBLISH_GAZE_POINTS"), False),
    )

    missing = [
        name
        for name, value in (
            ("LIVEKIT_URL", settings.livekit_url),
            ("LIVEKIT_TOKEN", settings.livekit_token),
            ("SESSION_ID", settings.session_id),
        )
        if not value
    ]
    if missing:
        raise ValueError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    if settings.frame_format not in {"bgr", "rgba", "i420", "auto"}:
        raise ValueError("FRAME_FORMAT must be one of: bgr, rgba, i420, auto")

    return settings
