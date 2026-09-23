# TRẠNG THÁI TRIỂN KHAI HIỆN TẠI — VEILTALK

**Ngày rà soát:** 22/09/2026  
**Mục đích:** Làm mốc giao nhiệm vụ tiếp theo cho Backend, Frontend nhân vật và Frontend web.  
**Quy ước:**

- `HOÀN THÀNH`: đã có code và được roadmap/tài liệu hiện tại xác nhận hoàn thành.
- `CODE COMPLETE / CHỜ NGHIỆM THU`: đã có code và automated test, nhưng còn thiếu webcam, đa model, performance hoặc xác nhận thủ công.
- `ĐANG LÀM`: đã triển khai một phần nhưng chưa đạt Definition of Done.
- `CHƯA LÀM`: chưa có màn hình/luồng sản phẩm hoàn chỉnh hoặc vẫn là placeholder.
- Khi mô tả trong dòng tổng hợp P4-T10 cũ mâu thuẫn với biên bản mới hơn, trạng thái mới hơn trong roadmap AR3/AR4/AR5 được ưu tiên.

---

## 1. Tổng quan

| Khu vực | Trạng thái hiện tại | Nhận định |
|---|---|---|
| Nền tảng và database | Hoàn thành P0 và P1 | Cấu trúc dự án, Docker Compose, Flyway, entity, repository và Redis đã có. |
| Backend API | Hoàn thành P2-T01 → P2-T26 theo roadmap | Chức năng backend MVP đã có; môi trường test tự động vẫn cần chuẩn hóa để chạy xanh bằng một lệnh. |
| Signaling server | Hoàn thành P3-T01 → P3-T04 | Đủ cho một instance; scale ngang signaling chưa được giải quyết. |
| Frontend nền và auth | Hoàn thành P4-T01 → P4-T07 | API client, store, WebSocket messaging, theme, onboarding, login và register đã có. |
| Frontend avatar | P4-T08/P4-T09 hoàn thành; P4-T10 đang làm | Tracking và renderer đã phát triển sâu, nhưng P4-T10 chưa đạt Definition of Done. |
| Frontend web sản phẩm | Mới đến chọn model avatar | Tùy chỉnh, Home, Chat, Call, Record, Video Library và Settings chưa hoàn thành. |

---

## 2. Backend — các task đã hoàn thành

### 2.1. Phase 0 — Thiết lập dự án

- [x] **P0-T01** — Khởi tạo repository và cấu trúc thư mục.
- [x] **P0-T02** — Cài đặt Docker và Docker Compose.
- [x] **P0-T03** — Khởi tạo Spring Boot backend.
- [x] **P0-T04** — Khởi tạo Node.js signaling server.
- [x] **P0-T05** — Khởi tạo React/TypeScript frontend.
- [x] **P0-T06** — Tạo `.env` và `docker-compose.yml`.
- [x] **P0-T07** — Xác minh stack PostgreSQL, Redis và MinIO.

### 2.2. Phase 1 — Database và persistence

- [x] **P1-T01** — Tích hợp Flyway và migration V1.
- [x] **P1-T02** — Kiểm tra schema, constraint và index.
- [x] **P1-T03** — Kiểm tra migration có thể chạy lặp lại và tái tạo database sạch.
- [x] **P1-T04** — Tạo các JPA Entity.
- [x] **P1-T05** — Tạo Repository và các query cần thiết.
- [x] **P1-T06** — Kết nối Redis từ backend.

### 2.3. Phase 2A — Xác thực và tài khoản

- [x] **P2-T01** — JWT Service: access token, refresh token, validate và extract claims.
- [x] **P2-T02** — Spring Security filter chain và JWT authentication filter.
- [x] **P2-T03** — `POST /auth/register`.
- [x] **P2-T04** — `POST /auth/login`.
- [x] **P2-T05** — `POST /auth/refresh` và `/auth/logout`.
- [x] **P2-T06** — `GET/PUT /users/me`.
- [x] **P2-T07** — `GET/PUT /users/me/settings`.
- [x] **P2-T08** — `DELETE /users/me`, soft delete và revoke token.
- [x] **P2-T09** — `POST /users/search`, anti-enumeration và rate limit.

### 2.4. Phase 2B — Avatar API

- [x] **P2-T10** — `GET /avatars/models`.
- [x] **P2-T11** — `PUT /avatars/me` để tạo/cập nhật avatar.
- [x] **P2-T12** — `GET /avatars/me` và `GET /avatars/{userId}`.

### 2.5. Phase 2C — Conversation và messaging

- [x] **P2-T13** — `POST /conversations` idempotent.
- [x] **P2-T14** — Danh sách và chi tiết conversation có cursor pagination.
- [x] **P2-T15** — Gửi message idempotent và publish realtime sau commit.
- [x] **P2-T16** — Lấy lịch sử message bằng keyset cursor.
- [x] **P2-T17** — Cập nhật trạng thái `sent/delivered/read`.
- [x] **P2-T18** — Messaging WebSocket, typing, Redis Pub/Sub, PING/PONG và multi-session.

### 2.6. Phase 2D/2E — Video và MinIO

- [x] **P2-T19** — Cấu hình MinIO client và kiểm tra presigned URL.
- [x] **P2-T20** — Khởi tạo multipart upload bằng `POST /videos`.
- [x] **P2-T21** — Cấp URL cho chunk tiếp theo bằng `POST /videos/{id}/chunks`.
- [x] **P2-T22** — Finalize và abort multipart upload.
- [x] **P2-T23** — MinIO webhook và chuyển video từ `processing` sang `ready`.
- [x] **P2-T24** — List/detail/rename/delete video và cleanup khi xóa tài khoản.

### 2.7. Phase 2F — Metrics và health

- [x] **P2-T25** — `POST /metrics/client` và rate limit.
- [x] **P2-T26** — Spring Boot Actuator và health check DB/Redis.

### 2.8. Signaling server đã hoàn thành

- [x] **P3-T01** — WebSocket server có JWT authentication.
- [x] **P3-T02** — Relay `CALL_OFFER`, `CALL_ANSWER`, `ICE_CANDIDATE` và rate limit.
- [x] **P3-T03** — `CALL_REJECT`, `CALL_END`, timeout và cleanup session.
- [x] **P3-T04** — Gửi `CALL_INCOMING` qua backend Messaging WebSocket.

### 2.9. Việc backend còn phải làm dù các task P2 đã đóng

Các mục dưới đây không phải API nghiệp vụ P2 còn thiếu, nhưng vẫn cần hoàn thành trước khi coi backend sẵn sàng cho bản bảo vệ:

- [ ] Chuẩn hóa PostgreSQL, Redis, MinIO và các secret cho test profile.
- [ ] Tạo quy trình chạy toàn bộ backend test bằng một lệnh trên môi trường sạch.
- [ ] Chạy lại và lưu bằng chứng toàn bộ 228 test backend.
- [ ] Chạy test API đầu-cuối TC-01 → TC-45 trong Phase 5.
- [ ] Tạo seed data và load-test scripts.
- [ ] Bổ sung Prometheus/Micrometer metrics và dashboard theo kế hoạch chịu tải.
- [ ] Hiện thực cấu hình Nginx/reverse proxy trong `infra/`.
- [ ] Kiểm tra hai backend instance và Redis Pub/Sub cross-instance.
- [ ] Kiểm tra scheduled cleanup không chạy trùng khi có nhiều backend instance.
- [ ] Quyết định cách scale signaling: một instance đã benchmark, sticky session hoặc shared routing/state.
- [ ] Giới hạn truy cập production tới `/internal/**` thay vì chỉ dựa vào shared secret.

---

## 3. Frontend nhân vật — phần đã hoàn thành

### 3.1. Chọn model và tracking

- [x] **P4-T08** — Màn hình chọn model avatar, gọi thật `GET /avatars/models`.
- [x] **P4-T09** — MediaPipe Face, Hand và Pose Landmarker chạy local-only.
- [x] Camera lifecycle: start, stop và dispose.
- [x] Model/WASM MediaPipe được self-host.
- [x] `RawTrackingFrameV1` chỉ được xử lý cục bộ.
- [x] DEV tracking harness.
- [x] Không gửi ảnh webcam hoặc raw landmarks ra server/network packet.

### 3.2. Renderer và model lifecycle đã có code

- [x] Three.js và `@pixiv/three-vrm` renderer.
- [x] Load VRM, model capability và normalized rig profile.
- [x] `AvatarCanvas` và animation frame loop.
- [x] Render smoothing và renderer metrics.
- [x] DEV harness cho renderer.
- [x] Đổi/reload nhiều VRM với latest-request guard.
- [x] Model-specific capability fallback cho các rig không đầy đủ.

### 3.3. Khuôn mặt và miệng đã có code

- [x] Neutral calibration cho khuôn mặt.
- [x] Mapping biểu cảm mắt, lông mày và miệng.
- [x] Mouth landmark geometry.
- [x] Speech corrective và telemetry cho mouth pipeline.
- [x] Facial expression dynamics và mixer.
- [x] Blend/corrective để giảm saturation và neutral drift.
- [x] F4 corrective code và automated gate đã hoàn tất.

### 3.4. Eye gaze — AR3 đã hoàn thành phần code/tooling

- [x] Semantic gaze observation và gaze solver.
- [x] Gaze temporal processing.
- [x] Gaze–eyelid coupling.
- [x] Model capability adapter.
- [x] Faithful mode mặc định và cinematic mode opt-in.
- [x] Gaze metrics và DEV gate.
- [x] Corrective giảm response/range sau manual smoke ban đầu.

### 3.5. Đầu, cổ, thân trên và vai — AR4 đã được owner-accepted

- [x] Head/neck solver.
- [x] Torso basis và upper-body calibration.
- [x] Head-relative neutral delta.
- [x] Full-torso và shoulder-only mode.
- [x] Yaw/pitch/roll thân trên.
- [x] Vertical shoulder translation/shrug.
- [x] Shoulder-only observation khi không thấy hông.
- [x] Hybrid torso lean: chúi/ngả người.
- [x] Triệt bilateral shoulder drift do perspective.
- [x] Upper-body temporal state, life motion, diagnostics và metrics.
- [x] **AR4-T01 → AR4-T06 đã được chủ dự án xác nhận hoàn thành ngày 16/09/2026.**

### 3.6. Tay, cổ tay và bàn tay đã có nền code

- [x] Parent-local/rest-relative arm frame.
- [x] Anatomical arm-frame Phase 3A.
- [x] Arm temporal state và partial-arm loss/recovery.
- [x] Elbow candidate scan và face/body collision evidence hiện có.
- [x] Pose wrist evidence.
- [x] Hand wrist reconstruction khi Pose wrist không đủ.
- [x] Pose ↔ Hand reacquire blending.
- [x] Wrist reconstruction có shoulder scale, bone sphere và depth prior.
- [x] Hand/forearm twist baseline đã được nghiệm thu và bật mặc định.
- [x] Palm basis, twist confidence, stabilization và temporal processing.
- [x] Finger rig và rest palm normal.
- [x] Gesture classifier/preset cho `open`, `fist`, `point`, `thumbsUp`, `thumbsDown`.
- [x] Idle arm pose và tracking-loss handling.

### 3.7. Automated gate hiện có

- [x] 77 frontend test files.
- [x] 777 frontend tests PASS tại lần rà soát 22/09/2026.
- [x] Frontend lint PASS.
- [x] Frontend production build PASS.

> Lưu ý: automated gate xanh không đồng nghĩa toàn bộ P4-T10 đã hoàn thành. P4-T10 còn các manual, multi-model và performance gate ở phần tiếp theo.

---

## 4. Frontend nhân vật — phần chưa hoàn thành

### 4.1. P4-T10 chưa đạt Definition of Done

- [ ] Chạy và lưu bằng chứng webcam gate thống nhất cho toàn bộ renderer.
- [ ] Chạy trên ít nhất 03 VRM có rig/rest orientation khác nhau.
- [ ] Xác minh không NaN/Infinity, không đổi bên tay và không flip/snap nghiêm trọng.
- [ ] Xác minh mất tracking và reacquire phục hồi mượt.
- [ ] Xác minh reload model không dùng profile/state của model cũ.
- [ ] Benchmark 60 giây/model.
- [ ] Đạt tối thiểu 24 FPS trên máy tham chiếu.
- [ ] Tracking-to-render trung bình dưới 100 ms và lưu p95 theo kế hoạch.
- [ ] Freeze/version contract cuối cho `AvatarPosePacket` trước khi tích hợp WebRTC.
- [ ] Đóng Phase 3C/calibration tối thiểu cho bộ 03 VRM dùng trong MVP.

### 4.2. Facial dynamics F4 còn thiếu manual gate

- [ ] Chạy D1–D10 bằng webcam.
- [ ] Kiểm tra nói nhanh, pucker, âm m/b/p và silent-smile.
- [ ] Ghi latency, saturation và neutral recovery.
- [ ] Chỉ đánh dấu F4 DONE sau manual evidence.

### 4.3. AR3 gaze còn thiếu manual unified gate

- [ ] Chạy E1–E12.
- [ ] Kiểm tra gaze head-relative.
- [ ] Kiểm tra applied range và eyelid coupling.
- [ ] Chạy trên ít nhất 03 VRM có capability khác nhau.
- [ ] Lưu video/metric và xác nhận không regression.

### 4.4. AR4 còn verification follow-up

AR4 đã owner-accepted và không còn là blocker, nhưng các việc xác minh sau vẫn chưa có đầy đủ bằng chứng:

- [ ] Chạy full manual matrix đa model.
- [ ] Benchmark 60 giây/model.
- [ ] Kiểm tra lại AR4 khi tích hợp màn hình active call.
- [ ] Xác minh head/torso/shoulder parent transform không bị áp hai lần khi thêm AR5.

### 4.5. Gesture và ngón tay còn thiếu

- [ ] Manual accept directional thumb trên ít nhất 03 VRM.
- [ ] Kiểm tra năm gesture preset trong điều kiện tracking thực tế.
- [ ] Kiểm tra ổn định khi che tay, đổi bên và reacquire.
- [ ] Continuous finger hoàn chỉnh chưa làm; đây không phải điều kiện chặn MVP nếu preset ổn định.

### 4.6. AR5-T01 — Anatomical Arm Constraints chưa hoàn thành

AR5-T01 hiện mới có kế hoạch thiết kế chi tiết; lần triển khai trước gây regression và đã rollback. Những phần cần làm gồm:

- [ ] **AR5-T01-01** — Constraint contract, profile, validator, capability và model-generation lifecycle.
- [ ] **AR5-T01-02** — Pure shoulder cone với elliptical projection.
- [ ] **AR5-T01-03** — Elbow hinge và temporal pole transport.
- [ ] **AR5-T01-04** — Elbow-side hysteresis/state machine theo timestamp.
- [ ] **AR5-T01-05** — Upper-arm twist, unwrap và clamp theo rest basis.
- [ ] **AR5-T01-06** — Tích hợp constraint solver vào arm candidate ranking.
- [ ] **AR5-T01-07** — Diagnostics, metrics, DEV panel và automated regression gate.
- [ ] **AR5-T01-08** — Manual webcam A1–A14 trên ít nhất 03 VRM.
- [ ] Xác nhận không double-apply AR4 parent transform.
- [ ] Xác nhận Hand forearm twist không bị cộng hai lần.
- [ ] Xác nhận candidate preview không mutate runtime state.
- [ ] Xác nhận full-capability path không bị generic total-angle clamp cũ.
- [ ] Chỉ bắt đầu AR5 task tiếp theo sau khi chủ dự án nghiệm thu AR5-T01.

### 4.7. F7 đa model và performance chưa làm

- [ ] Xây ma trận 03–05 VRM.
- [ ] Kiểm tra face loss/reacquire.
- [ ] Kiểm tra arm/wrist/gesture trên từng model.
- [ ] Ghi FPS, tracking-to-render latency, invalid output và model load time.
- [ ] Kiểm tra model cache, abort request cũ và giải phóng GPU khi đổi model.

### 4.8. Các hướng đã deferred, không chặn bản bảo vệ

- [ ] F5 Audio Fusion production — chỉ mở lại nếu telemetry chứng minh webcam bỏ lỡ toàn bộ peak.
- [ ] F6 Conversational Expression Layer đầy đủ.
- [ ] Continuous finger nâng cao.
- [ ] Contact tay–mặt/thân.
- [ ] Hair interaction.
- [ ] Two-hand interaction nâng cao.
- [ ] Tương tác vật thể.
- [ ] Motion prior.
- [ ] Full-body tracking/animation.

---

## 5. Frontend web — phần đã hoàn thành

### 5.1. Hạ tầng frontend

- [x] **P4-T01** — API client, tự gắn access token và refresh khi 401.
- [x] TypeScript types và endpoint wrapper cho auth, users, avatars, conversations, videos và metrics.
- [x] **P4-T02** — Zustand auth store.
- [x] Access token giữ trong memory; refresh token theo contract hiện tại.
- [x] **P4-T03** — Messaging WebSocket client: connect, disconnect, reconnect, typing và PING/PONG.
- [x] **P4-T04** — Design system, CSS variables, light/dark tokens, typography và reduced-motion baseline.
- [x] **P4-T05** — Theme provider `dark/light/system`, đồng bộ setting với backend.

### 5.2. Màn hình và luồng đã có

- [x] Splash screen và restore session.
- [x] Welcome screen.
- [x] Onboarding ba slide, swipe, dots và skip.
- [x] Login gọi auth store thật.
- [x] Register gọi backend thật, validation và xử lý email conflict.
- [x] Password strength indicator.
- [x] Màn hình chọn avatar model.
- [x] Loading, error và retry cho avatar catalog.
- [x] Điều hướng từ register tới `/avatar/setup`.
- [x] DEV routes được lazy-load trong môi trường development.

---

## 6. Frontend web — phần chưa hoàn thành

### 6.1. Điều hướng và bảo vệ route

- [ ] Route guard hoàn chỉnh cho các route yêu cầu đăng nhập.
- [ ] Xử lý session hết hạn xuyên suốt các màn hình.
- [ ] Điều hướng người dùng đã có avatar và chưa có avatar.
- [ ] Offline/no-connection handling dùng chung.
- [ ] Trang 404/thất bại phù hợp thay vì luôn redirect về splash.

### 6.2. P4-T11 — Tùy chỉnh và preview avatar

- [ ] SCR-08 tùy chỉnh tóc, mắt, outfit và màu.
- [ ] Giữ `model_id` đã chọn khi chuyển route/reload.
- [ ] Preview realtime các customization.
- [ ] SCR-09 webcam + avatar preview live.
- [ ] Loading/error/retry và permission-denied state cho camera.
- [ ] Gọi `PUT /avatars/me` để lưu avatar.
- [ ] Resume/edit flow khi người dùng đã có avatar.
- [ ] Điều hướng thành công sang Home.

Hiện `/avatar/customize` vẫn là `TaskPlaceholder`.

### 6.3. P4-T12 — Home/danh sách hội thoại

- [ ] Gọi `GET /conversations`.
- [ ] Cursor pagination.
- [ ] Hiển thị last message và thời gian.
- [ ] Empty state và generic mask khi chưa có avatar.
- [ ] Swipe action “Ẩn”.
- [ ] Không hiển thị online/offline sai khi chưa có Presence Service.

Hiện `/home` vẫn là `TaskPlaceholder`.

### 6.4. P4-T13 — Tìm người dùng

- [ ] Search input auto-focus.
- [ ] Gọi `POST /users/search`.
- [ ] Giữ thông báo anti-enumeration giống nhau cho không tồn tại/chưa discoverable.
- [ ] Countdown khi backend trả 429.
- [ ] Lưu local history tối đa năm email.
- [ ] Tạo/mở conversation từ kết quả tìm kiếm.

### 6.5. P4-T14 — Chat realtime

- [ ] Message list và bubble component.
- [ ] Tải lịch sử cũ khi scroll lên bằng cursor.
- [ ] Gửi message idempotent.
- [ ] Nhận `NEW_MESSAGE` qua Messaging WebSocket.
- [ ] Cập nhật `sent/delivered/read`.
- [ ] Typing indicator và `TYPING_STOP`.
- [ ] Reconnect/offline banner.
- [ ] Chống message trùng hoặc mất khi REST và WebSocket cùng trả kết quả.

### 6.6. P4-T15 → P4-T19 — Gọi 1-1

- [ ] `RTCPeerConnection` client.
- [ ] Chỉ truyền audio track; không truyền webcam video track.
- [ ] DataChannel chỉ truyền `AvatarPosePacket`, không truyền raw landmarks.
- [ ] ICE candidate exchange.
- [ ] Signaling WebSocket client vòng đời ngắn.
- [ ] `CALL_OFFER`, `CALL_ANSWER`, `ICE_CANDIDATE`, `CALL_REJECT`, `CALL_END`.
- [ ] SCR-13 màn gọi đi và timeout 30 giây.
- [ ] SCR-15 màn nhận cuộc gọi.
- [ ] Xử lý busy khi đang có cuộc gọi khác.
- [ ] SCR-14 màn đang gọi với remote avatar và self PiP.
- [ ] Mic toggle, Tracking toggle, End call, Chat và More.
- [ ] Reconnecting overlay.
- [ ] Jitter buffer và timestamp alignment cho pose/lip-sync.
- [ ] STUN/TURN và kiểm tra hai thiết bị/khác NAT.

### 6.7. P4-T20 → P4-T22 — Quay và quản lý video

- [ ] Capture WebGL canvas bằng `MediaRecorder`; không quay webcam thật.
- [ ] Upload từng chunk qua presigned URL.
- [ ] Retry chunk và giữ ETag.
- [ ] Finalize/abort upload.
- [ ] Resume recording/upload sau gián đoạn nếu còn trong phạm vi cuối kỳ.
- [ ] SCR-16 thư viện video và storage indicator.
- [ ] Quota full/near-full UI.
- [ ] SCR-17 video player.
- [ ] Rename và delete video.
- [ ] Failed/processing/ready states.

### 6.8. P4-T23 → P4-T24 — Profile, settings và lỗi

- [ ] Hiển thị avatar và hồ sơ người dùng.
- [ ] Sửa display name.
- [ ] Toggle “Cho phép tìm qua email”.
- [ ] Theme setting trong màn Settings.
- [ ] Logout.
- [ ] Xóa tài khoản bằng mật khẩu xác nhận.
- [ ] No-connection/error screen và retry.

### 6.9. Frontend quality và tối ưu còn thiếu

- [ ] E2E toàn luồng bằng hai tài khoản/hai trình duyệt hoặc thiết bị.
- [ ] TC-46 → TC-58 cho realtime, call và record flow.
- [ ] Accessibility review cho form, focus, keyboard và screen reader.
- [ ] Lazy-load các route sản phẩm.
- [ ] Tối ưu các ảnh PNG/JPG lớn sang WebP/AVIF.
- [ ] Tách DEV harness khỏi production loading path.
- [ ] Cache-control cho asset/model.
- [ ] Đo cold/warm load, FPS và memory/VRAM.

---

## 7. Thứ tự nhiệm vụ tiếp theo đề xuất

Thứ tự này bám theo kế hoạch 03 tháng và dependency hiện tại:

1. **M0 Backend test stack:** làm toàn bộ backend test chạy xanh, tái lập bằng một lệnh.
2. **Khóa P4-T10-MVP:** đóng F4/AR3 manual gate, F7 đa model và AR5-T01 theo từng lát cắt.
3. **P4-T11:** hoàn thành customize → preview → `PUT /avatars/me` → Home.
4. **P4-T12 → P4-T14:** Home, search và chat realtime.
5. **P4-T15 → P4-T19:** WebRTC và toàn bộ call flow.
6. **P4-T20 → P4-T24:** record, video library và settings.
7. **P5:** chạy TC-01 → TC-58, lập defect log và đóng Critical/High.
8. **Load/performance:** baseline, tối ưu, hai backend instance, soak và báo cáo before/after.

Nguyên tắc khóa phạm vi: không mở contact, hair, full-body hoặc feature avatar nghiên cứu mới trước khi P4-T11 → P4-T24 hoàn thành.

---

## 8. Tài liệu nguồn đã đối chiếu

- `README.md`
- `docs/00_PROJECT_CONTEXT.md`
- `docs/01_PRODUCT_REQUIREMENTS.md`
- `docs/02_SYSTEM_ARCHITECTURE.md`
- `docs/04_API.md`
- `docs/05_UI_UX.md`
- `docs/06_CODEBASE_GUIDE.md`
- `docs/07_DEVELOPMENT_AND_TESTING.md`
- `docs/09_ROADMAP_AND_TASKS.md`
- `docs/10_PERFORMANCE.md`
- `docs/11_AVATAR_EVOLUTION_ROADMAP.md`
- `docs/KE_HOACH_03_THANG_DO_AN_VEILTALK.docx`
- `docs/P4_T10_PHASE1_DIAGNOSTICS_REPORT.md`
- `docs/P4_T10_PHASE2_ACCEPTANCE_REPORT.md`
- `docs/P4_T10_PHASE3A_ACCEPTANCE_REPORT.md`
- `docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md`
- `docs/P4_T10_PHASE3B_PARTIAL_ARM_ACCEPTANCE_REPORT.md`
- `docs/P4_T10_PHASE3B3_HAND_GESTURE_PLAN.md`
- `docs/P4_T10_PHASE3B4_WRIST_RECONSTRUCTION_STATUS_AND_ACCEPTANCE.md`
- `docs/AR3_EYE_GAZE_ATTENTION_IMPLEMENTATION_PLAN.md`
- `docs/AR4_HEAD_NECK_TORSO_SHOULDER_IMPLEMENTATION_PLAN.md`
- `docs/AR4_T03_VERTICAL_SHRUG_EXTENSION_PLAN.md`
- `docs/AR4_T06_HYBRID_TORSO_LEAN_PLAN.md`
- `docs/AR5_T01_ANATOMICAL_ARM_CONSTRAINTS_PLAN.md`
- `docs/F4_EXPRESSION_DYNAMICS_MIXER_MATH_PLAN.md`
- `docs/F5_AUDIO_WEBCAM_FUSION_MATH_PLAN.md`
- `docs/F6_CONVERSATIONAL_EXPRESSION_LAYER_MATH_PLAN.md`

