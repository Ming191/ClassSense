# ClassSense — Checklist 6 Tuần

> Sync với Notion board: [ClassSense — Roadmap 6 Tuần](https://www.notion.so/0dcfc5c41746486a8ca7dd98d6096163)  
> **P0** = Blocker · **P1** = Critical · **P2** = Normal · **P3** = Nice to have

---

## Tuần 1 — CV Pipeline core

**Deliverable:** `python test_pipeline.py --image face.jpg` in ra FrameSignal đầy đủ

- [x] `[P1]` Setup Python 3.12 + uv, cài đủ dependencies
- [x] `[P1]` Download và verify 3 model files: `face_landmarker.task`, `6DRepNet_300W_LP_AFLW2000.pth`, `enet_b0_8_best_afew.onnx`
- [x] `[P1]` Implement `face_detector.py` — MediaPipe Face Landmarker wrapper, trả về face ROI
- [x] `[P1]` Implement `landmark_analyzer.py` — EAR trái/phải, blink detection, gaze zone từ iris landmarks
- [x] `[P1]` Implement `pose_estimator.py` — 6DRepNet wrapper, trả về `(yaw, pitch, roll)`
- [x] `[P1]` Implement `emotion_classifier.py` — emotiefflib ONNX wrapper, trả về `probs[8]`
- [x] `[P1]` Implement `frame_signal.py` — dataclass `FrameSignal`, validate schema
- [x] `[P2]` Unit test từng module với ảnh tĩnh

---

## Tuần 2 — Score Aggregator & local demo

**Deliverable:** `python demo_local.py` — cửa sổ webcam với overlay score real-time

- [ ] `[P1]` Implement `score_aggregator.py` — sliding window 30s, tính 4 sub-scores, engagement score
- [ ] `[P1]` Implement event flag detection: `DISTRACTION`, `DROWSY`, `CONFUSED`, `FACE_MISSING`, `LOW_ENGAGEMENT`
- [ ] `[P2]` Implement `rolling_score.py` — EMA(alpha=0.3) để tránh jitter
- [ ] `[P1]` Implement local webcam loop với debug overlay (EAR, gaze zone, yaw/pitch, emotion, score)
- [ ] `[P2]` Implement writing mode heuristic — pitch pattern suppress gaze penalty khi học sinh ghi bài
- [ ] `[P2]` Tune ngưỡng EAR, gaze offset, pose range với dữ liệu webcam thực tế
- [ ] `[P2]` Validate PERCLOS calculation với ground truth (ghi video, đếm tay)

---

## Tuần 3 — Thin Client & WebSocket Gateway

**Deliverable:** `docker compose up` → mở `thin_client.py` → data xuất hiện trong Firestore console

- [ ] `[P1]` Implement `thin_client.py` — `VideoCapture → resize 320×240 → JPEG encode → WebSocket send`
- [ ] `[P1]` Implement WebSocket Gateway FastAPI + auth HMAC (Firebase Auth chờ đến Tuần 4)
- [ ] `[P0]` Deploy Cloud Run Gateway với `--timeout=3600` (tránh disconnect buổi học > 60 phút)
- [ ] `[P0]` Pub/Sub: dùng **per-session topic** + `student_id` làm message attribute — không tạo per-student topic
- [ ] `[P1]` Setup GCP project: enable Cloud Run, Pub/Sub, Firestore, Firebase
- [ ] `[P1]` Implement worker consumer: pull Pub/Sub → run pipeline → push FrameSignal
- [ ] `[P1]` Implement `firestore_writer.py` — write score updates vào Firestore
- [ ] `[P1]` Docker: build image `gateway` + `worker` (models baked in, base `python:3.12-slim`)
- [ ] `[P1]` Test end-to-end: `thin_client → gateway → pubsub → worker → firestore`

---

## Tuần 4 — Teacher Dashboard (real-time)

**Deliverable:** Dashboard chạy trên Firebase Hosting, test với 2-3 người thật

- [ ] `[P1]` Setup Firebase Hosting + React/Vue project
- [ ] `[P1]` Implement Firestore realtime listener trong frontend
- [ ] `[P1]` Build Class Heatmap component: grid học sinh, màu theo score (xanh/vàng/đỏ), update mỗi 1-2s
- [ ] `[P2]` Build Alert Feed component: show event flags, auto-dismiss sau 30s
- [ ] `[P2]` Build Class Trend Line: rolling avg 5 phút, cập nhật mỗi 30s
- [ ] `[P1]` Implement session management: tạo session → invite link → URL share
- [ ] `[P1]` Firebase Auth cho giáo viên (email/password hoặc Google), thay thế HMAC tạm Tuần 3
- [ ] `[P1]` Test với 2-3 người thật, validate latency end-to-end < 3s

---

## Tuần 5 — Post-session Report & Hardening

**Deliverable:** Full buổi học 30-45 phút, xuất được report PDF hoàn chỉnh

- [ ] `[P1]` Implement `report_generator.py` — query full session data từ Firestore, tính stats
- [ ] `[P1]` Build Report UI: engagement timeline, low-point highlight, per-student table
- [ ] `[P2]` Implement PDF + CSV export
- [ ] `[P1]` Implement event snapshot storage — GCS CMEK, signed URL 1h, trigger per event flag
- [ ] `[P0]` Implement dual consent flow — consent phân tích **tách riêng** consent lưu ảnh
- [ ] `[P1]` Implement UI indicator trên thin client: 🟢 phân tích / 🟡 snapshot vừa lưu / ⚪ opt-out
- [ ] `[P2]` Implement snapshot viewer: click event trên timeline → xem ảnh + metadata
- [ ] `[P1]` Implement GCS lifecycle policy: tự động xóa snapshot sau **30 ngày**
- [ ] `[P1]` Implement erasure API — endpoint học sinh yêu cầu xóa toàn bộ ảnh của mình
- [ ] `[P1]` Error handling: mất kết nối webcam, face không detect lâu, worker crash
- [ ] `[P1]` Worker retry logic: inference fail → requeue với exponential backoff
- [ ] `[P1]` Load test: simulate 10 thin clients đồng thời, đo latency và CPU worker
- [ ] `[P2]` Optimize nếu cần: giảm JPEG quality → 65, fps → 10
- [ ] `[P1]` Cloud Run auto-scaling: `min=0`, `max=5` worker instances

---

## Tuần 6 — Production deploy & Pilot

**Deliverable:** Production URL chạy được, ít nhất 2 buổi học pilot thành công

- [ ] `[P1]` Setup GCP production environment (tách hoàn toàn khỏi dev project)
- [ ] `[P2]` Setup Cloud Monitoring: alert khi worker lag > 5s
- [ ] `[P0]` Implement consent flow hoàn chỉnh: học sinh đọc privacy notice → click Đồng ý → gửi frame
- [ ] `[P1]` Implement opt-out toggle: pause gửi frame bất kỳ lúc nào, không ảnh hưởng tham gia lớp
- [ ] `[P2]` UI polish: responsive design, loading states, error messages thân thiện
- [ ] `[P2]` Viết hướng dẫn sử dụng cho giáo viên (1 trang A4)
- [ ] `[P2]` Viết hướng dẫn cài thin client cho học sinh (ảnh chụp màn hình từng bước)
- [ ] `[P1]` Pilot với 1-2 giáo viên thật, 3-5 học sinh mỗi lớp
- [ ] `[P1]` Thu thập feedback: score có phản ánh đúng cảm quan giáo viên không?
- [ ] `[P1]` Fix bugs từ pilot

---

## Buffer (nếu có thời gian thừa)

- [ ] `[P3]` Per-student EAR baseline calibration — 60s đầu buổi học để calibrate ngưỡng theo từng người
- [ ] `[P3]` Admin panel: quản lý nhiều giáo viên, nhiều lớp
- [ ] `[P3]` Mobile-friendly thin client (PWA)
- [ ] `[P3]` Gaze + mouse fusion (theo Zhu et al. 2023) — tăng F1 ~7.44% cho phân biệt ghi bài vs distraction

---

## Blockers nổi bật (P0)

| Task | Tuần | Lý do blocker |
|---|---|---|
| Cloud Run `--timeout=3600` | T3 | Buổi học > 60 phút sẽ bị ngắt kết nối |
| Pub/Sub per-session topic | T3 | Per-student topic vượt giới hạn số topic Pub/Sub |
| Dual consent flow | T5 | Bắt buộc trước khi lưu bất kỳ snapshot nào |
| Full consent flow | T6 | Không được gửi frame trước khi có consent |
