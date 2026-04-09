"""
Run all Week 1 unit tests in sequence and print a summary.

Usage:
    python tests/run_all_tests.py [--fast]   # --fast uses smaller samples
"""
import argparse
import subprocess
import sys
import time

TESTS = [
    {
        "name": "FaceDetector (LFW)",
        "module": "tests/test_face_detector.py",
        "args_normal": ["--n", "200"],
        "args_fast":   ["--n", "50"],
    },
    {
        "name": "LandmarkAnalyzer (LFW)",
        "module": "tests/test_landmark_analyzer.py",
        "args_normal": ["--n", "200"],
        "args_fast":   ["--n", "50"],
    },
    {
        "name": "PoseEstimator (LFW)",
        "module": "tests/test_pose_estimator.py",
        "args_normal": ["--n", "80"],
        "args_fast":   ["--n", "20"],
    },
    {
        "name": "EmotionClassifier (FER2013 + AffectNet)",
        "module": "tests/test_emotion_classifier.py",
        "args_normal": ["--n", "300"],
        "args_fast":   ["--n", "50"],
    },
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true", help="Use smaller samples for quick check")
    args = ap.parse_args()

    results = []
    total_start = time.perf_counter()

    for t in TESTS:
        extra = t["args_fast"] if args.fast else t["args_normal"]
        cmd = [sys.executable, t["module"]] + extra
        print(f"\n{'-'*60}")
        print(f"  {t['name']}")
        print(f"{'-'*60}")
        t0 = time.perf_counter()
        ret = subprocess.run(cmd)
        elapsed = time.perf_counter() - t0
        passed = ret.returncode == 0
        results.append((t["name"], passed, elapsed))

    total = time.perf_counter() - total_start
    print(f"\n{'='*60}")
    print(f"  SUMMARY  ({total:.0f}s total)")
    print(f"{'='*60}")
    all_pass = True
    for name, passed, elapsed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name:<42} {elapsed:5.0f}s")
        if not passed:
            all_pass = False

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
