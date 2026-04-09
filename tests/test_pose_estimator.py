import argparse
import glob
import os
import random
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from src.face_detector import FaceDetector
from src.pose_estimator import PoseEstimator


def run(lfw_dir: str, n: int, model_path: str, seed: int = 42):
    image_paths = glob.glob(os.path.join(lfw_dir, "**", "*.jpg"), recursive=True)
    random.seed(seed)
    sample = random.sample(image_paths, min(n, len(image_paths)))
    print(f"Testing PoseEstimator on {len(sample)} LFW images\n")

    detector = FaceDetector()
    pose = PoseEstimator(model_path=model_path)

    yaws, pitches, rolls, errors, times_ms = [], [], [], 0, []

    for path in sample:
        bgr = cv2.imread(path)
        if bgr is None:
            continue
        _, roi = detector.detect(bgr)
        if roi is None:
            continue

        t0 = time.perf_counter()
        try:
            yaw, pitch, roll = pose.predict(roi)
        except Exception as e:
            print(f"  CRASH: {e} on {os.path.basename(path)}")
            errors += 1
            continue
        times_ms.append((time.perf_counter() - t0) * 1000)
        yaws.append(yaw)
        pitches.append(pitch)
        rolls.append(roll)

    n_ok = len(yaws)
    print(f"Estimated: {n_ok} poses ({errors} errors)\n")
    if not yaws:
        print("No data.")
        sys.exit(1)

    for name, vals in [("yaw  ", yaws), ("pitch", pitches), ("roll ", rolls)]:
        v = np.array(vals)
        print(f"{name}: mean={v.mean():+.1f}°  std={v.std():.1f}°  "
              f"range=[{v.min():.1f}, {v.max():.1f}]  |x|<45°: {100*(np.abs(v)<45).mean():.0f}%")

    print(f"\nLatency: mean={np.mean(times_ms):.0f} ms  p95={np.percentile(times_ms,95):.0f} ms")

    assert errors == 0, f"{errors} crashes"
    assert (np.abs(np.array(yaws)) < 180).all(), "yaw out of [-180, 180]"
    assert (np.abs(np.array(pitches)) < 90).all(), "pitch out of [-90, 90]"
    frontal_pct = (np.abs(np.array(yaws)) < 45).mean()
    assert frontal_pct >= 0.50, f"Only {frontal_pct:.0%} frontal — model may be broken"
    print(f"\nPASS — {frontal_pct:.0%} of LFW images are frontal (|yaw|<45°)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--lfw-dir", default="datasets/lfw")
    ap.add_argument("--model-path", default="models/6DRepNet_300W_LP_AFLW2000.pth")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    run(args.lfw_dir, args.n, args.model_path, args.seed)
