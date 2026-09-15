# AR4-T03.1 — Kế hoạch mở rộng Vertical Shrug

Ngày lập: 2026-09-15  
Trạng thái: **IMPLEMENTED — AUTOMATED GATE PASS — MANUAL/PERFORMANCE GATE PENDING**  
Phạm vi cha: P4-T10 / AR4-T03 Shoulder–clavicle–scapula approximation

## 1. Vấn đề đã xác nhận

AR4 hiện đo được nhún vai và phát rotation cho `leftShoulder/rightShoulder`, nhưng gốc xương vai không đổi vị trí.
Webcam thực tế cho thấy quaternion vai có thay đổi rõ, trong khi avatar vẫn khó tạo cảm giác “đưa vai lên sát tai”.

Đây không phải lỗi mất tracking hoàn toàn. Khoảng trống là retargeting:

- Nhún vai người thật gồm nâng xương đòn, trượt bả vai và dịch chuyển đầu vai.
- VRM humanoid không chuẩn hóa scapula/clavicle riêng; đa số model chỉ có `shoulder` làm approximation.
- AR4 V2 hiện chỉ có `jointRotations`, không có semantic displacement cho vai.

Kế hoạch này chỉ bổ sung **dịch chuyển cục bộ hai shoulder bone**. Nó không mở root translation, locomotion, pelvis,
center-of-mass hay full-body tracking.

## 2. Quyết định kiến trúc đề xuất

### 2.1 Không suy translation từ quaternion

Không để renderer suy độ nâng vai từ `jointRotations.leftShoulder/rightShoulder`, vì rotation hiện là tổng của observed
shrug, reach assist và life motion. Suy ngược sẽ không phân biệt được nguyên nhân, dễ biến breathing hoặc giơ tay thành
dịch vai giả.

Processor phát thêm một semantic scalar độc lập cho mỗi vai; renderer đổi scalar đó thành khoảng dịch theo kích thước
rig đang hiển thị.

```ts
interface ShoulderMotionStateV1 {
  version: 1;
  /** [-1, 1]: 0 rest, dương nâng vai, âm hạ vai. */
  leftVertical: number;
  rightVertical: number;
}

interface AvatarPosePacketV2 {
  // field hiện hữu giữ nguyên
  shoulderMotion?: ShoulderMotionStateV1 | null;
}
```

Field là optional để receiver V2 cũ bỏ qua an toàn. Packet không chứa landmark, ảnh, matrix hay vị trí camera; chỉ chứa
hai scalar đã calibration/filter nên không thay đổi cam kết NFR-06. Trước P4-T15 phải bổ sung validation finite/range và
mixed-version tests.

### 2.2 Model-space adapter ở renderer — current torso-up

Chốt contract **current torso-up/anatomical-up**, không dùng world-up tuyệt đối. Khi thân nghiêng, hướng nhún vai phải
nghiêng theo thân như chuyển động giải phẫu, thay vì tiếp tục đi thẳng đứng theo camera/world.

Loader capture cho từng shoulder:

- `restLocalPosition`;
- parent hợp lệ;
- `torsoUpParentLocalRest = inverse(parentRestWorldRotation) rotate torsoUpRest`;
- `shoulderWidth` giải phẫu của rig, đo giữa hai gốc `upperArm` và chỉ fallback về hai shoulder node khi model thiếu upper-arm.

Mỗi frame renderer gán tuyệt đối, không cộng dồn:

```text
torsoUpCurrent_i = parentCurrentWorldRotation_i rotate torsoUpParentLocalRest_i
offsetLocal_i = inverse(parentCurrentWorldRotation_i) rotate torsoUpCurrent_i × displacement_i
shoulder.position_i = restLocalPosition_i + offsetLocal_i
```

Với `@pixiv/three-vrm`, loader capture **raw skinned shoulder bone** riêng. `VRMHumanoid.update()` chỉ chuyển position
từ normalized rig cho `hips`, không chuyển position của shoulder; vì vậy rotation tiếp tục áp lên normalized bone,
còn shoulder translation phải gán lên raw bone sau `vrm.update()` và trước WebGL render.

Hai phép đổi hệ quy chiếu làm offset local tương đương anatomical-up của parent, còn hướng world của nó quay theo
current torso. Test không được gọi đây là world-up. Implementation có thể dùng trực tiếp axis parent-local đã capture
nếu chứng minh đại số và fixture cho kết quả tương đương khi parent đang animate.

Model thiếu shoulder bone, parent hoặc shoulder width hợp lệ sẽ no-op đúng side. `upperArm` chỉ làm mốc đo scale ngoài, không bị dùng làm shoulder giả hay nhận translation trực tiếp.

## 3. Observation và calibration

Vertical shrug dùng `pose.landmarks` image-space, không dùng `pose.worldLandmarks`, để khung gọi video đầu–vai
không bị phụ thuộc vào việc MediaPipe có quan sát được hông. Tọa độ X được nhân `videoWidth/videoHeight`; scale là
span ngang hiện tại giữa hai vai nên zoom camera được triệt tiêu và chính độ lệch dọc của một vai không làm phình mẫu số.
World-space vẫn là nguồn cho rotation vai/thân, reach và chiều sâu.

Với side `i`, shoulder `S_i`, ear `A_i` và current image shoulder width `W`:

```text
gapRatio_i   = imageVerticalGap(A_i, S_i) / W
normalized_i = neutralGapRatio_i - gapRatio_i
```

Dead-zone và ánh xạ bất đối xứng:

```text
if normalized_i >= 0:
    observed_i = smoothstep(0.015, 0.12, normalized_i)
else:
    observed_i = -smoothstep(0.010, 0.05, -normalized_i)
```

- `+1` là mức nhún lên tối đa; `-1` là mức hạ vai tối đa.
- Không hard-switch gain theo `shoulder-only/full-torso`; hips chỉ tăng capability của torso, không đổi gain nhún vai.
- Hai vai có observation, confidence và temporal state riêng.
- Khi ear cùng bên đạt quality, dùng shoulder–ear gap để nhận cả unilateral và bilateral shrug.
- Khi ear mất nhưng nose đủ quality, dùng khoảng cách nose–tâm hai vai để lấy thành phần nhún chung, rồi kết hợp với
  differential shoulder-line để tách trái/phải. Nếu cả ear và nose đều mất thì chỉ giữ differential; không claim nhận
  được bilateral common shrug chỉ từ hai shoulder point.
- Reach-up chỉ được thêm như assist có cap tối đa `0.20`; diagnostic phải tách `observed` và `reachAssist`.

### 3.1 Gate chống head-tilt false positive

Ear-gap và nose-gap chỉ được tin đầy đủ khi calibrated Face delta gần neutral. Lấy pitch/roll độc lập với shoulder basis để chính
unilateral shrug không tự tạo head-relative roll rồi triệt tiêu observation; không lấy tọa độ ảnh thô:

```text
rollGate  = 1 - smoothstep(8°, 22°, abs(headRoll))
pitchGate = 1 - smoothstep(15°, 30°, abs(headPitch))
earGapConfidence = landmarkConfidence × min(rollGate, pitchGate)
```

Khi gate giảm, blend/fallback về differential shoulder evidence; không giữ head-gap lớn do tai/mũi tiến gần vai khi chỉ
nghiêng đầu. Nếu cả head-gap lẫn differential đều không đủ confidence thì observation side đó unavailable và temporal
tự hold/return — không phát chuyển động giả.

Calibration vẫn dùng 30 pair Face + upper body như AR4 corrective hiện tại. Neutral lưu các gap ratio tai–vai,
nose–tâm vai và confidence; không yêu cầu thấy hông.

## 4. Temporal và trạng thái mất tracking

Scalar vertical có temporal owner duy nhất ở processor:

- dead-zone trước filter để loại rung nhẹ quanh neutral;
- attack mục tiêu 70–100 ms để nhún vai không trễ;
- release mục tiêu 140–220 ms để vai hạ tự nhiên;
- short loss: hold tối đa 120 ms;
- sau hold: return về 0 trong 250 ms;
- reacquire blend từ giá trị đang áp dụng, không snap;
- reset/calibrate/model swap: terminal assignment về chính xác 0.

Không smoothing lần hai ở renderer. Các hằng số cuối cùng phải được khóa bằng webcam gate, không chỉ unit test.

`shoulderMotion` là **full-state snapshot**, không phải event hoặc delta update. Khi feature active, mọi Packet V2 đều
phải chứa field này, kể cả khi không có Pose sample mới; processor tiếp tục phát chính state held/returning/idle đã tính.
Field omitted/null chỉ có nghĩa feature unavailable/disabled hoặc sender cũ, khi đó renderer mới đưa vai về rest.

## 5. Chuyển semantic scalar thành displacement

Displacement phụ thuộc rig shoulder width `Wr`, không dùng mét MediaPipe trực tiếp:

```text
if vertical_i >= 0:
    displacement_i = vertical_i × 0.10 × Wr
else:
    displacement_i = vertical_i × 0.035 × Wr
```

Giá trị khởi đầu để manual tuning:

- không dùng hard cap theo model unit như một hằng số universal;
- capability adapter chỉ nhận shoulder width finite và dương; displacement dùng tỷ lệ nên không phụ thuộc đơn vị model;
- không scale theo khoảng cách người dùng tới camera.

Rotation shoulder hiện hữu vẫn chạy để tạo cung xương đòn. Translation và rotation dùng cùng observed evidence nhưng có
gain/cap riêng; không nhân translation từ quaternion sau composition.

## 6. Tích hợp với arm và torso

- Shoulder translation được áp trước khi render world matrices của upper/lower arm.
- Upper arm vẫn nhận rotation từ arm solver; là child của shoulder nên toàn bộ chuỗi tay đi theo gốc vai.
- Không cộng offset lần nữa vào elbow/wrist và không sửa Hand Twist/Finger Gesture.
- Bilateral shrug không được biến thành head bob hoặc root lift.
- Có thể thêm upperChest rotation rất nhỏ từ common shrug ở vòng tuning sau, nhưng mặc định **không thêm chest
  translation** trong task này.
- Nếu model có hierarchy vai bất thường, adapter no-op thay vì mutate sai bone.

## 7. Chẩn đoán DEV bắt buộc

Panel AR4 bổ sung, không log raw frame:

```text
Vertical L/R: raw · filtered · applied
Source L/R: ear-gap | nose-gap | differential | reach-assist | unavailable
Capability L/R: supported | missing-bone | invalid-parent | invalid-scale
Displacement L/R: model units
Clamp count · loss state
```

`Freeze current` phải giữ được evidence tai/vai cùng scalar, nhưng vẫn không lưu/upload ảnh hoặc raw landmark.

## 8. Thứ tự triển khai 01 → 05

### VS-01 — Contract và rig capability — CODE COMPLETE

- Thêm optional `shoulderMotion` vào Packet V2.
- Capture rest local position, parent-local up axis và scale guard.
- Thêm finite/range validation, reset và model-generation ownership.
- Chưa bật displacement trong renderer ở cuối bước này.

### VS-02 — Observation và scalar temporal — CODE COMPLETE

- Tách vertical observation khỏi quaternion rotation trong `ShoulderMotionSolver`.
- Thêm dead-zone, asymmetric mapping, per-side confidence và hold/return/reacquire.
- Giữ output rotation hiện tại để không regression AR4-T03.

### VS-03 — Renderer vertical adapter — CODE COMPLETE

- Áp `restLocalPosition + axis × displacement` bằng assignment tuyệt đối.
- Packet không có field/null/invalid phải đưa vai về rest an toàn.
- Model swap và renderer stop/start không để lại offset.

### VS-04 — Arm/hierarchy integration — CODE COMPLETE; MANUAL REGRESSION PENDING

- Xác minh shoulder → upperArm inheritance sau translation.
- Khóa không double-apply; đo end-effector/elbow world error, pole continuity và twist continuity thay vì bắt arm
  direction byte-identical khi shoulder origin thực sự đã dịch.
- Thêm fallback cho partial/missing shoulder rigs.

### VS-05 — Diagnostics/tooling COMPLETE; MANUAL TUNING/ACCEPTANCE PENDING

- Nối diagnostic DEV.
- Chạy automated gate toàn frontend.
- Tune gain/cap bằng webcam trên ít nhất ba VRM rồi cập nhật tài liệu trạng thái.

Không thêm thư viện mới. Không đổi backend/database/API HTTP.

## 9. Automated test gate

### Solver/temporal

- Neutral cho đúng `0/0`.
- Nhún trái, phải và hai vai cho đúng side/sign.
- Hạ vai cho scalar âm và cap bất đối xứng.
- Mất một/hai ear nhưng nose còn tốt vẫn nhận bilateral common shrug từ nose–tâm vai; mất cả ear lẫn nose chỉ dùng differential.
- Scale invariance khi landmark geometry cùng phóng to/thu nhỏ.
- Jitter trong dead-zone không tạo displacement.
- Hold → return → exact zero; reacquire không snap.
- Mọi output finite và nằm trong `[-1,1]`.

### Renderer/rig

- Parent/torso bị nghiêng thì displacement đi theo current torso-up, không theo world-up tuyệt đối.
- Không drift sau chuỗi A–B–A dài; A cuối bằng chính xác A đầu.
- Field omitted/null/invalid và packet V1 trả shoulder position về rest.
- Model thiếu một/hai shoulder no-op đúng side.
- Model swap không tái sử dụng rest position/scale của model cũ.
- Rotation và translation cùng tồn tại mà không overwrite nhau.

### Arm regression

- Không có rotation double-apply do shoulder translation.
- Wrist/elbow world target error không tăng ngoài tolerance; pole và twist giữ continuity.
- Child chain cùng dịch với shoulder đúng một lần.
- Hand Twist và finger quaternion byte-equivalent khi chỉ bật/tắt vertical offset.
- Privacy assertion: packet không chứa landmark/matrix/raw image field.

Gate cuối: toàn bộ `npm test`, `npm run lint`, `npm run build` phải PASS.

## 10. Manual webcam gate

Chạy cả `shoulder-only` và `full-torso`, Dynamics/filter ON, trên ít nhất ba VRM:

| Mã | Kịch bản | Kỳ vọng |
|---|---|---|
| VS-U1 | Neutral 10 giây | Vai không rung/bò khỏi rest |
| VS-U2 | Nhún riêng vai trái 5 lần | Đầu vai trái đi lên rõ, vai phải không cross-talk rõ |
| VS-U3 | Nhún riêng vai phải 5 lần | Đúng side, biên độ gần đối xứng VS-U2 |
| VS-U4 | Nhún cả hai vai | Hai vai lên gần tai, torso center và đầu không bob giả |
| VS-U5 | Hạ hai vai | Chuyển động nhỏ hơn nhún lên, không mesh tear |
| VS-U6 | Nhún rồi giữ 2 giây | Không tụt dần khi tracking vẫn active |
| VS-U7 | Nhún khi tay thả | Chuỗi tay đi theo vai, khuỷu/cổ tay không bật |
| VS-U8 | Nhún khi tay đang giơ | Không double-lift, pole/twist không lật |
| VS-U9 | Che một tai | Side có ear vẫn chạy; side thiếu không bịa common shrug |
| VS-U10 | Mất Pose rồi xuất hiện lại | Hold/return/reacquire không snap |
| VS-U11 | Tiến gần/lùi xa camera | Biên độ không đổi bất thường theo zoom |
| VS-U12 | Đổi VRM liên tục | Không giữ offset model trước; unsupported model no-op |
| VS-U13 | Gọi video framing chỉ đầu + vai | Calibration và bilateral shrug vẫn dùng được khi ears visible |
| VS-U14 | Nghiêng đầu trái/phải, giữ vai yên | Vertical shoulder gần 0; ear-gap bị head-pose gate hạ confidence |
| VS-U15 | Nghiêng thân 20–30°, sau đó shrug | Displacement đi theo current torso-up, không xiên khỏi thân |
| VS-U16 | Giữ shrug qua nhiều render frame không có sample Pose mới | Full-state snapshot giữ vai ổn định, không nhảy về rest giữa frame |

Quay benchmark local 60 giây/model: tracking→render vẫn dưới 100 ms, tối thiểu 24 fps, không tăng heap theo thời gian.

## 11. Điều kiện DONE và giới hạn tuyên bố

Chỉ đánh dấu AR4-T03.1 DONE khi:

1. VS-01 → VS-05 hoàn tất theo thứ tự.
2. Automated gate xanh (**76 test files / 766 tests**, lint và production build PASS ngày 2026-09-15).
3. VS-U1 → VS-U16 PASS trên ít nhất ba VRM.
4. Benchmark 60 giây/model đạt NFR.
5. Packet/architecture/testing/codebase docs được cập nhật cùng phiên.

Sau task này có thể tuyên bố “avatar có vertical shoulder shrug approximation”. Không được tuyên bố có scapula biomechanics,
root translation hoặc full-body vertical motion.

## 12. Quyết định review đã được chủ dự án chấp thuận

Kế hoạch chủ động thay đổi quyết định AR4 V2 từ rotation-only sang cho phép **optional semantic shoulder displacement**.
Review chấp thuận sau khi đã khóa ba điểm:

1. Thêm `shoulderMotion?` vào Packet V2 thay vì tạo Packet V3; đây là full-state snapshot khi feature active.
2. Chấp nhận shoulder bone local translation là approximation có cap, không phải giải phẫu scapula đầy đủ.
3. Giữ root/chest translation ngoài phạm vi; chỉ hai shoulder bone được dịch vị trí.

Review corrective bổ sung: displacement theo current torso-up, ear-gap có head pose gate, và arm acceptance đo world
target error/continuity thay vì yêu cầu direction bất biến tuyệt đối.
