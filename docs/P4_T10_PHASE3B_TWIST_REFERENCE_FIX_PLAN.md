# P4-T10 — Phase 3B fix: reference twist của lowerArm bị trôi (holonomy)

> Trạng thái ngày 2026-07-30: **IN PROGRESS — đang triển khai**.
> Đây là bugfix nằm TRONG Phase 3B, không phải phase mới. Tài liệu chủ vẫn là
> `docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md`; file này ghi lại một root cause
> cụ thể cùng bằng chứng số và cách sửa.
> Fix này **không** tự đóng acceptance gate Phase 3B (§7 tài liệu chủ) — vẫn cần webcam.

## Context

Phase 3B (`docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md`) đo pronation/supination của cẳng tay bằng góc có dấu của palm normal quanh trục forearm, so với một hướng tham chiếu `referenceDirection` (mốc twist = 0).

Hiện tại `avatarMotionProcessor.ts:710` lấy mốc đó từ `armState[side].previousSecondary.lower` — giá trị **parallel-transport tích luỹ theo lịch sử** do `armFrameSolver.ts` dựng. Mốc đo twist bắt buộc phải là hàm **không phụ thuộc lịch sử** của hình học hiện tại, nên đây là lỗi.

Đã chứng minh bằng số (test tạm, đã xoá):

| Kiểm chứng | Kết quả |
|---|---|
| Reference xoay 30° quanh forearm axis, palm giữ nguyên | twist đổi **đúng 30°** (1:1) |
| Reference nghiêng dọc axis | twist **không đổi** (projection khử đúng) |
| Đổi nhánh transport → `projectToPrimary(upperSecondary, lower)` | reference nhảy **76.6°** |
| Cẳng tay đi vòng kín rồi **về đúng hướng ban đầu** | reference lệch **35.08°** (holonomy) |

Dòng 2 quan trọng: phép chiếu ở `handForearmTwist.ts:145` chỉ khử thành phần **dọc** axis, không khử roll **quanh** axis — nên roll của reference đi thẳng 1:1 vào twist.

Dòng 4 là bằng chứng nặng nhất: tay về đúng chỗ cũ nhưng twist bị tiêm 35°. Giải thích được cả sai lệch hệ thống lẫn triệu chứng "quắn lại" **ngẫu nhiên, không tái hiện ổn định** ghi ở §5 tài liệu Phase 3B.

Kết quả mong đợi: cùng một hướng cẳng tay ⇒ luôn cùng một reference, không tích luỹ, không nhảy khi đổi nhánh.

**Đã loại trừ:** trục *áp* twist (`anatomicalRestBasis.primaryLocal` trong `handTwistRig.ts`) từng bị nghi nhưng đã chứng minh **đúng** — xoay quanh nó là axial twist thật ở mọi tư thế (hướng xương đổi < 1e-6°). Không sửa.

## Giải pháp

Thay reference lịch sử bằng reference **history-free**: parallel-transport rest frame của **lowerArm** (đã xoay theo `torsoDelta`) lên hướng `lower` hiện tại.

Đây đúng là kỹ thuật `armFrameSolver.ts:257-259` đã dùng để chữa **cùng lớp lỗi này** cho upperArm (comment tại dòng 253-255: "ngay cả pole vuông góc rest cũng làm mesh vai xoắn rõ"). lowerArm chưa được áp dụng.

Transport từ một rest frame **cố định** mỗi frame là idempotent — cùng `lower` ⇒ cùng reference, không holonomy. Khác hẳn transport từ frame trước.

### Vị trí: trong `armFrameSolver.ts`, thêm field vào `SideArmGeometryResult`

Không tính ở processor, không tạo module mới:

- `torsoDelta` (dòng 241) và `lower` (hướng đã qua One-Euro filter) đều là biến **nội bộ** của `solveSide`. Processor có `torso` nhưng không có `torsoDelta`; tự tính lại sẽ tạo định nghĩa thứ hai lệch nhẹ — đúng loại trôi hình học đã gây ra lỗi này.
- `transportedSecondary` là hàm private (dòng 66), `projectToPrimary` là closure **bên trong** `solveSide` (dòng 251). Tính trong solver cần 0 thay đổi visibility. Export chúng ra ngoài là mở rộng phạm vi vào Phase 3A, và mời gọi người sau tái dùng transport lịch sử ở nơi khác.
- Field trên result **tự động** là hình học của frame hiện tại, cùng `lower` mà solver đã dùng.

`SideArmGeometryResult` vốn đã export `primary`/`secondary` chỉ để Phase 3B tiêu thụ (Phase 3A dùng biến local `lowerSecondary` trực tiếp ở dòng 280). Nó đã là contract Pose→Hand; thêm một field read-only là thay đổi nhỏ nhất.

### Chuỗi fallback (thứ tự bắt buộc)

Dùng `joints[i.lower].anatomicalRestBasis`, **không** dùng của `i.upper` — mốc twist=0 phải là frame mà chính cẳng tay nghỉ trong đó, và trục *áp* twist cũng lấy từ joint này (`processor:849`). Fixture test dùng chung `leftBasis` cho cả upper/lower nên nhầm lẫn này **vô hình** trong mọi test hiện có (đã xác minh `armFrameSolver.test.ts:14-15`).

1. **Phát hiện antiparallel trước tiên.** `lower · normalize(lowerRestPrimary) < -1 + 1e-4`. Nếu đúng → nhảy sang bước 3.

   Lý do phải đứng đầu: `setFromUnitVectors` ở gần điểm đối cực **không** trả null và **không** nhạy với ε-jitter (đã đo: lệch 0.00°). Vấn đề thật là **phụ thuộc đường tiếp cận** — tới gần đối cực theo `+y` so với theo `+z` cho reference lệch **180.00°**. Phép chiếu ở bước 3 lệch **0.00°** trong cùng tình huống. Cẳng tay dựng lên có thể tiến gần đối cực của rest, nên đây không phải nhánh lý thuyết.

2. **Transport rest frame (nhánh gần như luôn chạy).**
   ```
   lowerRestPrimary   = rotateVector(torsoDelta, basis.primaryWorld)
   lowerRestSecondary = rotateVector(torsoDelta, basis.secondaryWorld)
   transportedSecondary(lower, lowerRestPrimary, lowerRestSecondary)
   ```
   `transportedSecondary` tự normalize và tái trực giao với `lower`, nên kết quả luôn unit và ⊥ `lower` ⇒ `referenceProjectionRatio` ổn định ~1 (`handTwistConfidence` đọc tỉ lệ này).

3. **Chiếu trực tiếp rest axis lên `lower`** (đầu cuối, an toàn ở đối cực):
   ```
   projectToPrimary(rotateVector(torsoDelta, basis.secondaryWorld), lower)
     ?? projectToPrimary(rotateVector(torsoDelta, basis.binormalWorld), lower)
   ```
   Gram-Schmidt thuần, không có trục quay tuỳ ý. Hai ứng viên vuông góc nhau nên ít nhất một cái sống.

   **Không dùng lại `restCandidates` (dòng 242)** — chúng đã bị chiếu lên `armAxis` (vai→wrist), phụ thuộc độ gập khuỷu, sẽ tiêm swing vào reference.

4. **`null`** → guard sẵn có ở `processor:740` fallback Pose-only. Không cần rejection path mới.

**Torso thiếu:** không xử lý riêng. `torsoDelta` = identity khi torso null (dòng 241), và `solveAnatomicalArmFrames` (313-317) không bao giờ truyền null — nó thay bằng `lastTorso` hoặc rest reference (⇒ identity). Reference thành rest frame thuần: history-free, đúng.

**Residual đã biết (không sửa):** đổi *nguồn* torso (rest→previous→fresh) làm `torsoDelta` đổi ⇒ reference roll. Đây là thay đổi thật của hệ quy chiếu thân, dùng chung với upperArm (257-258), có biên và **không tích luỹ** — khác holonomy. Ghi vào tài liệu, không đưa vào phạm vi.

**Không thêm điều kiện theo side.** `positiveSign` (767) và `rigApplicationSign` (847) đã giữ chirality; rest basis mỗi bên đã mã hoá primary đối xứng.

### Giữ nguyên `forearmAxis` (`previousPrimary.lower`)

Trục này *cũng* có thể cũ: dòng 498 nằm trong `if (acceptedGeometry)`, mà `geometryConfirmed` (464-468) đòi `chainGeometryValid` **và** 80 ms `validRecoveryConfirmMs` khi đang hồi phục. Frame không accepted mà Hand có sample mới ⇒ trục cũ.

Vẫn để nguyên, vì đây là lớp lỗi **yếu hơn hẳn**:

1. Sai số trục bị chặn bởi chuyển động thật của cẳng tay và **tự sửa** khi geometry được nhận lại. Holonomy **không bao giờ** tự sửa (35.08° với tay đã về đúng chỗ).
2. Trục lệch **không** vào góc 1:1. Reference roll vào 1:1 vì `atan2` đo trực tiếp từ nó; trục nghiêng làm cả palm normal và reference nghiêng cùng nhau nên ảnh hưởng vi phân là bậc hai.
3. Sửa trục = đổi timing của Pose chain (bỏ qua One-Euro `directionFilter:189` và gating 449/466, hoặc dời `applyHandTwist` lên trước 498). Ngoài phạm vi theo AGENTS.md.
4. **Cặp khớp nhau quan trọng hơn độ tươi.** Lưu `twistReference` trên **đúng** biên dòng 498 ⇒ trục và reference luôn cùng frame. `computeHandForearmTwist` chiếu cả hai vào mặt phẳng ⊥ trục đó, nên cặp cũ-nhưng-nhất-quán cho góc đúng, chỉ trễ. Trục tươi + reference cũ thì tệ hơn cả hai cùng cũ.

Thêm comment tiếng Việt tại 709-710 ghi rõ đây là cặp cố ý cùng frame.

### `handTwistStabilization.ts` — không sửa

Neutral lưu `neutralUnwrappedRadians` theo hệ của reference cũ. Đổi định nghĩa reference làm raw lệch một hằng `Δ`, nhưng `corrected = rawUnwrapped - neutral` (dòng 95) **triệt tiêu đúng** hằng số đó. Logic anchor đúng nguyên trạng — fix này chính là thứ làm neutral có nghĩa lần đầu.

Không có vấn đề migration: state chỉ nằm trong RAM trên instance processor, không `localStorage`, không serialize vào `AvatarPosePacketV1`. Reload là state mới.

**Không** thêm đường "reference đổi → reanchor neutral": `reanchorNeutral` là tín hiệu do người dùng/epoch điều khiển; nối hình học vào đó sẽ để torso-source âm thầm xoá neutral người dùng đã neo, trái contract §6.3 tài liệu.

## Các bước thực hiện

1. **`armFrameSolver.ts`** — thêm `twistReference: { lower: Vector3Data | null; lowerSource: TwistReferenceSource }` vào `SideArmGeometryResult`. **Đã triển khai khác kế hoạch gốc:** `TwistReferenceSource` đặt trong `avatarMotionDiagnostics.ts` cạnh `PoleSource`/`ElbowSource` chứ không export từ solver — vì `armTemporalState.ts` cũng cần type này, mà solver đã import từ `armTemporalState` nên import ngược sẽ thành vòng.
2. **`armFrameSolver.ts`** — tính reference trong `solveSide`, chèn **ngay sau** block `lowerSecondary` (sau 276) để nó nằm cạnh và rõ ràng độc lập với transport lịch sử. Guard `lowerDirectionValid && lower`. Điền vào return (300-303). Comment tiếng Việt nêu: history-free; cùng kỹ thuật minimal-twist với upperArm 257-259; **không** dùng `lowerSecondary` vì holonomy 35.08° và nhảy nhánh 76.6°; nhánh antiparallel phải chiếu vì transport phụ thuộc đường tiếp cận (lệch 180°).
   **Giữ nguyên `lowerSecondary` (268-276)** — Pose swing vẫn dùng continuity transport cho *frame*. Field mới là bổ sung, không thay thế.
3. **`armFrameSolver.test.ts`** — U1-U6 (dưới). Viết trước khi chạm processor để contract solver được khoá độc lập.
4. **`armTemporalState.ts`** — thêm `previousTwistReference: { lower: Vector3Data | null }` vào `ArmTemporalState` (~44-45) và `createArmTemporalState()` (61), tạo **object literal mới** mỗi lần gọi (tránh chia sẻ giữa hai bên).
5. **`avatarMotionProcessor.ts:498`** — gán cùng dòng với `previousPrimary`/`previousSecondary`, **cùng một điều kiện accept**.
6. **`avatarMotionProcessor.ts:710`** — trỏ `referenceDirection` sang `previousTwistReference.lower`. Không chạm `forearmAxis`.
7. **`avatarMotionDiagnostics.ts`** + hai site dựng diagnostic (`inactiveHandTwistDiagnostic` 141-176 và literal 853-896) — thêm `twistReferenceSource`. Lý do: cả lớp lỗi này **vô hình** trong diagnostic — không thể biết nhánh nào đang chạy. Một enum làm nó quan sát được trong JSON export, cần cho webcam re-test.
8. **`handTwistStabilization.test.ts`** — U7. Không sửa source.
9. **`avatarMotionProcessor.test.ts`** — I1-I5. Kiểm xem đã có helper drive N frame trước khi viết mới.

Bước 1-3 review được độc lập. Bước 4-6 phải vào cùng nhau (5 không có 4 thì không compile).

## Kiểm chứng

### Unit — `armFrameSolver.test.ts`

- **U1 idempotence:** cùng landmark frame, hai `ArmGeometryHistory` khác nhau (rỗng vs. có `previousPrimary/Secondary.lower` lạ + `lastValidPoleAtMs` còn hạn). `twistReference.lower` phải **giống nhau** (dot > 1-1e-9). Test hiện có ở dòng 186-192 khẳng định `secondary.lower` *khác* nhau — đây là chứng minh trực tiếp.
- **U2 branch-switch invariance:** ba lần solve cùng hình học, history dựng để chọn từng nhánh cũ (pole fresh; pole fresh nhưng `lastValidPoleAtMs` hết hạn; không pole/không history). `twistReference.lower` giống hệt cả ba, **và** assert `secondary.lower` *không* giống — thiếu assert âm này test có thể pass rỗng.
- **U3 holonomy = 0 (test quan trọng nhất):** ≥8 hướng cẳng tay tạo vòng kín, feed output frame này vào history frame sau **đúng như processor:498**. Assert reference cuối = đầu (< 1e-6), **và** cùng vòng đó `secondary.lower` tích luỹ > 5° (đã đo 35.08°, để biên rộng).
- **U4 rest semantics:** `torsoDelta` identity + `lower` = rest primary ⇒ reference = `secondaryWorld` (dot > 1-1e-6). Thêm: unit length và `|reference · lower| < 1e-6` cho mọi hướng trong U3.
- **U5 antiparallel:** tiến gần đối cực theo hai đường khác nhau (`+y` vs `+z`) ⇒ hai reference lệch **< vài độ** (hiện tại transport lệch 180°). Assert `lowerSource === "rest-projection"`.
- **U6 dùng basis lowerArm:** cần profile test có `leftLowerArm.anatomicalRestBasis` **khác** `leftUpperArm` một roll đã biết quanh primary chung. Fixture đang ship dùng chung một object nên không cách nào khác bắt được lỗi này.

### Unit — `handTwistStabilization.test.ts`

- **U7:** cùng chuỗi raw angle, lần hai lệch một hằng `Δ = 1.34 rad`, mỗi lần state mới. `clampedTwistRadians` phải giống nhau từng frame — khoá lập luận "không cần sửa stabilization".

### Integration — `avatarMotionProcessor.test.ts`

- **I1:** các test flag-off / Pose-only-equality hiện có phải **xanh mà không sửa dòng nào**. Nếu đổi ⇒ fix đã rò vào Pose path.
- **I2:** hai processor, chuỗi frame giống nhau, chỉ khác B đi qua một vòng occlusion→recovery trước để `previousSecondary.lower` khác state. `rawWrappedTwistRadians` frame cuối phải khớp (< 1e-6). Hôm nay fail. Đây là phát biểu mức integration của U1/U2, gần triệu chứng người dùng thấy nhất.
- **I3:** đi vòng kín U3 qua processor, palm giữ **cố định** suốt. `appliedTwistRadians` cuối = đầu (giữ tư thế cuối ≥ 5×tc = 0.4 s cho filter kịp settle).
- **I4:** ép chuyển `poleSource` rest→fresh (cơ chế như test dòng 303), palm cố định. `|Δ rawWrappedTwistRadians|` qua frame chuyển < 2° (dưới dead zone 3°). Phải assert trên **rawWrapped**, không phải `appliedTwistRadians` — applied đã lọc nên che mất bước nhảy.
- **I5:** **Đã sửa tiền đề khi triển khai.** Kế hoạch gốc định dùng rest basis suy biến, nhưng `validateRigProfile` chặn profile đó ngay tại `setRigProfile` (throw) — nên đường duy nhất để mốc không dựng được là HÌNH HỌC. Test thực tế: wrist trùng elbow ⇒ `lowerDirectionValid=false` ⇒ `twistReference.lower=null` ⇒ output **đúng bằng** Pose-only, `handTwistApplied=false`, `twistReferenceSource="unavailable"`.
- **I6:** nhiễu hình học tay trái không làm đổi `rawWrappedTwistRadians` của tay phải (mốc mỗi bên độc lập).

### Gate — kết quả thực tế (2026-07-30)

- `npx tsc --noEmit`: **sạch**. `npm run lint`: **sạch**. `npm run build`: **thành công**.
- `npx vitest run`: **518 PASS**, 4 FAIL.
- 4 FAIL đều trong `handTwistRootCauseValidation.test.ts` với `TypeError: Cannot read properties of undefined (reading 'gaze')` tại `avatarRenderer.ts:167`. **Có trước fix này** — đã xác minh bằng cách stash toàn bộ thay đổi rồi chạy lại file đó, vẫn đúng 4 FAIL cùng lỗi. Thuộc đường renderer/model capability, **không** sửa trong phạm vi này.
- Không sửa một dòng nào trong test cũ; `armFrameSolver.test.ts` các test parallel-transport cũ vẫn xanh ⇒ `secondary.lower` không bị đổi.

**Mutation-test (chống test pass rỗng):** tạm khôi phục hành vi cũ (`twistReference = lowerSecondary`, rồi `referenceDirection = previousSecondary.lower`) và xác nhận test đỏ đúng chỗ:
- Unit: **5/6 đỏ** (U1, U2, U3, U5, U6). U4 xanh là đúng — ở rest pose hai định nghĩa trùng nhau.
- Integration: **I2 và I3 đỏ**. I3 là bản integration của bằng chứng holonomy.

Fix này **không** tự đóng acceptance gate Phase 3B (§7 tài liệu chủ) — vẫn cần webcam.

## Tài liệu cập nhật (AGENTS.md "Sau khi sửa code")

- **`docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md`** (tài liệu chủ):
  - §2 sơ đồ pipeline: ghi rõ mốc là "minimal-twist rest transport (history-free)".
  - §5: thêm **root cause thứ ba** cạnh hai cái đã có ở dòng 110, kèm 4 con số đã đo; ghi đã khoá bằng automated regression, còn chờ webcam. Sửa lại câu "root cause runtime cuối cùng chưa được xác định" ở dòng 110.
  - §5: ghi **kết quả âm** — trục twist `primaryLocal` đã điều tra và **loại trừ** (hướng xương đổi < 1e-6°). Kết quả này đắt để suy lại, phải lưu.
  - §6 mục 1: thêm bước webcam "giữ palm cố định, đưa cẳng tay đi một vòng kín rồi về đúng hướng ban đầu — twist phải trở về giá trị ban đầu".
  - §5: ghi **hai residual đã biết, KHÔNG sửa trong lần này** (đã xác nhận với người dùng):
    - Dồn 100% twist vào `lowerArm`, cổ tay không bù ⇒ mesh cẳng tay xoắn tuỳ skinning weight từng VRM. §3 tài liệu đã ghi việc phân phối lowerArm/hand ngoài phạm vi Phase 3B. Không đo được bằng unit test, cần webcam.
    - `geometryQuality` (`handPalmBasis.ts:112`) chỉ đo across/forward có song song không, **không** đo edge-on — mà `normal` (trục được chọn để đo twist) lại là trục có Z kém tin cậy nhất của MediaPipe khi bàn tay nhìn từ cạnh. Confidence gate vì thế bỏ qua đúng chế độ lỗi nguy hiểm nhất. Comment trong code đã tự thừa nhận.
    - Cả hai chỉ ghi nhận để quyết định sau, không đưa vào phạm vi lần này (AGENTS.md: "không tự mở rộng phạm vi").
  - Banner dòng 4: cập nhật số test.
- **`docs/06_CODEBASE_GUIDE.md`** — không thêm file mới nên không bắt buộc, nhưng bảng trách nhiệm module nên ghi `armFrameSolver.ts` giờ cung cấp thêm reference twist history-free cho Phase 3B.
- **`docs/07_DEVELOPMENT_AND_TESTING.md`** — cập nhật nếu có ghi con số test.
- **Không** đánh dấu P4-T10 xong trong `09_ROADMAP_AND_TASKS.md`: đây là bugfix trong task đang chạy, gate là webcam acceptance (banner §3-5 tài liệu đã cấm).
- Không ảnh hưởng: `04_API.md`, `03_DATABASE.md`, `05_UI_UX.md` (đã xác minh `AvatarRendererDevHarness.tsx` không tham chiếu tên field twist nào, nó export JSON chung).
