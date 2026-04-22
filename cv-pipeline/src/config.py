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
    redis_url: str
    web_base_url: str = "http://web:3000"
    worker_identity: str = "cv-worker"
    worker_retry_base_ms: int = 500
    worker_retry_max_ms: int = 10000
    session_lifecycle_channel: str = "session:lifecycle"
    frame_format: str = "bgr"
    target_width: int = 0
    target_height: int = 0
    max_stream_capacity: int = 2
    publish_gaze_points: bool = False


def load_settings() -> Settings:
    settings = Settings(
        livekit_url=(os.getenv("LIVEKIT_URL") or "").strip(),
        redis_url=(os.getenv("REDIS_URL") or "redis://localhost:6379/0").strip(),
        web_base_url=(os.getenv("WEB_BASE_URL") or "http://web:3000").strip(),
        worker_identity=(os.getenv("WORKER_IDENTITY") or "cv-worker").strip(),
        worker_retry_base_ms=max(1, _as_int(os.getenv("WORKER_RETRY_BASE_MS"), 500)),
        worker_retry_max_ms=max(1, _as_int(os.getenv("WORKER_RETRY_MAX_MS"), 10000)),
        session_lifecycle_channel=(
            os.getenv("SESSION_LIFECYCLE_CHANNEL") or "session:lifecycle"
        ).strip(),
        frame_format=(os.getenv("FRAME_FORMAT") or "bgr").strip().lower(),
        target_width=_as_int(os.getenv("TARGET_WIDTH"), 0),
        target_height=_as_int(os.getenv("TARGET_HEIGHT"), 0),
        max_stream_capacity=max(1, _as_int(os.getenv("MAX_STREAM_CAPACITY"), 2)),
        publish_gaze_points=_as_bool(os.getenv("PUBLISH_GAZE_POINTS"), False),
    )

    if settings.frame_format not in {"bgr", "rgba", "i420", "auto"}:
        raise ValueError("FRAME_FORMAT must be one of: bgr, rgba, i420, auto")

    if settings.worker_retry_base_ms > settings.worker_retry_max_ms:
        raise ValueError("WORKER_RETRY_BASE_MS must be <= WORKER_RETRY_MAX_MS")
    if not settings.worker_identity:
        raise ValueError("WORKER_IDENTITY must not be empty")
    if not settings.web_base_url:
        raise ValueError("WEB_BASE_URL must not be empty")
    if not settings.session_lifecycle_channel:
        raise ValueError("SESSION_LIFECYCLE_CHANNEL must not be empty")

    return settings
