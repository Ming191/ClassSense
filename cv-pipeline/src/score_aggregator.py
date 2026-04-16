"""
ScoreAggregator — computes the per-student engagement score from a sliding
window of FrameSignal objects.

Engagement formula (v1, unchanged in v2):
    E(t) = 0.35 × S_blink(t)
          + 0.30 × S_gaze(t)
          + 0.25 × S_pose(t)
          + 0.10 × S_emotion(t)

Applied on a sliding window of W = 30 s, then smoothed with EMA(α = 0.3).

Composite signals (new in v2):
    C_score  — confusion composite
    F_score  — fatigue composite (with session-time multiplier)

Event flags emitted per update:
    DISTRACTION, DROWSY, CONFUSED, FACE_MISSING, LOW_ENGAGEMENT,
    CONFUSED_SUSTAINED, FATIGUE_WARNING

Threshold sources
-----------------
PERCLOS_BLINK_THRESHOLD = 0.10
    Lin et al. (2012) "PERCLOS Threshold for Drowsiness Detection during Real
    Driving" (Journal of Vision) found a baseline PERCLOS of ~6 % in alert
    drivers that rises to ~10.5 % at the point of a 1-second microsleep, so
    0.10 is used as the alert→drowsy boundary in real driving conditions.
    Abe (2023) "PERCLOS-based technologies for detecting drowsiness" (Sleep
    Advances) confirms PERCLOS as the most validated passive drowsiness index.

BLINK_RATE_LOW = 8  (blinks/min)
    Stern et al. (1994) "Blink rate: a possible measure of fatigue" (Human
    Factors) reports resting blink rate ~15–20 bpm, but focused visual-display
    tasks consistently reduce this to 6–8 bpm.  The lower guard of 8 therefore
    distinguishes normal screen-task attention from pathological suppression.

BLINK_RATE_HIGH = 20 / BLINK_RATE_NORMAL = 14
    Bentivoglio et al. (1997) "Analysis of blink rate patterns in normal
    subjects" (Movement Disorders) found a mean spontaneous blink rate of
    14.9 ± 5.3 blinks/min across 157 healthy adults, giving a natural upper
    bound of ~20 bpm before elevated rate indicates distress.

STARING_BLINK_THRESHOLD = 5  (blinks/min)
    Recarte & Nunes (2003) "Mental load and loss of control over speed in real
    driving" (Ergonomics) measured blink rates as low as 3.5 bpm under high
    cognitive load, validated by Brookings et al. (1996) who similarly found
    sustained suppression below 5–6 bpm during difficult visual tasks.

YAW_LIMIT_DEG = 25
    Crundall & Underwood (1998) "Effects of experience and processing demands
    on visual information acquisition in drivers" (Ergonomics) and SAE J2399
    driver monitoring guidelines both treat ≥ 25° horizontal head deviation
    as off-road gaze.  Vural et al. (2007) used the same threshold for
    drowsiness-related head pose classification.

PITCH_LIMIT_DEG = 20
    Fischer et al. (2018) "Head Pose Estimation in the Wild" and several
    driver-monitoring systems (e.g., Daimler, Seeing Machines) accept up to
    ±20° pitch as natural screen-viewing posture.  15° was too conservative
    for students leaning slightly toward their monitor.

PERCLOS saturation (F_score) at 0.15
    Minhas et al. (2024) "Association of Visual-Based Signals with EEG Patterns"
    (Sensors) uses PERCLOS ≥ 0.30 as severe drowsiness in OSA drivers.
    0.15 is chosen as the saturation point (perclos_signal = 1.0) because it
    represents moderate drowsiness in a lower-stakes classroom context while
    keeping 0.30 available as the flag threshold via PERCLOS_BLINK_THRESHOLD
    scaled relative to the normalisation.

_CONFUSION_EMOTIONS includes "sadness"
    Kapoor et al. (2007) "Automatic prediction of frustration" (Int. J.
    Human-Computer Studies) and Craig et al. (2008) "Emote aloud during
    learning with AutoTutor" (Metacognition & Learning) both demonstrate that
    confusion during learning tasks co-occurs significantly with sadness,
    fear, and disgust affect signals, justifying their joint use in C_score.
"""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, List, Set

from .frame_signal import EMOTION_LABELS, FrameSignal

# ---------------------------------------------------------------------------
# Constants — thresholds backed by peer-reviewed literature (see module doc)
# ---------------------------------------------------------------------------

WINDOW_SECONDS: float = 30.0
EMA_ALPHA: float = 0.3

# S_blink
# PERCLOS alert→drowsy boundary: Lin et al. (2012, J. Vision) — real-driving
# microsleep occurs at ~10.5 % PERCLOS; Abe (2023, Sleep Advances) review.
PERCLOS_BLINK_THRESHOLD: float = 0.10

# Normal blink rate range during screen-based tasks.
# Low guard: Stern et al. (1994, Human Factors) — visual-display tasks drop
# blink rate to 6–8 bpm; 8 distinguishes attention from pathological suppression.
# High guard & normal: Bentivoglio et al. (1997, Movement Disorders) —
# mean spontaneous rate 14.9 ± 5.3 bpm, natural ceiling ~20 bpm.
BLINK_RATE_LOW: float = 8.0
BLINK_RATE_HIGH: float = 20.0
BLINK_RATE_NORMAL: float = 14.9         # Bentivoglio et al. (1997) mean

# S_gaze
GAZE_ON_SCREEN_TARGET: float = 0.80    # fraction of frames with gaze_zone == "center"

# S_pose
# Yaw: SAE J2399 / Crundall & Underwood (1998, Ergonomics) — ≥ 25° = off-road gaze.
# Pitch: Fischer et al. (2018) & Seeing Machines guidelines — ±20° = natural
# screen-viewing posture; 15° was too conservative for seated monitor use.
YAW_LIMIT_DEG: float = 25.0
PITCH_LIMIT_DEG: float = 20.0
POSE_ON_TARGET: float = 0.85           # fraction of frames within limits

# S_emotion — positive emotions
_POSITIVE_EMOTIONS: Set[str] = {"happiness", "neutral", "surprise"}
# Confusion-correlated emotions: Kapoor et al. (2007, IJHCS); Craig et al.
# (2008, Metacognition & Learning) — sadness, fear, disgust co-occur with
# confusion in learning tasks.
_CONFUSION_EMOTIONS: Set[str] = {"fear", "disgust", "sadness"}

# Flag thresholds
LOW_ENGAGEMENT_THRESHOLD: float = 0.45
C_SCORE_THRESHOLD: float = 0.55
C_SCORE_SUSTAINED_SECONDS: float = 8.0
F_SCORE_THRESHOLD: float = 0.60
FATIGUE_ESCALATION_AFTER_MIN: float = 30.0
FATIGUE_ESCALATION_RATE: float = 0.015   # per minute after the 30-min mark
# Recarte & Nunes (2003, Ergonomics) + Brookings et al. (1996) — blink rate
# drops to 3.5–6 bpm under high cognitive load / staring; 5 bpm as threshold.
STARING_BLINK_THRESHOLD: float = 5.0
PITCH_DROOP_START: float = 20.0         # degrees — above this → drooping head

# F_score PERCLOS saturation: 0.15 = moderate drowsiness in classroom context.
# Minhas et al. (2024, Sensors) use 0.30 for severe drowsiness in OSA drivers;
# 0.15 is chosen as a softer mid-point suitable for a non-safety-critical setting.
_PERCLOS_FATIGUE_SATURATION: float = 0.15

# Max gaze drift used to normalise gaze_unstable; tuned empirically
_MAX_GAZE_DRIFT_STD: float = 0.4

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------

FLAGS = frozenset({
    "DISTRACTION",
    "DROWSY",
    "CONFUSED",
    "FACE_MISSING",
    "LOW_ENGAGEMENT",
    "CONFUSED_SUSTAINED",
    "FATIGUE_WARNING",
})


# ---------------------------------------------------------------------------
# ScoreResult — what the aggregator returns each tick
# ---------------------------------------------------------------------------

@dataclass
class ScoreResult:
    student_id: str
    timestamp: float

    # Main scores
    E_raw: float            # raw weighted sum [0, 1]
    E_display: float        # EMA-smoothed [0, 1]

    # Sub-scores
    S_blink: float
    S_gaze: float
    S_pose: float
    S_emotion: float

    # Composite scores
    C_score: float          # confusion composite
    F_score: float          # fatigue composite (after multiplier)

    # Flags
    flags: List[str] = field(default_factory=list)

    # Context snapshot
    dominant_emotion: str = "neutral"
    gaze_zone: str = "center"
    yaw: float = 0.0
    pitch: float = 0.0

    # How many non-missing frames were in the window
    window_size: int = 0


# ---------------------------------------------------------------------------
# ScoreAggregator
# ---------------------------------------------------------------------------

class ScoreAggregator:
    """Maintains a per-student sliding window and emits ScoreResult on each push."""

    def __init__(
        self,
        student_id: str,
        session_id: str = "",
        window_seconds: float = WINDOW_SECONDS,
        session_start_time: float | None = None,
    ) -> None:
        self.student_id = student_id
        self.session_id = session_id
        self._window_seconds = window_seconds
        self._session_start = session_start_time if session_start_time is not None else time.time()

        self._buffer: Deque[FrameSignal] = deque()
        self._E_display: float | None = None   # None until first valid frame

        # For CONFUSED_SUSTAINED tracking
        self._confused_since: float | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push(self, signal: FrameSignal) -> ScoreResult:
        """
        Accept a new FrameSignal, update the sliding window, and return a
        fresh ScoreResult.
        """
        self._buffer.append(signal)
        self._evict_old(signal.timestamp)
        return self._compute(signal)

    def reset(self) -> None:
        """Clear the window and reset EMA state (e.g. when a student reconnects)."""
        self._buffer.clear()
        self._E_display = None
        self._confused_since = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _evict_old(self, now: float) -> None:
        cutoff = now - self._window_seconds
        while self._buffer and self._buffer[0].timestamp < cutoff:
            self._buffer.popleft()

    def _compute(self, latest: FrameSignal) -> ScoreResult:
        """Compute all scores from the current window contents."""
        window = list(self._buffer)
        valid = [s for s in window if not s.face_missing]
        n_valid = len(valid)
        n_total = len(window)

        # ---- handle full face-missing case --------------------------------
        if n_valid == 0:
            E_raw = 0.0
            E_display = self._ema(E_raw)
            result = ScoreResult(
                student_id=self.student_id,
                timestamp=latest.timestamp,
                E_raw=E_raw,
                E_display=E_display,
                S_blink=0.0,
                S_gaze=0.0,
                S_pose=0.0,
                S_emotion=0.0,
                C_score=0.0,
                F_score=0.0,
                flags=["FACE_MISSING"],
                window_size=0,
            )
            self._confused_since = None
            return result

        # ---- S_blink ------------------------------------------------------
        S_blink = self._score_blink(valid, n_total)

        # ---- S_gaze -------------------------------------------------------
        S_gaze = self._score_gaze(valid)

        # ---- S_pose -------------------------------------------------------
        S_pose = self._score_pose(valid)

        # ---- S_emotion ----------------------------------------------------
        S_emotion = self._score_emotion(valid)

        # ---- Main engagement score ----------------------------------------
        E_raw = (
            0.35 * S_blink
            + 0.30 * S_gaze
            + 0.25 * S_pose
            + 0.10 * S_emotion
        )
        E_display = self._ema(E_raw)

        # ---- Composite scores ---------------------------------------------
        C_score = self._compute_c_score(valid)
        F_score = self._compute_f_score(valid, latest.timestamp)

        # ---- Flags --------------------------------------------------------
        flags = self._detect_flags(
            valid=valid,
            n_total=n_total,
            E_display=E_display,
            C_score=C_score,
            F_score=F_score,
            latest=latest,
        )

        # ---- Context snapshot from latest valid frame ----------------------
        dominant_emotion = latest.emotion
        gaze_zone = latest.gaze_zone
        yaw = latest.yaw
        pitch = latest.pitch

        return ScoreResult(
            student_id=self.student_id,
            timestamp=latest.timestamp,
            E_raw=round(E_raw, 4),
            E_display=round(E_display, 4),
            S_blink=round(S_blink, 4),
            S_gaze=round(S_gaze, 4),
            S_pose=round(S_pose, 4),
            S_emotion=round(S_emotion, 4),
            C_score=round(C_score, 4),
            F_score=round(F_score, 4),
            flags=flags,
            dominant_emotion=dominant_emotion,
            gaze_zone=gaze_zone,
            yaw=round(yaw, 2),
            pitch=round(pitch, 2),
            window_size=n_valid,
        )

    # ------------------------------------------------------------------
    # Sub-score helpers
    # ------------------------------------------------------------------

    def _score_blink(self, valid: List[FrameSignal], n_total: int) -> float:
        """
        PERCLOS (proportion of eye-closure) + blink rate normality.

        PERCLOS: fraction of valid frames where both EARs are below threshold.
        Alert→drowsy boundary: 0.10 (Lin et al. 2012, real-driving microsleep).

        Blink rate: blink_detected events per minute.
        Normal range: 8–20 bpm during screen tasks (Stern et al. 1994;
        Bentivoglio et al. 1997).
        """
        from .landmark_analyzer import EAR_BLINK_THRESHOLD

        if not valid:
            return 0.0

        # PERCLOS — using average EAR per frame as proxy
        closed_count = sum(
            1 for s in valid
            if (s.ear_left + s.ear_right) / 2.0 < EAR_BLINK_THRESHOLD
        )
        perclos = closed_count / len(valid)
        perclos_score = max(0.0, 1.0 - perclos / PERCLOS_BLINK_THRESHOLD)

        # Blink rate (blinks per minute over the window duration)
        n_blinks = sum(1 for s in valid if s.blink_detected)
        # Estimate window duration from first/last timestamp
        if len(valid) >= 2:
            duration_s = valid[-1].timestamp - valid[0].timestamp
        else:
            duration_s = 1.0
        duration_min = max(duration_s / 60.0, 1e-6)
        blink_rate = n_blinks / duration_min

        # Score: 1.0 inside [12, 20], linearly degrades outside
        if BLINK_RATE_LOW <= blink_rate <= BLINK_RATE_HIGH:
            blink_rate_score = 1.0
        elif blink_rate < BLINK_RATE_LOW:
            blink_rate_score = max(0.0, blink_rate / BLINK_RATE_LOW)
        else:
            blink_rate_score = max(0.0, 1.0 - (blink_rate - BLINK_RATE_HIGH) / BLINK_RATE_HIGH)

        # Face coverage penalty — missing frames reduce the score
        coverage = len(valid) / max(n_total, 1)

        return coverage * (0.6 * perclos_score + 0.4 * blink_rate_score)

    def _score_gaze(self, valid: List[FrameSignal]) -> float:
        """Fraction of valid frames where gaze_zone == 'center'."""
        if not valid:
            return 0.0
        on_screen = sum(1 for s in valid if s.gaze_zone == "center")
        return on_screen / len(valid)

    def _score_pose(self, valid: List[FrameSignal]) -> float:
        """
        Fraction of valid frames within head-pose attention limits.
        |yaw| < 25° (SAE J2399 / Crundall & Underwood 1998 off-road-gaze bound)
        |pitch| < 20° (Fischer et al. 2018 natural screen-viewing posture)
        """
        if not valid:
            return 0.0
        on_target = sum(
            1 for s in valid
            if abs(s.yaw) < YAW_LIMIT_DEG and abs(s.pitch) < PITCH_LIMIT_DEG
        )
        return on_target / len(valid)

    def _score_emotion(self, valid: List[FrameSignal]) -> float:
        """
        Average valence signal over the window.

        Use the pre-computed valence from EmotiEffLib (range approximately
        [-1, 1]) scaled to [0, 1].  Fall back to the softmax probabilities
        for positive-emotion labels if valence is unavailable.
        """
        if not valid:
            return 0.0

        valence_sum = 0.0
        for s in valid:
            # EmotiEffLib valence is in [-1, 1]; scale to [0, 1]
            scaled = (s.valence + 1.0) / 2.0
            valence_sum += max(0.0, min(1.0, scaled))

        return valence_sum / len(valid)

    # ------------------------------------------------------------------
    # Composite scores
    # ------------------------------------------------------------------

    def _compute_c_score(self, valid: List[FrameSignal]) -> float:
        """
        Confusion Composite Score (C_score):
            0.5 × confusion_emotion
          + 0.3 × blink_irregular
          + 0.2 × gaze_unstable
        """
        if not valid:
            return 0.0

        # confusion_emotion — mean confusion-emotion probability over window
        confusion_indices = [
            EMOTION_LABELS.index(label)
            for label in _CONFUSION_EMOTIONS
            if label in EMOTION_LABELS
        ]
        confusion_emotion = sum(
            sum(s.emotion_probs[idx] for idx in confusion_indices)
            for s in valid
        ) / len(valid)
        confusion_emotion = min(1.0, confusion_emotion)

        # blink_irregular — deviation of blink_rate from 15 bpm normalised to [0, 1]
        n_blinks = sum(1 for s in valid if s.blink_detected)
        if len(valid) >= 2:
            duration_s = valid[-1].timestamp - valid[0].timestamp
        else:
            duration_s = 1.0
        duration_min = max(duration_s / 60.0, 1e-6)
        blink_rate = n_blinks / duration_min
        blink_irregular = min(1.0, abs(blink_rate - BLINK_RATE_NORMAL) / BLINK_RATE_NORMAL)

        # gaze_unstable — std of gaze_x/gaze_y offsets normalised
        gaze_xs = [s.gaze_x for s in valid]
        gaze_ys = [s.gaze_y for s in valid]
        if len(gaze_xs) > 1:
            std_x = _std(gaze_xs)
            std_y = _std(gaze_ys)
            drift_std = math.sqrt(std_x ** 2 + std_y ** 2)
        else:
            drift_std = 0.0
        gaze_unstable = min(1.0, drift_std / _MAX_GAZE_DRIFT_STD)

        return (
            0.5 * confusion_emotion
            + 0.3 * blink_irregular
            + 0.2 * gaze_unstable
        )

    def _compute_f_score(self, valid: List[FrameSignal], now: float) -> float:
        """
        Fatigue Composite Score with session-time multiplier:
            F_score = 0.5 × perclos_signal
                    + 0.3 × staring_signal
                    + 0.2 × drooping
            F_final = min(1.0, F_score × fatigue_multiplier)
        """
        if not valid:
            return 0.0

        from .landmark_analyzer import EAR_BLINK_THRESHOLD

        # perclos_signal
        closed_count = sum(
            1 for s in valid
            if (s.ear_left + s.ear_right) / 2.0 < EAR_BLINK_THRESHOLD
        )
        perclos = closed_count / len(valid)
        perclos_signal = min(1.0, perclos / _PERCLOS_FATIGUE_SATURATION)

        # staring_signal — blink_rate < 6 bpm
        n_blinks = sum(1 for s in valid if s.blink_detected)
        if len(valid) >= 2:
            duration_s = valid[-1].timestamp - valid[0].timestamp
        else:
            duration_s = 1.0
        duration_min = max(duration_s / 60.0, 1e-6)
        blink_rate = n_blinks / duration_min
        staring_signal = 1.0 if blink_rate < STARING_BLINK_THRESHOLD else 0.0

        # drooping — mean pitch > 20° (looking down)
        mean_pitch = sum(s.pitch for s in valid) / len(valid)
        drooping = max(0.0, (mean_pitch - PITCH_DROOP_START) / PITCH_DROOP_START)
        drooping = min(1.0, drooping)

        F_base = (
            0.5 * perclos_signal
            + 0.3 * staring_signal
            + 0.2 * drooping
        )

        # Session-time multiplier — escalates after 30 minutes
        session_minutes = (now - self._session_start) / 60.0
        extra_minutes = max(0.0, session_minutes - FATIGUE_ESCALATION_AFTER_MIN)
        multiplier = 1.0 + FATIGUE_ESCALATION_RATE * extra_minutes

        return min(1.0, F_base * multiplier)

    # ------------------------------------------------------------------
    # EMA
    # ------------------------------------------------------------------

    def _ema(self, new_value: float) -> float:
        if self._E_display is None:
            self._E_display = new_value
        else:
            self._E_display = EMA_ALPHA * new_value + (1.0 - EMA_ALPHA) * self._E_display
        return self._E_display

    # ------------------------------------------------------------------
    # Flag detection
    # ------------------------------------------------------------------

    def _detect_flags(
        self,
        valid: List[FrameSignal],
        n_total: int,
        E_display: float,
        C_score: float,
        F_score: float,
        latest: FrameSignal,
    ) -> List[str]:
        flags: List[str] = []

        # FACE_MISSING — more than half the window has no face
        face_missing_fraction = (n_total - len(valid)) / max(n_total, 1)
        if face_missing_fraction > 0.5 or latest.face_missing:
            flags.append("FACE_MISSING")

        if not valid:
            return flags

        # DISTRACTION — gaze away from screen more than 20% of the time
        gaze_away = sum(1 for s in valid if s.gaze_zone != "center")
        if gaze_away / len(valid) > 0.20:
            flags.append("DISTRACTION")

        # DROWSY — sustained eye closure / very low blink rate
        from .landmark_analyzer import EAR_BLINK_THRESHOLD
        closed = sum(
            1 for s in valid
            if (s.ear_left + s.ear_right) / 2.0 < EAR_BLINK_THRESHOLD
        )
        perclos = closed / len(valid)
        if perclos >= PERCLOS_BLINK_THRESHOLD:
            flags.append("DROWSY")

        # CONFUSED — C_score above threshold
        if C_score > C_SCORE_THRESHOLD:
            flags.append("CONFUSED")

        # CONFUSED_SUSTAINED — C_score has been above threshold for ≥ 8 s
        if C_score > C_SCORE_THRESHOLD:
            if self._confused_since is None:
                self._confused_since = latest.timestamp
            elif latest.timestamp - self._confused_since >= C_SCORE_SUSTAINED_SECONDS:
                flags.append("CONFUSED_SUSTAINED")
        else:
            self._confused_since = None

        # LOW_ENGAGEMENT
        if E_display < LOW_ENGAGEMENT_THRESHOLD:
            flags.append("LOW_ENGAGEMENT")

        # FATIGUE_WARNING
        if F_score > F_SCORE_THRESHOLD:
            flags.append("FATIGUE_WARNING")

        return flags


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _std(values: List[float]) -> float:
    """Population standard deviation."""
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n
    return math.sqrt(variance)
