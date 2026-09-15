# F5-0B — HeadAudio candidate qualification plan

Trạng thái: **DEFERRED BY OWNER 2026-09-14 — giữ tài liệu candidate, chưa qualification hoặc integration**  
Ngày: 2026-09-11

## 1. Quyết định candidate

Candidate tiếp theo là `met4citizen/HeadAudio` với `model-en-mixed.bin`:

- 14,352 bytes; SHA-256 `0358f68989b5861f9b7d18871b010fa6cbf88a53bda4954a954d8c548bbcf251`;
- MIT; upstream commit được audit: `d3af5f9ff86ab6b2b1913d411a4e1922ec101953`;
- 16 kHz mono, cửa sổ 512 sample, hop 256 sample, 12 MFCC;
- Gaussian prototypes + Mahalanobis classifier;
- xuất trực tiếp 15 Oculus viseme: `aa/E/I/O/U/PP/SS/TH/DD/FF/kk/nn/RR/CH/sil`;
- artifact đã tải vào `frontend/dev-assets/audio/candidates/headaudio-en-mixed/`, bị `.gitignore` và chưa vào
  production bundle.

Nguồn: https://github.com/met4citizen/HeadAudio

Đây chỉ là candidate. Upstream tự công bố model huấn luyện bằng bốn giọng TTS tiếng Anh và cảnh báo độ chính xác/VAD
chưa tối ưu, nhất là khi SNR thấp. Vì vậy không được chọn production trước khi qua fixture giọng Việt thật.

## 2. Thay đổi so với kế hoạch ONNX ban đầu

HeadAudio không phải ONNX phone recognizer. Nó là model prototype nhỏ, ánh xạ trực tiếp acoustic feature sang viseme.
Do đó qualification harness phải hỗ trợ hai loại provider:

- `onnx-phone`: Uni2005 cũ, giữ lại chỉ làm bằng chứng candidate đã FAIL;
- `gaussian-viseme`: HeadAudio, candidate F5-0B.

Không thêm npm dependency mới. Không dùng upstream nguyên trạng trong production: upstream chạy cả DSP/classifier trên
`AudioWorklet`, trái boundary đã chốt của VeilTalk. Bản VeilTalk chỉ để AudioWorklet thu/batch PCM tối thiểu và chuyển
thẳng bằng `MessagePort`; resample, MFCC, classifier và scoring phải chạy trong dedicated Worker.

## 3. Trình tự code

1. Tổng quát hóa qualification descriptor/gate theo `providerKind`; không hardcode Uni2005 trong React.
2. Viết parser thuần cho model binary, kiểm tra magic/record length/finite values, inventory 15 viseme, size và checksum.
3. Port phần DSP/classifier tối thiểu có attribution MIT vào Worker; không copy UI/easing/training code không cần thiết.
4. Tạo DEV-only microphone lifecycle: xin quyền rõ ràng, không upload/lưu PCM, stop/dispose đầy đủ.
5. Chuyển khoảng cách prototype thành semantic score có tổng bằng 1; temperature/margin phải hiển thị ở diagnostics,
   không gọi là probability đã hiệu chuẩn nếu chưa có calibration dataset.
6. Thêm timeline DEV cho `sil`, năm nguyên âm và `PP`; chưa nối vào F3/F4/avatar trong F5-0B.
7. Đo cùng renderer/tracking LIVE; sau đó chạy fixture tiếng Việt và mới quyết định candidate.

## 4. Gate bắt buộc

### Correctness/privacy

- artifact/record contract/checksum PASS; không NaN/Infinity;
- PCM chỉ tồn tại trong browser memory, không log/upload/persist;
- stop/restart không còn microphone track, AudioContext, Worker hoặc timer rò rỉ;
- silence không tạo khẩu hình nói liên tục.

### Performance

- DSP + classifier Worker p95 ≤ 10 ms cho mỗi hop 16 ms;
- audio-frame → semantic-viseme p95 < 80 ms;
- tracking→render < 100 ms và renderer/tracking/pipeline ≥24 FPS trong phép đo chuẩn;
- không chọn cấu hình chỉ vì classifier nhanh nếu toàn ứng dụng tụt FPS.

### Vietnamese fixture

Chạy tối thiểu ba lượt mỗi câu, giọng tự nhiên và không cố làm khẩu hình quá mức:

1. `a a a — i i i — u u u — e e e — o o o`;
2. `ba mẹ bảo bé bập bẹ`;
3. `một bông hoa màu tím`;
4. `uống nước rồi đi ngủ`;
5. im lặng, tiếng quạt/phím và nói nhỏ.

Gate chất lượng: năm nguyên âm phải tạo nhóm khác nhau ổn định; `m/b/p` phải có pulse `PP`; silence/noise không được
chatter; chuyển viseme không đảo loạn. Vì model nguồn chỉ học tiếng Anh, đây là hard gate, không phải bước tinh chỉnh UI.

## 5. Quyết định sau qualification

- PASS toàn bộ: pin model/attribution và mới sang F5-1/F5-3 production integration.
- PASS hiệu năng nhưng FAIL tiếng Việt: loại model; không vá mapper để che nhận diện sai.
- Không candidate nào PASS: F5 chỉ làm VAD + timing và ghi **PARTIAL**, hoặc mở task riêng để huấn luyện
  Vietnamese audio→viseme model nhỏ.
