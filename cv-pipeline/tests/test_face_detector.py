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


def run(lfw_dir: str, n: int, seed: int = 42):
    image_paths = glob.glob(os.path.join(lfw_dir, "**", "*.jpg"), recursive=True)
    if not image_paths:
        print(f"ERROR: No images found in {lfw_dir}")
        sys.exit(1)

    random.seed(seed)
    sample = random.sample(image_paths, min(n, len(image_paths)))
    print(f"Testing FaceDetector on {len(sample)} LFW images (of {len(image_paths)} total)\n")

    detector = FaceDetector()
    detected, failed, errors = 0, 0, 0
    roi_widths, times_ms = [], []

    for path in sample:
        bgr = cv2.imread(path)
        if bgr is None:
            errors += 1
            continue
        t0 = time.perf_counter()
        try:
            result, roi = detector.detect(bgr)
        except Exception as e:
            print(f"  CRASH on {os.path.basename(path)}: {e}")
            errors += 1
            continue
        times_ms.append((time.perf_counter() - t0) * 1000)

        if result is not None:
            detected += 1
            roi_widths.append(roi.shape[1])
        else:
            failed += 1

    total = detected + failed
    print(f"Results ({total} images, {errors} read errors excluded):")
    print(f"  Detected        : {detected:5d}  ({100*detected/total:.1f}%)")
    print(f"  Missed          : {failed:5d}  ({100*failed/total:.1f}%)")
    if roi_widths:
        print(f"\nROI width (px) — detected images:")
        print(f"  min={min(roi_widths)}  median={int(np.median(roi_widths))}  mean={int(np.mean(roi_widths))}  max={max(roi_widths)}")
    if times_ms:
        print(f"\nLatency per image:")
        print(f"  mean={np.mean(times_ms):.1f} ms  p50={np.median(times_ms):.1f} ms  p95={np.percentile(times_ms,95):.1f} ms")

    rate = detected / total
    assert rate >= 0.70, f"Detection rate {rate:.1%} below 70% threshold"
    assert errors == 0 or errors / len(sample) < 0.05, "Too many read errors"
    print(f"\nPASS — detection rate {rate:.1%} >= 70%")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--lfw-dir", default="datasets/lfw")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    run(args.lfw_dir, args.n, args.seed)
