# ClassSense

Hệ thống phân tích hành vi học sinh trong lớp học trực tuyến, sử dụng computer vision để đo engagement theo thời gian thực và hiển thị lên dashboard cho giáo viên.

## Tổng quan

ClassSense capture frame webcam phía học sinh, gửi lên cloud để inference (BlazeFace → EAR/Gaze/Head Pose → Emotion), tổng hợp thành engagement score, và push về dashboard giáo viên qua Firestore realtime listener — tất cả mà không lưu video thô.

```
Webcam (học sinh) → WSS → Cloud Run Gateway → Pub/Sub → Inference Worker
                                                               ↓
Teacher Dashboard ← Firestore ← Score Aggregator ←───────────┘
```

## Tech Stack

| Layer | Công nghệ |
|---|---|
| Language | Python 3.12, uv |
| Face / Landmarks | MediaPipe `face_landmarker.task` (478 pts) |
| Head Pose | 6DRepNet (`sixdrepnet`) |
| Emotion | EfficientNet-B0 ONNX (`emotiefflib`) |
| Image I/O | OpenCV, NumPy |
| Gateway / API | FastAPI + WebSockets |
| Queue | Google Cloud Pub/Sub |
| Database | Firestore |
| Snapshot Storage | Google Cloud Storage (CMEK) |
| Dashboard | React/Vue + Firebase Hosting |
| Deploy | Cloud Run (scale-to-zero) |

## Cài đặt nhanh (local dev)

```bash
# Clone repo
git clone https://github.com/your-org/classsense.git
cd classsense

# Setup môi trường Python 3.12
uv venv --python 3.12
uv pip install -r requirements.txt

# Download model files (xem models/README.md)
python scripts/download_models.py

# Chạy local với emulator
docker compose up

# Test pipeline với ảnh tĩnh
python test_pipeline.py --image assets/face_sample.jpg

# Chạy webcam demo local
python demo_local.py
```

## Cấu trúc project

```
classsense/
├── models/                     # Model files (gitignored, download riêng)
│   ├── face_landmarker.task
│   ├── 6DRepNet_300W_LP_AFLW2000.pth
│   └── enet_b0_8_best_afew.onnx
├── services/
│   ├── gateway/                # FastAPI WebSocket Gateway
│   └── worker/                 # Inference Worker
├── src/
│   ├── face_detector.py        # MediaPipe Face Landmarker wrapper
│   ├── landmark_analyzer.py    # EAR, blink, gaze zone
│   ├── pose_estimator.py       # 6DRepNet wrapper
│   ├── emotion_classifier.py   # emotiefflib ONNX wrapper
│   ├── frame_signal.py         # FrameSignal dataclass
│   ├── score_aggregator.py     # Sliding window + engagement score
│   └── rolling_score.py        # EMA smoothing
├── dashboard/                  # React/Vue frontend
├── scripts/
│   └── download_models.py
├── test_pipeline.py
├── demo_local.py
├── docker-compose.yml
└── README.md
```

## Engagement Score

Score E(t) ∈ [0, 1] được tính từ 4 tín hiệu trên sliding window 30 giây:

```
E(t) = 0.35 × S_blink + 0.30 × S_gaze + 0.25 × S_pose + 0.10 × S_emotion
```

Hiển thị qua EMA(α=0.3) để tránh jitter.

**Event flags:** `DISTRACTION`, `DROWSY`, `CONFUSED`, `FACE_MISSING`, `LOW_ENGAGEMENT`

## Chi phí cloud ước tính

~$1 / buổi học (10 học sinh, 60 phút). Chi phí chính là bandwidth egress (~$0.86). Có thể giảm xuống ~$0.3 bằng cách giảm fps từ 15 xuống 8.

## Privacy

- JPEG frame chỉ tồn tại trong transit (WSS) và trong quá trình inference — không lưu lại
- Chỉ `{student_id, timestamp, score, flags}` được ghi vào Firestore
- Event snapshot (ảnh lúc có alert): lưu GCS encrypted, xóa tự động sau 30 ngày, cần consent riêng
- Học sinh có thể opt-out bất kỳ lúc nào

Xem [ClassSense_Technical_Document.md](./ClassSense_Technical_Document.md) để biết chi tiết kiến trúc, scoring formula, và privacy policy.

## Lộ trình

| Tuần | Milestone |
|---|---|
| 1 | CV Pipeline core — FrameSignal từ ảnh tĩnh |
| 2 | Score Aggregator + local webcam demo |
| 3 | Thin Client + WebSocket Gateway + Cloud infra |
| 4 | Teacher Dashboard real-time |
| 5 | Post-session Report + Hardening |
| 6 | Production deploy + Pilot |

## License

[MIT](LICENSE)
