import unittest

import cv2
import numpy as np

from src.adapters.livekit_frame_adapter import video_frame_to_bgr


class _FakeFrame:
    def __init__(self, width, height, frame_type, data):
        self.width = width
        self.height = height
        self.type = frame_type
        self.data = data


class TestLivekitFrameAdapter(unittest.TestCase):
    def test_rgba_to_bgr_shape(self):
        width, height = 4, 3
        rgba = np.zeros((height, width, 4), dtype=np.uint8)
        rgba[:, :, 0] = 255  # R
        frame = _FakeFrame(width, height, "RGBA", rgba.tobytes())

        bgr = video_frame_to_bgr(frame)
        self.assertEqual(bgr.shape, (height, width, 3))
        self.assertEqual(bgr.dtype, np.uint8)
        self.assertTrue(np.all(bgr[:, :, 2] == 255))

    def test_i420_to_bgr_shape(self):
        width, height = 8, 4
        bgr_input = np.zeros((height, width, 3), dtype=np.uint8)
        bgr_input[:, :, 1] = 200
        i420 = cv2.cvtColor(bgr_input, cv2.COLOR_BGR2YUV_I420)
        frame = _FakeFrame(width, height, "I420", i420.tobytes())

        bgr = video_frame_to_bgr(frame)
        self.assertEqual(bgr.shape, (height, width, 3))
        self.assertEqual(bgr.dtype, np.uint8)


if __name__ == "__main__":
    unittest.main()
