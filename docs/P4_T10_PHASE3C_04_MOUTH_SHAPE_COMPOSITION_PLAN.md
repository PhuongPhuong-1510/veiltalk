# P4-T10 Phase 3C-04 — Mouth Shape Composition

## Trạng thái

**COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL GATE ACCEPTED BY USER 2026-07-30.**

## Phạm vi và ownership

- `MouthShapeComposer` chạy sau neutral calibration, semantic mapping và mouth timing; chạy trước
  expression filter và packet.
- Composer sở hữu conflict giữa close/press/roll, pucker/funnel, smile/stretch/dimple và derived
  `happy`. Renderer chỉ chọn target theo capability và áp kết quả, không suy diễn lại.
- Giữ semantic trái/phải độc lập. Chỉ model adapter mới fallback sang preset tổng hợp.
- Không thêm mắt, mày, má, face-loss policy hoặc WebRTC vào task này.

## Conflict contract

1. Close/press/roll giảm jaw và chặn `happy` khi môi khép mạnh.
2. Pucker/funnel và smile/stretch loại trừ mềm theo dominance; nhóm mạnh hơn được giữ, nhóm nhiễu đối
   kháng bị giảm. Không triệt tiêu đồng thời cả hai nhóm khi MediaPipe phát nhiễu chéo.
3. Dimple đi theo từng bên và bị giảm bởi close/press tương ứng.
4. `happy` là fallback thận trọng: chỉ có giá trị khi smile đủ mạnh và có bằng chứng miệng đang mở
   từ jaw hoặc cặp `mouthUpperUp`/`mouthLowerDown`; cười mím phải cho `happy = 0`.
5. Direct `mouthSmileLeft/Right` vẫn giữ được cười khép môi nếu model hỗ trợ. Model chỉ có preset
   `happy` há miệng phải ưu tiên không cười hơn biểu diễn sai.
6. Mọi output finite, clamp `[0,1]`, không mutate input và diagnostics local-only.

## Automated gate

- Unit: pass-through từng shape; close/press suppression; pucker↔stretch conflict; left/right;
  NaN/Infinity; input immutability; reset.
- Regression: cười mím không phát `happy`; cười mở có fallback; processor giữ `jawOpen === aa`;
  mapped/direct target thắng fallback và không double-apply physical target.
- Chỉ chạy các test liên quan, lint và production build theo yêu cầu người dùng.

## Manual gate

Chạy trên ba model tham chiếu: cười mím, cười hở răng, mím mạnh, chu môi, kéo khóe từng bên,
dimple từng bên, há→mím, nói nhanh→cười mím, model thiếu morph và chạy liên tục. Với model chỉ có
`happy` dạng há miệng, cười mím không chuyển động được chấp nhận; há miệng sai không được chấp nhận.

Người dùng xác nhận manual gate PASS ngày 2026-07-30 sau khi kiểm tra lại cười mím, cười hở răng và
chu môi trên model tham chiếu.

## Evidence

Targeted gate: `mouthShapeComposer.test.ts`, `mouthTiming.test.ts`,
`avatarMotionProcessor.test.ts`, `faceExpressionDiagnostics.test.ts`,
`faceExpressionApplyPlan.test.ts`, `avatarRendererMath.test.ts` — 6 files, 85/85 PASS; lint và
production build PASS. Không chạy full suite theo yêu cầu người dùng.
