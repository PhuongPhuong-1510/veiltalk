# P4-T10 — Phase 3B: Hand Forearm Twist

> Trạng thái ngày 2026-07-29: **IMPLEMENTED, MANUAL ACCEPTANCE FAILED — IN PROGRESS**.
> Automated gate gần nhất: **380/380 test PASS**, TypeScript, lint và Vite build sạch.
> Không được đánh dấu Phase 3B hoàn thành trước khi webcam gate trái/phải và nhiều avatar cùng PASS.

## 1. Phase 3B làm gì?

Phase 3B bổ sung **pronation/supination** — chuyển động xoay cẳng tay quanh chính trục
vai–khuỷu–cổ tay — bằng Hand landmarks. Pose vẫn quyết định toàn bộ swing của upperArm và
lowerArm; Hand chỉ cung cấp axial twist correction cho `leftLowerArm` hoặc `rightLowerArm`.

Phép ghép bắt buộc:

```text
outputLowerDelta = poseLowerDelta * handTwistDelta
```

Trục twist là:

```text
rigProfile.joints[lowerArm].anatomicalRestBasis.primaryLocal
```

Phase này không thay toàn bộ lower-arm quaternion bằng Hand orientation và không ghi trực tiếp
rotation vào hand/finger bones.

## 2. Phạm vi đã triển khai

Pipeline hiện có:

```text
Pose arm swing + Pose temporal output
→ Hand sample classification
→ Hand–Pose matching theo từng side
→ palm basis từ world landmarks
→ đổi raw Hand frame (x,y,z) sang motion frame (x,-y,-z)
→ chirality normalization
→ forearm twist geometry
→ confidence/trust
→ unwrap quanh ±π
→ neutral-relative correction
→ dead zone
→ target filter
→ clamp
→ twist temporal hold/fade/reacquire
→ poseLowerDelta * handTwistDelta
→ jointRotations[lowerArm]
```

Các contract đã có trong code và automated test:

- Runtime flag `handTwistEnabled`, mặc định `false`, có setter và checkbox DEV.
- State Hand twist độc lập left/right, không trộn với Pose `ArmTemporalState`.
- Chỉ lowerArm tương ứng được sửa; upperArm, elbow, pole và Pose swing giữ nguyên.
- Invalid Hand, influence bằng 0, flag off hoặc profile/geometry không hợp lệ trả đúng Pose quaternion.
- Duplicate Hand timestamp không trở thành observation mới; temporal vẫn tiến theo `dt`.
- Reset/dispose/rig generation/tracking discontinuity/long loss không được rò twist cũ.
- Renderer tiếp tục nhận rest-relative parent-local delta và áp `restLocal × deltaLocal`.

## 3. Những gì chưa thuộc Phase 3B

- Wrist flexion/extension và radial/ulnar deviation tại bone `hand`.
- Finger pose, nắm đấm và finger bones.
- Phân phối twist giữa lowerArm/hand; rig profile chưa có hand anatomical rest basis.
- Torso/chest animation, collision, hand–body contact hoặc arm–arm collision.
- Face-occlusion recovery. Lỗi đầu/mặt quay hoặc biến dạng khi tay che mặt là task Face tracking riêng.
- Truyền packet qua WebRTC; việc này thuộc P4-T15.

## 4. Bản đồ code Phase 3B

| Nhóm | File | Trách nhiệm |
|---|---|---|
| Orchestration | `frontend/src/lib/avatar-motion/avatarMotionProcessor.ts` | Phân loại sample, gọi matching/palm/twist, quản lý state/temporal và chỉ ghi lowerArm |
| Contract/diagnostic | `avatarPoseTypes.ts`, `avatarMotionDiagnostics.ts`, `handMotionDiagnostics.ts` | Packet public không chứa raw landmarks; snapshot Hand/Pose chỉ dùng DEV |
| Matching | `handPoseMatching.ts` | Ghép candidate Hand với wrist Pose theo side và continuity |
| Palm geometry | `handPalmBasis.ts` | Dựng `across`, `forward`, `normal` từ image/world landmarks |
| Coordinate/rig boundary | `handTwistRig.ts`, `coordinateAdapter.ts` | Đổi motion frame, chirality convention và ghép quaternion vào Pose lowerArm |
| Twist solver | `handForearmTwist.ts` | Chiếu palm direction lên mặt phẳng vuông góc forearm và đo signed angle |
| Trust | `handTwistConfidence.ts` | Gating matching, palm geometry, projection, age và handedness |
| Stabilization | `handTwistStabilization.ts` | Unwrap, neutral, dead zone, filter và clamp |
| Temporal | `handTwistTemporal.ts` | Acquire/track/hold/fade/reset theo thời gian |
| Analysis | `handCalibrationAnalysis.ts`, `handTwistRootCauseValidation.test.ts` | Calibration snapshot và synthetic/rig-only evidence |
| Rig source | `normalizedRigProfile.ts`, `avatar-renderer/modelLoader.ts` | Cung cấp model-generation và anatomical rest basis của lowerArm |
| DEV UI | `components/dev/AvatarRendererDevHarness.tsx` | Checkbox, freeze/replay, calibration và diagnostic snapshot |

Mỗi module trên có file `*.test.ts` tương ứng khi tồn tại logic thuần; integration chính nằm trong
`avatarMotionProcessor.test.ts`.

## 5. Trạng thái nghiệm thu thật

### Đã đạt bằng automated test

- Pose-only equality khi flag off hoặc fallback.
- Thứ tự `poseLowerDelta * handTwistDelta`.
- Pure twist giữ lowerArm primary direction, elbow và wrist position.
- Left/right state độc lập; right-only và both-hands có output assertions.
- Synthetic neutral, ±45°, ±179°/−179°, projection-degenerate và không double-negate.
- Duplicate/unsampled/missing, hold/fade/reacquire, reset/dispose/rig change và finite quaternion.

### Chưa đạt bằng webcam

- Webcam mới nhất cho thấy chiều xoay cẳng tay phải vẫn ngược với động tác thật.
- Thử tách `rigApplicationSign` và đặt right `-1` vẫn không làm manual gate PASS.
- Vì vậy không được ghi rằng convention/dấu tay phải đã được xác nhận; đây vẫn là lỗi mở.
- Chưa có bộ snapshot đồng nhất `neutral → palm-up → neutral → palm-down` cho cả hai tay trên cả ba
  model local.

## 6. Công việc tiếp theo của Phase 3B

1. **Đóng băng baseline trước khi sửa tiếp**
   - Giữ một model, một side, Filter/Constraints/Smoothing cố định.
   - Reload model, đưa tay khỏi camera để epoch/state cũ không ảnh hưởng lần đo.
2. **Thu bằng chứng ba tư thế**
   - Chụp diagnostic neutral, palm-up và palm-down cho right; lặp lại cho left.
   - Đối chiếu từ raw palm basis đến `appliedTwistRadians` và world orientation thật sau renderer.
3. **Xác định tầng đảo dấu duy nhất**
   - Palm basis/chirality, signed-angle, local anatomical axis, quaternion composition hoặc
     normalized humanoid inheritance.
   - Không đảo dấu ở nhiều tầng và không tune smoothing/clamp để che lỗi convention.
4. **Kiểm chứng theo model**
   - Chạy cùng procedure trên `reference-avatar.vrm`, `reference-avatar-1.vrm` và
     `reference-avatar-2.vrm`.
   - Nếu dấu phụ thuộc rig, phải biểu diễn bằng dữ liệu/profile đã đo; không hard-code theo tên model.
5. **Viết RED regression từ nguyên nhân gốc**, sửa production tối thiểu, rồi chạy lại toàn bộ gate.

## 7. Acceptance gate Phase 3B

Phase 3B chỉ hoàn thành khi tất cả điều kiện sau cùng đúng:

- Right và left: neutral gần 0; palm-up/palm-down tạo chuyển động avatar đúng chiều và trái dấu nhau.
- Biên độ 45–60° không bị dead zone/filter/clamp triệt tiêu hoặc khuếch đại bất thường.
- Không flip 180°, drift, NaN/Infinity, neutral pumping hoặc double-negate.
- Chỉ lowerArm thay đổi; Pose swing, upperArm, elbow, pole và wrist position không đổi do pure twist.
- Flag off và mọi fallback giống Pose-only tuyệt đối.
- Ít nhất ba avatar local qua cùng manual matrix hoặc có rejection rõ ràng nếu profile không đủ.
- Full test, TypeScript, lint và Vite build sạch.
- Evidence webcam và kết luận được cập nhật vào tài liệu này trước khi đổi trạng thái thành COMPLETE.

## 8. Quan hệ với phase kế tiếp

Phase 3C chỉ bắt đầu sau Phase 3B hoặc bằng quyết định tách task rõ ràng. Phase 3C dự kiến mở rộng
anatomical calibration/constraint theo rig và, nếu được duyệt, hand-bone orientation. Không dùng
Phase 3C để che một lỗi dấu/convention còn tồn tại trong lowerArm twist của Phase 3B.
