# AR9 — Hand–Body Contact Reconstruction & Contact-aware Arm IK

> Trạng thái: **V1 CODE PATH CÓ NHƯNG WEBCAM GATE FAIL — MẶC ĐỊNH TẮT; QUAY LẠI SỬA ARM ENDPOINT / WRIST / OPEN HAND TRƯỚC**  
> Phạm vi đầu tiên: một tay chạm `headTop`, `forehead`, `leftCheek`, `rightCheek`, `chin`, `neck`, `leftShoulder`, `rightShoulder`, `upperChest`.  
> Mục tiêu: sửa đúng lớp lỗi “Pose/Hand thấy đủ nhưng bàn tay avatar không chạm đúng bộ phận”. Đây là AR9/AR10 theo roadmap, không phải chỉnh threshold của arm solver hiện tại.

Implementation hiện có chạy opt-in (`contactEnabled`, mặc định processor tắt; DEV harness bật) và gồm semantic
regions, rigid probes, multi-cue depth evidence, detector/render temporal clocks, avatar contact rig, probe-specific
wrist target, length-preserving two-bone IK, parent-local arm/hand correction và diagnostics. Chưa được đánh dấu
AR9 DONE trước manual hai tay/3 VRM, replay precision/recall và performance/privacy report.

Webcam evidence sau integration cho thấy baseline vẫn sai endpoint ở `raised palm`, `forehead`, `mouth`,
`headTop`, `ear`; wrist orientation sai rõ và open hand còn quặp ngón. Đây là prerequisite failure, không phải
contact threshold failure. Không tuning hoặc bật mặc định AR9 cho tới khi ba gate nền này pass độc lập.

## 1. Điều kiện bắt đầu và nguyên tắc

Không merge contact production trước khi các gate nền tương ứng hoàn tất hoặc có quyết định rõ ràng chấp nhận rủi ro:

- arm/wrist/finger rig ổn định trên ít nhất 3 VRM;
- AR6-T04 manual/performance hoàn tất;
- temporal/occlusion state theo AR8 đủ để giữ và nhả contact an toàn;
- tracking vẫn local-only; packet/log production không chứa raw landmark hay frame webcam.

Contact solver phải là một lớp corrective sau faithful reconstruction. Không được dùng contact để che lỗi sai side, sai coordinate frame, sai rig axis hoặc arm calibration.

Các bất biến:

1. Khi không có contact đáng tin cậy, output arm/wrist phải tương đương baseline trong tolerance số học.
2. Gesture label không được kích hoạt contact; contact phải đến từ bằng chứng hình học và thời gian.
3. Không trộn trực tiếp origin/scale của Pose world, Hand world và Face image.
4. Không kéo dài xương avatar, không ghi position vào joint con để giả contact.
5. Joint limit và continuity có quyền từ chối target không thể với tới.
6. Chỉ solver contact sở hữu positional correction; renderer không tự thêm một lớp IK/smoothing khác.

## 2. Kết quả mong muốn

Pipeline đích:

```text
Face/Pose/Hand landmarks
  -> semantic body regions trong image space
  -> hand contact probe (palm/edge/fingertip)
  -> depth relation + contact evidence
  -> contact state machine
  -> semantic target trên avatar rig
  -> wrist target = surface target - rotated contact-probe offset
  -> constrained two-bone IK
  -> wrist orientation solve
  -> penetration projection + one corrective re-solve
  -> temporal blend
  -> upperArm/lowerArm/hand/finger rotations
```

Đầu ra không phải “wrist trùng landmark người”, mà là:

```text
contactProbePositionAvatar ~= targetSurfacePointAvatar
contactProbeNormalAvatar ~= -targetSurfaceNormalAvatar
```

## 3. Contract và kiểu dữ liệu

Tạo contract riêng, không nhét thêm cờ rời vào `armFrameSolver.ts`:

```ts
type BodyContactRegion =
  | "headTop" | "forehead" | "leftCheek" | "rightCheek" | "chin"
  | "neck" | "leftShoulder" | "rightShoulder" | "upperChest";

type HandContactProbe = "palmCenter" | "ulnarEdge" | "radialEdge";
type ContactPhase = "idle" | "approach" | "near" | "touch" | "hold" | "slide" | "release";

interface HumanContactObservation {
  side: "left" | "right";
  region: BodyContactRegion;
  probe: HandContactProbe;
  imagePoint: Vector2Data;
  imageNormal: Vector2Data | null;
  overlap: number;
  approachVelocity: number | null;
  depthRelation: "front" | "near-surface" | "behind" | "unknown";
  confidence: number;
  sampledAtMs: number;
}

interface HandContactProbeProfile {
  probe: HandContactProbe;
  localPoint: Vector3Data;
  localContactNormal: Vector3Data;
  localTangentHint: Vector3Data;
}

interface ContactEvidenceBreakdown {
  handGeometry: number;
  bodyRegion: number;
  overlap: number;
  motion: number;
  orientation: number;
  depth: number;
  continuity: number;
  finalConfidence: number;
  hardRejections: string[];
}

interface AvatarContactAnchor {
  region: BodyContactRegion;
  parentJoint: AvatarJointName;
  localPoint: Vector3Data;
  localNormal: Vector3Data;
  tangentHint: Vector3Data;
  radius: number;
}

interface ActiveContact {
  side: "left" | "right";
  phase: ContactPhase;
  region: BodyContactRegion;
  probe: HandContactProbe;
  anchor: AvatarContactAnchor;
  confidence: number;
  enteredAtMs: number;
  lastObservedAtMs: number;
  slideOffsetLocal: Vector3Data;
}
```

Mọi diagnostic public chỉ chứa semantic/metric; raw landmarks chỉ được xem trong DEV local.

## 4. Hệ tọa độ và calibration

### 4.1 Không gian quan sát người

- Face/Pose/Hand được so sánh trong **image-aspect space**: `x`, `y * videoHeight/videoWidth`.
- Pose world chỉ cung cấp hướng/độ dài tương đối và depth prior.
- Hand world chỉ cung cấp palm basis và finger geometry, không cung cấp vị trí tuyệt đối so với đầu.
- Mọi phép chuyển image delta sang Pose-world phải dùng scale đã calibrate từ shoulder, kèm source/confidence.

### 4.2 Không gian avatar

Khi load VRM, tạo `AvatarContactRigProfile`:

- head capsule/ellipsoid;
- face ellipsoid và các patch má/trán/cằm;
- neck capsule;
- torso capsule/ellipsoid;
- shoulder spheres;
- arm capsules;
- `wrist -> palmCenter/radialEdge/ulnarEdge` rest-local offsets;
- rest palm normal, palm forward, wrist flex/deviation axes;
- upper/lower arm length và reach domain.

Anchor luôn lưu local theo joint cha để đi theo head/torso animation. Không lưu world point cố định.

### 4.3 Sinh anchor không phụ thuộc mesh vertex index

V1 dùng normalized rig geometry, không raycast trực tiếp mesh skinned:

- `headTop`: đỉnh head ellipsoid;
- `forehead`: patch phía trước, phía trên face ellipsoid;
- cheek: patch trái/phải của face ellipsoid;
- `chin`: patch dưới face ellipsoid;
- neck/shoulder/chest: capsule hoặc ellipsoid tương ứng.

Mesh raycast có thể là refinement sau, không là dependency V1 vì skinning, tóc và topology mỗi VRM khác nhau.

## 5. Thuật toán nhận biết vùng người đang chạm

### 5.1 Body-region primitives trong ảnh

Dựng vùng semantic từ landmark:

- Face: ellipse robust bằng quantile như code hiện tại, sau đó chia patch theo tọa độ chuẩn hóa `(u,v)`.
- `headTop`: ngoại suy từ forehead/face height; mở margin cho tóc nhưng confidence thấp hơn face.
- Neck/chest/shoulder: Pose shoulder + face chin + torso basis; chỉ tạo region khi scale hợp lệ.

Với điểm `p`, tính signed normalized distance tới từng primitive. Chọn region bằng chi phí:

```text
C_region = wDistance*d + wContinuity*switchPenalty + wSide*sidePenalty
```

Không đổi region chỉ vì một frame có chi phí thấp hơn. Dùng hysteresis enter/exit và minimum dwell time.

### 5.2 Chọn contact probe của bàn tay

Từ 21 Hand landmarks:

- `palmCenter`: robust centroid của wrist + MCP 5/9/13/17, ưu tiên polygon center;
- `radialEdge`: vùng wrist/index-MCP;
- `ulnarEdge`: vùng wrist/little-MCP;

Tính palm basis từ `handPalmBasis.ts`. Probe classification dựa trên điểm gần region nhất và hướng palm:

- palm-to-surface -> `palmCenter`;
- palm edge-on -> edge gần target;

Nếu chênh lệch score giữa hai probe nhỏ hơn margin, giữ probe trước; không flip mỗi frame.

### 5.3 Contact evidence và depth relation

Không coi overlap 2D là contact. Confidence gồm:

```text
q = qHand * qFacePose * qOverlap * qMotion * qOrientation * qDepth * qContinuity
```

Trong đó:

- `qOverlap`: signed distance probe–region;
- `qMotion`: vận tốc tiếp cận giảm về gần 0 khi chạm;
- `qOrientation`: palm normal hợp lý với surface;
- `qDepth`: scale/occlusion/history cho biết tay ở trước hoặc gần surface;
- `qContinuity`: lịch sử cùng side/region/probe.

Không gộp “ở trước” với “đã contact”. Contract depth riêng:

```ts
type ContactDepthRelation = "in-front-separated" | "surface-compatible" | "behind" | "unknown";

interface ContactDepthEvidence {
  relation: ContactDepthRelation;
  confidence: number;
  sources: {
    occlusion: number | null;
    scaleChange: number | null;
    motionConsistency: number | null;
    posePrior: number | null;
    history: number | null;
  };
}
```

Không source đơn lẻ nào được tạo `surface-compatible`. Trạng thái này cần nhiều cue nhất quán theo thời gian:
overlap đúng region, scale/history phù hợp, chuyển động approach→settled, orientation hợp lý và occlusion/depth
prior không mâu thuẫn. `front` một mình không chứng minh contact. `unknown` không được acquire `touch`; nó chỉ
được giữ contact đã tồn tại trong grace ngắn.

## 6. Contact state machine

State machine theo thời gian thật, chỉ tiến trên detector sample mới:

```text
idle -> approach -> near -> touch -> hold
                         \-> release
hold <-> slide
mọi state -> release -> idle
```

Seed để tuning, không phải ngưỡng nghiệm thu cuối:

- enter `approach`: confidence >= 0.45 trong 50 ms;
- enter `near`: distance <= near threshold trong 60 ms;
- enter `touch`: confidence >= 0.70, depth đúng `surface-compatible` và evidence bền 80 ms;
- enter `hold`: vận tốc probe thấp và touch bền 100 ms;
- short occlusion grace: 120–180 ms, chỉ khi trước đó là `touch/hold`;
- release: confidence dưới 0.35 trong 100 ms hoặc observed motion rời target rõ;
- blend release: 160–240 ms.

Hysteresis phải tách enter/exit. Duplicate timestamp không tăng timer. Reversed timestamp reset velocity, không tạo contact.
Evidence/FSM chỉ tiến theo detector timestamp; acquire/release visual blend tiến theo render `dt` để vừa
FPS-invariant vừa không giật khi detector chậm hơn renderer.

`hold -> slide` chỉ xảy ra khi normal separation còn trong touch band, tangent displacement và tangent velocity
đều vượt enter threshold đủ thời gian. `slide -> hold` khi tangent velocity dưới exit threshold đủ lâu. `slide ->
release` khi normal separation vượt exit threshold. Slide offset bị clamp trong semantic patch.

## 7. Ánh xạ semantic người -> target avatar

Observation chỉ truyền region + tọa độ patch chuẩn hóa, không truyền raw point 3D.

Mỗi region có chart `(u,v)`:

- cheek/forehead/chin trên ellipsoid;
- chest trên capsule;
- shoulder trên sphere;
- headTop trên cap patch.

Map `(region,u,v)` sang local point và normal của avatar. Clamp vào patch để tay không trượt sang mặt sau đầu do noise.

Trong `touch/hold`, anchor lock vào local space của body joint. `slide` chỉ cập nhật offset tangent với giới hạn tốc độ; không thay anchor hoàn toàn mỗi frame.

## 8. Thuật toán contact-aware arm IK

### 8.1 Atomic contact arm/wrist solve

Arm IK và wrist orientation là một owner nguyên tử. Giả sử `T` là surface point, `Qh` là wrist/hand target
orientation và `oProbe` là offset wrist->probe trong hand local:

```text
W = T - rotate(Qh, oProbe)
```

Đây là bước còn thiếu trong pipeline hiện tại. Không đặt wrist trực tiếp tại má/đầu. Trình tự bounded:

```text
probe-specific orientation Q0
-> W0 = T - rotate(Q0, oProbe)
-> two-bone IK
-> orientation refinement Q1
-> W1 = T - rotate(Q1, oProbe)
-> optional final IK nếu residual vượt tolerance
```

Không có wrist solver độc lập chạy sau và làm sai offset vừa giải.

### 8.2 Wrist/hand orientation target

Dựng frame mục tiêu:

- probe contact normal target = `-surfaceNormal` (palm normal chỉ dùng cho `palmCenter`);
- palm forward chiếu lên tangent plane, ưu tiên hướng ngón quan sát được;
- nếu projection suy biến, dùng previous tangent rồi rig rest tangent;
- quaternion shortest-arc + twist alignment;
- clamp wrist flexion/deviation và phân phối pronation/supination giữa lowerArm/hand.

Giải orientation và position lặp tối đa 2 vòng: orientation quyết định probe offset, probe offset quyết định wrist target.

### 8.3 Analytic two-bone IK

Với shoulder `S`, wrist target `W`, chiều dài avatar `L1,L2`:

```text
d = |W-S|
d' = clamp(d, |L1-L2|+eps, L1+L2-eps)
x = (L1^2 - L2^2 + d'^2)/(2d')
r = sqrt(max(0, L1^2-x^2))
E = S + x*axis + r*pole
```

Pole được chấm điểm trên vòng nghiệm, tái dùng nền hiện tại nhưng thêm contact cost:

```text
C = C_history + C_anatomy + C_palm + C_collision
  + C_contactPosition + C_wristOrientation + C_jointLimit
```

Target unreachable:

- không scale xương;
- project target về reach sphere;
- giảm contact influence theo reach error;
- diagnostic `unreachable-contact`;
- nếu error vượt gate, giữ faithful arm thay vì snap vào target giả.

### 8.4 Joint limits và singularity

- soft-limit trong scoring, hard clamp ở output;
- gần tay duỗi thẳng, giữ previous elbow pole/contact pole, không cho flip;
- nếu shoulder–target axis trùng pole, dùng transported previous pole rồi rest pole;
- giới hạn angular velocity và blend acquire/release.

## 9. Collision và penetration correction

Broad phase: sphere/capsule AABB. Narrow phase V1:

- arm capsule vs head/neck/torso primitives;
- palm oriented disc/box vs surface primitive;
- fingertip spheres vs face/head/palm;
- không mesh–mesh toàn phần.

Khi contact chủ ý:

- cho probe chạm đúng target;
- vẫn phạt các phần khác của arm/hand xuyên sâu;
- project probe ra surface theo normal nếu penetration dương;
- chạy **tối đa một corrective IK re-solve** để tránh vòng lặp và giữ budget.
- nếu vẫn vượt hard penetration threshold: giảm influence về baseline; nếu vẫn invalid thì reject sample với
  diagnostic `collision-unsatisfied`, không lặp solver thêm.

Contact không chủ ý: collision là constraint đẩy ra. Contact chủ ý: target probe có signed distance gần 0, các collider khác vẫn không được xuyên.

## 10. Tương tác với finger solver

V1 không tự bịa pose ngón theo gesture label.

- Palm/edge contact: continuous finger solver vẫn sở hữu các ngón.
- Finger-pad contact để AR10/coupled finger-contact solve; AR9 V1 chỉ dùng probe rigid với hand bone.
- Thumb/finger self-contact là task riêng sau body-contact baseline.
- Contact correction không ghi vào wrist bằng finger rotation và không ghi arm bằng finger joint.

## 11. Temporal ownership và thứ tự compose

Thứ tự bắt buộc:

1. faithful torso/head;
2. baseline arm geometry;
3. hand matching/palm basis;
4. contact observation + temporal state;
5. atomic contact arm/wrist solve (orientation, probe offset, IK, refinement, optional second IK);
6. penetration projection + tối đa một corrective IK;
7. continuous finger solve;
8. final limits và diagnostics;
9. renderer áp đúng một lần.

Contact output phải blend theo influence `0..1`. Trong `approach/near`, chỉ orientation hint nhẹ; positional lock bắt đầu ở `touch`, mạnh ở `hold`.

## 12. File/module dự kiến

```text
bodyContactTypes.ts
humanBodyRegions.ts
handContactProbe.ts
contactObservation.ts
contactDepthRelation.ts
contactTemporal.ts
avatarContactRig.ts
contactAnchorMapping.ts
contactWristTarget.ts
contactArmIk.ts
contactCollision.ts
contactDiagnostics.ts
```

Sửa có kiểm soát:

- `avatarMotionProcessor.ts`: orchestration/ownership;
- `normalizedRigProfile.ts` hoặc profile riêng: contact rig capability;
- `armFrameSolver.ts`: tái dùng primitive hoặc tách shared two-bone geometry, không nhồi state machine vào file này;
- `AvatarRendererDevHarness.tsx`: overlay/diagnostic;
- `motionConfig.ts`: toàn bộ seed threshold/timing.

## 13. Chia task triển khai

### AR9-T01 — Observation và depth relation

- Body-region primitives, semantic `(u,v)`.
- Palm/edge/fingertip probe.
- Multi-cue confidence, left/right mirror tests.
- Chỉ diagnostic, chưa sửa avatar.

Gate: hai still fixture xác định đúng `headTop + palmCenter` và `cheek + palmCenter`; thêm replay
approach→head, approach→cheek, pass-by và overlap-không-contact. Overlap đơn thuần không được thành touch.

### AR9-T02 — Avatar contact rig và collision proxies

- Tạo anchor/proxy từ từng VRM.
- Wrist-to-probe offsets và palm rest frame.
- Capability/fail-closed khi rig thiếu.

Gate: ít nhất 3 synthetic rigs + 3 VRM thật; anchor finite, đúng side, đi theo head/torso transform.

### AR9-T03 — State machine

- Approach/Near/Touch/Hold/Slide/Release.
- Duplicate/gap/occlusion/reacquire.
- Không sửa rotations ngoài test harness shadow mode.

Gate: không false touch vì một frame overlap; hold qua occlusion ngắn; nhả đúng khi tay rời.

### AR9-T04 — Contact-aware arm/wrist solve

- Probe-offset wrist target.
- Two-bone IK + candidate scoring.
- Wrist frame alignment.
- Unreachable fallback, acquire/release blend.

Gate: sửa được headTop và hai cheek; baseline byte/tolerance-equivalent khi influence=0.

### AR9-T05 — Penetration correction và nghiệm thu

- Capsule/sphere/ellipsoid collision.
- Một corrective re-solve.
- Metrics, replay, webcam, performance/privacy report.

Gate: không penetration nghiêm trọng, không flip, đạt metric mục 15.

### AR10 follow-up

Sau AR9 mới thêm primitive đặc trưng: chống cằm, che miệng, tay sau gáy, chạm vai/ngực, vuốt tóc. Không gộp tất cả vào PR contact đầu tiên.

## 14. Automated test matrix

### Geometry

- Ellipsoid/capsule closest point và normal.
- `(u,v)` mapping mirror trái/phải.
- Wrist target bù đúng rotated probe offset.
- Two-bone IK giữ đúng `L1/L2` và endpoint.
- Unreachable projection không tạo NaN/scale xương.

### State machine

- Duplicate/reversed timestamp.
- Một frame overlap không touch.
- Approach->touch->hold->release.
- Slide không đổi region vô cớ.
- Occlusion trong/ngoài grace.

### Integration

- Contact OFF/influence 0 không đổi baseline arm/wrist/finger.
- Contact không ghi joint ngoài side sở hữu.
- Head/torso chuyển động khi hold: anchor đi theo parent.
- Model reload/reset xóa contact và history cũ.
- Tay trái/phải và input mirror không đảo cheek.
- Continuous fingers ON/OFF không đổi contact endpoint ngoài probe-offset capability đã khai báo.

### Failure cases

- Tay đi ngang trước mặt nhưng không chạm.
- Che mắt/miệng nhanh.
- Đầu quay trong khi tay đứng yên.
- Target ngoài reach.
- Palm basis suy biến/edge-on.
- Face mất nhưng Pose/Hand còn.
- Hai tay cùng gần một region: V1 giải độc lập nếu không collision nhau; không triển khai mutual hand IK.

## 15. Manual acceptance và metric

Chạy hai tay trên ít nhất 3 VRM:

- chạm đỉnh đầu;
- trán;
- hai má;
- cằm;
- cổ;
- vai cùng bên/đối diện;
- ngực;
- tiếp cận/rời chậm và nhanh;
- giữ contact rồi quay đầu/nghiêng torso;
- che wrist/elbow ngắn và dài;
- target không thể với tới;
- đi tay qua trước mặt nhưng không chạm.

Seed gate:

| Metric | Gate |
|---|---:|
| Non-finite output | 0 |
| Wrong-side contact | 0 |
| Random elbow/wrist flip | 0 |
| Contact false positive trên pass-by | 0 trong bộ acceptance |
| Expected-contact acquisition | seed >= 90%, stretch >= 95% scripted positive trials |
| Touch acquisition latency | median <= 200 ms, p95 <= 350 ms |
| Expected release success | seed >= 95%; không sticky quá timeout |
| Release latency | median <= 220 ms, p95 <= 350 ms |
| Unexpected release khi stable hold | 0 trong acceptance set |
| Palm/probe -> anchor error khi hold | median <= 2 cm, p95 <= 4 cm theo scale avatar |
| Palm-normal error khi palm contact | median <= 15°, p95 <= 25° |
| Penetration ngoài probe cho phép | p95 <= 1 cm; không frame xuyên đầu rõ rệt |
| Hold jitter tại probe | p95 <= 1.5 cm |
| Acquire/release angular discontinuity | <= 12°/joint/frame |
| Contact processing p95 | <= 2 ms/hand trên máy tham chiếu |
| Tracking->render tổng | mục tiêu < 100 ms |
| FPS | >= 24 |

Mọi metric hold/error chỉ hợp lệ khi đủ số successful-contact sample đã định trước. Báo cả precision và recall.
Nếu seed không hợp lý sau webcam evidence, báo raw metric và lý do; không nới âm thầm.

## 16. DEV diagnostics bắt buộc

Overlay:

- human region/probe trong video;
- avatar target point + normal;
- palm probe hiện tại;
- đường shoulder–elbow–wrist target;
- collider và penetration vector.

Panel:

```text
side / phase / region / probe
observation confidence / depth relation
anchor error / normal error / penetration
reach ratio / unreachable reason
pole source / contact influence
sample disposition / age / hold duration
solver time
```

Thêm local-only ring buffer semantic/metric 2–3 giây; không lưu ảnh hoặc raw landmark trong export mặc định.

## 17. Privacy, packet và networking

V1 contact chạy local. Nếu gửi qua mạng sau này, packet chỉ gửi final rig-local rotations và contact semantic tối thiểu khi consumer thật sự cần. Không gửi face/hand landmark hoặc camera-space contact point.

Rig-local quaternion chỉ dùng giữa sender/receiver khi fingerprint/version tương thích; mismatch phải fail closed về baseline pose.

## 18. Các phần cố ý chưa làm

- mesh–mesh physics đầy đủ;
- deformation da/mô mềm;
- tóc phản ứng;
- palm–palm và hand–hand mutual IK;
- cầm vật thể;
- finger–finger/contact grip hoàn chỉnh;
- AI motion completion;
- full-body balance.

## 19. Checklist cho AI reviewer

1. Có phép tính nào trộn Pose world, Hand world và Face image origin không?
2. Contact có thể bật chỉ do overlap 2D không?
3. Region/probe/side có hysteresis và mirror test không?
4. Anchor có ở local space của body joint và đi theo animation không?
5. Wrist target có trừ đúng rotated wrist-to-probe offset không?
6. IK có giữ nguyên chiều dài xương avatar không?
7. Unreachable target có fail mềm thay vì kéo dài xương/snap không?
8. Palm normal và tangent singularity có previous/rest fallback không?
9. Collision có phân biệt intentional probe contact với xuyên của arm/hand khác không?
10. Có giới hạn đúng một corrective re-solve và budget thời gian không?
11. Contact influence=0 có giữ baseline không?
12. Duplicate/reversed/loss/reload có lifecycle xác định không?
13. Finger solver và contact solver có ownership không chồng chéo không?
14. Manual gate có hai tay, 3 VRM, pass-by negative case và occlusion không?
15. Packet/log có giữ privacy và rig compatibility không?

## 20. Definition of Done

AR9 chỉ DONE khi:

- T01–T05 đều đạt automated gate;
- hai lỗi mẫu `headTop` và `cheek` được tái hiện trước fix và pass sau fix;
- manual matrix đủ hai tay/3 VRM;
- có performance/privacy report;
- không regression baseline khi contact không active;
- không còn penetration nghiêm trọng hoặc flip trong bộ acceptance;
- reviewer xác nhận coordinate-space, ownership và lifecycle invariants.
