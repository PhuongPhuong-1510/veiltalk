# P4-T10 Phase 3C-05 — Eyes & Gaze

## Trạng thái

**COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL GATE ACCEPTED 2026-07-30.**

## Contract

- `EyeExpressionProcessor` sở hữu blink, squint và wide theo từng bên sau mouth composition, trước
  expression filter/packet. Blink có attack/release, hysteresis và minimum hold để giữ pulse ngắn.
- Blink thắng wide; squint lấy max có trọng số từ eye/cheek squint, smile chỉ bổ sung khi đủ mạnh.
- `GazeProcessor` đổi các cặp `eyeLook*` thành yaw/pitch normalized có dead zone, clamp và smoothing.
- `AvatarPosePacketV1.gaze` chỉ chứa hai số normalized; không chứa landmark hay ảnh.
- Renderer chọn đúng một owner: VRM LookAt (bone hoặc expression) → direct eye morph → eye bones →
  unsupported. Không bật automatic LookAt song song custom controller.
- Không hard-code model name/morph index. Model thiếu capability báo rõ và không giả chuyển động.

## Gate

- Automated: blink từng bên/hai bên, pulse ngắn, blink-vs-wide, squint composition, left/right,
  invalid/reset/loss; gaze direction/dead-zone/clamp/smoothing; capability priority/one owner;
  packet privacy và renderer application math.
- Manual trên ba model: blink trái/phải/hai mắt, wide, squint, cười nhẹ/mạnh, gaze bốn hướng,
  neutral stability, loss/recovery và chạy liên tục.

## Evidence

Audit: cả ba model tham chiếu có `leftEye/rightEye` và VRM LookAt kiểu bone. Targeted gate gồm
`eyeExpression`, `gaze`, processor integration, gaze capability, face diagnostics/apply plan,
neutral gaze centering, model loader và renderer math — 9 files, 94/94 PASS; lint và production build PASS. Không chạy full
suite theo yêu cầu người dùng.
