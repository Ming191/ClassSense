# Pre-trained models for classroom behavior analysis: a deployment-ready guide

**No single end-to-end engagement detection model works out-of-the-box, but a powerful pipeline can be assembled in weeks using four pip-installable libraries.** The recommended stack — **6DRepNet** (head pose), **EmotiEffLib** (emotion + engagement), **MediaPipe** (blink + iris tracking), and **L2CS-Net** (gaze) — delivers near-SOTA accuracy on standard benchmarks, runs on CPU, and requires zero model training. This guide maps every viable pre-trained model across four sub-tasks, with benchmark numbers, deployment complexity, and a concrete integration plan for a student team working within a 4–6 week timeline.

---

## Head pose estimation: 6DRepNet is the clear winner

Head pose tells you whether a student is looking forward (engaged), down at their phone, or sideways at a distraction. The field has matured significantly, with multiple models achieving **< 4° mean absolute error** on standard benchmarks.

**6DRepNet** dominates for practical deployment. A single `pip3 install SixDRepNet` gives you auto-downloading weights and a three-line inference API. On **AFLW2000**, it achieves **3.97° MAE** (yaw 3.63°, pitch 4.91°, roll 3.37°). On **BIWI**, it hits **3.47° MAE**. The RepVGG-B1g2 backbone runs at roughly **5–15 FPS on CPU** per face — adequate for a classroom dashboard sampling frames every few seconds. The MIT license and active PyPI package make it the lowest-friction option by a wide margin.

For teams needing higher accuracy, **SynergyNet** achieves the best published MAE of **3.31° on AFLW2000** and an astonishing 3,000 FPS on an RTX 2080 for batched face crops. However, it requires manual setup, GPU by default, and separate 3DMM data downloads — not ideal for beginners. **6DRepNet360**, published at IEEE TIP 2024, extends the original to handle full **360° head rotation** (±180° yaw), useful if students turn fully around. It shares the same pip ecosystem.

Two newer models deserve mention: **DirectMHP** (2023) performs simultaneous multi-person head detection and pose estimation using a YOLOv5 backbone — ideal for physical classroom cameras capturing many students at once. Its successor **SemiUHPE** (TPAMI 2025) claims substantial improvements. Both provide pre-trained weights on HuggingFace but require GPU and manual setup.

| Model | AFLW2000 MAE | BIWI MAE | pip install | CPU real-time | License |
|-------|-------------|----------|-------------|---------------|---------|
| **SynergyNet** | **3.31°** | — | `pip install -e .` | ⚠️ GPU default | Research |
| **img2pose** | 3.91° | 3.79° | ❌ Manual | ❌ GPU needed | Meta Research |
| **6DRepNet** ⭐ | 3.97° | 3.47° | ✅ `pip3 install SixDRepNet` | ✅ ~10 FPS | MIT |
| **DirectMHP** | 4.04° | 4.35° | ❌ Manual | ❌ GPU needed | Custom |
| **WHENet** | 4.83° | 3.48° | ❌ Manual | ✅ Mobile-friendly | Unstated |
| **FSA-Net** | 5.07° | 4.00° | ❌ Legacy TF 1.x | ✅ Very light | Unstated |

**Avoid FSA-Net** — despite its tiny footprint, it requires Python 3.5 and TensorFlow 1.10, which are incompatible with modern environments. **TokenHPE** (CVPR 2023, ViT-based) was archived on GitHub in December 2025 with only 10 stars and mediocre accuracy (4.66° MAE). Neither is suitable for new projects.

One important caveat: BIWI benchmark numbers are **not directly comparable across papers** because different face detectors create different test subsets, with over 15% of images potentially skipped. AFLW2000 numbers are more reliable for cross-method comparison.

---

## Facial expression recognition: EmotiEffLib leads on every practical metric

Emotion detection serves as a key engagement proxy — confusion and boredom correlate with disengagement, while interest and concentration signal attentiveness. The accuracy ceiling on standard benchmarks is constrained by **~35% label noise in AffectNet** and similar issues in FER2013, so even SOTA models top out around 67–68% on AffectNet-7 and 74–76% on FER2013.

**EmotiEffLib** (formerly HSEmotion) is the standout choice. Install via `pip install emotiefflib`, and you get pre-trained EfficientNet-B0/B2 models that auto-download, predict **8 emotion classes plus valence/arousal plus engagement levels**, and run at **15–30 FPS on CPU** via ONNX Runtime. The library has won **1st place in multiple ABAW competitions** (the premier affective behavior recognition challenge series) and is published at ICML 2023 as an oral presentation. It achieves **SOTA on AffectNet 8-class** per Papers With Code, offers both PyTorch and ONNX backends, and carries an **Apache 2.0 license**. Critically for the student team, it includes Colab notebooks demonstrating engagement and emotion prediction on video.

**DeepFace** (`pip install deepface`) is the easier but less accurate alternative. Its one-liner API — `DeepFace.analyze(img, actions=['emotion'])` — returns 7-class emotion probabilities plus age, gender, and race estimates. However, its underlying emotion model achieves only **~65–68% on FER2013**, well below research SOTA. With 16,000+ GitHub stars and active maintenance, it is battle-tested and extremely well-documented, making it a valid choice if accuracy is less critical than speed of integration.

For teams willing to handle more complex setup, **POSTER++** achieves the highest published accuracy on **RAF-DB at 92.21%** and **AffectNet-7 at 67.49%**, using a cross-attention architecture combining facial landmarks with image features. It requires GPU, dlib landmarks, and manual weight downloads — not beginner-friendly, but MIT-licensed and offering genuine accuracy gains.

| Model | FER2013 | RAF-DB | AffectNet-7 | pip install | CPU capable | License |
|-------|---------|--------|-------------|-------------|-------------|---------|
| **POSTER++** | 74.73% | **92.21%** | **67.49%** | ❌ Manual | ❌ GPU only | MIT |
| **DDAMFN+** | 72.03% | 90.97% | — | ❌ Manual | ❌ GPU only | Academic |
| **DAN** | — | 89.70% | 63.91% | ❌ Manual | ❌ GPU only | MIT |
| **EmotiEffLib** ⭐ | — | — | ~66–67% | ✅ `pip install emotiefflib` | ✅ 15–30 FPS | Apache 2.0 |
| **DeepFace** | ~65–68% | — | — | ✅ `pip install deepface` | ✅ 10–15 FPS | MIT |
| **FER (pip)** | ~66% | — | — | ✅ `pip install fer` | ✅ 5–10 FPS | MIT |

Several **HuggingFace ViT models** offer moderate accuracy (70–73% on FER2013) and can be loaded via the `transformers` pipeline API, but none match the dedicated libraries in accuracy or ease-of-use for production deployment.

---

## Eye blink and gaze: MediaPipe handles both, L2CS-Net adds precision

Blink rate and gaze direction are powerful attention signals. Normal blink rate is **15–20 blinks/minute**; abnormally low rates suggest fatigue or screen hypnosis, while frequent blinking may indicate stress. Gaze direction reveals whether a student is looking at their screen or elsewhere.

**For blink detection, MediaPipe Face Mesh is unbeatable.** It provides 478 facial landmarks (including iris refinement), runs at **30+ FPS on CPU** and 50–1000+ FPS on GPU, installs via `pip install mediapipe`, and carries an Apache 2.0 license. Computing the **Eye Aspect Ratio (EAR)** from six key landmarks per eye takes roughly 30 lines of Python. Published evaluations show **98.03% accuracy on the Eyeblink8 dataset**. The older dlib-based EAR approach achieves similar accuracy in controlled conditions but is slower (~15–30 FPS), struggles with non-frontal poses, and dlib installation often fails on Windows due to CMake dependencies.

**For gaze estimation**, three viable options exist at different complexity levels:

- **MediaPipe iris landmarks** (simplest): Compute the iris center position relative to eye corners to classify gaze into zones — left, right, center, away. No additional library needed. Accuracy is coarse (no angular error metric) but sufficient for detecting "looking at screen vs. not." This is the recommended starting point.

- **L2CS-Net** (most accurate): Achieves **3.92° MAE on MPIIGaze** using a ResNet-50 dual-branch architecture. Provides a clean Pipeline API with pre-trained weights, runs at **5–10 FPS on CPU**. Requires cloning from GitHub and adding PyTorch (~2 GB dependency). Best for teams that need precise gaze angles for richer analytics.

- **GazeFollower** (newest, pip-installable): Published at ACM SIGCHI 2025, this model trained on **32 million face images** achieves **1.11 cm screen accuracy** after calibration. Install via `pip install gazefollower`. It outputs 2D screen coordinates directly — perfect for answering "is the student looking at their screen?" The tradeoff: it requires per-user calibration and carries a CC BY-NC-SA 4.0 (non-commercial) license.

**OpenFace 2.0** provides gaze estimation, head pose, Action Units, and blink (AU45) all in one toolkit — but it is a C++ binary requiring CMake builds, outputs CSV files, and has no Python API. Not suitable for a Python-first web dashboard project.

| Tool | Task | Key Metric | FPS (CPU) | pip install | License |
|------|------|-----------|-----------|-------------|---------|
| **MediaPipe** ⭐ | Blink + rough gaze | 98% blink accuracy | 30+ | ✅ `pip install mediapipe` | Apache 2.0 |
| **dlib + EAR** | Blink | ~95–98% (frontal) | 15–30 | ⚠️ Compilation issues | Boost |
| **L2CS-Net** ⭐ | Precise gaze | **3.92° MPIIGaze** | 5–10 | GitHub clone | Research |
| **GazeFollower** | Screen attention | 1.11 cm screen accuracy | Real-time | ✅ `pip install gazefollower` | CC BY-NC-SA |
| **OpenFace 2.0** | Gaze + AUs + pose | ~5–6° gaze | 30 | ❌ C++ build | Research |

---

## End-to-end engagement detection: no plug-and-play model exists yet

The most important finding for the student team: **there is no fully out-of-the-box, high-accuracy engagement detection model available.** The DAiSEE benchmark — the field's primary evaluation standard with 9,068 video clips across 4 engagement levels — has a SOTA accuracy of only **~73% (4-class)** from ViBED-Net (October 2025, not yet peer-reviewed). For binary engaged/disengaged classification, accuracies of **80–90%** are achievable with simpler approaches.

HuggingFace has only **one model tagged "student-engagement"** (a BEIT-Large image classifier with minimal documentation). Papers With Code shows a steady progression from 51% to 73% accuracy on DAiSEE over five years, but most top models do not release pre-trained weights.

The closest thing to a ready-made solution is **EmotiEffLib's engagement prediction capability**. Its published paper — "Classifying Emotions and Engagement in Online Learning Based on a Single Facial Expression Recognition Neural Network" (IEEE Transactions on Affective Computing) — demonstrates that a single EfficientNet model pre-trained on VGGFace2 and fine-tuned on AffectNet can predict engagement levels alongside emotions. The library includes a Colab notebook specifically for engagement + emotion video prediction, requires no training, and runs on CPU.

For teams wanting commercial reliability, **Hume AI** offers a streaming Expression Measurement API detecting 48+ emotion dimensions (including interest, boredom, confusion, concentration) that can be combined into custom engagement scores. A free researcher tier exists. **Affectiva/Smart Eye** provides a direct 0–100 engagement score but requires expensive commercial licensing.

Several **open-source pipeline repositories** combine individual components into engagement scoring systems. The most instructive is **rijju-das/Student-Engagement** (2025), which extracts OpenFace AUs + head pose + gaze + MediaPipe landmarks and trains XGBoost classifiers, achieving **82.9% on the WACV engagement dataset**. However, it requires training the final classifier.

A fundamental limitation applies to all approaches: **facial expressions are imperfect proxies for cognitive engagement.** A student reading intently may appear neutral; a smiling student may be watching something unrelated. Current SOTA reflects this inherent ceiling.

---

## The recommended pipeline for a 4–6 week deployment

Given the team's constraints — limited ML experience, web deployment, CPU-only, no training from scratch — here is the optimal architecture:

- **Face detection**: MediaPipe Face Detection (free, 30+ FPS on CPU, pip install)
- **Head pose**: 6DRepNet via `pip3 install SixDRepNet` (3.97° MAE, 3-line API)
- **Emotion + engagement**: EmotiEffLib via `pip install emotiefflib` (SOTA accuracy, engagement output)
- **Blink detection**: MediaPipe Face Mesh + EAR (98% accuracy, ~30 lines of code)
- **Gaze direction**: MediaPipe iris landmarks for rough zone classification (start here), upgrade to L2CS-Net if precision is needed

**Composite engagement score**: Combine signals with simple weighted averaging — for example, `engagement = 0.4 × emotion_score + 0.3 × gaze_score + 0.2 × head_pose_score + 0.1 × blink_rate_score`. Temporal smoothing over 5–10 second windows eliminates frame-level noise. No ML training required for this fusion — rule-based thresholds work well as a starting point.

**Suggested timeline**:

- **Weeks 1–2**: Install MediaPipe + EmotiEffLib + 6DRepNet. Build a Python script that reads webcam frames, detects faces, and outputs per-frame emotion, head pose angles, blink count, and iris position. Total dependencies: `pip install mediapipe emotiefflib SixDRepNet opencv-python numpy`.
- **Weeks 2–3**: Implement the composite engagement score with rule-based logic. Build the web dashboard using Flask or Streamlit. Add temporal smoothing and per-student tracking.
- **Weeks 4–6**: Test with real users, tune EAR blink threshold (~0.20), tune engagement score weights, add session analytics and visualizations.

This pipeline achieves near-SOTA accuracy across all sub-tasks, runs entirely on CPU, requires no model training, and uses only permissive open-source licenses (MIT + Apache 2.0). Every component is pip-installable except L2CS-Net (GitHub clone), and the total additional disk footprint is approximately **500 MB–1 GB** for all model weights.

## Conclusion

The classroom behavior analysis stack has reached a practical inflection point. While no single end-to-end engagement model delivers turnkey deployment, the component models have become accurate enough and easy enough to assemble that **a working multi-signal pipeline requires fewer than 200 lines of Python and zero training**. The critical insight is that combining imperfect signals — a 4° head pose estimate, a 66% emotion classifier, a 98% blink detector, and a coarse gaze zone — produces engagement predictions that are substantially more robust than any single signal alone. EmotiEffLib's dual capability as both an emotion classifier and engagement predictor, combined with 6DRepNet's pip-installable simplicity and MediaPipe's extraordinary speed, creates a stack that would have required a dedicated ML team just three years ago. Start with rule-based signal fusion, collect labeled data from your actual classrooms, and only then consider fine-tuning — the pre-trained components will carry you further than most teams expect.