import dataclasses
import time
from dataclasses import dataclass

VALID_GAZE_ZONES = {"center", "left", "right", "up", "down"}
EMOTION_LABELS = ["anger", "contempt", "disgust", "fear", "happiness", "neutral", "sadness", "surprise"]


@dataclass
class FrameSignal:
    student_id: str
    timestamp: float
    ear_left: float
    ear_right: float
    blink_detected: bool
    gaze_zone: str
    gaze_x: float
    gaze_y: float
    yaw: float
    pitch: float
    roll: float
    emotion: str
    emotion_probs: list
    valence: float = 0.0
    arousal: float = 0.0
    face_missing: bool = False

    def __post_init__(self):
        if not self.face_missing:
            if self.gaze_zone not in VALID_GAZE_ZONES:
                raise ValueError(f"gaze_zone must be one of {VALID_GAZE_ZONES}, got {self.gaze_zone!r}")
            if len(self.emotion_probs) != 8:
                raise ValueError(f"emotion_probs must have length 8, got {len(self.emotion_probs)}")
            if not (0.0 <= self.ear_left <= 1.0):
                raise ValueError(f"ear_left out of range [0,1]: {self.ear_left}")
            if not (0.0 <= self.ear_right <= 1.0):
                raise ValueError(f"ear_right out of range [0,1]: {self.ear_right}")

    def to_dict(self):
        return dataclasses.asdict(self)

    @staticmethod
    def face_missing_signal(student_id: str) -> "FrameSignal":
        return FrameSignal(
            student_id=student_id,
            timestamp=time.time(),
            ear_left=0.0,
            ear_right=0.0,
            blink_detected=False,
            gaze_zone="center",
            gaze_x=0.0,
            gaze_y=0.0,
            yaw=0.0,
            pitch=0.0,
            roll=0.0,
            emotion="neutral",
            emotion_probs=[1.0 if l == "neutral" else 0.0 for l in EMOTION_LABELS],
            valence=0.0,
            arousal=0.0,
            face_missing=True,
        )
