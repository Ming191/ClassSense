import numpy as np
from sixdrepnet import SixDRepNet as SixDRepNet_Detector


class PoseEstimator:
    def __init__(self, model_path: str = "models/6DRepNet_300W_LP_AFLW2000.pth"):
        import os
        dict_path = model_path if os.path.isfile(model_path) else ""
        self._detector = SixDRepNet_Detector(gpu_id=-1, dict_path=dict_path)

    def predict(self, face_roi_bgr: np.ndarray) -> tuple[float, float, float]:
        if face_roi_bgr.size == 0:
            return 0.0, 0.0, 0.0
        pitch_arr, yaw_arr, roll_arr = self._detector.predict(face_roi_bgr)
        return float(yaw_arr[0]), float(pitch_arr[0]), float(roll_arr[0])
