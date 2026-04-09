# ClassSense — Tài liệu Kỹ thuật & Lộ trình 6 Tuần

**Phiên bản:** 1.2  
**Ngày:** tháng 4, 2026  
**Phạm vi:** Hệ thống phân tích hành vi học sinh trong lớp học trực tuyến, sử dụng computer vision, triển khai theo mô hình cloud

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Cơ sở khoa học & nghiên cứu liên quan](#2-cơ-sở-khoa-học--nghiên-cứu-liên-quan)
3. [Tech stack & mô hình ML](#3-tech-stack--mô-hình-ml)
4. [Kiến trúc hệ thống](#4-kiến-trúc-hệ-thống)
5. [Luồng dữ liệu & workflow](#5-luồng-dữ-liệu--workflow)
6. [Engagement score — thiết kế chi tiết](#6-engagement-score--thiết-kế-chi-tiết)
7. [Dashboard giáo viên](#7-dashboard-giáo-viên)
8. [Triển khai Cloud (GCP)](#8-triển-khai-cloud-gcp)
9. [Lộ trình 6 tuần](#9-lộ-trình-6-tuần)
10. [Privacy & Ethics](#10-privacy--ethics)
11. [Giới hạn kỹ thuật & Behavioral Ambiguity](#11-giới-hạn-kỹ-thuật--behavioral-ambiguity)
12. [Tài liệu tham khảo](#12-tài-liệu-tham-khảo)

---

## 1. Tổng quan hệ thống

ClassSense là hệ thống phân tích hành vi học sinh trong lớp học trực tuyến, được thiết kế dành riêng cho giáo viên. Hệ thống sử dụng computer vision để theo dõi các tín hiệu phi ngôn ngữ từ webcam của học sinh, tổng hợp thành một chỉ số engagement theo thời gian thực, và hiển thị lên dashboard để giáo viên có thể can thiệp kịp thời.

### 1.1 Vấn đề cần giải quyết

Trong môi trường học trực tuyến, giáo viên mất đi khả năng quan sát hành vi tự nhiên của học sinh — điều mà họ làm vô thức mỗi ngày trong lớp học offline. Nghiên cứu cho thấy tỷ lệ dropout và mất tập trung trong lớp online cao hơn đáng kể so với lớp trực tiếp [1], trong khi giáo viên không có công cụ khách quan nào để đo lường tình trạng này.

### 1.2 Giải pháp

ClassSense xây dựng một pipeline computer vision chạy trên cloud, nhận frame webcam từ học sinh, trích xuất 4 tín hiệu hành vi chính (blink rate, gaze zone, head pose, emotion), tổng hợp thành engagement score theo sliding window, và push kết quả về dashboard của giáo viên mà không bao giờ truyền tải video thô ra ngoài máy học sinh.

### 1.3 Phạm vi v1.0

- Lớp học online 1-1 đến nhóm nhỏ (≤ 15 học sinh)
- Nền tảng: Zoom, Google Meet (bất kỳ nền tảng nào có webcam)
- Deployment: GCP Cloud Run + Firebase
- Privacy: local JPEG capture, score-only transmission

---

## 2. Cơ sở khoa học & nghiên cứu liên quan

### 2.1 Engagement detection trong e-learning

Phát hiện mức độ tập trung của học sinh là bài toán được nghiên cứu tích cực từ sau COVID-19. Xie et al. (2023) [1] đề xuất hệ thống kết hợp VGG16 (facial expression), ResNet-101 (head pose), và MediaPipe (facial landmarks) — stack gần giống với ClassSense — đạt tương quan Pearson 0.714 so với khảo sát NSSE-China, chứng minh tính khả thi của phương pháp multi-dimensional feature fusion.

Savchenko et al. (2022) [2] đề xuất pipeline dùng một mạng neural duy nhất (EfficientNet fine-tuned trên AffectNet) để đồng thời dự đoán cả emotion lẫn engagement level, chạy được real-time ngay trên thiết bị di động — đây chính là foundation của thư viện `emotiefflib` được dùng trong ClassSense.

Gupta et al. (2023) [6] xây dựng hệ thống multimodal kết hợp facial expression, eye blink count, và head movement, đạt accuracy 92.58% trong dự đoán engagement — xác nhận rằng fusion 3-4 modalities cho kết quả tốt hơn đáng kể so với single-modal.

### 2.2 Temporal dynamics và mind-wandering

Buono et al. (2022) [7] sử dụng LSTM trên facial action units + gaze + head pose để dự đoán engagement, và phát hiện một insight quan trọng: **gaze movement có tương quan nghịch với engagement** — người đang tập trung thực sự ít di chuyển gaze hơn. Đây là cơ sở cho thiết kế gaze stability metric của ClassSense.

Zhang et al. (2024) [8] nghiên cứu "hidden mind-wandering" — học sinh nhìn vào màn hình nhưng không tiếp thu — sử dụng temporal analysis của gaze direction với compressed DTW algorithm. ClassSense áp dụng insight này thông qua gaze drift metric trong sliding window.

### 2.3 Stability-centric framework

Almuniri et al. (2026) [9] cho thấy **stability của engagement score quan trọng hơn peak accuracy** trong điều kiện thực tế. Nghiên cứu này đề xuất dùng temporal augmentation và ensemble để đạt mean accuracy 0.901 ± 0.043, với variance dưới 0.07. ClassSense áp dụng bằng cách dùng rolling window thay vì per-frame label.

### 2.4 Datasets tham chiếu

| Dataset | Mô tả | Dùng trong ClassSense |
|---|---|---|
| DAiSEE | 8,925 video clip, 4 engagement levels | Benchmark cho scoring model |
| WACV2016 | Multi-dimensional engagement dataset | Validate fusion weights |
| MPIIFaceGaze | 15 participants × 3000 images, 3D gaze | Calibrate iris offset threshold |
| AffectNet-8 | 8 emotion classes, 450k images | Pre-train emotiefflib ONNX |

---

## 3. Tech stack & mô hình ML

### 3.1 Language & Runtime

| Thành phần | Phiên bản | Vai trò |
|---|---|---|
| Python | 3.12 | Core language |
| uv | latest | Package manager & virtual environment |

### 3.2 Computer Vision Pipeline

#### Face Detection & Facial Landmarks

**Thư viện:** `mediapipe >= 0.10.33`  
**Model:** `face_landmarker.task` (3.7 MB)

MediaPipe Face Landmarker cung cấp 478 facial landmark points. Blink detection được tính thông qua **Eye Aspect Ratio (EAR)**:

```
EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
```

Trong đó p1–p6 là 6 landmark điểm quanh mắt. EAR < 0.25 trong > 2 frames liên tiếp được tính là một blink event. **PERCLOS** (Percentage of Eye Closure) được tính trên sliding window 2 phút: PERCLOS = (số frame EAR < 0.20) / (tổng số frame) — ngưỡng 0.20 (mắt nhắm gần hoàn toàn) khác với ngưỡng blink 0.25 (chớp mắt thoáng qua).

#### Gaze Estimation

**Thư viện:** `mediapipe >= 0.10.33`

Gaze zone được ước tính từ iris landmarks (điểm 468–477 trong bộ 478 landmarks). Offset của iris center so với eye corner được map sang 5 zone: `center`, `left`, `right`, `up`, `down`. Zone `center` được coi là "đang nhìn màn hình", các zone còn lại là off-screen. Thư viện được validate trên **MPIIFaceGaze dataset** (15 participants × 3000 images, 3D gaze vectors) để calibrate ngưỡng offset.

#### Head Pose Estimation — 6DRepNet

**Thư viện:** `sixdrepnet >= 0.1.6`  
**Model:** `6DRepNet_300W_LP_AFLW2000.pth` (~60 MB)

Hempel et al. (2022) [11] giới thiệu 6DRepNet, phương pháp head pose estimation sử dụng **continuous 6D rotation matrix representation** thay vì Euler angles hay quaternion, tránh được vấn đề discontinuity. Loss function dựa trên geodesic distance trên SO(3) manifold. Kết quả: **MAE 3.97° trên AFLW2000**, outperform state-of-the-art cùng thời điểm đến 20%.

Kết quả đầu ra: yaw (ngang), pitch (lên-xuống), roll (nghiêng) dưới dạng góc độ. Ngưỡng "đang nhìn thẳng": |yaw| < 20°, |pitch| < 15°.

#### Emotion Recognition — EfficientNet-B0 ONNX

**Thư viện:** `emotiefflib >= 1.1.1`  
**Model:** `enet_b0_8_best_afew.onnx` (~20 MB)

Savchenko (2021) [12] và Savchenko et al. (2022) [2] phát triển pipeline dùng EfficientNet-B0 pre-trained trên face identification, sau đó fine-tune cho facial expression recognition trên AffectNet. Model phân loại 8 class cảm xúc: `neutral`, `happy`, `sad`, `surprise`, `fear`, `disgust`, `anger`, `contempt`. Model được export sang ONNX để inference không cần PyTorch runtime, giảm đáng kể overhead.

Mapping emotion → engagement signal:
- `neutral`, `happy`, `surprise` → neutral/positive (không penalize score)
- `sad`, `fear`, `disgust`, `anger` → negative signal (penalize nhẹ)
- `contempt` liên tục > 5s → strong distraction flag

#### Image I/O & Numerics

| Thư viện | Phiên bản | Vai trò |
|---|---|---|
| `opencv-python` | ≥ 4.10.0 | Frame capture, BGR processing, debug overlay |
| `numpy` | ≥ 2.0.0 | Landmark arithmetic, EAR computation, gaze offsets |

---

## 4. Kiến trúc hệ thống

### 4.1 Tổng quan kiến trúc

ClassSense triển khai theo mô hình **cloud-centralized inference** với thin client ở phía học sinh:

```
┌─────────────────────────────────────────────────────┐
│                PHÍA HỌC SINH (browser/thin client)  │
│                                                     │
│  Webcam → cv2.VideoCapture → resize 320×240 → JPEG  │
│          → WebSocket → Cloud (score-only return)    │
└─────────────────────────────────────────────────────┘
                          │
                    ~200 KB/s mỗi HS
                    WebSocket / WSS
                          │
┌─────────────────────────────────────────────────────┐
│              GOOGLE CLOUD PLATFORM                  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ Cloud Run — WebSocket Gateway (FastAPI)       │  │
│  │ nhận frame, auth token, map student_id        │  │
│  └─────────────────┬─────────────────────────────┘  │
│                    │                                │
│  ┌─────────────────▼─────────────────────────────┐  │
│  │ Pub/Sub — Frame Queue                         │  │
│  │ per-session topic, student_id as attribute    │  │
│  └─────────────────┬─────────────────────────────┘  │
│                    │                                │
│  ┌─────────────────▼─────────────────────────────┐  │
│  │ Cloud Run — Inference Workers (auto-scale)    │  │
│  │ BlazeFace → EAR → Gaze → 6DRepNet → ONNX     │  │
│  └─────────────────┬─────────────────────────────┘  │
│                    │                                │
│  ┌─────────────────▼─────────────────────────────┐  │
│  │ Score Aggregator + Firestore                  │  │
│  │ sliding window, rolling score, event flags    │  │
│  └─────────────────┬─────────────────────────────┘  │
│                    │ realtime listener               │
└────────────────────┼────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              GIÁO VIÊN (browser)                    │
│                                                     │
│  Firebase Hosting → Dashboard React/Vue             │
│  Class heatmap · Alert feed · Post-session report   │
└─────────────────────────────────────────────────────┘
```

### 4.2 Lý do chọn mô hình cloud-centralized

**Bài toán máy học sinh yếu:** Full pipeline ClassSense (BlazeFace + Face Landmarker 478pt + 6DRepNet + emotiefflib ONNX) tốn ~200–400 MB RAM và yêu cầu CPU i5 trở lên để chạy real-time. Nhiều học sinh dùng máy cấu hình thấp hoặc điện thoại, không đáp ứng được.

**Giải pháp:** Thin client phía học sinh chỉ làm 3 việc: `VideoCapture` → `resize(320, 240)` → `imencode('.jpg')` → gửi WebSocket. Yêu cầu tối thiểu: CPU Celeron, 1GB RAM, kết nối 2Mbps. Toàn bộ inference nằm trên cloud.

**Scale-to-zero:** Cloud Run tự động scale down về 0 khi không có buổi học, giúp chi phí tỷ lệ thuận với số buổi học thực tế thay vì trả fixed monthly cost.

### 4.3 Privacy design

- **JPEG frame được mã hóa qua WSS trong transit.** Worker nhận JPEG, xử lý, discard ngay sau khi tính score — không lưu lại trên cloud.
- **Chỉ truyền về dashboard:** `{student_id, timestamp, score, flags}` — không có hình ảnh.
- **Firestore security rules:** giáo viên chỉ đọc được data của session mình tạo.
- **Học sinh có thể opt-out** bất kỳ lúc nào (toggle trong thin client), lúc đó không gửi frame.

---

## 5. Luồng dữ liệu & workflow

### 5.1 Khởi động session

```
Giáo viên tạo session trên Dashboard
    → Firebase tạo session_id, trả về invite link
    → Học sinh mở invite link (browser)
    → Thin client xin permission camera
    → Học sinh xác nhận consent
    → WebSocket kết nối tới Gateway với {session_id, student_id, token}
    → Gateway xác thực, publish vào Pub/Sub topic per session (student_id làm attribute)
    → Inference worker subscribe topic
```

### 5.2 Luồng xử lý frame (per student, real-time)

```
[Thin Client - học sinh]
1. cv2.VideoCapture(0) lấy frame
2. cv2.resize(frame, (320, 240))
3. cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
4. ws.send(jpeg_bytes)  ← ~15fps, ~10–15KB/frame

[Gateway - Cloud Run]
5. Nhận bytes, parse header {student_id, session_id, timestamp}
6. Publish lên Pub/Sub topic: f"frames-{session_id}"
   # Dùng message attribute: {"student_id": student_id}
   # 1 topic per session, không tạo topic per student

[Inference Worker - Cloud Run]
7. Pull message từ Pub/Sub
8. cv2.imdecode → numpy array (BGR)
9. BlazeFace detect face → crop face ROI
10. Nếu không có face: face_missing_flag = True, skip inference
11. Face Landmarker 478 pts → EAR trái, EAR phải → blink event detection
12. Iris landmarks 468-477 → gaze zone classification
13. 6DRepNet(face_ROI) → yaw, pitch, roll
14. emotiefflib ONNX(face_ROI) → emotion probs[8]
15. Tạo FrameSignal:
    {
        student_id, timestamp,
        ear_left, ear_right, blink_detected,
        gaze_zone,          # "center"|"left"|"right"|"up"|"down"
        yaw, pitch, roll,
        emotion,            # argmax
        emotion_probs       # array[8]
    }
16. Push FrameSignal vào Score Aggregator

[Score Aggregator]
17. Thêm FrameSignal vào sliding window buffer (2 phút) của student
18. Tính engagement score (xem mục 6)
19. Detect event flags
20. Write vào Firestore: sessions/{session_id}/students/{student_id}/scores
21. Firestore realtime listener → push về Dashboard giáo viên
```

### 5.3 Kết thúc session

```
Giáo viên click "Kết thúc buổi học"
    → Gateway broadcast close signal
    → Thin clients ngừng gửi frame, đóng WebSocket
    → Aggregator flush buffer còn lại
    → Firestore đánh dấu session status = "completed"
    → Dashboard chuyển sang màn hình Post-session Report
    → Report được generate từ full time-series trong Firestore
    → Giáo viên có thể export PDF/CSV
```

---

## 6. Engagement score — thiết kế chi tiết

### 6.1 Công thức tổng hợp

Engagement score tại thời điểm t là trung bình có trọng số của 4 sub-scores, tính trên sliding window W = 30 giây:

```
E(t) = w_blink  × S_blink(t)
     + w_gaze   × S_gaze(t)
     + w_pose   × S_pose(t)
     + w_emotion × S_emotion(t)
```

**Trọng số khuyến nghị ban đầu** (có thể tune):

| Signal | Trọng số | Lý do |
|---|---|---|
| Blink (S_blink) | 0.35 | Indicator mạnh nhất, ít noise nhất |
| Gaze (S_gaze) | 0.30 | Trực tiếp đo on-screen attention |
| Head pose (S_pose) | 0.25 | Bổ sung cho gaze khi iris bị che |
| Emotion (S_emotion) | 0.10 | Noisy nhất, dùng như tiebreaker |

### 6.2 Tính từng sub-score

**S_blink(t) — Blink normality score**

```python
perclos = sum(ear < 0.2 for ear in window_ears) / len(window_ears)
blink_rate = count_blinks(window_ears) / window_duration_min  # blinks/phút

# Bình thường: 12-20 blinks/phút, PERCLOS < 0.08
if 8 <= blink_rate <= 25 and perclos < 0.08:
    S_blink = 1.0
elif perclos > 0.15:  # drowsy
    S_blink = max(0, 1 - (perclos - 0.08) / 0.15)
elif blink_rate < 5:  # staring — possible mind-wandering
    S_blink = 0.7
else:
    S_blink = 0.85
```

> **Lưu ý:** Ngưỡng EAR mặc định 0.25 có thể không phù hợp với tất cả người dùng (đặc biệt người châu Á hoặc đeo kính). Trong v2 sẽ implement per-student calibration dựa trên 60 giây đầu buổi học.

**S_gaze(t) — Gaze on-screen ratio**

```python
on_screen_frames = sum(zone == "center" for zone in window_gaze_zones)
S_gaze = on_screen_frames / len(window_gaze_zones)

# Penalize thêm nếu off-screen kéo dài liên tục
max_consecutive_off = max_consecutive(zone != "center" for zone in window_gaze_zones)
if max_consecutive_off > 5 * fps:  # > 5 giây
    distraction_event = True
```

**S_pose(t) — Head orientation score**

```python
# yaw: ngang, pitch: lên-xuống
in_range_frames = sum(
    abs(yaw) < 20 and abs(pitch) < 15
    for yaw, pitch in window_poses
)
S_pose = in_range_frames / len(window_poses)
```

**S_emotion(t) — Emotional valence**

```python
POSITIVE = {"neutral", "happy", "surprise"}
NEGATIVE = {"sad", "fear", "disgust", "anger", "contempt"}

valence_scores = []
for emotion, probs in window_emotions:
    pos_prob = sum(probs[i] for i in POSITIVE_IDX)
    neg_prob = sum(probs[i] for i in NEGATIVE_IDX)
    valence_scores.append(pos_prob - 0.5 * neg_prob)

S_emotion = max(0, min(1, np.mean(valence_scores) + 0.5))
```

### 6.3 Event flags

| Flag | Điều kiện kích hoạt | Action gợi ý |
|---|---|---|
| `DISTRACTION` | gaze off-screen > 5s liên tiếp | Highlight học sinh trên dashboard |
| `DROWSY` | PERCLOS > 15% trong 2 phút | Alert nhẹ cho giáo viên |
| `CONFUSED` | `fear` hoặc `disgust` > 40% prob trong 10s | Gợi ý giáo viên hỏi học sinh |
| `FACE_MISSING` | Không detect được face > 10s | Học sinh có thể rời khỏi máy |
| `LOW_ENGAGEMENT` | E(t) < 0.4 trong 3 phút liên tiếp | Alert giáo viên |

### 6.4 Rolling score & decay

Score cuối cùng hiển thị trên dashboard dùng exponential moving average để tránh nhảy đột ngột:

```python
alpha = 0.3  # smoothing factor
E_display(t) = alpha * E(t) + (1 - alpha) * E_display(t-1)
```

---

## 7. Dashboard giáo viên

### 7.1 Màn hình real-time

**Class Heatmap:** Grid hiển thị avatar/tên học sinh. Màu nền thay đổi theo engagement score:
- Xanh lá (E ≥ 0.7): đang tập trung tốt
- Vàng (0.4 ≤ E < 0.7): tập trung trung bình
- Đỏ (E < 0.4): cần chú ý

**Alert Feed (góc phải):** Toast notification không ồn ào, ví dụ:
- *"Nguyễn Văn A mất tập trung 3 phút — cân nhắc gọi tên"*
- *"3 học sinh đang ở mức thấp — có thể cần dừng hỏi bài"*

**Class Trend Line:** Biểu đồ engagement trung bình của cả lớp theo thời gian, cập nhật mỗi 30 giây. Giáo viên nhìn xu hướng đi xuống là biết cần thay đổi nhịp dạy.

### 7.2 Post-session report

Sau buổi học, report tự động generate bao gồm:

- **Engagement timeline:** Biểu đồ E(t) của từng học sinh và trung bình lớp theo toàn bộ buổi học
- **Low-point analysis:** Highlight các khoảng thời gian engagement drop mạnh (> 20% trong 5 phút) — thường tương ứng với đoạn content quá khó hoặc quá dễ
- **Per-student summary:** Bảng tổng hợp avg score, số distraction events, dominant emotion của từng học sinh
- **Export:** PDF và CSV

---

## 8. Triển khai Cloud (GCP)

### 8.1 Services sử dụng

| Component | GCP Service | Lý do chọn |
|---|---|---|
| WebSocket Gateway | Cloud Run | Scale-to-zero, managed TLS; set `--timeout=3600` |
| Frame Queue | Pub/Sub | Per-session topic, student_id làm message attribute |
| Inference Worker | Cloud Run | Docker image với models baked in |
| Session Data | Firestore | Realtime listener built-in cho dashboard |
| Model Storage | GCS + Artifact Registry | Pull tự động khi deploy |
| Dashboard Hosting | Firebase Hosting | Free tier, CDN global, tích hợp Firestore |

### 8.2 Docker image cho Inference Worker

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Cài dependencies
RUN pip install --no-cache-dir \
    mediapipe>=0.10.33 \
    sixdrepnet>=0.1.6 \
    emotiefflib>=1.1.1 \
    opencv-python-headless>=4.10.0 \
    numpy>=2.0.0 \
    fastapi uvicorn \
    google-cloud-pubsub \
    google-cloud-firestore

# Copy model files (bake vào image để tránh cold start)
COPY models/ /app/models/
# models/blaze_face_short_range.tflite
# models/face_landmarker.task
# models/6DRepNet_300W_LP_AFLW2000.pth
# models/enet_b0_8_best_afew.onnx

COPY src/ /app/src/

CMD ["python", "-m", "src.worker"]
```

### 8.3 Ước tính chi phí (1 lớp 10 học sinh, 60 phút/buổi)

| Resource | Tiêu thụ | Chi phí ước tính |
|---|---|---|
| Cloud Run (inference) | ~2 vCPU × 60 min | ~$0.05/buổi |
| Pub/Sub | 10 HS × 15fps × 3600s ≈ 540K messages | ~$0.02/buổi |
| Firestore writes | ~1800 score updates | ~$0.001/buổi |
| Bandwidth egress | 10 × 200KB/s × 3600s ≈ 7.2 GB | ~$0.86/buổi |
| **Tổng** | | **~$1/buổi học** |

> Bandwidth là chi phí lớn nhất. Có thể giảm xuống ~$0.3/buổi bằng cách giảm fps xuống 8 và tăng JPEG quality threshold.

### 8.4 `docker-compose.yml` cho local development

```yaml
services:
  gateway:
    build: ./services/gateway
    ports:
      - "8080:8080"
    environment:
      - PUBSUB_EMULATOR_HOST=pubsub:8085
      - GOOGLE_CLOUD_PROJECT=classsense-dev

  worker:
    build: ./services/worker
    deploy:
      replicas: 2
    environment:
      - PUBSUB_EMULATOR_HOST=pubsub:8085
      - FIRESTORE_EMULATOR_HOST=firestore:8080

  pubsub:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators
    command: gcloud beta emulators pubsub start --host-port=0.0.0.0:8085

  firestore:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators
    command: gcloud emulators firestore start --host-port=0.0.0.0:8080
```

---

## 9. Lộ trình 6 tuần

### Tuần 1 — CV Pipeline core

**Mục tiêu:** Pipeline chạy được trên một frame JPEG đơn lẻ, trả về FrameSignal đầy đủ.

**Tasks:**
- [ ] Setup Python 3.12 + uv, cài đủ dependencies
- [ ] Download và verify 3 model files (face_landmarker.task, 6DRepNet, emotiefflib ONNX)
- [ ] Implement `face_detector.py` — MediaPipe Face Landmarker (tận dụng built-in detection, không cần BlazeFace riêng)
- [ ] Implement `landmark_analyzer.py` — EAR trái/phải, blink detection, gaze zone từ iris landmarks
- [ ] Implement `pose_estimator.py` — 6DRepNet wrapper, trả về (yaw, pitch, roll)
- [ ] Implement `emotion_classifier.py` — emotiefflib ONNX wrapper, trả về probs[8]
- [ ] Implement `frame_signal.py` — dataclass FrameSignal, validate schema
- [ ] Unit test cho từng module với ảnh tĩnh

**Deliverable:** Script `python test_pipeline.py --image face.jpg` in ra FrameSignal đầy đủ.

---

### Tuần 2 — Score Aggregator & local demo

**Mục tiêu:** Pipeline chạy real-time trên webcam local, hiển thị score debug.

**Tasks:**
- [ ] Implement `score_aggregator.py` — sliding window 30s, tính 4 sub-scores, engagement score
- [ ] Implement event flag detection (DISTRACTION, DROWSY, CONFUSED, FACE_MISSING)
- [ ] Implement `rolling_score.py` — exponential moving average, EMA(alpha=0.3)
- [ ] Implement local webcam loop: `cv2.VideoCapture → resize → pipeline → overlay debug`
- [ ] Debug overlay: vẽ EAR, gaze zone, yaw/pitch, emotion, score lên frame
- [ ] Tune ngưỡng EAR, gaze offset, pose range với dữ liệu thực tế
- [ ] Validate PERCLOS calculation với ground truth (ghi video rồi đếm tay)

**Deliverable:** `python demo_local.py` — cửa sổ webcam với overlay real-time score.

---

### Tuần 3 — Thin Client & WebSocket Gateway

**Mục tiêu:** Thin client học sinh gửi frame lên, Gateway nhận và publish Pub/Sub.

**Tasks:**
- [ ] Implement `thin_client.py` — `VideoCapture → resize 320×240 → JPEG encode → WebSocket send`
- [ ] Implement Gateway với FastAPI + `websockets`: nhận bytes, parse header, publish Pub/Sub
- [ ] Auth Tuần 3: dùng session_id signed bằng HMAC secret (Firebase Auth implement ở Tuần 4)
- [ ] Deploy Cloud Run Gateway với `--timeout=3600` (tránh disconnect buổi học > 60 phút)
- [ ] Setup GCP project: enable Cloud Run, Pub/Sub, Firestore, Firebase
- [ ] Setup Pub/Sub emulator cho local dev
- [ ] Implement worker consumer: pull từ Pub/Sub, run pipeline, push FrameSignal
- [ ] Implement `firestore_writer.py` — write score updates vào Firestore
- [ ] Docker: build image gateway, image worker với models baked in
- [ ] Test end-to-end: thin_client → gateway → pubsub → worker → firestore

**Deliverable:** Chạy `docker-compose up`, mở thin_client.py, thấy data xuất hiện trong Firestore console.

---

### Tuần 4 — Teacher Dashboard (real-time)

**Mục tiêu:** Dashboard web hiển thị class heatmap real-time.

**Tasks:**
- [ ] Setup Firebase Hosting + React/Vue project
- [ ] Implement Firestore realtime listener trong frontend
- [ ] Build Class Heatmap component: grid học sinh, màu theo score, update mỗi 1-2s
- [ ] Build Alert Feed component: show event flags, auto-dismiss sau 30s
- [ ] Build Class Trend Line: recharts/chart.js, rolling avg 5 phút
- [ ] Implement session management: tạo session → invite link → URL share
- [ ] Authentication: Firebase Auth cho giáo viên (email/password hoặc Google)
- [ ] Test với 2-3 người thật, validate latency end-to-end < 3s

**Deliverable:** Dashboard chạy được trên firebase hosting, test với nhóm nhỏ.

---

### Tuần 5 — Post-session Report & Hardening

**Mục tiêu:** Report đầy đủ sau buổi học, hệ thống ổn định.

**Tasks:**
- [ ] Implement `report_generator.py` — query toàn bộ session data từ Firestore, tính stats
- [ ] Build Report UI: timeline chart, low-point highlight, per-student table
- [ ] **Implement event snapshot storage:** khi inference worker detect event flag, lưu frame hiện tại lên GCS với signed URL
- [ ] **Implement dual consent flow:** consent phân tích tách riêng consent lưu ảnh, lưu consent log vào Firestore
- [ ] **Implement UI indicator:** chấm xanh/vàng/xám trên thin client theo trạng thái snapshot
- [ ] **Implement snapshot viewer:** giáo viên click vào event trên timeline → xem ảnh snapshot kèm theo
- [ ] **Implement GCS lifecycle policy:** tự động xóa snapshot sau 30 ngày
- [ ] **Implement erasure API:** endpoint cho phép học sinh yêu cầu xóa toàn bộ ảnh của mình
- [ ] Implement PDF export (html2pdf hoặc server-side WeasyPrint)
- [ ] Implement CSV export
- [ ] Error handling: mất kết nối webcam, face không detect được lâu, worker crash
- [ ] Implement worker retry logic: nếu inference fail, requeue với backoff
- [ ] Load test: simulate 10 thin clients đồng thời, đo latency và CPU worker
- [ ] Optimize: giảm JPEG quality xuống 65, giảm fps xuống 10 nếu latency cao
- [ ] Setup Cloud Run auto-scaling: min=0, max=5 worker instances

**Deliverable:** Chạy full buổi học thật 30-45 phút, xuất report PDF hoàn chỉnh.

---

### Tuần 6 — Polish, deploy production & pilot

**Mục tiêu:** Deploy production, chạy pilot với 1-2 giáo viên thật.

**Tasks:**
- [ ] Setup GCP production environment (tách khỏi dev project)
- [ ] Setup monitoring: Cloud Monitoring, alert khi worker lag > 5s
- [ ] Implement consent flow hoàn chỉnh: học sinh đọc privacy notice, click "Đồng ý"
- [ ] Implement opt-out: toggle trong thin client pause việc gửi frame
- [ ] UI polish: responsive design, loading states, error messages thân thiện
- [ ] Viết hướng dẫn sử dụng cho giáo viên (1 trang A4)
- [ ] Viết hướng dẫn cài thin client cho học sinh (ảnh chụp màn hình từng bước)
- [ ] Pilot với 1-2 giáo viên, 3-5 học sinh mỗi lớp
- [ ] Thu thập feedback: score có phản ánh đúng cảm quan của giáo viên không?
- [ ] Fix bugs từ pilot

**Deliverable:** Production URL chạy được, ít nhất 2 buổi học pilot thành công.

---

### Timeline tổng quan

```
Tuần 1   [██████████] CV Pipeline core
Tuần 2   [██████████] Score Aggregator + local demo
Tuần 3   [██████████] Thin Client + Gateway + Cloud infra
Tuần 4   [██████████] Teacher Dashboard real-time
Tuần 5   [██████████] Post-session Report + Hardening
Tuần 6   [██████████] Production deploy + Pilot

Buffer tasks (nếu có thời gian thừa):
         [ ] Per-student EAR baseline calibration (60s đầu buổi)
         [ ] Admin panel: quản lý nhiều giáo viên, nhiều lớp
         [ ] Mobile-friendly thin client (PWA)
```

---

## 10. Privacy & Ethics

### 10.1 Nguyên tắc thiết kế

1. **Proportionate storage:** Chỉ lưu ảnh khi có lý do cụ thể (event flag), không lưu liên tục.
2. **Dual consent:** Consent phân tích hành vi và consent lưu ảnh là hai consent riêng biệt, tường minh.
3. **Local-first inference trong tương lai:** v1 gửi JPEG lên cloud, v2 sẽ nghiên cứu khả năng chạy inference trực tiếp trong browser (WebAssembly + WASM ONNX Runtime).
4. **Transparency:** Học sinh luôn biết camera đang bật, đang được phân tích, và ảnh có đang được lưu hay không (indicator riêng trên UI).
5. **Consent-first:** Không gửi bất kỳ frame nào trước khi học sinh click "Đồng ý".
6. **Right to opt-out:** Học sinh có thể dừng phân tích bất kỳ lúc nào mà không ảnh hưởng đến tham gia lớp học.
7. **Right to erasure:** Học sinh hoặc phụ huynh có thể yêu cầu xóa toàn bộ ảnh của mình bất kỳ lúc nào.

### 10.2 Chính sách lưu trữ ảnh (Event Snapshot)

Giáo viên cần bằng chứng ảnh để đối chiếu khi score drop — ví dụ phân biệt "học sinh đang ghi bài" với "học sinh thực sự mất tập trung". ClassSense giải quyết nhu cầu này theo mô hình **event-triggered snapshot**: chỉ lưu 1 frame tại thời điểm hệ thống phát hiện một event flag, không lưu liên tục.

#### 10.2.1 Ba mức lưu trữ

| Mức | Cơ chế | Số ảnh ước tính | Khuyến nghị |
|---|---|---|---|
| **Mức 1 — Event snapshot** | 1 frame mỗi khi trigger event flag | 5–20 ảnh/HS/buổi | ✓ **Áp dụng v1** |
| Mức 2 — Keyframe định kỳ | 1 frame mỗi N phút bất kể event | 15–30 ảnh/HS/giờ | Xem xét v2 |
| Mức 3 — Full stream | Toàn bộ frame | Hàng nghìn ảnh | Không khuyến nghị |

ClassSense v1 áp dụng **Mức 1** vì cân bằng tốt nhất giữa usefulness cho giáo viên và privacy impact: giáo viên có đủ bằng chứng để đối chiếu từng alert cụ thể, trong khi học sinh không bị chụp ảnh liên tục suốt buổi học.

#### 10.2.2 Các event trigger lưu snapshot

| Event flag | Trigger condition | Lý do cần ảnh |
|---|---|---|
| `DISTRACTION` | gaze off-screen > 5s liên tiếp | Phân biệt distracted vs ghi bài / màn hình thứ 2 |
| `DROWSY` | PERCLOS > 15% trong 2 phút | Xác nhận buồn ngủ vs nhắm mắt suy nghĩ |
| `FACE_MISSING` | Không detect face > 10s | Xác nhận rời khỏi máy vs webcam bị che |
| `LOW_ENGAGEMENT` | E(t) < 0.4 trong 3 phút liên tiếp | Cung cấp context cho alert |

Mỗi snapshot được lưu kèm metadata: `{student_id, session_id, timestamp, event_type, score_at_event}`.

#### 10.2.3 Storage và access control

```
GCS Bucket: classsense-snapshots-{project_id}
  └── sessions/{session_id}/
        └── students/{student_id}/
              └── {timestamp}_{event_type}.jpg
```

- **Encryption:** GCS Customer-managed encryption keys (CMEK), không public URL
- **Signed URL:** Giáo viên truy cập ảnh qua signed URL có thời hạn 1 giờ, không truy cập trực tiếp bucket
- **IAM:** Chỉ service account của inference worker có quyền write; giáo viên đọc qua API có xác thực session
- **Audit log:** Mọi lần truy cập ảnh được log vào Cloud Audit Logs
- **Retention:** Tự động xóa sau **30 ngày** qua GCS lifecycle policy

#### 10.2.4 Consent flow cho lưu ảnh

Đây là consent **riêng biệt** với consent phân tích hành vi, hiển thị rõ ràng trước khi session bắt đầu:

```
┌─────────────────────────────────────────────────────┐
│  ClassSense — Xác nhận lưu ảnh                     │
│                                                     │
│  Ngoài việc phân tích hành vi, giáo viên đã bật    │
│  tính năng lưu ảnh chụp nhanh (snapshot) khi hệ    │
│  thống phát hiện dấu hiệu mất tập trung.            │
│                                                     │
│  Ảnh sẽ được:                                       │
│  • Lưu trữ mã hoá trên cloud                       │
│  • Chỉ giáo viên của buổi học này truy cập được    │
│  • Tự động xóa sau 30 ngày                         │
│  • Xóa ngay theo yêu cầu của bạn                   │
│                                                     │
│  Bạn có thể từ chối lưu ảnh và vẫn tham gia        │
│  buổi học bình thường (chỉ tắt tính năng này).      │
│                                                     │
│  [ Đồng ý lưu ảnh ]    [ Từ chối — chỉ phân tích ] │
└─────────────────────────────────────────────────────┘
```

Nếu học sinh chọn "Từ chối", hệ thống vẫn hoạt động bình thường — chỉ không lưu snapshot. Score và event flags vẫn được tính và hiển thị cho giáo viên, nhưng không có ảnh kèm theo.

#### 10.2.5 UI indicator trên thin client

Thin client hiển thị hai trạng thái rõ ràng cho học sinh trong suốt buổi học:

- 🟢 **Chấm xanh:** Camera đang bật, đang phân tích, không có snapshot nào đang được lưu
- 🟡 **Chấm vàng nhấp nháy:** Vừa có snapshot được lưu (hiển thị 3 giây rồi về xanh)
- ⚪ **Chấm xám:** Camera tắt / đã opt-out

### 10.3 Bảng tổng hợp dữ liệu được lưu trữ

| Loại dữ liệu | Lưu ở đâu | Thời gian lưu | Ai truy cập được |
|---|---|---|---|
| JPEG frames (non-event) | Không lưu | Xử lý xong xóa ngay | Không ai |
| Event snapshots (ảnh) | GCS (encrypted) | 30 ngày | Giáo viên của session (signed URL) |
| FrameSignal (numbers) | Firestore (ephemeral) | Trong session | Worker only |
| Engagement scores | Firestore | 90 ngày | Giáo viên của session |
| Session report | Firestore | 1 năm | Giáo viên của session |
| Consent log | Firestore | 2 năm | Admin only |

### 10.4 Giới hạn kỹ thuật cần làm rõ với người dùng

- Score chỉ là proxy hành vi, không phải đo lường trực tiếp sự hiểu bài.
- Snapshot tại event có thể không phản ánh đúng ngữ cảnh — học sinh có thể đang ghi bài hoặc nhìn màn hình phụ tại thời điểm bị chụp.
- Lighting kém, webcam chất lượng thấp, hoặc đeo kính có thể ảnh hưởng độ chính xác.
- Không dùng để đánh giá học lực hay xếp loại học sinh.
- Giáo viên cần hiểu snapshot là gợi ý để hỏi thêm, không phải bằng chứng kết luận.

---

## 11. Giới hạn kỹ thuật & Behavioral Ambiguity

### 11.1 Vấn đề cốt lõi: cùng hành vi, nhiều ý nghĩa

Một trong những thách thức lớn nhất của hệ thống phân tích hành vi qua camera là **behavioral ambiguity** — cùng một tín hiệu quan sát được từ webcam có thể tương ứng với nhiều trạng thái nhận thức hoàn toàn khác nhau. Đây không phải là bug có thể fix hoàn toàn bằng kỹ thuật, mà là giới hạn inherent của phương pháp.

| Hành vi quan sát được | Giải thích A (tiêu cực) | Giải thích B (tích cực) |
|---|---|---|
| Nhìn xuống, không nhìn cam | Mất tập trung | **Đang ghi bài** |
| Gaze nhìn sang bên | Distracted | Nhìn màn hình thứ 2 / tài liệu |
| Gaze ổn định, ít di chuyển | Mind-wandering | Đang tập trung sâu [7] |
| Nhắm mắt ngắn | Buồn ngủ | Đang suy nghĩ / nhớ lại thông tin |
| Emotion neutral flat | Không engage | Đang cố gắng tập trung |
| Head cúi thấp | Bỏ cuộc | Đang đọc tài liệu in |

Vanneste et al. (2021) [15] sau khi thử nhiều approach trên dữ liệu thực tế kết luận rằng **note-taking là hành vi cực kỳ khó nhận diện và không tương quan với self-reported engagement** của học sinh — tức ngay cả khi detect được "đang ghi bài", điều đó cũng không nói lên nhiều về mức độ tiếp thu thực sự. Đây là vấn đề conceptual, không chỉ là vấn đề kỹ thuật.

### 11.2 Tình trạng nghiên cứu hiện tại

#### Hướng 1 — Body pose + action classification

Hướng được nhiều nhóm nghiên cứu theo đuổi nhất là tách bài toán **nhận diện hành động** ra khỏi bài toán **đo engagement**. Liu et al. (2025) [16] trong systematic review của 80 paper xác nhận "physical action" và "learning engagement" là hai target recognition chính của field. Yang et al. (2023) [17] xây dựng SCB-Dataset3 với 6 behavioral class cụ thể: `hand-raising`, `reading`, `writing`, `using phone`, `bowing head`, `leaning on table` — model YOLOv8-based đạt mAP 80.3% trong việc phân biệt các hành vi này, trong đó `writing` là một class riêng, không bị nhầm với distraction.

**Giới hạn với ClassSense:** Tất cả các dataset và model này được xây dựng cho lớp học offline với camera góc rộng nhìn từ phía trước hoặc trên xuống, thấy được toàn thân học sinh. Với webcam online học cắt ngang ngực, không thấy tay và bút — approach này **không áp dụng được trực tiếp**.

#### Hướng 2 — Gaze + mouse fusion cho môi trường online

Zhu et al. (2023) [18] đề xuất kết hợp eye tracking và mouse movement để nhận diện 8 hoạt động học sinh khi học online, đạt F1 94.87% với Joint Cross-Attention Fusion Net. Insight quan trọng: khi ghi bài trên giấy, mouse không di chuyển và gaze nhìn xuống — pattern này phân biệt được với distraction (gaze nhảy nhiều hướng) và đọc tài liệu trên máy (gaze di chuyển đều theo chiều đọc, mouse thỉnh thoảng scroll).

**Giới hạn:** Cần cài thêm mouse tracker vào thin client, tăng friction cho học sinh. Khả thi cho v2.

#### Hướng 3 — Audio + video multimodal

Zhao et al. (2025) [19] với Multimodal Sensing Framework kết hợp video và audio, evaluate trên CSBR10 dataset 10 behavioral class, đạt accuracy cao hơn đáng kể so với video-only. Thêm audio giúp phân biệt "đang ghi bài im lặng" với "đang nói chuyện riêng" — hai hành vi mà video-only không phân biệt được.

#### Hướng 4 — Head pitch heuristic (pragmatic, áp dụng được ngay)

Với techstack hiện tại của ClassSense (6DRepNet đã cho ra yaw/pitch/roll), có thể implement một heuristic đơn giản để nhận diện trạng thái ghi bài dựa trên pattern của head pose:

```python
def detect_writing_mode(window_poses, window_gazes, fps):
    """
    Heuristic phân biệt writing vs distracted khi gaze off-screen.
    Writing: pitch cao + ổn định + gaze hướng xuống liên tục.
    Distracted: gaze nhảy nhiều hướng, pitch thay đổi bất thường.
    """
    pitches = [p for _, p, _ in window_poses]
    gaze_dirs = window_gazes

    avg_pitch = np.mean(pitches)
    pitch_variance = np.var(pitches)
    gaze_down_ratio = sum(g == "down" for g in gaze_dirs) / len(gaze_dirs)
    gaze_consistent = pitch_variance < 8.0  # pitch ổn định

    if avg_pitch > 18 and gaze_consistent and gaze_down_ratio > 0.55:
        return "WRITING"    # suppress gaze penalty
    else:
        return "DISTRACTED" # penalize bình thường
```

Khi `writing_mode = True`, trọng số gaze trong công thức engagement được giảm xuống ~0.05 (thay vì 0.30 bình thường), đồng thời không trigger `DISTRACTION` flag. Đây là biện pháp giảm false positive đơn giản nhất có thể implement trong Tuần 2.

### 11.3 Chiến lược xử lý trong ClassSense

ClassSense áp dụng kết hợp ba lớp giảm thiểu false positive:

**Lớp 1 — Temporal smoothing (implement Tuần 2).**
Sliding window 30 giây và EMA smoothing đã tự nhiên làm phẳng các sự kiện ngắn. Học sinh ghi bài thường kéo dài 30–90 giây rồi ngẩng đầu lại — với window 2 phút, drop ngắn hạn không kéo score xuống đủ để trigger alert.

**Lớp 2 — Writing mode heuristic (implement Tuần 2).**
Dùng pitch pattern từ 6DRepNet để suppress gaze penalty khi phát hiện pattern nhất quán với việc ghi bài. Không cần model bổ sung, chỉ cần thêm ~20 dòng logic vào Score Aggregator.

**Lớp 3 — Alert threshold bảo thủ + framing rõ ràng (implement Tuần 4).**
Alert chỉ trigger khi score thấp liên tục > 3 phút (không phải > 1 phút). Dashboard hiển thị rõ ràng: *"Chỉ số phản ánh hành vi quan sát được qua camera. Học sinh ghi bài hoặc nhìn tài liệu có thể bị đánh giá thấp hơn thực tế trong thời gian ngắn."*

### 11.4 Giới hạn còn lại và hướng v2

Ngay cả với 3 lớp trên, một số trường hợp vẫn không giải quyết được trong v1:

- **Màn hình kép:** Học sinh nhìn sang màn hình thứ 2 để đọc tài liệu — pitch không thay đổi nhiều, gaze lệch ngang → hệ thống vẫn báo distracted.
- **Deep thinking:** Học sinh nhìn chằm chằm vào một điểm hoặc nhắm mắt để suy nghĩ — gaze ổn định bất thường, dễ bị nhầm với mind-wandering.
- **Lighting / webcam chất lượng thấp:** Iris landmark detection không ổn định, gaze zone sai → noise cao.

Hướng giải quyết cho v2: tích hợp mouse tracker nhẹ (Zhu et al. approach [18]) để phân biệt "đang tương tác với máy tính" vs "không tương tác", kết hợp với head pitch heuristic hiện tại. Theo kết quả của Zhu et al., sự kết hợp gaze + mouse tăng F1 ít nhất 7.44% so với gaze đơn lẻ.

---

## 12. Tài liệu tham khảo

[1] Xie, N. et al. (2023). *Student engagement detection in online environment using computer vision and multi-dimensional feature fusion.* Multimedia Systems. https://consensus.app/papers/details/59e9c838e6405d7997f8483566741a36/

[2] Savchenko, A. et al. (2022). *Classifying Emotions and Engagement in Online Learning Based on a Single Facial Expression Recognition Neural Network.* IEEE Transactions on Affective Computing. https://consensus.app/papers/details/1af57a17cd9958ee90b0a8d607e43292/

[3] Trabelsi, Z. et al. (2023). *Real-Time Attention Monitoring System for Classroom: A Deep Learning Approach for Student's Behavior Recognition.* Big Data and Cognitive Computing. https://consensus.app/papers/details/a7992f8881c25c8f8b27ad029cd7013f/

[4] Altuwairqi, K. et al. (2021). *Student behavior analysis to measure engagement levels in online learning environments.* Signal, Image and Video Processing. https://consensus.app/papers/details/9c230cea127e57ef88c383793fa03a8a/

[5] Hossen, M.K. et al. (2023). *A dataset for assessing real-time attention levels of the students during online classes.* Data in Brief. https://consensus.app/papers/details/9349557b77d15efc90588edf9d0a732f/

[6] Gupta, S. et al. (2023). *A multimodal facial cues based engagement detection system in e-learning context using deep learning approach.* Multimedia Tools and Applications. https://consensus.app/papers/details/1b0214ecac495ef2a72636d20cd4d300/

[7] Buono, P. et al. (2022). *Assessing student engagement from facial behavior in on-line learning.* Multimedia Tools and Applications. https://consensus.app/papers/details/acc7183bafc750beaece5ce40c305980/

[8] Zhang, M. et al. (2024). *Research on Hidden Mind-Wandering Detection Algorithm for Online Classroom Based on Temporal Analysis of Eye Gaze Direction.* https://consensus.app/papers/details/ca88ef55b3dc5ee88521ad050f647ae8/

[9] Almuniri, I.S. et al. (2026). *Beyond peak accuracy: a stability-centric framework for reliable multimodal student engagement assessment.* Scientific Reports. https://consensus.app/papers/details/0f3318f6e400584cbff42f899bb7a13d/

[10] Bazarevsky, V. et al. (2019). *BlazeFace: Sub-millisecond Neural Face Detection on Mobile GPUs.* ArXiv. https://consensus.app/papers/details/acfab347e6835935bd9197bba9c5866f/

[11] Hempel, T. et al. (2022). *6D Rotation Representation For Unconstrained Head Pose Estimation.* IEEE ICIP 2022. https://consensus.app/papers/details/ed3fbe30bb74519082d51dc1d609f3b8/

[12] Savchenko, A. (2021). *Facial expression and attributes recognition based on multi-task learning of lightweight neural networks.* IEEE SISY 2021. https://consensus.app/papers/details/e968c412a85c520abd07af1898d2d6bd/

[13] Sabuncuoglu, A. et al. (2023). *Developing a Multimodal Classroom Engagement Analysis Dashboard for Higher-Education.* Proceedings of the ACM on Human-Computer Interaction. https://consensus.app/papers/details/a0e318e7afa15a43b7716d8510c6ad65/

[14] Xie, N. et al. (2025). *MSC-Trans: A Multi-Feature-Fusion Network With Encoding Structure for Student Engagement Detecting.* IEEE Transactions on Learning Technologies. https://consensus.app/papers/details/3470d674289456e98243cad622db286f/

[15] Vanneste, P. et al. (2021). *Computer Vision and Human Behaviour, Emotion and Cognition Detection: A Use Case on Student Engagement.* https://consensus.app/papers/details/2b340bbb3b545f8b93c1de9a08d5a36f/

[16] Liu, Q. et al. (2025). *Classroom Behavior Recognition Using Computer Vision: A Systematic Review.* Sensors. https://consensus.app/papers/details/943c469e1e7b5c838805dd956a2a2d5e/

[17] Yang, F. et al. (2023). *SCB-Dataset3: A Benchmark for Detecting Student Classroom Behavior.* ArXiv. https://consensus.app/papers/details/862d4a7d62505e2e87082b551e1c5669/

[18] Zhu, R. et al. (2023). *Integrating Gaze and Mouse Via Joint Cross-Attention Fusion Net for Students' Activity Recognition in E-learning.* Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies. https://consensus.app/papers/details/ea2504b824af535b8300652918f8825b/

[19] Zhao, X.M. et al. (2025). *Classroom Student Behavior Recognition Using an Intelligent Sensing Framework.* IEEE Access. https://consensus.app/papers/details/16e8d37644cc5b37b4d464b89de829ee/

---

*Tài liệu này được cập nhật lần cuối: tháng 4, 2026 (v1.2 — bổ sung Event Snapshot storage policy & consent flow). Mọi thắc mắc về kiến trúc hoặc implementation, liên hệ team ClassSense.*
