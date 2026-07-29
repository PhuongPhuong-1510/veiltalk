# P4-T10 Phase 3C-07 — Face Tracking Loss & Recovery

## Trạng thái

**COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL GATE ACCEPTED 2026-07-30.**

## Contract

- `tracked` sample mới cập nhật face target; `not-sampled` và duplicate không bơm lại filter.
- Loss ngắn giữ nguyên expressions/gaze hợp lệ cuối trong `holdMs`.
- Loss dài easing toàn bộ expressions/gaze về neutral trong `returnMs`; jaw/vowel/happy về 0
  nên miệng đóng. Sau đó state là idle.
- Reacquire cần hai sample mới liên tiếp rồi blend từ output hiện tại sang target trong `recoveryMs`.
- Long-loss temporal reset phát đúng một lần; reset/dispose/reload xóa cache.
- Không thay đổi arm/hand loss state machine và không thêm dữ liệu raw vào packet.

## Gate

Unit test state/timing, duplicate/not-sampled, exact hold, return/idle, mouth close, confirmation,
recovery blend, one-shot reset và lifecycle. Integration test packet + privacy; targeted tests, lint,
build. Manual: che mặt ngắn/dài, reacquire, lặp loss, reload và xác nhận tay/thân độc lập.

Kết quả 2026-07-30: 9 targeted files, 105/105 PASS; lint PASS; production build PASS.
