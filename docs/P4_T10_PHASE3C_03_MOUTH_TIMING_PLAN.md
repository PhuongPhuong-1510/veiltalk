# P4-T10 Phase 3C-03 — Mouth Timing & Local Audio Activity

## Trạng thái

**COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL WEBCAM/AUDIO GATE ACCEPTED BY USER 2026-07-30.**

## Contract đã khóa

- Calibrated face là nguồn chính; audio envelope chỉ hỗ trợ activity/short hold, không phoneme/viseme.
- `jawOpen` dùng attack 35 ms/release 55 ms; `closeOrPressStrength` là weighted max của close/press/roll.
- Soft suppression liên tục; strong close có enter/exit hysteresis và confirmation, không đóng cứng từ một frame.
- Audio source do caller cung cấp; module không gọi `getUserMedia`. Có null, simulated và Web Audio source.
- Web Audio dùng RMS/noise floor, attack 20 ms/release 80 ms; không lưu/truyền sample.
- Duplicate không tiến hysteresis; timestamp regression/reset/dispose xóa temporal state; loss release jaw.
- Processor sở hữu timing của `jawOpen`, `aa`, `mouthClose`; expression filter/renderer không smooth lần hai.
- Diagnostics chỉ local-only; không vào `AvatarPosePacketV1`.

## Evidence

Targeted gate đã chạy: `mouthTiming.test.ts`, `audioActivity.test.ts`,
`avatarMotionProcessor.test.ts`, `faceExpressionApplyPlan.test.ts`, `avatarRendererMath.test.ts` —
5 files, 71/71 PASS; lint và
production build PASS. Không chạy full suite theo yêu cầu người dùng.

Manual gate gồm neutral/nói nhanh/ngắt âm/mím môi/close spike/loss; simulated audio matrix; latency
<100 ms và matrix ba model. Người dùng xác nhận đạt ngày 2026-07-30.
