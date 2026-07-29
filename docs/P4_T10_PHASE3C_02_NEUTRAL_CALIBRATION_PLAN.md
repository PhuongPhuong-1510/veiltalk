# P4-T10 Phase 3C-02 — Neutral Face Calibration

## Trạng thái

**COMPLETE — AUTOMATED GATE PASS; MANUAL WEBCAM GATE ACCEPTED BY USER 2026-07-30.**

3C-02 chỉ xây baseline, noise floor và normalization; chưa tuning semantic gain hay temporal policy.

## Contract

- Profile v1 chỉ chứa số (`baseline`, `noiseFloor`, `activationThreshold`, `quality`) và chỉ ở memory.
- State machine `idle → collecting → ready|failed`; start/cancel/reset có chủ đích.
- Trước `ready` hoặc sau `failed`, output passthrough raw; recalibration vô hiệu profile cũ ngay.
- Mục tiêu 36 sample; tối thiểu 24; ít nhất 1.000 ms; target 1.500 ms; timeout 4.000 ms;
  accepted ratio ≥60%; neutral streak ≥8.
- Reject duplicate timestamp, NaN/Infinity, thiếu core blendshape, facial transform lỗi, head motion
  >35°/s và các mouth/eye/brow signal vượt bootstrap threshold.
- `baseline = median`; `noiseFloor = clamp(3 × MAD, 0.01, 0.15)`; unsigned output normalize về `[0,1]`.
- Eye look/signed direction giữ raw trong 3C-02; center dành cho 3C-05.
- Processor reset/dispose, timestamp regression và Face loss >750 ms reset; short loss/model change không reset.
- Không mutate raw frame; không landmark/facial transform trong export hoặc packet.

## Diagnostics và gate

DEV harness có countdown, start/cancel/reset, state, accepted/rejected/ratio/streak, rejection counters,
profile, calibrated values và JSON export local-only.

Automated gate: 39 test files, 401/401 PASS; lint và production build PASS.

Manual gate gồm neutral 10 giây; cười/hé miệng trong calibration; blink; thiếu sample; recalibration;
short/long loss; hai điều kiện ánh sáng và privacy inspection. Người dùng xác nhận đạt ngày 2026-07-30.
