import argparse
import io
import os
import pickle
import random
import sys
import time
from collections import Counter

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from src.emotion_classifier import EmotionClassifier

AFFECTNET_IDX2LABEL = {
    0: "anger", 1: "surprise", 2: "contempt",
    3: "happiness", 4: "neutral", 5: "fear",
    6: "sadness", 7: "disgust",
}

FER2013_LABEL_MAP = {
    "angry": "anger", "disgust": "disgust", "fear": "fear",
    "happy": "happiness", "neutral": "neutral",
    "sad": "sadness", "surprise": "surprise",
}


def load_fer2013(path: str, n: int, seed: int):
    with open(path, "rb") as f:
        data = pickle.load(f)
    random.seed(seed)
    sample = random.sample(data, min(n, len(data)))
    items = []
    for d in sample:
        img = Image.open(io.BytesIO(d["img_bytes"])).convert("RGB")
        bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        items.append((bgr, FER2013_LABEL_MAP.get(d["labels"], d["labels"])))
    return items


def load_affectnet(parquet_path: str, n: int, seed: int):
    import pandas as pd
    df = pd.read_parquet(parquet_path)
    df = df.sample(min(n, len(df)), random_state=seed).reset_index(drop=True)
    items = []
    for _, row in df.iterrows():
        img = Image.open(io.BytesIO(row["image"]["bytes"])).convert("RGB")
        bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        items.append((bgr, AFFECTNET_IDX2LABEL[int(row["label"])]))
    return items


def evaluate(items, clf, dataset_name: str, min_acc: float = 0.30):
    print(f"\n{'='*55}")
    print(f"Dataset : {dataset_name}  ({len(items)} samples)")
    print(f"{'='*55}")

    correct, errors, probs_ok = 0, 0, 0
    gt_labels, pred_labels, times_ms = [], [], []

    for bgr, gt in items:
        t0 = time.perf_counter()
        try:
            pred, probs, valence, arousal = clf.predict(bgr)
        except Exception as e:
            print(f"  CRASH: {e}")
            errors += 1
            continue
        times_ms.append((time.perf_counter() - t0) * 1000)

        gt_labels.append(gt)
        pred_labels.append(pred)
        if pred == gt:
            correct += 1
        if abs(sum(probs) - 1.0) < 0.01 and len(probs) == 8:
            probs_ok += 1
        assert isinstance(valence, float) and np.isfinite(valence), f"Bad valence: {valence}"
        assert isinstance(arousal, float) and np.isfinite(arousal), f"Bad arousal: {arousal}"

    n = len(gt_labels)
    acc = correct / n if n else 0
    print(f"Top-1 accuracy  : {correct}/{n}  ({100*acc:.1f}%)")
    print(f"Prob valid (~1.0): {probs_ok}/{n}  ({100*probs_ok/n:.1f}%)")
    print(f"Latency         : mean={np.mean(times_ms):.0f} ms  p95={np.percentile(times_ms,95):.0f} ms")
    print(f"Crashes         : {errors}")

    print(f"\nPer-class accuracy:")
    for lbl in sorted(set(gt_labels)):
        idxs = [i for i, g in enumerate(gt_labels) if g == lbl]
        cls_correct = sum(1 for i in idxs if pred_labels[i] == lbl)
        cls_n = len(idxs)
        bar = "#" * int(30 * cls_correct / cls_n) if cls_n else ""
        print(f"  {lbl:10s}: {cls_correct:3d}/{cls_n:3d}  ({100*cls_correct/cls_n if cls_n else 0:.0f}%)  {bar}")

    assert errors == 0, f"{errors} crashes in emotion classifier"
    assert probs_ok == n, "Some emotion_probs don't sum to 1.0 or have wrong length"
    assert acc >= min_acc, f"Accuracy {acc:.1%} below {min_acc:.0%} threshold"
    print(f"\nPASS — accuracy {acc:.1%}")
    return acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["fer2013", "affectnet", "both"], default="both")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--fer2013-path", default="datasets/fer2013/test.pt")
    ap.add_argument("--affectnet-path",
                    default="datasets/affectnet_short/data/val-00000-of-00001-15bd8d507ff5dd11.parquet")
    args = ap.parse_args()

    clf = EmotionClassifier()
    accs = []

    if args.dataset in ("fer2013", "both"):
        if not os.path.exists(args.fer2013_path):
            print(f"SKIP FER2013 -- file not found: {args.fer2013_path}")
        else:
            accs.append(evaluate(load_fer2013(args.fer2013_path, args.n, args.seed),
                                 clf, "FER2013 test set", min_acc=0.20))

    if args.dataset in ("affectnet", "both"):
        if not os.path.exists(args.affectnet_path):
            print(f"SKIP AffectNet -- file not found: {args.affectnet_path}")
        else:
            accs.append(evaluate(load_affectnet(args.affectnet_path, args.n, args.seed),
                                 clf, "AffectNet short val", min_acc=0.40))

    if accs:
        print(f"\nOverall mean accuracy: {100*sum(accs)/len(accs):.1f}%")


if __name__ == "__main__":
    main()
