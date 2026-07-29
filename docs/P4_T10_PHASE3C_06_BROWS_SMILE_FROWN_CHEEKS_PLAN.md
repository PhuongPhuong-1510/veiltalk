# P4-T10 Phase 3C-06 — Brows, Smile, Frown & Cheeks

## Trạng thái

**COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL GATE ACCEPTED 2026-07-30.**

## Contract

- Giữ độc lập `browDownLeft/Right`, `browOuterUpLeft/Right`, `mouthFrownLeft/Right` và
  `mouthSmileLeft/Right`; không cân bằng hoặc tổng hợp hai phía trong motion processor.
- `browInnerUp` là semantic giữa; brow và mouth-frown không kích hoạt chéo nhau.
- `happy` tiếp tục thuộc mouth composition của 3C-04; 3C-06 không tạo thêm một owner `happy`.
  Thứ tự fallback theo capability là semantic chi tiết → alias morph chi tiết VRoid `Fcl_BRW_*` /
  `Fcl_MTH_*` → preset VRM `angry/surprised/sad`; target chi tiết luôn thắng preset toàn mặt.
  Raw morph mày `Fcl_BRW_*` có binding gain 1.6 và output cap 1.6 để bù morph gốc quá nhẹ;
  input semantic vẫn `[0,1]`. Overdrive không áp lên VRM preset hoặc expression khác.
- `cheekPuff` có dead-zone, hysteresis và attack/release riêng. Bằng chứng nói chỉ triệt tín hiệu
  phồng má yếu; phồng má mạnh được quyền vượt suppression.
- Model thiếu cheek target phải báo `unsupported`; không scale đầu, mặt hoặc xương để giả lập.
- Raw landmark/ảnh webcam vẫn local-only; packet chỉ chứa semantic scalar đã xử lý.

## Automated gate

- Unit: bất đối xứng brow/frown; không cross-coupling; cheek dead-zone/hysteresis;
  speech suppression/strong bypass; invalid input; reset.
- Integration: motion packet giữ trái/phải, cheek được processor sở hữu và không làm đổi `happy`.
- Renderer: detailed target thắng fallback, shared `happy` chỉ có một owner, unsupported traceable.
- Chỉ chạy targeted tests liên quan, lint và production build; không chạy full suite.

Kết quả 2026-07-30: 6 targeted files, 91/91 PASS; lint PASS; production build PASS.

## Manual webcam gate

Neutral; brow down trái/phải/hai bên; inner-up; outer-up trái/phải; smile nhẹ/lớn; frown trái/phải;
frown không kéo brow; brow không kéo frown; cheek puff nhẹ/rõ; nói bình thường không tự puff;
bất đối xứng; loss/reload reset; capability/probe trên model supported và unsupported.
