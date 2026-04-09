"""Download model files to models/ directory.

Usage:
    python scripts/download_models.py
"""
import os
import sys
import urllib.request

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")

# MediaPipe Face Landmarker — not needed when using mp.solutions.face_mesh,
# but downloaded here for reference / future tasks API migration.
FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)

# 6DRepNet head-pose model — official URL from sixdrepnet package (regressor.py)
SIXDREPNET_URL = (
    "https://cloud.ovgu.de/s/Q67RnLDy6JKLRWm/download/"
    "6DRepNet_300W_LP_AFLW2000.pth"
)

MODELS = [
    ("face_landmarker.task", FACE_LANDMARKER_URL, None),
    ("6DRepNet_300W_LP_AFLW2000.pth", SIXDREPNET_URL, None),
    # emotiefflib downloads enet_b0_8_best_afew.onnx automatically on first use
]


def _reporthook(block_num, block_size, total_size):
    downloaded = block_num * block_size
    if total_size > 0:
        pct = min(100.0, downloaded * 100.0 / total_size)
        mb = downloaded / 1_048_576
        total_mb = total_size / 1_048_576
        print(f"\r  {pct:5.1f}%  {mb:.1f}/{total_mb:.1f} MB", end="", flush=True)
    else:
        print(f"\r  {downloaded / 1_048_576:.1f} MB downloaded", end="", flush=True)


def download(filename, url):
    dest = os.path.join(MODELS_DIR, filename)
    if os.path.exists(dest):
        size_mb = os.path.getsize(dest) / 1_048_576
        print(f"  Already exists ({size_mb:.1f} MB) — skipping.")
        return True
    print(f"  Downloading {url}")
    try:
        urllib.request.urlretrieve(url, dest, reporthook=_reporthook)
        print()
        size_mb = os.path.getsize(dest) / 1_048_576
        print(f"  Saved to {dest} ({size_mb:.1f} MB)")
        return True
    except Exception as e:
        print(f"\n  ERROR: {e}")
        if os.path.exists(dest):
            os.remove(dest)
        return False


def verify_emotiefflib():
    """Trigger emotiefflib to download enet_b0_8_best_afew.onnx on first use."""
    print("[3/3] enet_b0_8_best_afew.onnx (emotiefflib auto-download)")
    try:
        from emotiefflib.facial_analysis import EmotiEffLibRecognizer
        print("  Initialising EmotiEffLibRecognizer (downloads model if not cached)...")
        fer = EmotiEffLibRecognizer(engine="onnx", model_name="enet_b0_8_best_afew", device="cpu")
        print("  OK — model ready.")
        del fer
        return True
    except Exception as e:
        print(f"  ERROR: {e}")
        print("  Install emotiefflib: uv pip install emotiefflib>=1.1.1")
        return False


def main():
    os.makedirs(MODELS_DIR, exist_ok=True)

    ok = True
    for i, (filename, url, _) in enumerate(MODELS, 1):
        print(f"[{i}/{len(MODELS)}] {filename}")
        ok &= download(filename, url)

    ok &= verify_emotiefflib()

    print()
    if ok:
        print("All models ready.")
    else:
        print("Some downloads failed. Check errors above and retry.")
        sys.exit(1)


if __name__ == "__main__":
    main()
