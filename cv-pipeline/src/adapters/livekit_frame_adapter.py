from __future__ import annotations

import cv2
import numpy as np
from livekit import rtc


def livekit_frame_to_bgr(frame: rtc.VideoFrame) -> np.ndarray:
    """Convert LiveKit VideoFrame to OpenCV BGR ndarray."""
    if frame.width <= 0 or frame.height <= 0:
        raise ValueError("Invalid frame dimensions from LiveKit")

    frame_type = frame.type

    if (
        frame_type != rtc.VideoBufferType.RGBA
        and frame_type != rtc.VideoBufferType.I420
    ):
        # Convert any unexpected format to RGBA for stable downstream conversion.
        frame = frame.convert(rtc.VideoBufferType.RGBA)
        frame_type = frame.type

    buffer = np.frombuffer(frame.data, dtype=np.uint8)

    if frame_type == rtc.VideoBufferType.RGBA:
        rgba = buffer.reshape((frame.height, frame.width, 4))
        return cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)

    if frame_type == rtc.VideoBufferType.I420:
        yuv = buffer.reshape((frame.height * 3 // 2, frame.width))
        return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)

    raise ValueError(f"Unsupported frame type for conversion: {frame_type}")
