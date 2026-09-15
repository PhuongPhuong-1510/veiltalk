# F5-0 — Audio model qualification report

Trạng thái: **F5 DEFERRED BY OWNER 2026-09-14 — Uni2005 INT8 đã bị loại khỏi mặc định; giữ báo cáo và harness làm bằng chứng R&D, chưa tìm candidate khác**  
Ngày: 2026-09-11

## 1. Phạm vi đã triển khai

F5-0 chưa mở microphone, chưa xử lý PCM thật và chưa nối audio vào facial pipeline. Mốc này chỉ:

- pin `onnxruntime-web@1.29.0` (MIT);
- định nghĩa provider/model descriptor và gate thuần có unit test;
- chạy ORT trong dedicated qualification Worker;
- cho người kiểm thử chọn `.onnx` và `vocab.json` từ máy cục bộ;
- benchmark WASM 1/2/auto hoặc WebGPU trong `/dev/avatar-renderer` khi renderer/tracking vẫn hoạt động;
- kiểm tra SHA-256, byte size, graph metadata, runtime output shape và inference timing;
- giữ model candidate ngoài production bundle và không tải model từ CDN lúc runtime.

DEV server bật COOP/COEP để `crossOriginIsolated` và WASM multi-thread có thể được đo thật. Production header và
runtime audio vẫn chưa thay đổi trong F5-0.

## 2. Candidate đã audit sơ bộ

| Thuộc tính | Giá trị đo/đọc được |
|---|---|
| Candidate | `KitsuMate/uni2005-onnx` — `onnx/model_quantized.onnx` |
| Kích thước | 11,225,320 bytes |
| SHA-256 | `b078a37029c2b9e074b0efe699b751d80fc70b325c1648295f290a239399b8af` |
| Input thật từ graph | `mfcc`, float32, `[batch,time,120]` |
| Output thật từ graph | `logits`, float32, `[batch,time,230]` |
| Probe | `[1,32,120]` → `[1,32,230]` |
| Published preprocessing | mono 8 kHz; 25 ms window; 10 ms hop; 40 MFCC + CMVN; context ba frame; factor-3 subsample |
| License công bố | GPL-3.0 — bắt buộc review nghĩa vụ redistribution/source trước production |
| Trạng thái chọn model | **CHƯA CHỌN — research/qualification candidate only** |
| Local DEV path | `frontend/dev-assets/audio/candidates/uni2005-int8/` — bị `.gitignore`, không vào bundle/commit |

Nguồn model card: https://huggingface.co/KitsuMate/uni2005-onnx

## 3. Preliminary Node/WASM smoke benchmark

Điều kiện: Windows 11 Home `10.0.26200`, AMD Ryzen 7 5800H (8 core/16 logical), RAM 17,024,741,376 bytes,
Node `v24.18.0`, ORT Web `1.29.0`, input zero `[1,32,120]`, 3 warmup + 60 measured. Mỗi cấu hình chạy process
riêng để không tái sử dụng WASM environment.

| WASM threads | Load | Avg | p50 | p95 | Max | Gate p95 ≤25 ms |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 431.90 ms | 45.51 ms | 44.42 ms | 48.55 ms | 63.06 ms | FAIL |
| 2 | 469.06 ms | 26.16 ms | 25.67 ms | 28.14 ms | 35.42 ms | FAIL |
| auto | 455.33 ms | 17.92 ms | 17.29 ms | 22.30 ms | 25.26 ms | Preliminary PASS |

Các số trên chỉ chứng minh ORT/model chạy được. Node không đại diện browser Worker, không tranh CPU/GPU với
MediaPipe/Three.js và không chứng minh ≥24 FPS; vì vậy không được dùng để chọn `auto` cho production.

## 4. Automated evidence

- 6 test F5-0 PASS: vocab ordering/gap/duplicate, descriptor/graph contract, label width, timing percentile,
  automatic-vs-manual gates, changed artifact/shape/latency rejection.
- Full frontend regression: 58 files / 667 tests PASS.
- TypeScript + Vite production build PASS; production output không chứa ORT chunk/WASM vì F5-0 UI là DEV-only.
- Lint PASS.
- Vite DEV transform trả HTTP 200 cho panel/controller/Worker và optimize được `onnxruntime-web` + WebGPU entry.

`npm audit --omit=dev` hiện vẫn báo advisory High ở `react-router-dom@7.18.1`/`react-router@7.18.1`. Đường dependency
này không thuộc ORT và đã có trước F5-0; không tự nâng package ngoài phạm vi F5. Cần xử lý ở task dependency/security
riêng rồi chạy regression routing.

## 5. Browser qualification — chạy thật cùng renderer/tracking

Chủ dự án chạy ngày 2026-09-11 trên Chrome, không Frozen, `crossOriginIsolated=yes`, với cùng artifact/checksum
ở mục 2. Mỗi cấu hình gồm 3 warmup và ít nhất 5 giây đo. Số FPS là `renderer / tracking / pipeline`.

| Backend | Load | Runs | Avg | p50 | p95 | Max | FPS trước → sau | Kết quả |
|---|---:|---:|---:|---:|---:|---:|---|---|
| WASM 1 thread | 899.0 ms | 110 | 45.84 ms | 44.92 ms | 49.59 ms | 61.28 ms | `116.3/17.0/17.4 → 34.4/17.4/17.5` | FAIL |
| WASM 2 threads | 492.3 ms | 174 | 28.76 ms | 26.81 ms | 38.20 ms | 49.23 ms | `57.8/22.2/22.3 → 40.1/16.4/16.5` | FAIL |
| WASM auto | 963.6 ms | 215 | 23.27 ms | 22.82 ms | 29.17 ms | 33.00 ms | `55.2/19.5/19.6 → 34.4/17.1/17.2` | FAIL |
| WebGPU | 1150.8 ms | 60 | 98.84 ms | 95.64 ms | 123.73 ms | 136.28 ms | `50.4/20.6/20.7 → 24.5/15.9/16.0` | FAIL |

Tất cả backend đều vượt ngân sách inference p95 25 ms và không giữ được cả renderer/tracking/pipeline ở tối thiểu
24 FPS. `WASM auto` là cấu hình gần nhất nhưng vẫn trượt p95 4.17 ms, trong khi chưa tính MFCC, audio capture,
jitter buffer, phone→viseme và fusion. WebGPU chậm nhất nên không phải hướng tối ưu cho artifact này trên thiết bị đo.

Tracking/pipeline nền trước benchmark trong bốn lần đo cũng chỉ khoảng 17.0–22.3 FPS, thấp hơn gate 24 FPS; đây là
vấn đề hiệu năng nền cần đo riêng theo protocol F7/P6 và không làm thay đổi kết luận, vì Uni2005 đã trượt gate inference
độc lập ở cả bốn cấu hình.

## 6. Quyết định

- **Không chọn Uni2005 INT8 làm provider F5 production trên cấu hình hiện tại.**
- Không cần tiếp tục gate GPL redistribution hoặc Vietnamese fixture cho candidate đã bị loại bởi hard performance gate.
- Không nối artifact này vào microphone, MFCC hay facial pipeline và không dùng việc nới ngưỡng để biến FAIL thành PASS.
- F5-0 vẫn mở ở cấp task: bước tiếp theo là tìm/benchmark candidate nhẹ hơn hoặc thiết kế audio evidence nhẹ hơn;
  chỉ bắt đầu F5-1 sau khi một phương án đạt browser performance, license và Vietnamese mapping gate.

## 7. Candidate tiếp theo

Đã audit sơ bộ và tải local `met4citizen/HeadAudio` `model-en-mixed.bin`: 14,352 bytes, SHA-256
`0358f68989b5861f9b7d18871b010fa6cbf88a53bda4954a954d8c548bbcf251`, MIT, 15 Oculus viseme. Candidate này
không phải ONNX và upstream chạy MFCC/classifier trong AudioWorklet, nên VeilTalk phải dùng adapter Worker riêng để
giữ realtime-thread boundary. Model nguồn chỉ huấn luyện bằng giọng TTS tiếng Anh; fixture tiếng Việt là hard gate.

Kế hoạch qualification và tiêu chí loại/chọn: `F5_0B_HEADAUDIO_QUALIFICATION_PLAN.md`.
