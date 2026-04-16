import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision


class FaceDetector:
    def __init__(self, model_path: str = "models/face_landmarker.task"):
        base_options = mp_tasks.BaseOptions(model_asset_path=model_path)
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(options)

    def detect(self, bgr: np.ndarray):
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect(mp_image)

        if not result.face_landmarks:
            return None, None

        lms = result.face_landmarks[0]
        face_roi = self._crop_face(bgr, lms, h, w)
        return result, face_roi

    def _crop_face(self, bgr, landmarks, h, w):
        xs = [lm.x * w for lm in landmarks]
        ys = [lm.y * h for lm in landmarks]
        lm_w = max(xs) - min(xs)
        lm_h = max(ys) - min(ys)
        pad_x = max(int(0.10 * lm_w), 1)
        pad_y = max(int(0.10 * lm_h), 1)
        x1 = max(0, int(min(xs)) - pad_x)
        y1 = max(0, int(min(ys)) - pad_y)
        x2 = min(w, int(max(xs)) + pad_x)
        y2 = min(h, int(max(ys)) + pad_y)
        return bgr[y1:y2, x1:x2]

    def close(self):
        self._landmarker.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
