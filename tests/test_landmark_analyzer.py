import argparse
import glob
import os
import random
import sys
import time
from collections import Counter

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from src.face_detector import FaceDetector
from src.landmark_analyzer import LandmarkAnalyzer


def run(lfw_dir: str, n: int, seed: int = 42):
    image_paths = glob.glob(os.path.join(lfw_dir, "**", "*.jpg"), recursive=True)
    random.seed(seed)
    sample = random.sample(image_paths, min(n, len(image_paths)))
    print(f"Testing LandmarkAnalyzer on {len(sample)} LFW images\n")

    detector = FaceDetector()
    analyzer = LandmarkAnalyzer(min_blink_frames=1)

    ear_lefts, ear_rights, gaze_zones = [], [], []
    gaze_xs, gaze_ys = [], []
    blinks, analyzed, errors = 0, 0, 0
    times_ms = []

    for path in sample:
        bgr = cv2.imread(path)
        if bgr is None:
            continue
        result, _ = detector.detect(bgr)
        if result is None:
            continue

        t0 = time.perf_counter()
        try:
            lm = analyzer.analyze(result)
        except Exception as e:
            print(f"  CRASH: {e} on {os.path.basename(path)}")
            errors += 1
            continue
        times_ms.append((time.perf_counter() - t0) * 1000)

        analyzed += 1
        ear_lefts.append(lm["ear_left"])
        ear_rights.append(lm["ear_right"])
        gaze_zones.append(lm["gaze_zone"])
        gaze_xs.append(lm["gaze_x"])
        gaze_ys.append(lm["gaze_y"])
        if lm["blink_detected"]:
            blinks += 1

    print(f"Analyzed: {analyzed} faces ({errors} errors)\n")
    if not ear_lefts:
        print("No data to report.")
        sys.exit(1)

    el, er = np.array(ear_lefts), np.array(ear_rights)
    print(f"EAR Left:  range [{el.min():.3f}, {el.max():.3f}]  mean={el.mean():.3f}  std={el.std():.3f}")
    print(f"           values in [0,1]: {(el >= 0).all() and (el <= 1).all()}")
    print(f"EAR Right: range [{er.min():.3f}, {er.max():.3f}]  mean={er.mean():.3f}  std={er.std():.3f}")

    gc = Counter(gaze_zones)
    print(f"\nGaze zone distribution (n={analyzed}):")
    for zone in ["center", "left", "right", "up", "down"]:
        pct = 100 * gc[zone] / analyzed
        print(f"  {zone:6s}: {gc[zone]:4d} ({pct:5.1f}%) {'#' * int(pct / 2)}")

    gx, gy = np.array(gaze_xs), np.array(gaze_ys)
    print(f"\nGaze offsets (continuous):")
    print(f"  gaze_x: mean={gx.mean():+.3f}  std={gx.std():.3f}  range=[{gx.min():.3f}, {gx.max():.3f}]")
    print(f"  gaze_y: mean={gy.mean():+.3f}  std={gy.std():.3f}  range=[{gy.min():.3f}, {gy.max():.3f}]")
    print(f"\nBlink rate: {100*blinks/analyzed:.1f}% of frames flagged as blink")
    print(f"Latency: mean={np.mean(times_ms):.1f} ms  p95={np.percentile(times_ms,95):.1f} ms")

    assert (el >= 0).all() and (el <= 1).all(), "EAR left out of [0,1]"
    assert (er >= 0).all() and (er <= 1).all(), "EAR right out of [0,1]"
    assert all(z in {"center", "left", "right", "up", "down"} for z in gaze_zones), "Invalid gaze zone"
    assert np.isfinite(gx).all(), "gaze_x contains non-finite values"
    assert np.isfinite(gy).all(), "gaze_y contains non-finite values"
    assert errors == 0, f"{errors} crashes in landmark analyzer"
    center_pct = gc["center"] / analyzed
    assert center_pct >= 0.30, f"center gaze only {center_pct:.1%} — unexpectedly low"
    print(f"\nPASS")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--lfw-dir", default="datasets/lfw")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    run(args.lfw_dir, args.n, args.seed)
