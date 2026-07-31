# P4-T10 — Phase 3B: Hand Forearm Twist

> Trạng thái ngày 2026-08-01: **HOÀN THÀNH — người thực hiện đã xác nhận nghiệm thu webcam và duyệt bật mặc định**.
> Automated gate gần nhất: **386/386 test PASS**, TypeScript, lint và Vite build sạch.
> Runtime vẫn giữ setter để regression test có thể kiểm tra Pose-only, nhưng production và DEV harness bật Hand Twist mặc định.
>
> ⚠️ **Đã bị thay thế một phần bởi Phase 3E.** Invariant "upper/lower là một chain, cùng
> hold/return" mô tả ở mục 111/124 **không còn đúng**: Phase 3E cho hai đoạn nghiệm thu độc lập
> vì hold lưu parent-local delta nên lower xoay theo upper như khối cứng, không quét ngang mặt.
> Hành vi hiện hành: `docs/P4_T10_PHASE3E_PARTIAL_ARM_ACCEPTANCE_REPORT.md`.

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
→ clamp ±90° quanh neutral
→ twist temporal hold/fade/reacquire
→ poseLowerDelta * handTwistDelta
→ jointRotations[lowerArm]
```

Các contract đã có trong code và automated test:

- Runtime flag `handTwistEnabled`, mặc định `true`, có setter và checkbox DEV mặc định bật.
- DEV harness có lệnh neo neutral riêng tay trái/tay phải/hai tay; frame Hand trusted kế tiếp trở thành zero mà không mở tracking epoch mới.
- State Hand twist độc lập left/right, không trộn với Pose `ArmTemporalState`.
- Chỉ lowerArm tương ứng được sửa; upperArm, elbow, pole và Pose swing giữ nguyên.
- Invalid Hand, influence bằng 0, flag off hoặc profile/geometry không hợp lệ trả đúng Pose quaternion.
- Duplicate Hand timestamp không trở thành observation mới; temporal vẫn tiến theo `dt`.
- Reset/dispose/rig generation/tracking discontinuity/long loss không được rò twist cũ.
- Renderer tiếp tục nhận rest-relative parent-local delta và áp `restLocal × deltaLocal`.
- Confidence chỉ gate observation; observation trusted có target amplitude `1`. Temporal influence chỉ ramp khi acquire và hold/fade khi mất tracking, không co biên độ steady-state theo quality.

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

### Bằng chứng webcam và trạng thái lỗi còn mở

- Ba snapshot tay phải cùng tracking epoch (`palm-facing → edge → back-facing`) cho thấy raw/corrected tăng liên tục nhưng output bị đảo bởi `rigApplicationSign.right=-1`.
- Hai tư thế cuối cùng cùng chạm clamp `+75°`; confidence `0.689→0.813` tiếp tục co output thành `−52°→−61°`, nên tay thật đổi khoảng 75° nhưng avatar chỉ đổi khoảng 9°.
- Neutral của lần đo được neo trước chuỗi tại raw `2.009 rad`, khiến edge bị tính thành khoảng `+95°`; đây là bằng chứng first-trusted auto-neutral không đủ cho manual acceptance.
- Production candidate fix: `rigApplicationSign={left:+1,right:+1}`, clamp đối xứng `±90°`, trusted target amplitude bằng `1`, và API/nút DEV neo neutral chủ động theo từng side.
- Automated regression đã khóa sign semantic hai bên, neutral re-anchor độc lập và full steady-state amplitude. Tuy nhiên đây chưa thay thế webcam acceptance.
- Một lỗi độc lập ở Phase 3A đã được tái tạo qua hai regression: initial pole đối dấu tạo roll 180°, còn pole lệch 90° vẫn lọt qua hemisphere-only fix. Bản sửa hiện tại không cho fresh pole điều khiển axial upperArm; upperArm dùng minimal-twist swing, pole vẫn phục vụ bend/lower frame. Hai regression đã PASS nhưng sau khi re-test, webcam vẫn đôi lúc xuất hiện xoắn tay/vùng vai không tái hiện ổn định. Vì vậy hai lỗi đã khóa chỉ là nguyên nhân đóng góp đã biết; root cause runtime cuối cùng chưa được xác định.
- Chuỗi ảnh mới đã xác định thêm một root cause có thể tái hiện: khi Pose wrist bị che, code cũ cho upperArm nhận nghiệm mới nhưng lowerArm giữ quaternion cũ (`{upper: active, lower: held}`), làm forearm bị kéo quét ngang mặt. Regression hai bên đã khóa invariant mới: upper/lower là một chain, cùng hold/return và chỉ cùng recovery sau 80 ms geometry hợp lệ liên tục.
- Nếu chỉ Hand landmarks mất nhưng Pose chain còn hợp lệ, Pose arm vẫn chạy; twist cũ debounce 80 ms rồi fade hết trong 180 ms thay vì giữ lâu trên orientation không còn quan sát được.
- Bug reload “face chạy nhưng tay không chạy” được xác định là stale model callback có thể ghi `rigProfile=null` sau khi renderer mới đã sẵn sàng. Reload DEV hiện tái dùng canvas/WebGL, giữ model cũ tới khi swap và chỉ request ID mới nhất của đúng renderer mới được commit rig profile; cleanup renderer cũ không còn quyền xóa profile hiện tại. Lần tải trang đầu của model 22.5 MB vẫn cần đo riêng và chưa được tuyên bố tối ưu xong.
- Chưa có số liệu tay trái hợp lệ (các snapshot vừa thu đều `left: missing`); vì vậy không được kết luận cả hai tay đã PASS.
- Chưa có bộ snapshot đồng nhất `neutral → palm-up → neutral → palm-down` cho cả hai tay trên cả ba model local.

Nếu lỗi ngẫu nhiên vẫn còn sau webcam re-test partial occlusion, cần triển khai anomaly capture local-only: ring buffer 2–3 giây, trigger theo upper-arm axial twist/quaternion delta và xuất JSON chứa nguồn upper frame/pole/torso, trạng thái temporal/reacquire, angular delta, `sampleDisposition` và `dt`. Capture này chưa được triển khai, không chứa raw frame/ảnh khuôn mặt và không upload dữ liệu.

## 6. Công việc tiếp theo của Phase 3B

1. **Webcam re-test reload lifecycle và chuỗi partial occlusion vừa tái hiện**
   - Khi tracking đang chạy, bấm Reload nhiều lần: model cũ phải còn hiển thị trong lúc tải; sau swap phải có rig profile và mặt/tay đều tiếp tục điều khiển được.
   - Refresh trang nhiều lần, ghi thời gian model visible/rig ready và đối chiếu `pose: tracked → active`; không được còn trường hợp pose active nhưng packet thiếu arm rotations vì profile bị stale callback xóa.
   - Giữ tay rõ → che/mất wrist một phần → di chuyển khuỷu → đưa wrist trở lại; xác nhận upper/lower cùng hold/return/recover và không quét ngang mặt.
   - Lặp lại cho hai bên với Hand twist OFF rồi ON để tách Pose chain khỏi twist fade.
2. **Nếu còn lỗi, thu anomaly capture local-only**
   - Triển khai ring buffer và trigger chẩn đoán, phân biệt quaternion upperArm thật sự xoắn với artifact do lowerArm/skinning của từng VRM.
3. **Đóng băng baseline trước khi webcam re-test twist**
   - Giữ một model, một side, Filter/Constraints/Smoothing cố định.
   - Reload model, bật Hand twist, giữ cạnh bàn tay rồi bấm `Neo neutral tay trái/phải`; xác nhận `neutralReanchorReason=manual-neutral-calibration` và corrected gần 0.
4. **Thu bằng chứng ba tư thế**
   - Chụp diagnostic neutral, palm-up và palm-down cho right; lặp lại cho left.
   - Đối chiếu từ raw palm basis đến `appliedTwistRadians` và world orientation thật sau renderer.
5. **Kiểm chứng candidate sign boundary**
   - Xác nhận tay phải đi cùng chiều sau khi bỏ lần đảo thứ hai (`rigApplicationSign.right: -1→+1`).
   - Thu tay trái tương đương trước khi khóa convention; không đổi chirality/signed-angle thêm nếu chưa có bằng chứng.
6. **Kiểm chứng theo model**
   - Chạy cùng procedure trên `reference-avatar.vrm`, `reference-avatar-1.vrm` và
     `reference-avatar-2.vrm`.
   - Nếu dấu phụ thuộc rig, phải biểu diễn bằng dữ liệu/profile đã đo; không hard-code theo tên model.
7. **Regression và production candidate fix đã có**; còn webcam re-test, anomaly capture nếu còn lỗi, world-orientation evidence sau renderer và acceptance đa model.

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
