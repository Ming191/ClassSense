import cv2
import numpy as np
from emotiefflib.facial_analysis import EmotiEffLibRecognizer

_MODEL_NAME = "enet_b0_8_va_mtl"
_DEFAULT_LABELS = [
    "anger",
    "contempt",
    "disgust",
    "fear",
    "happiness",
    "neutral",
    "sadness",
    "surprise",
]


def _softmax(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    if x.size == 0:
        return x
    e_x = np.exp(x - np.max(x))
    denom = np.sum(e_x)
    if denom <= 0 or not np.isfinite(denom):
        return np.zeros_like(e_x)
    return e_x / denom


class EmotionClassifier:
    def __init__(self, device: str = "cpu"):
        self._fer = EmotiEffLibRecognizer(
            engine="onnx", model_name=_MODEL_NAME, device=device
        )
        idx_map = getattr(self._fer, "idx_to_emotion_class", None)
        self._labels = (
            [idx_map[i] for i in range(len(idx_map))] if idx_map else _DEFAULT_LABELS
        )
        self._label_to_idx = {label.lower(): i for i, label in enumerate(self._labels)}

    def predict(self, face_roi_bgr: np.ndarray) -> tuple[str, list, float, float]:
        if face_roi_bgr.size == 0:
            probs = [0.0] * 8
            probs[5] = 1.0
            return "neutral", probs, 0.0, 0.0

        rgb = cv2.cvtColor(face_roi_bgr, cv2.COLOR_BGR2RGB)
        emotions, scores = self._fer.predict_emotions([rgb], logits=True)

        row = scores[0]
        valence = float(row[-2])
        arousal = float(row[-1])

        model_probs = _softmax(row[:-2])
        probs = [0.0] * len(_DEFAULT_LABELS)
        for std_i, std_label in enumerate(_DEFAULT_LABELS):
            src_i = self._label_to_idx.get(std_label.lower())
            if src_i is not None and src_i < len(model_probs):
                probs[std_i] = float(model_probs[src_i])

        return str(emotions[0]).lower(), probs, valence, arousal
