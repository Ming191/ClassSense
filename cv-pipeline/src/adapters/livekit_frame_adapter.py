from __future__ import annotations

import cv2
import numpy as np

FRAME_TYPE_RGBA = 0
FRAME_TYPE_I420 = 1

try:
    from livekit.rtc import VideoBufferType as _LivekitVideoBufferType

    FRAME_TYPE_RGBA = int(_LivekitVideoBufferType.RGBA)
    FRAME_TYPE_I420 = int(_LivekitVideoBufferType.I420)
except Exception:
    pass


def _normalize_frame_type(frame_type: object) -> int | str:
    if frame_type is None:
        return -1
    if isinstance(frame_type, int):
        return frame_type
    name = getattr(frame_type, "name", None)
    if isinstance(name, str):
        return name.upper()
    return str(frame_type).upper()


def video_frame_to_bgr(frame) -> np.ndarray:
    width = int(getattr(frame, "width"))
    height = int(getattr(frame, "height"))
    data = getattr(frame, "data")
    frame_type = _normalize_frame_type(getattr(frame, "type", None))

    buf = np.frombuffer(data, dtype=np.uint8)

    is_rgba = frame_type in (FRAME_TYPE_RGBA, "RGBA")
    is_i420 = frame_type in (FRAME_TYPE_I420, "I420")

    if is_rgba:
        expected = width * height * 4
        if buf.size < expected:
            raise ValueError(
                f"RGBA buffer too small: got {buf.size}, expected >= {expected}"
            )
        rgba = buf[:expected].reshape((height, width, 4))
        return cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)

    if is_i420:
        expected = width * height * 3 // 2
        if buf.size < expected:
            raise ValueError(
                f"I420 buffer too small: got {buf.size}, expected >= {expected}"
            )
        i420 = buf[:expected].reshape((height * 3 // 2, width))
        return cv2.cvtColor(i420, cv2.COLOR_YUV2BGR_I420)

    # Fallback: attempt raw BGR shape
    expected_bgr = width * height * 3
    if buf.size >= expected_bgr:
        return buf[:expected_bgr].reshape((height, width, 3))

    raise ValueError(f"Unsupported frame type: {frame_type!r}")


def resize_bgr(frame_bgr: np.ndarray, width: int, height: int) -> np.ndarray:
    if width <= 0 or height <= 0:
        return frame_bgr
    return cv2.resize(
        frame_bgr, (int(width), int(height)), interpolation=cv2.INTER_LINEAR
    )
