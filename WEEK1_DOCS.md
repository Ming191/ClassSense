# ClassSense — Week 1 Implementation Notes

**Deliverable:** `python test_pipeline.py --image assets/face_sample.jpg` prints a full FrameSignal as JSON  
**Status:** Complete — all P1 + P2 tasks done, post-sprint improvements applied  
**Date:** 2026-04-09

---

## 1. Environment Setup

**Python version:** 3.12.12 (created via `uv venv --python 3.12`)

> The initial `.venv` was Python 3.14.3. Deleted and recreated with 3.12 because `sixdrepnet` pulls in PyTorch which does not yet have wheels for 3.14.

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
```

**`requirements.txt`:**
```
mediapipe>=0.10.33
sixdrepnet>=0.1.6
emotiefflib>=1.1.1
opencv-python>=4.10.0
numpy>=2.0.0
```

Total installed: 39 packages including PyTorch 2.11.0 (CPU), ONNX Runtime 1.24.4, scipy 1.17.1.

---

## 2. Model Files

Downloaded to `models/` via `python scripts/download_models.py`.

| File | Size | Source |
|---|---|---|
| `face_landmarker.task` | 3.6 MB | `storage.googleapis.com/mediapipe-models/...` |
| `6DRepNet_300W_LP_AFLW2000.pth` | 151 MB | `cloud.ovgu.de/s/Q67RnLDy6JKLRWm/download/...` |
| `enet_b0_8_va_mtl.onnx` | ~16 MB | emotiefflib auto-downloads on first `EmotiEffLibRecognizer` init |

> The tech doc said 6DRepNet model is ~60 MB. Actual size is 151 MB (RepVGG-B1g2 deploy mode).  
> The official download URL is from the `sixdrepnet` package's own `regressor.py`.

`models/` is gitignored. Re-download anytime with:
```bash
python scripts/download_models.py
```

---

## 3. Source Modules (`src/`)

### 3.1 `src/frame_signal.py` — FrameSignal dataclass

```python
EMOTION_LABELS = ["anger", "contempt", "disgust", "fear", "happiness", "neutral", "sadness", "surprise"]

@dataclass
class FrameSignal:
    student_id: str
    timestamp: float       # Unix time
    ear_left: float        # Eye Aspect Ratio, left eye, clamped to [0, 1]
    ear_right: float       # Eye Aspect Ratio, right eye, clamped to [0, 1]
    blink_detected: bool   # True after ≥ min_blink_frames consecutive frames below EAR threshold
    gaze_zone: str         # "center"|"left"|"right"|"up"|"down"
    gaze_x: float          # continuous iris offset: neg=left, pos=right
    gaze_y: float          # continuous iris offset: neg=up, pos=down
    yaw: float             # head pose degrees: neg=left, pos=right
    pitch: float           # head pose degrees: neg=up, pos=down
    roll: float            # head pose degrees: in-plane tilt
    emotion: str           # argmax label (lowercase) e.g. "happiness"
    emotion_probs: list    # float[8] matching EMOTION_LABELS order, sums to 1.0
    valence: float = 0.0   # EmotiEffLib MTL output: pos=pleasant, neg=unpleasant (unbounded)
    arousal: float = 0.0   # EmotiEffLib MTL output: pos=activated/alert, neg=calm/drowsy (unbounded)
    face_missing: bool = False
```

**Emotion label index order** (`EMOTION_LABELS`):

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Label | anger | contempt | disgust | fear | happiness | **neutral** | sadness | surprise |

`face_missing_signal(student_id)` returns a sentinel signal with `face_missing=True` and `emotion_probs` carrying 1.0 at the neutral index.  
`to_dict()` → `dataclasses.asdict(self)` for JSON serialization.

---

### 3.2 `src/face_detector.py` — MediaPipe Face Landmarker

**API:** `MediaPipe tasks` (NOT `mp.solutions`)

> MediaPipe 0.10.33 removed `mp.solutions` entirely. Only `mediapipe.tasks.python.vision` is available. The `.task` model file is required.

```python
detector = FaceDetector(model_path="models/face_landmarker.task")
result, face_roi = detector.detect(bgr_frame)   # returns (None, None) if no face
```

- Uses `vision.FaceLandmarker` with `RunningMode.IMAGE`
- Returns 478 normalized landmarks (`result.face_landmarks[0]`)
- `face_roi`: BGR crop with 10% padding around the landmark bounding box
- Landmarks accessed as `result.face_landmarks[0]` — **not** `result.multi_face_landmarks`
- Implements context manager (`__enter__`/`__exit__`) for resource safety

**Performance on LFW (n=200):** 100% detection rate, ~11 ms/frame CPU.

---

### 3.3 `src/landmark_analyzer.py` — EAR + Gaze

Takes `FaceLandmarkerResult` from `FaceDetector.detect()`. Stateful — holds blink frame counter.

```python
analyzer = LandmarkAnalyzer(min_blink_frames=2)
lm = analyzer.analyze(result)
# lm keys: ear_left, ear_right, blink_detected, gaze_zone, gaze_x, gaze_y
analyzer.reset()   # call between unrelated video streams
```

**EAR (Eye Aspect Ratio):**
```
EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
```
Landmark indices (478-pt model):
- Left eye: `[33, 160, 158, 133, 153, 144]`
- Right eye: `[362, 385, 387, 263, 373, 380]`

**Blink detection:** `EAR < 0.25` on both eyes for ≥ `min_blink_frames` consecutive frames (default 2). At `min_blink_frames=1` the behaviour is per-frame (used in static-image tests).

**Gaze from iris landmarks:**
```python
gaze_x = (iris_center_x - eye_center_x) / eye_width    # averaged across both eyes
gaze_y = (iris_center_y - eye_center_y) / eye_height
```
Iris centers: left=468, right=473. Thresholds: `GAZE_H_THRESHOLD = GAZE_V_THRESHOLD = 0.15`.

Zone assignment uses **dominant axis** when both thresholds are exceeded (prevents always returning up/down on diagonal gaze).

**Observed on LFW (n=200):**
- EAR mean: ~0.27, range [0.06, 0.51]
- Gaze: 82.5% center, 10% up, 3.5% left, 3.5% right, 0.5% down
- Blink rate: ~27.5% (static photos, some squinting; temporal filter reduces live false positives)

---

### 3.4 `src/pose_estimator.py` — 6DRepNet Head Pose

```python
from sixdrepnet import SixDRepNet as SixDRepNet_Detector
```

> The package's `__init__.py` aliases `SixDRepNet_Detector` → `SixDRepNet`. Importing `SixDRepNet_Detector` directly fails.

```python
pose = PoseEstimator(model_path="models/6DRepNet_300W_LP_AFLW2000.pth")
yaw, pitch, roll = pose.predict(face_roi_bgr)   # degrees
```

**Return order from `SixDRepNet_Detector.predict()`:** `(pitch_arr, yaw_arr, roll_arr)` — wrapper reorders to `(yaw, pitch, roll)`.

**Performance on LFW (n=80):** 100% frontal (|yaw|<45°), ~96 ms/frame CPU.

> Latency note: 6DRepNet uses full RepVGG-B1g2 backbone (151 MB). For live 30fps streaming (Week 2), run pose every Nth frame or reduce input resolution.

---

### 3.5 `src/emotion_classifier.py` — EfficientNet-B0 MTL (Valence/Arousal)

Model: `enet_b0_8_va_mtl` — EfficientNet-B0 jointly trained on 8-class emotion + valence/arousal (MTL).

```python
clf = EmotionClassifier()
emotion_label, probs, valence, arousal = clf.predict(face_roi_bgr)
```

**Why MTL over emotion-only models:**  
`enet_b0_8_va_mtl` exposes valence and arousal per-frame at the same 12 ms/frame cost. These are needed for the Week 2 score aggregator. The emotion-only `enet_b2_8` gives ~2% better accuracy but no V/A output.

**Output layout from `predict_emotions([rgb], logits=True)` on MTL model:**
```
scores shape: (1, 10)
  scores[:, :8]  → emotion logits  → softmax → emotion_probs
  scores[:, -2]  → valence  (raw linear, unbounded)
  scores[:, -1]  → arousal  (raw linear, unbounded)
```

**Valence/Arousal interpretation:**
- `valence > 0` → positive/pleasant mood; `valence < 0` → negative/unpleasant
- `arousal > 0` → activated/alert; `arousal < 0` → calm/drowsy

**Performance:**
- FER2013 test set (n=300): 56.3% top-1 accuracy — expected lower due to domain shift (48×48 grayscale vs. color training)
- AffectNet short val (n=300): 65.0% top-1 accuracy
- Latency: ~12 ms/frame CPU

**Fallback (empty ROI):** returns `("neutral", probs_with_neutral_1.0, 0.0, 0.0)`.

---

## 4. Test Script (`test_pipeline.py`)

```bash
python test_pipeline.py --image assets/face_sample.jpg
python test_pipeline.py --image path/to/face.jpg --student-id alice --no-pose
```

All models are initialised **once** in `main()` and passed as parameters to `run()`. This singleton pattern is the template for the Week 2 per-frame webcam loop (`LandmarkAnalyzer` is stateful and must not be re-created per frame).

`--no-pose` skips head pose estimation (useful when model file not downloaded).

**Verified output** (`assets/face_sample.jpg`, 820×1024 px portrait):
```json
{
  "student_id": "test_student",
  "ear_left": 0.174,
  "ear_right": 0.162,
  "blink_detected": false,
  "gaze_zone": "center",
  "gaze_x": 0.004,
  "gaze_y": 0.017,
  "yaw": -1.4,
  "pitch": -4.9,
  "roll": -1.1,
  "emotion": "happiness",
  "emotion_probs": [3.2e-05, 4.3e-04, 1.4e-04, 3.3e-05, 0.999, 1.5e-05, 5.0e-06, 3.0e-04],
  "valence": 0.857,
  "arousal": 0.229,
  "face_missing": false
}
```

---

## 5. Datasets (`datasets/`)

Downloaded for unit testing. All gitignored.

| Dataset | Path | Size | Content |
|---|---|---|---|
| LFW | `datasets/lfw/` | ~170 MB | 13,233 JPEGs, real-world face photos |
| FER2013 | `datasets/fer2013/test.pt` | 11 MB | 7,178 × 48×48 grayscale crops, 7 emotion labels |
| AffectNet short val | `datasets/affectnet_short/data/*.parquet` | 103 MB | 5,809 × 96×96 RGB crops, 8 emotion labels |

**Re-download:**
```bash
# LFW
python -c "
import urllib.request, tarfile, os
urllib.request.urlretrieve('https://ndownloader.figshare.com/files/5976018', 'datasets/lfw.tgz')
tarfile.open('datasets/lfw.tgz','r:gz').extractall('datasets/')
os.remove('datasets/lfw.tgz')
"

# FER2013 + AffectNet (requires HuggingFace token)
HF_TOKEN=<token> python -c "
from huggingface_hub import hf_hub_download, login
import os; login(token=os.environ['HF_TOKEN'], add_to_git_credential=False)
hf_hub_download('Jeneral/fer-2013', 'test.pt', repo_type='dataset', local_dir='datasets/fer2013')
hf_hub_download('Mauregato/affectnet_short',
    'data/val-00000-of-00001-15bd8d507ff5dd11.parquet',
    repo_type='dataset', local_dir='datasets/affectnet_short')
"
```

**AffectNet label mapping note:** `Mauregato/affectnet_short` uses a non-standard label ordering. Mapping determined empirically:

| Dataset idx | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Emotion | anger | surprise | contempt | happiness | neutral | fear | sadness | disgust |

---

## 6. Unit Tests (`tests/`)

```bash
python tests/run_all_tests.py          # full (~200/200/80/300 samples, ~34s)
python tests/run_all_tests.py --fast   # quick (~50/50/20/50 samples, ~17s)
```

| Test file | Dataset | Assertions |
|---|---|---|
| `test_face_detector.py` | LFW | Detection rate ≥ 70% |
| `test_landmark_analyzer.py` | LFW | EAR ∈ [0,1], valid gaze zone, center ≥ 30%, gaze_x/y finite |
| `test_pose_estimator.py` | LFW | Frontal (|yaw|<45°) ≥ 50% |
| `test_emotion_classifier.py` | FER2013 + AffectNet | Accuracy ≥ 20%/40%, probs sum to 1, V/A finite |

**Results (normal mode, n=200/200/80/300):**

```
[PASS] FaceDetector (LFW)                4s  — 100% detection, 10.8ms/frame
[PASS] LandmarkAnalyzer (LFW)            4s  — 82.5% center gaze, gaze_x/y valid
[PASS] PoseEstimator (LFW)              14s  — 100% frontal, 96ms/frame
[PASS] EmotionClassifier (FER+AffNet)   12s  — 56.3% FER2013, 65.0% AffectNet
```

---

## 7. Known Issues & Notes

**Pose latency (~96 ms/frame):** 6DRepNet uses a full RepVGG-B1g2 backbone. For live 30fps streaming run pose every Nth frame or profile smaller alternatives.

**EAR blink threshold (0.25):** May not suit all users (glasses, ethnicity). The `min_blink_frames=2` temporal filter reduces false positives from single-frame squints. Per-student threshold calibration is a P3 task for v2. 

**FER2013 accuracy (56%):** Expected — FER2013 is 48×48 grayscale, far from the color AffectNet training distribution. AffectNet val (65%) is more representative of real webcam input.

**V/A are unbounded raw linear outputs:** Do not assume they fall in [-1, 1]. Normalize or clip before using in score aggregator if a bounded range is needed.
