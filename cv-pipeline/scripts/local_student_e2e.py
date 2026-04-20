import argparse
import os
import signal
import sys
import time

import cv2

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, PROJECT_ROOT)

from src.adapters.classsense_mapper import map_score_result_to_payload
from src.adapters.classsense_signal_client import (
    ClassSenseClientConfig,
    ClassSenseSignalClient,
)
from src.emotion_classifier import EmotionClassifier
from src.face_detector import FaceDetector
from src.frame_signal import EMOTION_LABELS, FrameSignal
from src.landmark_analyzer import LandmarkAnalyzer
from src.pose_estimator import PoseEstimator
from src.score_aggregator import ScoreAggregator


def _neutral_probs() -> list[float]:
    probs = [0.0] * len(EMOTION_LABELS)
    probs[EMOTION_LABELS.index("neutral")] = 1.0
    return probs


def _now_stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Local E2E student publisher using real CV pipeline"
    )
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--name", default="CV Student")
    parser.add_argument("--email", default="cv-student@classsense.local")
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--fps", type=int, default=20)
    parser.add_argument("--publish-interval", type=float, default=3.0)
    parser.add_argument("--show-preview", action="store_true")
    args = parser.parse_args()

    face_model_path = os.path.join(PROJECT_ROOT, "models", "face_landmarker.task")
    pose_model_path = os.path.join(
        PROJECT_ROOT, "models", "6DRepNet_300W_LP_AFLW2000.pth"
    )

    cap = cv2.VideoCapture(args.camera_index)
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open camera index {args.camera_index}")

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, max(args.width, 0))
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, max(args.height, 0))
    cap.set(cv2.CAP_PROP_FPS, max(args.fps, 0))

    client = ClassSenseSignalClient(
        ClassSenseClientConfig(
            base_url=args.base_url,
            session_id=args.session_id,
            participant_name=args.name,
            participant_email=args.email,
        )
    )

    token_payload = client.issue_token()
    participant = token_payload.get("participant") or {}
    participant_id = participant.get("id")
    if not participant_id:
        raise RuntimeError("Token response missing participant.id")

    print(
        f"[{_now_stamp()}] Connected as participant={participant_id} "
        f"session={args.session_id} base_url={args.base_url}"
    )

    stop = False

    def _handle_interrupt(_sig, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _handle_interrupt)

    analyzer = LandmarkAnalyzer(min_blink_frames=1)
    aggregator = ScoreAggregator(student_id=participant_id, session_id=args.session_id)
    emotion_probs = _neutral_probs()
    emotion = "neutral"
    valence = 0.0
    arousal = 0.0
    yaw = 0.0
    pitch = 0.0
    roll = 0.0
    next_publish_at = time.time()

    try:
        with FaceDetector(model_path=face_model_path) as detector:
            pose = PoseEstimator(model_path=pose_model_path)
            emo = EmotionClassifier(device="cpu")

            while not stop:
                ok, frame = cap.read()
                if not ok:
                    print(f"[{_now_stamp()}] WARN: failed to read frame")
                    continue

                detected, face_roi = detector.detect(frame)
                has_face = bool(detected and detected.face_landmarks)
                now_ts = time.time()

                if has_face:
                    metrics = analyzer.analyze(detected)
                    if face_roi is not None and face_roi.size > 0:
                        yaw, pitch, roll = pose.predict(face_roi)
                        emotion, probs, valence, arousal = emo.predict(face_roi)
                        if probs and len(probs) == len(EMOTION_LABELS):
                            emotion_probs = [float(p) for p in probs]

                    frame_signal = FrameSignal(
                        student_id=participant_id,
                        timestamp=now_ts,
                        ear_left=metrics["ear_left"],
                        ear_right=metrics["ear_right"],
                        blink_detected=metrics["blink_detected"],
                        gaze_zone=metrics["gaze_zone"],
                        gaze_x=metrics["gaze_x"],
                        gaze_y=metrics["gaze_y"],
                        yaw=float(yaw),
                        pitch=float(pitch),
                        roll=float(roll),
                        emotion=str(emotion),
                        emotion_probs=emotion_probs,
                        valence=float(valence),
                        arousal=float(arousal),
                        face_missing=False,
                    )
                else:
                    analyzer.reset()
                    frame_signal = FrameSignal.face_missing_signal(participant_id)
                    frame_signal.timestamp = now_ts

                score_result = aggregator.push(frame_signal)

                if now_ts >= next_publish_at:
                    payload = map_score_result_to_payload(
                        frame_signal=frame_signal,
                        score_result=score_result,
                        participant_id=participant_id,
                        camera_enabled=True,
                        microphone_enabled=False,
                    )
                    client.publish_signal(
                        participant_id=payload["participantId"],
                        engagement_score=payload["engagementScore"],
                        face_detected=payload["faceDetected"],
                        emotion=payload.get("emotion"),
                        yaw=payload.get("yaw"),
                        pitch=payload.get("pitch"),
                        roll=payload.get("roll"),
                        camera_enabled=payload["cameraEnabled"],
                        microphone_enabled=payload["microphoneEnabled"],
                    )
                    print(
                        f"[{_now_stamp()}] engagement={payload['engagementScore']:.3f} "
                        f"face_detected={payload['faceDetected']} emotion={payload.get('emotion')} "
                        f"yaw={float(payload.get('yaw') or 0.0):+.1f} pitch={float(payload.get('pitch') or 0.0):+.1f}"
                    )
                    next_publish_at = now_ts + max(args.publish_interval, 0.2)

                if args.show_preview:
                    cv2.imshow("ClassSense Local Student E2E", frame)
                    if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                        stop = True
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print(f"[{_now_stamp()}] Stopped local_student_e2e and released camera")


if __name__ == "__main__":
    main()
