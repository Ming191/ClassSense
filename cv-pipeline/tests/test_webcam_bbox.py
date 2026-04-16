import argparse
import os
import sys
import time

import cv2

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, PROJECT_ROOT)

from src.emotion_classifier import EmotionClassifier
from src.face_detector import FaceDetector
from src.frame_signal import EMOTION_LABELS, FrameSignal
from src.landmark_analyzer import LandmarkAnalyzer
from src.pose_estimator import PoseEstimator
from src.score_aggregator import ScoreAggregator


def _bbox_from_landmarks(landmarks, frame_w: int, frame_h: int, pad_ratio: float = 0.10):
    xs = [lm.x * frame_w for lm in landmarks]
    ys = [lm.y * frame_h for lm in landmarks]

    lm_w = max(xs) - min(xs)
    lm_h = max(ys) - min(ys)
    pad_x = max(int(pad_ratio * lm_w), 1)
    pad_y = max(int(pad_ratio * lm_h), 1)

    x1 = max(0, int(min(xs)) - pad_x)
    y1 = max(0, int(min(ys)) - pad_y)
    x2 = min(frame_w, int(max(xs)) + pad_x)
    y2 = min(frame_h, int(max(ys)) + pad_y)
    return x1, y1, x2, y2


def _put_lines(frame, lines, x=20, y=25, font_scale=0.56, line_height=23):
    for i, text in enumerate(lines):
        yy = y + i * line_height
        cv2.putText(
            frame,
            text,
            (x, yy),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (20, 20, 20),
            4,
            cv2.LINE_AA,
        )
        cv2.putText(
            frame,
            text,
            (x, yy),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )


def _ema(prev: float, value: float, alpha: float = 0.08) -> float:
    if prev <= 0:
        return value
    return prev * (1.0 - alpha) + value * alpha


def _bottleneck(read_ms: float, detect_ms: float, pose_eff_ms: float, emo_eff_ms: float, other_ms: float) -> str:
    parts = {
        "camera_read": read_ms,
        "face_detect": detect_ms,
        "pose": pose_eff_ms,
        "emotion": emo_eff_ms,
        "other": other_ms,
    }
    best_name, _ = max(parts.items(), key=lambda kv: kv[1])
    return best_name


def _neutral_probs() -> list[float]:
    probs = [0.0] * len(EMOTION_LABELS)
    probs[EMOTION_LABELS.index("neutral")] = 1.0
    return probs


def _camera_backends(mode: str) -> list[tuple[str, int]]:
    mode = mode.lower()

    def _cap(name: str):
        return getattr(cv2, name, None)

    if mode == "dshow":
        v = _cap("CAP_DSHOW")
        return [("dshow", v)] if v is not None else []
    if mode == "msmf":
        v = _cap("CAP_MSMF")
        return [("msmf", v)] if v is not None else []
    if mode == "any":
        v = _cap("CAP_ANY")
        return [("any", v if v is not None else 0)]

    backends: list[tuple[str, int]] = []
    if os.name == "nt":
        for name, cap_name in [("dshow", "CAP_DSHOW"), ("msmf", "CAP_MSMF"), ("any", "CAP_ANY")]:
            v = _cap(cap_name)
            if v is not None:
                backends.append((name, int(v)))
    else:
        for name, cap_name in [("v4l2", "CAP_V4L2"), ("any", "CAP_ANY")]:
            v = _cap(cap_name)
            if v is not None:
                backends.append((name, int(v)))

    if not backends:
        backends = [("any", 0)]
    return backends


def _open_camera(
    camera_index: int,
    width: int,
    height: int,
    camera_fps: int,
    camera_backend: str,
) -> tuple[cv2.VideoCapture | None, int | None, str | None, list[str]]:
    backends = _camera_backends(camera_backend)

    candidate_indices = [camera_index]
    if camera_backend == "auto" and camera_index == 0:
        candidate_indices.extend([1, 2, 3])

    tried: list[str] = []

    for idx in candidate_indices:
        for backend_name, backend_value in backends:
            cap = cv2.VideoCapture(idx, backend_value)
            if not cap.isOpened():
                cap.release()
                tried.append(f"index={idx},backend={backend_name}: open failed")
                continue

            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if camera_fps > 0:
                cap.set(cv2.CAP_PROP_FPS, camera_fps)
            if width > 0:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            if height > 0:
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

            ok, _ = cap.read()
            if ok:
                return cap, idx, backend_name, tried

            cap.release()
            tried.append(f"index={idx},backend={backend_name}: opened but read failed")

    return None, None, None, tried


def _list_cameras(max_camera_index: int, width: int, height: int, camera_fps: int, camera_backend: str):
    backends = _camera_backends(camera_backend)
    found = False
    print(f"Scanning cameras 0..{max_camera_index} using backend mode: {camera_backend}")

    for idx in range(max_camera_index + 1):
        for backend_name, backend_value in backends:
            cap = cv2.VideoCapture(idx, backend_value)
            if not cap.isOpened():
                cap.release()
                continue

            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if camera_fps > 0:
                cap.set(cv2.CAP_PROP_FPS, camera_fps)
            if width > 0:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            if height > 0:
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

            ok, _ = cap.read()
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
            cap.release()

            if ok:
                found = True
                print(f"OK: index={idx}, backend={backend_name}, stream={w}x{h}@{fps:.1f}")

    if not found:
        print("No working camera stream found in scanned range.")
        print("Try closing other apps using camera, then rerun with --camera-backend any or --camera-index 1")


def run(
    camera_index: int,
    face_model_path: str,
    pose_model_path: str,
    width: int,
    height: int,
    flip: bool,
    pad_ratio: float,
    window_name: str,
    no_pose: bool,
    no_emotion: bool,
    blink_frames: int,
    blink_hold_ms: int,
    pose_every: int,
    emotion_every: int,
    camera_fps: int,
    camera_backend: str,
    student_id: str,
    session_id: str,
):
    if not os.path.isfile(face_model_path):
        raise FileNotFoundError(f"Face model file not found: {face_model_path}")

    cap, opened_index, opened_backend, tried = _open_camera(
        camera_index=camera_index,
        width=width,
        height=height,
        camera_fps=camera_fps,
        camera_backend=camera_backend,
    )
    if cap is None:
        tried_text = "\n  - " + "\n  - ".join(tried) if tried else ""
        raise RuntimeError(
            "Cannot open a webcam stream. Tried:" + tried_text + "\n"
            "Tips: close camera apps (Zoom/Teams/OBS), try --camera-index 1, or run --list-cameras"
        )

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    actual_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0

    print("Webcam test running. Press 'q' or ESC to quit.")
    print(f"Camera stream (reported): index={opened_index}, backend={opened_backend}, {actual_w}x{actual_h} @ {actual_fps:.1f} fps")

    analyzer = LandmarkAnalyzer(min_blink_frames=max(1, blink_frames))
    pose_every = max(1, pose_every)
    emotion_every = max(1, emotion_every)
    blink_hold_ms = max(50, blink_hold_ms)

    pose_estimator = None
    emotion_classifier = None

    if not no_pose:
        try:
            pose_estimator = PoseEstimator(model_path=pose_model_path)
            print(f"Pose enabled ({pose_model_path}), cadence: every {pose_every} frame(s)")
        except Exception as exc:
            print(f"WARN: PoseEstimator disabled ({exc})")

    if not no_emotion:
        try:
            emotion_classifier = EmotionClassifier(device="cpu")
            print(f"Emotion enabled, cadence: every {emotion_every} frame(s)")
        except Exception as exc:
            print(f"WARN: EmotionClassifier disabled ({exc})")

    frame_idx = 0
    blink_count = 0
    last_blink_t = -1e9

    aggregator = ScoreAggregator(student_id=student_id, session_id=session_id)

    yaw, pitch, roll = 0.0, 0.0, 0.0
    emotion = "neutral"
    emotion_probs = _neutral_probs()
    emotion_conf = 1.0
    valence, arousal = 0.0, 0.0

    ema_read_ms = 0.0
    ema_detect_ms = 0.0
    ema_lmk_ms = 0.0
    ema_pose_eff_ms = 0.0
    ema_emo_eff_ms = 0.0
    ema_total_ms = 0.0

    try:
        with FaceDetector(model_path=face_model_path) as detector:
            while True:
                frame_idx += 1
                frame_start = time.perf_counter()

                read_t0 = time.perf_counter()
                ok, frame = cap.read()
                read_ms = (time.perf_counter() - read_t0) * 1000
                if not ok:
                    print("Failed to read a frame from webcam.")
                    break

                if flip:
                    frame = cv2.flip(frame, 1)

                detect_t0 = time.perf_counter()
                result, face_roi = detector.detect(frame)
                detect_ms = (time.perf_counter() - detect_t0) * 1000

                landmark_ms = 0.0
                pose_ms = 0.0
                emotion_ms = 0.0

                face_landmarks = result.face_landmarks if result is not None else []
                has_face = bool(face_landmarks)
                metrics = None

                if has_face:
                    h, w = frame.shape[:2]
                    x1, y1, x2, y2 = _bbox_from_landmarks(face_landmarks[0], w, h, pad_ratio)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (60, 220, 60), 2)
                    cv2.putText(
                        frame,
                        "face detected",
                        (x1, max(y1 - 8, 20)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        (60, 220, 60),
                        2,
                        cv2.LINE_AA,
                    )

                    lmk_t0 = time.perf_counter()
                    metrics = analyzer.analyze(result)
                    landmark_ms = (time.perf_counter() - lmk_t0) * 1000

                    if metrics["blink_detected"]:
                        blink_count += 1
                        last_blink_t = time.perf_counter()

                    if (
                        pose_estimator is not None
                        and face_roi is not None
                        and frame_idx % pose_every == 0
                    ):
                        pose_t0 = time.perf_counter()
                        yaw, pitch, roll = pose_estimator.predict(face_roi)
                        pose_ms = (time.perf_counter() - pose_t0) * 1000

                    if (
                        emotion_classifier is not None
                        and face_roi is not None
                        and frame_idx % emotion_every == 0
                    ):
                        emo_t0 = time.perf_counter()
                        emotion, probs, valence, arousal = emotion_classifier.predict(face_roi)
                        emotion_ms = (time.perf_counter() - emo_t0) * 1000
                        if probs and len(probs) == len(EMOTION_LABELS):
                            emotion_probs = [float(p) for p in probs]
                            emotion_conf = max(probs)
                else:
                    analyzer.reset()
                    cv2.putText(
                        frame,
                        "no face detected",
                        (20, 45),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (0, 180, 255),
                        2,
                        cv2.LINE_AA,
                    )

                now_ts = time.time()
                if has_face and metrics is not None:
                    frame_signal = FrameSignal(
                        student_id=student_id,
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
                    frame_signal = FrameSignal.face_missing_signal(student_id)
                    frame_signal.timestamp = now_ts

                score = aggregator.push(frame_signal)

                total_ms = (time.perf_counter() - frame_start) * 1000
                fps = 1000.0 / total_ms if total_ms > 0 else 0.0

                ema_read_ms = _ema(ema_read_ms, read_ms)
                ema_detect_ms = _ema(ema_detect_ms, detect_ms)
                ema_lmk_ms = _ema(ema_lmk_ms, landmark_ms)
                ema_pose_eff_ms = _ema(ema_pose_eff_ms, pose_ms)
                ema_emo_eff_ms = _ema(ema_emo_eff_ms, emotion_ms)
                ema_total_ms = _ema(ema_total_ms, total_ms)

                ema_fps = 1000.0 / ema_total_ms if ema_total_ms > 0 else 0.0
                other_ms = max(
                    ema_total_ms - (ema_read_ms + ema_detect_ms + ema_lmk_ms + ema_pose_eff_ms + ema_emo_eff_ms),
                    0.0,
                )
                bottleneck = _bottleneck(
                    ema_read_ms,
                    ema_detect_ms,
                    ema_pose_eff_ms,
                    ema_emo_eff_ms,
                    other_ms,
                )

                lines = [
                    f"fps: {fps:5.1f} (avg {ema_fps:5.1f}) | total: {total_ms:6.1f} ms",
                    f"read: {read_ms:6.1f} | detect: {detect_ms:6.1f} | lmk: {landmark_ms:5.1f}",
                    f"pose: {pose_ms:5.1f} | emo: {emotion_ms:5.1f}",
                    f"avg ms -> read:{ema_read_ms:5.1f} detect:{ema_detect_ms:5.1f} pose_eff:{ema_pose_eff_ms:5.1f} emo_eff:{ema_emo_eff_ms:5.1f}",
                    f"E: {score.E_display:.3f} (raw {score.E_raw:.3f}) | C: {score.C_score:.3f} F: {score.F_score:.3f}",
                    f"S: blink {score.S_blink:.2f} gaze {score.S_gaze:.2f} pose {score.S_pose:.2f} emo {score.S_emotion:.2f}",
                ]

                if has_face and metrics is not None:
                    blink_visible = (time.perf_counter() - last_blink_t) * 1000.0 <= blink_hold_ms
                    lines.append(
                        f"EAR L/R: {metrics['ear_left']:.3f}/{metrics['ear_right']:.3f} | blink: {'YES' if blink_visible else 'no '} | count: {blink_count}"
                    )
                    lines.append(
                        f"gaze: {metrics['gaze_zone']:<6} | x={metrics['gaze_x']:+.3f} y={metrics['gaze_y']:+.3f}"
                    )
                    lines.append(f"pose: yaw={yaw:+.1f} pitch={pitch:+.1f} roll={roll:+.1f}")
                    lines.append(
                        f"emotion: {emotion:<10} conf={emotion_conf:.2f} val={valence:+.2f} aro={arousal:+.2f}"
                    )
                else:
                    lines.append("EAR/blink, gaze, pose, emotion: waiting for face")

                if score.flags:
                    lines.append("flags: " + ",".join(score.flags))
                else:
                    lines.append("flags: none")

                lines.append(f"bottleneck: {bottleneck}")

                if pose_estimator is None:
                    lines.append("pose: disabled")
                else:
                    lines.append(f"pose cadence: every {pose_every} frame(s)")
                if emotion_classifier is None:
                    lines.append("emotion: disabled")
                else:
                    lines.append(f"emotion cadence: every {emotion_every} frame(s)")

                if bottleneck == "camera_read":
                    lines.append("tip: improve lighting or test another camera backend/index")
                elif bottleneck == "pose":
                    lines.append("tip: increase --pose-every or set --no-pose")
                elif bottleneck == "emotion":
                    lines.append("tip: increase --emotion-every or set --no-emotion")

                if ema_fps < 10:
                    lines.append("tip: lower --width/--height while tuning blink")

                _put_lines(frame, lines)

                cv2.putText(
                    frame,
                    "q/esc: quit",
                    (20, frame.shape[0] - 20),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (210, 210, 210),
                    2,
                    cv2.LINE_AA,
                )

                cv2.imshow(window_name, frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q") or key == 27:
                    break
    finally:
        cap.release()
        cv2.destroyAllWindows()


def main():
    default_face_model_path = os.path.join(PROJECT_ROOT, "models", "face_landmarker.task")
    default_pose_model_path = os.path.join(PROJECT_ROOT, "models", "6DRepNet_300W_LP_AFLW2000.pth")

    ap = argparse.ArgumentParser(description="Webcam CV metrics demo with live face bounding box")
    ap.add_argument("--camera-index", type=int, default=0, help="Webcam index (default: 0)")
    ap.add_argument("--camera-backend", choices=["auto", "dshow", "msmf", "any"], default="auto", help="Camera backend mode (default: auto)")
    ap.add_argument("--camera-fps", type=int, default=30, help="Requested camera FPS (default: 30)")
    ap.add_argument("--list-cameras", action="store_true", help="List working camera index/backend combos and exit")
    ap.add_argument("--max-camera-index", type=int, default=5, help="Max camera index to probe with --list-cameras")
    ap.add_argument("--face-model-path", default=default_face_model_path, help="Path to face_landmarker.task")
    ap.add_argument("--pose-model-path", default=default_pose_model_path, help="Path to 6DRepNet model")
    ap.add_argument("--width", type=int, default=640, help="Capture width (default: 640)")
    ap.add_argument("--height", type=int, default=480, help="Capture height (default: 480)")
    ap.add_argument("--pad", type=float, default=0.10, help="Bounding-box padding ratio (default: 0.10)")
    ap.add_argument("--window-name", default="Face Detector Webcam Test", help="OpenCV window title")
    ap.add_argument("--no-pose", action="store_true", help="Disable head-pose estimation")
    ap.add_argument("--no-emotion", action="store_true", help="Disable emotion estimation")
    ap.add_argument("--blink-frames", type=int, default=1, help="Consecutive low-EAR frames to mark eye closed")
    ap.add_argument("--blink-hold-ms", type=int, default=300, help="Keep blink=YES visible for N ms")
    ap.add_argument("--pose-every", type=int, default=6, help="Run pose every N frames")
    ap.add_argument("--emotion-every", type=int, default=4, help="Run emotion every N frames")
    ap.add_argument("--student-id", default="webcam_student", help="Student id for FrameSignal and ScoreAggregator")
    ap.add_argument("--session-id", default="webcam_demo", help="Session id for ScoreAggregator")
    ap.add_argument("--no-flip", action="store_true", help="Disable mirror flip")
    args = ap.parse_args()

    if args.list_cameras:
        _list_cameras(
            max_camera_index=max(args.max_camera_index, 0),
            width=max(args.width, 0),
            height=max(args.height, 0),
            camera_fps=max(args.camera_fps, 0),
            camera_backend=args.camera_backend,
        )
        return

    run(
        camera_index=args.camera_index,
        face_model_path=args.face_model_path,
        pose_model_path=args.pose_model_path,
        width=1920,
        height=1080,
        flip=not args.no_flip,
        pad_ratio=args.pad,
        window_name=args.window_name,
        no_pose=args.no_pose,
        no_emotion=args.no_emotion,
        blink_frames=max(args.blink_frames, 1),
        blink_hold_ms=max(args.blink_hold_ms, 50),
        pose_every=max(args.pose_every, 1),
        emotion_every=max(args.emotion_every, 1),
        camera_fps=max(args.camera_fps, 0),
        camera_backend=args.camera_backend,
        student_id=args.student_id,
        session_id=args.session_id,
    )


if __name__ == "__main__":
    main()
