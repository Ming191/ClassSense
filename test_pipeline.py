import argparse
import dataclasses
import json
import sys
import time

import cv2

from src.face_detector import FaceDetector
from src.landmark_analyzer import LandmarkAnalyzer
from src.pose_estimator import PoseEstimator
from src.emotion_classifier import EmotionClassifier
from src.frame_signal import FrameSignal, EMOTION_LABELS

_NEUTRAL_PROBS = [1.0 if l == "neutral" else 0.0 for l in EMOTION_LABELS]


def parse_args():
    p = argparse.ArgumentParser(description="ClassSense CV pipeline — single-frame test")
    p.add_argument("--image", required=True)
    p.add_argument("--student-id", default="test_student")
    p.add_argument("--pose-model", default="models/6DRepNet_300W_LP_AFLW2000.pth")
    p.add_argument("--no-pose", action="store_true")
    return p.parse_args()


def run(frame, student_id, detector, analyzer, pose, emotion_clf) -> FrameSignal:
    print("Running FaceDetector...", end=" ", flush=True)
    result, face_roi = detector.detect(frame)
    if result is None:
        print("no face detected.")
        return FrameSignal.face_missing_signal(student_id)
    print(f"face found, ROI {face_roi.shape[1]}×{face_roi.shape[0]} px")

    print("Running LandmarkAnalyzer...", end=" ", flush=True)
    lm = analyzer.analyze(result)
    print(
        f"EAR L={lm['ear_left']:.3f} R={lm['ear_right']:.3f} "
        f"blink={lm['blink_detected']} gaze={lm['gaze_zone']} "
        f"(x={lm['gaze_x']:+.3f} y={lm['gaze_y']:+.3f})"
    )

    print("Running PoseEstimator...", end=" ", flush=True)
    if pose is None:
        print("SKIP (--no-pose)")
        yaw, pitch, roll = 0.0, 0.0, 0.0
    else:
        try:
            yaw, pitch, roll = pose.predict(face_roi)
            print(f"yaw={yaw:.1f}° pitch={pitch:.1f}° roll={roll:.1f}°")
        except Exception as e:
            print(f"WARN: {e} — using zeros")
            yaw, pitch, roll = 0.0, 0.0, 0.0

    print("Running EmotionClassifier...", end=" ", flush=True)
    try:
        emotion_label, emotion_probs, valence, arousal = emotion_clf.predict(face_roi)
        print(f"{emotion_label} (sum={sum(emotion_probs):.3f})  valence={valence:.3f}  arousal={arousal:.3f}")
    except Exception as e:
        print(f"WARN: {e} — defaulting to neutral")
        emotion_label, emotion_probs, valence, arousal = "neutral", _NEUTRAL_PROBS, 0.0, 0.0

    return FrameSignal(
        student_id=student_id,
        timestamp=time.time(),
        ear_left=lm["ear_left"],
        ear_right=lm["ear_right"],
        blink_detected=lm["blink_detected"],
        gaze_zone=lm["gaze_zone"],
        gaze_x=lm["gaze_x"],
        gaze_y=lm["gaze_y"],
        yaw=yaw,
        pitch=pitch,
        roll=roll,
        emotion=emotion_label,
        emotion_probs=emotion_probs,
        valence=valence,
        arousal=arousal,
        face_missing=False,
    )


def main():
    args = parse_args()
    print(f"\n=== ClassSense Pipeline Test ===")
    print(f"Image : {args.image}")
    print(f"Student: {args.student_id}\n")

    print("Loading models...")
    detector = FaceDetector()
    analyzer = LandmarkAnalyzer(min_blink_frames=2)
    emotion_clf = EmotionClassifier()

    pose = None
    if not args.no_pose:
        try:
            pose = PoseEstimator(model_path=args.pose_model)
        except Exception as e:
            print(f"WARN: PoseEstimator init failed ({e}) — pose skipped")
    print()

    frame = cv2.imread(args.image)
    if frame is None:
        print(f"ERROR: Cannot read image at {args.image!r}", file=sys.stderr)
        sys.exit(1)
    print(f"Image loaded: {frame.shape[1]}×{frame.shape[0]} px\n")

    sig = run(frame, args.student_id, detector, analyzer, pose, emotion_clf)

    print("\n--- FrameSignal ---")
    print(json.dumps(dataclasses.asdict(sig), indent=2))
    print("\nPipeline complete.")


if __name__ == "__main__":
    main()
