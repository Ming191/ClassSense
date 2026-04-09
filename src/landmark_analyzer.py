import numpy as np

_LEFT_EYE = [33, 160, 158, 133, 153, 144]
_RIGHT_EYE = [362, 385, 387, 263, 373, 380]

_LEFT_IRIS_CENTER = 468
_RIGHT_IRIS_CENTER = 473
_LEFT_EYE_OUTER = 33
_LEFT_EYE_INNER = 133
_LEFT_EYE_TOP = 159
_LEFT_EYE_BOT = 145
_RIGHT_EYE_INNER = 362
_RIGHT_EYE_OUTER = 263
_RIGHT_EYE_TOP = 386
_RIGHT_EYE_BOT = 374

EAR_BLINK_THRESHOLD = 0.25
GAZE_H_THRESHOLD = 0.15
GAZE_V_THRESHOLD = 0.15


def _dist(a, b):
    return np.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)


def _ear(landmarks, eye_indices):
    p = [landmarks[i] for i in eye_indices]
    return (_dist(p[1], p[5]) + _dist(p[2], p[4])) / (2.0 * _dist(p[0], p[3]) + 1e-6)


def _gaze_offset(iris_lm, outer, inner, top, bot):
    eye_cx = (outer.x + inner.x) / 2
    eye_cy = (top.y + bot.y) / 2
    x_off = (iris_lm.x - eye_cx) / (abs(inner.x - outer.x) + 1e-6)
    y_off = (iris_lm.y - eye_cy) / (abs(bot.y - top.y) + 1e-6)
    return x_off, y_off


class LandmarkAnalyzer:
    def __init__(self, min_blink_frames: int = 2):
        self._min_blink_frames = min_blink_frames
        self._consecutive_low_ear = 0
        self._is_eye_closed = False

    def analyze(self, mp_result) -> dict:
        lms = mp_result.face_landmarks[0]

        ear_left = float(_ear(lms, _LEFT_EYE))
        ear_right = float(_ear(lms, _RIGHT_EYE))

        both_low = (ear_left < EAR_BLINK_THRESHOLD) and (
            ear_right < EAR_BLINK_THRESHOLD
        )
        self._consecutive_low_ear = self._consecutive_low_ear + 1 if both_low else 0

        currently_closed = self._consecutive_low_ear >= self._min_blink_frames
        blink = self._is_eye_closed and not currently_closed
        self._is_eye_closed = currently_closed

        gaze_zone, gaze_x, gaze_y = self._gaze(lms)

        return {
            "ear_left": min(max(ear_left, 0.0), 1.0),
            "ear_right": min(max(ear_right, 0.0), 1.0),
            "blink_detected": blink,
            "gaze_zone": gaze_zone,
            "gaze_x": float(gaze_x),
            "gaze_y": float(gaze_y),
        }

    def reset(self):
        self._consecutive_low_ear = 0
        self._is_eye_closed = False

    def _gaze(self, lms) -> tuple[str, float, float]:
        if len(lms) < 478:
            return "center", 0.0, 0.0

        lx, ly = _gaze_offset(
            lms[_LEFT_IRIS_CENTER],
            lms[_LEFT_EYE_OUTER],
            lms[_LEFT_EYE_INNER],
            lms[_LEFT_EYE_TOP],
            lms[_LEFT_EYE_BOT],
        )
        rx, ry = _gaze_offset(
            lms[_RIGHT_IRIS_CENTER],
            lms[_RIGHT_EYE_INNER],
            lms[_RIGHT_EYE_OUTER],
            lms[_RIGHT_EYE_TOP],
            lms[_RIGHT_EYE_BOT],
        )
        avg_x = (lx + rx) / 2
        avg_y = (ly + ry) / 2

        h = abs(avg_x) > GAZE_H_THRESHOLD
        v = abs(avg_y) > GAZE_V_THRESHOLD

        if h and v:
            zone = (
                ("up" if avg_y < 0 else "down")
                if abs(avg_y) >= abs(avg_x)
                else ("left" if avg_x < 0 else "right")
            )
        elif v:
            zone = "up" if avg_y < 0 else "down"
        elif h:
            zone = "left" if avg_x < 0 else "right"
        else:
            zone = "center"

        return zone, avg_x, avg_y
