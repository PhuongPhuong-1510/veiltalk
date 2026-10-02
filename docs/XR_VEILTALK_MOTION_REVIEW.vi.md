# Đối chiếu chuyển động tay XR Animator và VeilTalk; kế hoạch A–Z

> Trạng thái mới hơn: [triển khai tiếp depth/body-local/DOF](MOTION_DEPTH_CONTINUATION.vi.md).

> Bản này giữ số đo và nhận định **baseline trước triển khai**. Code đã được triển khai tiếp trong working tree; xem [trạng thái từng bước, kết quả kiểm chứng và hướng dẫn webcam](MOTION_IMPLEMENTATION_AND_WEBCAM_TEST.vi.md). Những dòng “chưa sửa runtime”, tám test lỗi và F01–F10 bên dưới mô tả đợt khảo sát cũ, không phải trạng thái hiện tại.

Ngày rà soát: 02/10/2026. VeilTalk HEAD `5df5ee8ec6a8f62581844a17af0d886608527004`; XR HEAD `53c20eb91517d2807d142c122a868ca9157c3016`.

Kế hoạch cập nhật ngày 02/10/2026 sau phản biện: benchmark XR sớm tại D2, benchmark nền tại N2 trước contact, hợp đồng reset và quyền correction tại M1, ma trận thử nghiệm XR riêng. Các kết quả source/test dưới đây giữ nguyên từ đợt khảo sát; chưa chạy benchmark hoặc sửa runtime trong lần cập nhật này.

## 1. Kết luận và phạm vi bằng chứng

VeilTalk có nền tảng riêng đáng giữ: nghiệm hình học khi thiếu khuỷu, giữ cẳng tay trong hệ cha khi mất cổ tay, tối thiểu hóa xoắn bắp tay, tách twist cẳng tay khỏi swing cổ tay, góc ngón liên tục, nhận diện danh tính hai tay và chẩn đoán từng nguồn dữ liệu. Không nên thay toàn bộ pipeline bằng XR.

Điểm đáng học nhất từ XR là cách phối hợp các lớp: chuẩn hóa tầm với theo rig, ổn định điểm đích tay, lọc hình dạng bàn tay tương đối với cổ tay, duy trì trạng thái mất/tìm lại tay, sửa điểm đích bằng collider có offset lòng bàn tay, rồi IK và ánh xạ rig theo đúng thứ tự. Đây là các cơ chế thấy trong code; chưa phải kết quả benchmark chứng minh XR thắng mọi trường hợp.

Đã đọc đường chạy tracking → motion processor → renderer của VeilTalk và các thuật toán tay, cổ tay, ngón, contact, va chạm liên quan. Đọc toàn bộ các module lõi như `armFrameSolver`, `continuousFingerSolver`, `wristEvidence`, `wristReconstruction`, các module twist, contact runtime/temporal/correction và collision correction; đọc những đoạn liên quan trong processor lớn, rig builder, upper body và harness. Không tuyên bố đã đọc toàn bộ backend, toàn bộ biểu cảm, mọi test hoặc từng dòng của cả hai repository. Các kết luận dưới đây có căn cứ cụ thể; phần cần webcam được ghi riêng.

XR được đối chiếu với bảy file người dùng cung cấp và ghi chú đã lưu tại `C:/project/SystemAnimatorOnline/docs/mocap-study/README.vi.md`. Đợt này đọc bổ sung phần magnet/body collider và hand/finger mapping. `SA_system_emulation.readable.js` là bản tham chiếu để phân tích: `js/core_extra.js:36` thực tế nạp `.min.js` hoặc `_private/js/SA_system_emulation.js`. Chưa chứng minh toàn bộ bản readable tương đương bản chạy bằng AST/build, nên cần xác nhận phiên bản XR trong benchmark.

Không thay đổi thuật toán runtime trong đợt này. Báo cáo là kết quả khảo sát và kế hoạch triển khai, không phải bản sửa đã nghiệm thu.

### Kết quả kiểm tra tự động hiện tại

- `npm.cmd test -- --reporter=dot`: **105 file đạt, 2 file lỗi; 906 test đạt, 8 lỗi / 914 test**.
- Chạy lại riêng hai file lỗi: **85 đạt, 8 lỗi / 93 test**; tái hiện cùng nhóm lỗi.
- `npm.cmd run build`: **đạt** (`tsc -b` và Vite production build).
- Chưa bật webcam, chưa đo rung/độ trễ hai ứng dụng, chưa nghiệm thu ba VRM. Build đạt không chứng minh chất lượng chuyển động.

## 2. Đường chạy thực tế và công tắc

```text
CameraController
  → TrackingPipeline.requestVideoFrameCallback (fallback requestAnimationFrame)
  → MediaPipe Face → Hands → Pose chạy nối tiếp trên cùng frame
  → mapRawTrackingFrame: state/timestamp/candidates/image + world
  → DEV AvatarRendererDevHarness.onFrame
  → AvatarMotionProcessor.process
      upper body/neutral khi đủ điều kiện
      hand matching + palm basis
      wrist source arbitration + wrist reconstruction
      solveAnatomicalArmFrames
      temporal riêng upper/lower
      forearm twist → wrist swing
      AR9 contact nếu bật shadow/correction
      continuous fingers → bimanual preservation (hoặc legacy gestures)
  → AvatarPosePacket V1/V2
  → AvatarRenderer.applyTarget: restLocal × deltaLocal + smoothing
  → vrm.update + shoulder translation
  → final-pose body collision → inter-arm collision
  → vrm.update(0) + shoulder translation
  → render
```

Trong source hiện tại, chỗ khởi tạo `AvatarMotionProcessor` được tìm thấy ở `frontend/src/components/dev/AvatarRendererDevHarness.tsx:47`; route `/dev/avatar-renderer` chỉ được import trong DEV ở `frontend/src/App.tsx:42`. Chưa thấy cùng đường webcam/motion này được nối vào luồng gọi video production. Phải phân biệt chất lượng harness với mức hoàn thiện sản phẩm.

| Tính năng | Constructor processor | Harness hiện tại | Điều kiện khác |
|---|---|---|---|
| Filter, constraints | Bật | Bật | `avatarMotionProcessor.ts:421` |
| Forearm twist, wrist swing | Bật | Twist bật | Phải có hình học/rig/hand đáng tin |
| Continuous fingers | Tắt | Bật từ lúc tạo processor | Phải có finger rig |
| Gesture/preset legacy | Tắt | Có công tắc; bị vô hiệu khi continuous bật | Không phải đường continuous |
| AR9 contact shadow | Tắt | Bật | Chẩn đoán; chưa sửa pose |
| AR9 contact correction | Tắt | Tắt | Opt-in, webcam gate trong tài liệu chưa đạt |
| Body/inter-arm collision ở renderer | Theo collision profile hợp lệ | Chạy khi có profile và packet | Không phụ thuộc công tắc AR9 |
| Bone smoothing | Theo renderer option | Bật | Arm và finger được làm mượt ở renderer |
| Upper body V2 | Theo calibration/capability | Có calibration | Chưa calibrated thì processor phát V1 |

Tài liệu AR9 có câu “DEV harness bật”; code hiện tại chính xác hơn: **shadow bật, correction tắt**. Không dùng câu cũ để kết luận contact correction đang chạy mặc định.

## 3. Bản đồ file VeilTalk

Các tên ở bảng dưới thuộc `frontend/src/lib/avatar-motion/`, trừ khi ghi rõ thư mục khác. Đây là bản đồ chức năng; không phải mọi file đều được gọi trực tiếp trong baseline.

| Nhóm | File chính | Vai trò thực tế |
|---|---|---|
| Webcam/inference | `tracking/cameraController.ts`, `tracking/mediaPipeRuntime.ts`, `tracking/trackingPipeline.ts`, `tracking/useTracking.ts` | Camera lifecycle; Pose full mặc định; GPU→CPU fallback; lịch lấy frame/inference |
| Hợp đồng dữ liệu | `tracking/rawTrackingTypes.ts`, `tracking/rawTrackingMapper.ts` | Image/world tách biệt; tracked/lost/not-sampled; raw hand candidates; timestamp và kích thước video |
| Điều phối | `avatarMotionProcessor.ts`, `motionConfig.ts`, `avatarPoseTypes.ts`, `avatarMotionDiagnostics.ts`, `handMotionDiagnostics.ts` | Thứ tự các lớp, công tắc, packet V1/V2, provenance và diagnostic |
| Hệ tọa độ/rig | `coordinateAdapter.ts`, `motionMath.ts`, `normalizedRigProfile.ts`, `torsoBasis.ts`; `avatar-renderer/modelLoader.ts` | Semantic `(x,-y,-z)` cho vector; anatomical rest basis; parent/local/world; rig theo model |
| Hình học tay | `armFrameSolver.ts` | Vai–khuỷu–cổ tay; visibility; nghiệm khuỷu; pole; minimal-twist; chuyển quaternion theo cha |
| Nền partial-arm riêng | `armObservability.ts`, `armObservation.ts`, `armSolutionManifold.ts`, `partialArmEstimator.ts` | Chính sách tám mask và manifold; hiện **chưa nối vào processor/armFrameSolver** theo các caller tìm được |
| Mất dữ liệu/chống rung | `armTemporalState.ts`, `trackingLoss.ts`, `idleArmPose.ts`, `oneEuroFilter.ts`, `adaptiveBodyProfile.ts` | Temporal từng đoạn, hold/return/recovery, static hysteresis, One Euro, median/MAD chiều dài |
| Wrist endpoint | `wristEvidence.ts`, `wristReconstruction.ts`, `faceArmSpatialEvidence.ts` | Chọn Pose/Hand; dựng wrist từ ảnh trên sphere; evidence mặt cho arm solver |
| Hand identity/basis | `handPoseMatching.ts`, `handPalmBasis.ts` | Gán hai candidate toàn cục một–một, continuity/handedness mềm; palm frame và quality |
| Forearm twist | `handForearmTwist.ts`, `handTwistConfidence.ts`, `handTwistRig.ts`, `handTwistStabilization.ts`, `handTwistTemporal.ts` | Góc quanh trục cẳng tay, quality gate, rig absolute/session reference, unwrap/neutral/hold/fade |
| Wrist swing | `wristSwing.ts`, `swingTwist.ts` | Flexion/deviation trong hệ hand-rest sau forearm twist; reject disagreement và temporal |
| Ngón liên tục | `continuousFingerSolver.ts`, `fingerFeatures.ts`, `fingerRig.ts`, `thumbOppositionSolver.ts` | Góc từng đốt, MCP abduction/CMC sweep, thumb opposition, mapping trục theo VRM |
| Ngón chạm/xòe/chéo | `fingerContactFeatures.ts`, `fingerContactTemporal.ts`, `fingerSpatialRelations.ts`, `singleHandGestureEvidence.ts` | Feature/temporal và assist nhỏ; không thay toàn bộ pose bằng label |
| Hai bàn tay | `bimanualHandFeatures.ts`, `bimanualGestureEvidence.ts`, `bimanualHandTemporal.ts`, `bimanualContactRuntime.ts` | Evidence heart/palmsTogether/clasp/interlace; giữ nghiệm ngón liên tục khi che ngắn |
| Legacy gesture | `gestureClassifier.ts`, `gestureTemporal.ts`, `fingerPosePlanner.ts`, `fingerPosePresets.ts`, `fingerPoseTemporal.ts`, `gestureFixture.ts` | Nhánh phân loại/preset riêng, chạy khi continuous tắt và gesture bật |
| Body-contact observation | `bodyContactTypes.ts`, `handContactProbe.ts`, `humanSemanticBodyModel.ts`, `humanBodyRegions.ts`, `contactObservation.ts`, `contactDepthRelation.ts` | Probe lòng/cạnh tay, vùng đầu/cổ/vai/thân, evidence/depth tương đối |
| Body-contact solve | `contactTemporal.ts`, `contactRuntime.ts`, `avatarContactRig.ts`, `contactAnchorMapping.ts`, `posedContactAnchor.ts`, `contactWristTarget.ts`, `contactArmIk.ts`, `contactPoseCorrection.ts`, `contactCollision.ts`, `jointSolver.ts` | FSM, anchor theo body pose, wrist offset, two-bone IK và local correction; opt-in |
| Body/inter-arm collision | `avatarCollisionProfile.ts`, `avatarCollisionTypes.ts`, `avatarCollisionQuery.ts`, `avatarCollisionCorrection.ts`, `avatarInterArmCollision.ts`, `avatarCollisionDiagnostics.ts`, `collision/collisionPrimitives.ts`, `collision/collisionTypes.ts` | Sphere/capsule, deepest-first correction có budget, ưu tiên mức quan sát và depth ordering |
| Constraints | `jointConstraints.ts`, `quaternionDistribution.ts` | Arm quaternion-angle caps; upper body dùng semantic distribution/clamp riêng |
| Thân/vai ảnh hưởng tay | `upperBodyCalibration.ts`, `upperBodyRigProfile.ts`, `upperBodyComposer.ts`, `upperBodyTemporal.ts`, `shoulderMotionSolver.ts`, `torsoMotionSolver.ts`, `torsoLeanSolver.ts`, `upperBodyLifeMotion.ts`, `upperBodyMetrics.ts` | Neutral, torso/head/shoulder hierarchy, chống nhầm lean thành shrug, giới hạn capability |
| Render/đo lường | `avatar-renderer/avatarRenderer.ts`, `avatar-renderer/renderSmoothing.ts`, `avatar-renderer/rendererMetrics.ts`, `tracking/trackingMetrics.ts` | Final FK, retarget, render smoothing, VRM transfer, collider theo pose, thời gian xử lý |
| Công cụ kiểm chứng | `components/dev/AvatarRendererDevHarness.tsx`, `components/avatar/AvatarCanvas.tsx`, `handCalibrationAnalysis.ts`, các `.test.ts` tương ứng | Bật/tắt lớp, freeze/evidence capture, diagnostics; chưa thay manual gate |

## 4. Những điểm VeilTalk cần giữ

### 4.1. Mất wrist không giết upper arm

`avatarMotionProcessor.ts:827` tách upper/lower validity. `:933` giữ lower bằng **parent-local rest-relative delta**; upper tiếp tục bám vai→khuỷu. `motionConfig.ts:867`: generic hold 250 ms, partial wrist hold 600 ms, return 500 ms, recovery 180 ms. `armTemporalState.ts:225` giữ output đã ổn định cuối cùng, tránh snap về raw target.

Giữ nguyên tính chất này khi bổ sung endpoint IK/contact. Không biến một wrist thiếu thành sự kiện reset cả hai đoạn tay. XR cũng có fallback từ elbow khi wrist không đủ; khác biệt không phải “chỉ VeilTalk biết dự đoán”, mà là VeilTalk có policy/diagnostic riêng từng segment rõ ràng.

### 4.2. Nghiệm thiếu khuỷu có chiều dài và lịch sử

`armFrameSolver.ts:609` dựng circle từ vai/wrist và L1/L2. Nhánh mặc định `:726` tiếp tục pole lịch sử hoặc prior rig; không để missing data tự tạo ý định chuyển động mới. `:929` chỉ cho infer không timeout khi chiều dài đã calibrated và wrist từ Pose quan sát; wrist reconstructed vẫn có timeout/trust khác.

Giữ lịch sử quan sát thật tách khỏi nghiệm suy ra. `avatarMotionProcessor.ts:911` chặn inferred elbow liên tục ghi đè bend anchor. Chuyển sang vị trí contact mới cần bằng chứng contact độc lập và blend có kiểm soát.

### 4.3. Minimal twist upper arm và tách forearm/wrist

`armFrameSolver.ts:1137` parallel-transport secondary; upper arm dùng minimal twist thay vì để pole tiêm axial roll vào bắp tay. `handTwistRig.ts` áp `poseLowerDelta × twistDelta`. `avatarMotionProcessor.ts:963` dùng lower world đã có twist để dựng các trục swing cổ tay. `wristSwing.ts` conjugate world swing qua **lowerWorld × handRestLocal**, phù hợp contract renderer.

Giữ phép chia trách nhiệm: forearm pronation/supination thuộc lower arm; flexion/deviation thuộc hand; twist không được sửa wrist endpoint. Đây là ưu điểm kiến trúc đã thấy trong code, chưa phải chứng minh góc đo thực tế luôn hơn XR.

### 4.4. Calibration không bị mất mỗi lần che tay

`handTwistStabilization.ts` giữ neutral qua tracking reset; unwrap vào nhánh gần neutral cũ. Processor giữ neutral ở discontinuity/reacquire cùng rig và reset theo model/session phù hợp. Phải kiểm thử lại khi đổi worker hoặc lịch inference.

### 4.5. Ngón liên tục và bảo vệ ngón đang duỗi

`continuousFingerSolver.ts` đo các đốt riêng, MCP theo palm plane; 8° extension dead zone trong observation; median window, validation theo chiều dài, One Euro, hold 80 ms → prediction tới 180 ms → safe-return tới 450 ms theo config.

Có 2D extension evidence hai sample để bác 3D curl giả; gate frontal palm và ngoại lệ index pointing edge-on; contact strength ngăn override xóa pinch thật. Có prior từ consensus các ngón gập và assist contact. Giữ continuous observation là nguồn chính; cần kiểm chứng prior/assist không sửa nhầm gesture đặc biệt.

### 4.6. Matching và bimanual không ép preset

`handPoseMatching.ts` giữ raw candidates, assignment một–một, handedness mềm, continuity, identity switch margin và bootstrap missing side. `bimanualContactRuntime.ts` chỉ giữ/lọc nghiệm ngón vừa quan sát; **không tạo contact vật lý fingertip-to-fingertip**, không khóa wrist hai tay vào nhau.

### 4.7. Va chạm đã có nền và có budget

`avatarCollisionCorrection.ts` giữ baseline khi không collision hoặc <2 joint quan sát; correction bảo toàn L1/L2 và kiểm tra topology. `avatarInterArmCollision.ts` xét tất cả cặp upper/forearm/hand capsules giữa hai bên, tay ít quan sát được cho phép dịch nhiều hơn; depth ordering được renderer duy trì.

Giữ “không evidence → không tự bịa wrist intent”, exact baseline khi không va chạm và collider theo pose hiện tại. Không bỏ lớp này chỉ để bắt chước XR.

## 5. XR có gì đáng học; đâu chưa đủ bằng chứng để nói hơn

| Khía cạnh | Cơ chế XR đã thấy | VeilTalk hiện tại | Hướng áp dụng |
|---|---|---|---|
| Điểm đích tay/tỉ lệ người–avatar | Readable khoảng 5855–6301 chuẩn hóa độ vươn theo chiều dài tay; rig measurement 3271–3443; IK callback 8947–9157 | Baseline chủ yếu ánh xạ hướng các segment sang rig; có wrist reconstruction và contact IK riêng | Thử endpoint objective theo image wrist + tỷ lệ reach + rig; giữ elbow branch và partial policy |
| Tay trên/sau đầu | `MMD_SA.js:14706` body colliders; readable 8312–8690 peak barrier/z-push, palm offset; 8987 chỉ nối collider khi active | Có backHead/backNeck semantic/contact surfaces; correction tắt; generic renderer collision đã chạy | Học target correction + palm radius/offset theo rig; tách occlusion prediction khỏi contact thật |
| Độ sâu | Pose image/world reconstruction; shoulder scale; hand-depth temporal 7514–7536; palm/finger z heuristics trong mocap module | Pose world full; wrist sphere ±Z theo prior; contact depth mềm | Học scale/depth temporal và geometry sanity checks; giữ uncertainty, không coi webcam là cảm biến đo khoảng cách |
| Hand/finger shape ổn định | `mocap_lib_module.js:1237` trừ wrist trước lọc 21 point rồi cộng wrist hiện tại | Lọc góc ngón sau dựng palm; có median/One Euro | A/B wrist-relative landmark conditioning trước dựng palm/angles; đo độ trễ và hướng palm |
| Khi mất/tìm lại tay | Visibility session, hand correction ngắn, adaptive arm filters và entry/exit blends | Segment state, wrist source hysteresis, twist/finger holds | Kế thừa policy VeilTalk; bổ sung quality-aware target/filter tuning và shared reset contract |
| Rig khác rest pose | MMD A/T conversion, VRM rest transforms và twist-bone transfer trong MMD_SA | Native normalized VRM rig, local rest delta, finger axis/profile per model | Học calibration/proportion và deformation order; không mang tên bone/góc hằng MMD sang VRM |
| Hai tay va chạm | Đường body-collider đã đọc tạo head/chest/waist/hip; chưa xác nhận dedicated automatic hand↔hand solver ở XR | Inter-arm collider và bimanual finger preservation đã có | Không kết luận XR thắng hạng mục này bằng code đã đọc; benchmark crossing và true palm contact riêng |
| Ngón đẹp hơn | XR dựng basis bàn tay và vector đốt trong palm frame, đồng thời hiệu chỉnh input | Continuous angle+abduction, thumb sweep/contact assist và rig axes | So measured angles/FK endpoints/temporal trước; không thay continuous bằng legacy pose library |

Điểm “XR hơn” mạnh nhất có thể khẳng định từ khảo sát là **có các lớp target/rig/temporal/collider phối hợp theo luồng IK lâu đời**. Mức hơn về jitter, latency, tay sau đầu và ngón phải đo cùng điều kiện. Tuổi dự án 7 năm/vài tháng do người dùng cung cấp, không dùng làm chứng cứ chất lượng thuật toán.

Không nên sao chép XR nguyên xi: thresholds theo MMD units, tọa độ mirror, enum parallel/synced, A/T offsets, global state và một số nhánh dữ liệu cũ khác VeilTalk. Chẳng hạn `mocap_lib_module.js:1156` chỉ nhận một shape world landmarks nhất định; `:1219` tính `dz` từ thành phần `[1]`. Đây là dấu hiệu cần kiểm tra khi chuyển ý tưởng, không là code chuẩn để chép.

## 6. Các điểm cần xử lý trước khi thêm thuật toán

### F01 — Partial estimator riêng chưa phải đường chạy

Search caller của `estimatePartialArm`, `buildArmObservations`, `classifyArmObservability` cho thấy estimator chỉ được gọi trong test; `armObservation` dùng classifier nhưng chưa nối processor. Baseline partial-arm thật nằm trong `armFrameSolver` + processor + temporal.

Không viết kế hoạch như thể `partialArmEstimator.ts` đã điều khiển avatar. Quyết định dùng nó làm policy chung hay giữ baseline hiện tại; tránh hai estimator hoạt động song song.

### F02 — “24 candidates” không có nghĩa đang chọn 24 nghiệm

`motionConfig.ts:1475` đặt 24. Nhưng `armFrameSolver.ts:726` chọn một `continuationPole`, gọi evaluate đúng pole đó rồi trả kết quả; palm/anatomy/face/collision branch flags đều false. Nhánh legacy <3 mới so prior/opposite. Comment phía trên và candidateCount diagnostic có thể gây hiểu nhầm đang search tối ưu.

Giữ nguyên ý nghĩa missing-data continuity; sửa diagnostic/contract trước khi cân nhắc search trong **contact được xác nhận**. Đừng bật best-score branch choice cho partial-arm chỉ vì XR dùng IK.

### F03 — Depth hysteresis có API nhưng caller chưa dùng

`wristReconstruction.ts` hỗ trợ `preferredDepthSign` và switch margin. Hai lời gọi ở processor `:1340`, `:1354` không truyền preferred sign. Hiện vẫn chọn dấu gần direction trước nhất, nhưng chưa dùng state giữ hemisphere qua API này. Cần thêm history đúng epoch và replay khi crossing camera plane; không giữ dấu cũ vô hạn khi người thực sự đi ra sau đầu.

### F04 — Metadata wrist reconstructed cần đi xuyên pipeline

Processor ghi wrist dựng lại vào solver copy với visibility=1 ở `:1363`. Solver nhận metadata `wrist.source`, dùng để hạn timeout/trust, nhưng `observedLengths` ở `armFrameSolver.ts:1255` chỉ kiểm tra elbowObserved/lowerDirectionValid. Processor `:921` dùng observedLengths để calibration. Do đó một lower length dựng lại có thể đi vào đường calibration “observed” nếu elbow thật còn thấy.

Đây là lỗ hổng provenance cần kiểm chứng bằng integration test; chưa kết luận là nguyên nhân webcam cụ thể. Cần ngăn inferred/reconstructed point tự nâng cấp thành measurement thật, đồng thời cập nhật visibility history đúng ý nghĩa.

### F05 — Twist confidence chưa dùng trọn matching mới

Processor `:1465` tự tính matchQuality từ distance; distance=null (bootstrap) bị đưa quality=0 mặc dù matcher có `matchQuality`. Caller truyền raw handedness score; không truyền `handednessCompatibilityQuality` mà module hỗ trợ. Cũng không truyền `projectionQualityOverride` cho absolute rig solver.

Không kết luận mọi bootstrap bị reject (quality còn phụ thuộc thành phần khác), nhưng đường nối hiện tại bỏ qua chất lượng matcher đã tính và side compatibility. Cần integration test đúng assigned side, absolute rig branch và bootstrap.

### F06 — Contact thiếu Hand world ở điểm nối

`avatarMotionProcessor.ts:1104` gọi `ContactRuntime.update` đến tham số enabled; bỏ `handWorldLandmarks`, `handedness`. Runtime mặc định world=null; `orientationEvidence` cần worldBasis nên trả các orientation cue=null. Hand image vẫn được truyền, contact vẫn có đường hoạt động; không nói toàn bộ contact chết.

`ContactRuntime.update` còn truyền `occlusion:null`, `scaleChange:null` vào depth fusion. Độ sâu hiện chạy từ motion/Pose prior/probeDepth/history, chưa phải đầy đủ các cue độc lập theo tên “multi-cue”. Probe depth có cộng Hand image z offset vào Pose image wrist z; cần xác thực tỉ lệ/quy ước trước khi xem là calibrated cue độc lập.

### F07 — Hai lớp correction có thể tranh nhau khi bật AR9

AR9 ghi upper/lower/hand rotations vào packet; renderer sau đó smoothing arm và luôn chạy body/inter-arm correction khi profile hợp lệ. Renderer không nhận contact exclusion/ownership rõ trong packet hiện tại. Nó có thể đẩy palm khỏi bề mặt contact hoặc đổi forearm orientation sau wrist solve.

Đây là xung đột kiến trúc tiềm tàng và code path có thật; cần replay/FK cuối cùng để chứng minh ảnh hưởng từng scene. Tài liệu AR9 nói renderer không thêm IK/smoothing; code đã khác quy tắc đó. Không bật correction mặc định trước khi giải quyết ownership.

### F08 — Lọc nhiều lớp và đạo hàm ở output khác input

Arm có direction/pole One Euro → quaternion stabilizer → renderer damping(20/s) → collision correction. Finger có median → One Euro → bimanual blend → renderer damping(28/s). Một số lớp có mục đích khác nhau; không xóa tất cả, cũng không cứ thêm filter nữa.

`isProcessorOwnedRotation` chỉ bypass smoothing cho V2 hips/spine/chest/upperChest/neck/head/shoulders, không bypass arm/hand/fingers. Comments cũ “finger không double smooth” không phản ánh hoàn toàn dòng alpha hiện tại. Đo raw/solved/packet/applied riêng mới xác định được nguồn rung/trễ.

### F09 — Constraints và collider mới là proxy

`jointConstraints.ts` giới hạn tổng góc quaternion quanh rest, không phải elbow hinge hoặc shoulder swing cone + axial limits đầy đủ. Không dùng nhãn “anatomical” để kết luận ràng buộc đủ mọi hướng sau đầu.

Collider dimension từ bề rộng vai/neck-head và multiplier; không fit chính xác bề mặt mesh. Tay có thể không xuyên collider nhưng vẫn xuyên tóc/áo/đầu chibi, hoặc bị giữ quá xa mesh. Cần capability/profile per model và debug proxy so với skin.

### F10 — Eight failing tests: phân loại đúng trước sửa

Sáu lỗi trong `avatarMotionProcessor.test.ts`: torso/face yaw shoulder-only; missing Pose wrist từ Hand; giữ shoulder scale khi che vai; dựng wrist rồi infer khi elbow+wrist Pose cùng ẩn; palm branch với twist tắt; calibration observed/inferred.

Hai lỗi trong `bimanualHandTemporal.test.ts`: detector-time confirmation và unsampled-gap occlusion. Fixture đầu file dùng `const features={} as BimanualHandFeatures`; runtime chỉ chấp nhận `features.valid`. Đây là bất tương thích fixture/API thấy trực tiếp; không đủ căn cứ nói FSM thực tế hỏng chỉ từ hai lỗi này.

Test palm-branch cũng đang yêu cầu flag mà nhánh mặc định mới chủ động không tạo. Phải chốt intended behavior + cập nhật fixture/assertion hoặc thuật toán theo đúng hợp đồng, không thay code chỉ để xanh. Các lỗi wrist/yaw còn cần tái hiện/điều tra; không suy luận nguyên nhân khi chưa đo.

## 7. Kiến trúc đích đề xuất

Mỗi estimated joint cần source, observation timestamp, confidence, age, uncertainty và epoch. Observation thật, reconstruction, prediction và hold không được dùng thay nhau trong calibration/observability. Motion semantic tách khỏi rig mapping; temporal evidence chỉ được xác nhận trên detector sample mới.

```text
Raw synchronized observation
  → identity + quality + wrist-relative hand conditioning
  → human arm/hand state with provenance + uncertainty
  → faithful baseline (giữ partial-arm và twist hiện hữu)
  → optional rig-aware wrist endpoint objective
  → confirmed contact / clearance constraints
  → một nơi quyết định correction cuối cho chuỗi tay
  → parent-local arm solve + forearm twist + wrist orientation
  → continuous finger retarget + contact assist có giới hạn
  → temporal/render interpolation được phân quyền
  → final FK validation + VRM transfer
```

“Một nơi quyết định correction” có thể là coordinator giữa solver và renderer; không bắt buộc chuyển mọi phép toán vào processor ngay. Cần đúng final posed body/shoulder/raw VRM transform. Hai phương án phải A/B: solve toàn correction trước packet với FK tương đương renderer; hoặc renderer xử lý constraint cuối nhưng tôn trọng contact intent/locked anchor và không phá twist/wrist. Chọn phương án qua gate FK, remote-avatar và latency, không chỉ theo độ dễ viết.

Một nơi có quyền quyết định cuối không có nghĩa chỉ còn một solver. Baseline, contact và collision có thể dùng solver riêng dưới cùng hợp đồng ưu tiên, exclusion, correction budget và final-FK validation. Hợp đồng phải được chốt trong M1; triển khai phối hợp đầy đủ ở O trước bật contact. Thứ tự trong sơ đồ là trách nhiệm logic; dependency giữa hand orientation, probe offset và endpoint cần được giải bằng số lượt hữu hạn, không vòng lặp correction không giới hạn.

### Hợp đồng reset phải chốt trước khi thêm bộ nhớ temporal

Không mặc định tạo năm bộ đếm epoch độc lập. Trước hết lập bảng sự kiện nào làm dữ liệu/lịch sử nào mất hiệu lực; dùng session/model/source/calibration identity hoặc epoch chỉ khi cần biểu diễn sự mất hiệu lực đó.

| Sự kiện | Lịch sử cần mất hiệu lực hoặc giảm trust | Dữ liệu có thể giữ nếu điều kiện còn đúng | Gate |
|---|---|---|---|
| Không lấy mẫu detector trong một frame | Không coi là observation mới; tăng age theo thời gian | Hold có giới hạn, identity và neutral cùng phiên | Không xác nhận contact/gesture bằng duplicate |
| Mất một joint/hand ngắn | Confidence và prediction theo nguồn/segment giảm | Upper quan sát thật, lower local hold, neutral rig hợp lệ | Không reset cả tay vì mất wrist |
| Chuyển nguồn Pose↔Hand↔reconstructed | Kiểm tra source-dependent depth/velocity history; không cho inference vào calibration | Hình học/bend history còn tương thích được giữ có gate | Không flip hemisphere hoặc nhảy endpoint do nguồn đổi |
| Camera restart, đổi mirror/resolution hoặc timestamp discontinuity | Sample matching, velocity và image-coordinate caches phải kiểm tra/reset | Rig calibration không phụ thuộc camera; neutral chỉ giữ nếu contract cho phép | Không trộn evidence trước/sau restart |
| Đổi model/rig | Rig-local axes, collider, lengths và rig-dependent neutral mất hiệu lực | Observation người nếu còn cùng camera/subject | Không áp cached local rotation của model cũ |
| Recalibration hoặc đổi người | Body scale/neutral và history phụ thuộc calibration cũ | Chỉ state chứng minh độc lập calibration | Calibration mới không lấy reconstructed/held sample làm quan sát |

Depth hemisphere state cần gắn với side, source và phiên còn hợp lệ, kèm age/confidence. Khi mất hiệu lực phải chuyển về unknown hoặc prior có trust thấp; không giữ dấu độ sâu vĩnh viễn chỉ vì từng chọn một nghiệm.

Endpoint objective baseline đề xuất: wrist image error + reach ratio error + observed segment direction error + temporal/bend-plane continuity; weight theo source confidence. Contact endpoint đề xuất: `targetWrist = bodySurfacePoint - desiredHandRotation × probeOffset`. Dùng L1/L2 avatar, không kéo dài xương để đạt target.

## 8. Kế hoạch triển khai A–Z

Các bước là backlog có phụ thuộc và điều kiện nghiệm thu, không phải lịch tuần tự theo chữ cái hoặc lời hứa thời gian. D2 và N2 là hai cửa benchmark bổ sung. Hợp đồng ownership ở O phải được thiết kế sớm trong M1; kiểm tra identity ở T và jitter/latency ở V chạy xuyên suốt. W có thể được đưa lên sớm nếu profiling chứng minh cần thiết. Mỗi thay đổi thuật toán phải có switch A/B và rollback baseline; không bật toàn bộ cùng lúc.

Ma trận chuyển giao ý tưởng và quyết định giữ/bỏ được theo dõi tại [XR_TECHNIQUE_MATRIX.vi.md](XR_TECHNIQUE_MATRIX.vi.md). Mỗi thử nghiệm phải ghi invariant, baseline/config/hash, kết quả và giới hạn; ý tưởng có trong XR không tự động là tính năng nên bật trong VeilTalk.

### A. Đóng băng baseline và phiên bản hai dự án

- Việc: lưu commit, hash source/model, config, VRM fingerprint, camera resolution, mirror convention, CPU/GPU delegate và các switch.
- File: manifest khảo sát; `motionConfig.ts`, `mediaPipeRuntime.ts`, harness; XR readable/min/runtime config.
- Đầu ra/gate: cùng recording và cấu hình có thể chạy lại; xác nhận đúng source XR đang chạy. Không benchmark bản readable chưa được nối runtime.

### B. Làm sạch tám lỗi kiểm thử bằng phân loại hợp đồng

- Việc: tách fixture lỗi, assertions cũ và regression thật; đặc biệt valid bimanual fixture, continuity-vs-palm branch, wrist reconstruction và torso yaw.
- File: hai `.test.ts` lỗi, `armFrameSolver.ts`, `wristEvidence.ts`, processor, bimanual temporal.
- Gate: full suite xanh với giải thích mỗi thay đổi; không giảm assertion kiểm tra partial-arm/identity/rig để “đạt”.

### C. Tạo bộ scene replay thống nhất

- Việc: capture local có kiểm soát scene tay trung tính; giơ/chạm đỉnh đầu; sau đầu/sau gáy; tay qua mặt nhưng không chạm; hai tay crossing/chắp/vỗ; đưa tay vào camera; mất elbow/wrist; open/fist/pinch/point/thumb/peace.
- File: harness capture, `gestureFixture.ts` hoặc fixture mới dành motion, replay runner mới nếu cần.
- Gate: timestamps/video size/source được giữ đúng; frame unsampled/lost/duplicate/out-of-order tái tạo được. Không gửi raw webcam/landmarks vào production network.

### D. Đo theo tầng để biết lỗi nằm ở đâu

- Việc: ghi wrist image/Pose estimate/Hand estimate/solved FK/packet FK/rendered FK; raw/applied twist; finger angles; rejection/constraint/contact influence.
- File: diagnostics, `trackingMetrics.ts`, `rendererMetrics.ts`, harness.
- Gate: phân biệt detector jitter, geometry error, rig mismatch, temporal lag và collider displacement trong mỗi scene; diagnostic có timestamp/epoch.

### D2. Benchmark XR sớm và chọn vấn đề ưu tiên

- Việc: sau C/D chạy cùng video recording qua từng ứng dụng để so chất lượng đầu–cuối; ghi detector, config, runtime XR thật và model. Làm thêm landmark replay/ablation từng lớp khi adapter hai pipeline cho phép; không coi cùng video là cùng detector output.
- File: capture/replay harness, diagnostics/metrics, adapter benchmark; ma trận kỹ thuật XR.
- Đầu ra: báo cáo baseline đầu tiên cho endpoint, overhead/behind-head, crossing identity, finger fidelity, jitter và latency; xếp lỗi theo detector → geometry → retarget → temporal → final correction.
- Gate: khác input/rig/detector được ghi rõ. Chênh lệch cho biết hành vi khác nhau, chưa chứng minh nguyên nhân; chỉ gán lợi ích cho reach normalization, filter hoặc worker sau ablation riêng. Không cần chờ mọi thuật toán mới hoặc toàn bộ matrix đa máy ở Y mới có kết quả so sánh.

### E. Chốt hệ tọa độ và timestamp

- Việc: test mirror input vs CSS display, left/right chirality, `(x,-y,-z)`, image aspect ratio, parent-local/world; thống nhất capture/detector/render clocks.
- File: `coordinateAdapter.ts`, raw mapper/types, `handTwistRig.ts`, tracking pipeline, torso basis.
- Gate: cùng pose có cùng semantic trên 16:9, 4:3, portrait; q/−q tương đương; duplicate không xác nhận contact. Face matrix không mặc định áp cùng chuyển dấu với vector Pose.
- Đầu ra bổ sung M1: bảng reset ở mục 7 được cụ thể hóa theo caller/state thật; chọn identity/epoch cần thiết rồi test restart, source switch, model switch và recalibration. Không thêm counter chỉ để hoàn thiện sơ đồ.

### F. Hoàn thiện rig contract trên ba VRM

- Việc: audit actual normalized/raw bones, rest hand/frame/palm normal, upper/lower lengths, fingertip children, model forward và shoulder translation.
- File: modelLoader, normalizedRigProfile, fingerRig, upperBodyRigProfile.
- Gate: FK từ packet khớp bone thực; model thiếu capability bị giảm chức năng có lý do. Không dùng hằng góc A/T của XR như quy ước VRM.

### G. Nối và kiểm thử metadata còn thiếu

- Việc: caller truyền Hand world/assigned handedness cho contact; matcher quality/side compatibility cho twist; thêm depth sign history đúng epoch; bảo toàn wrist reconstructed provenance và calibration eligibility.
- File: processor `prepareArmPoseEvidence`/`applyHandTwist`/contact call, wrist reconstruction/evidence, hand confidence/matching.
- Gate: integration test đi qua caller thật; bootstrap không bị đánh giá bằng raw label certainty; reconstructed length không tự thành observation thật. Mỗi nhánh có diagnostic chứng minh được dùng.

### H. Chốt một partial-arm policy

- Việc: chọn đường hình học chính thức: giữ `armFrameSolver` hiện tại rồi dùng estimator làm policy/observability hỗ trợ, hoặc thay đường hình học bằng estimator sau chứng minh replay. Đây là quyết định cần ghi lý do ở M2, không mặc định nối hai bộ inference liên tiếp. Cover tám mask SEW, SE-, S-W, -EW, S--, -E-, --W, ---; ghi unknown DOF/uncertainty thực tế.
- File: partial estimator/observation/manifold, arm solver, processor.
- Gate: giữ SE- upper hoạt động/lower local hold; S-W tiếp tục bend branch; ít bằng chứng không tạo mục tiêu mới; thời gian kéo dài có degrade/release. Không suy ra history vô hạn là tracking chính xác.
- Chỉ một đường quyết định nghiệm khuỷu/wrist canonical cho mỗi frame; cùng provenance, timeout và history contract. Nếu tiếp tục dùng continuation pole, không bật palm/anatomy branch chỉ vì test cũ yêu cầu flag.

### I. Wrist-relative hand conditioning học từ XR

- Việc: thử lọc `handPoint[i] - handWrist` và cộng wrist hiện tại, quality gate và geometry sanity trước palm basis/angles; tách translation khỏi shape filter.
- File: module conditioning mới nếu cần; handPalmBasis, continuousFingerSolver; nguồn XR mocap `:1237`.
- Gate: jitter palm/angles giảm so baseline, không tăng translation lag quá budget; bảo vệ pinch/open hand và edge-on. Giữ raw input bất biến để replay.

### J. Depth tương đối và scale có uncertainty

- Việc: temporal cho shoulder scale/palm scale, giữ hemisphere có hysteresis; lựa chọn depth cue Pose/foreshortening/shape/history theo quality; tách body-depth và hand-local-depth.
- File: wrist reconstruction, adaptiveBodyProfile, depth relation, motion config.
- Gate: tay về camera rồi ra sau đầu không lật ±Z bởi nhiễu; ambiguity lớn → hold/degrade; không cộng các z khác đơn vị mà không adapter. Không mô tả output là khoảng cách metric đã đo.

### K. Retarget wrist endpoint theo rig

- Việc: thêm thử nghiệm endpoint objective khi evidence đủ: image wrist + observed segment direction + normalized reach; solve L1/L2 avatar với bend history.
- File: arm solver, rig profile, contactArmIk tái sử dụng hình học phù hợp; có thể tách retarget objective module mới.
- Gate: wrist image alignment/raised palm tốt hơn trên ba rig; không làm xấu partial-arm và cross-body; unreachable có reason và quality giảm. Không dùng contact để che baseline endpoint sai.

### L. Constraints theo DOF thay vì chỉ tổng quaternion angle

- Việc: xây shoulder swing region/axial limit, elbow flexion và forearm twist limits riêng; chuyển source-compatible axes sang rig-local; giữ continuity gần singularity.
- File: jointConstraints, arm solver, swingTwist, rig profile.
- Gate: overhead/behind-head reachable thật không bị cắt oan; elbow không gập ngược; clamp sau FK có sai số được báo. Đây là thay đổi cần gate đa model, không phải tăng angle cap chung.

### M. Giữ và nghiệm thu twist/swing hiện hữu

- Việc: A/B absolute-rig palm reference vs session-relative; test static/pronation/±π, wrist flexion lúc forearm quay, loss/reentry và toggle.
- File: bộ handTwist*, wristSwing, processor.
- Gate: twist không dịch endpoint; wrist axes theo lower frame cuối; cùng pose trở lại cùng orientation sau occlusion. Không đổi neutral chỉ vì tay vừa hiện lại.

### N. Sửa finger fidelity trước contact

- Việc: đo human angles vs rig applied axes; open hand/edge-on index/thumb sweep; audit consensus prior/contact assist/zero reset; conditioning trước angle solve.
- File: continuousFingerSolver, fingerFeatures, fingerRig, thumbOppositionSolver, finger contacts/spatial.
- Gate: ngón duỗi không quặp; pinch/point/peace/cross không bị consensus thành fist; exact source và confidence; không chỉ nhìn classifier label. Nếu cần fingertip contact IK thì phải là feature riêng có gate.

### N2. Benchmark nền lần hai; cửa bắt buộc trước contact

- Việc: chạy lại cùng bộ D2 sau các thay đổi M2, so VeilTalk baseline cũ, VeilTalk mới và XR; ablation từng conditioning/depth/endpoint/constraint/twist/finger change. Kiểm identity từ T và jitter/latency từ V ngay trong gate này.
- File: replay/benchmark, ma trận kỹ thuật, diagnostics, final-FK capture trên ba VRM.
- Gate: partial-arm và neutral được giữ; open hand/raised palm/baseline wrist endpoint đạt ngưỡng đã chốt; từng thay đổi có lợi ích hoặc tradeoff được ghi. Test/build đạt cùng regression scene. Nếu lỗi còn ở baseline thì quay về H–N; không dùng body-contact attraction để che lỗi nền.
- Contact correction vẫn opt-in và không được dùng làm điều kiện để baseline trông đúng. Scene tay sau đầu hoàn toàn mất quan sát được đánh giá bằng bounded continuation/uncertainty, không bằng độ chính xác pose thật không có ground truth.

### O. Hợp nhất quyền correction và quyền smoothing

- Việc: chọn coordinator và thứ tự baseline→contact/clearance→twist/wrist→final FK; xác định renderer sở hữu interpolation nào; contact exclusions/correction budget đi qua contract đúng cách.
- File: processor, avatarPoseTypes, contact runtime/correction, renderer, renderSmoothing, collision modules.
- Gate: tắt contact khôi phục baseline; bật contact renderer không phá anchor; final FK sau VRM update là số đo chuẩn; remote avatar cũng tái tạo hành vi. Không thêm IK độc lập thứ ba.
- Thiết kế contract ở M1, thực thi và nghiệm thu ở M3: baseline/contact/body/inter-arm solver cùng coordinator; output phải báo layer nào sửa gì, với budget nào. Không đồng nhất ownership cuối với việc xóa các solver chuyên biệt.

### P. Fit body/palm collider theo rig/model

- Việc: debug overlay head/neck/chest/torso/palm; tune radius/offset theo rig proportions; profile riêng cho head lớn/tóc/áo; học palm offset/body proxy từ XR.
- File: modelLoader, avatarCollisionProfile, avatarContactRig, query/primitives, harness.
- Gate: collider phản ánh khoảng clearance cần thiết trên ba model; correction budget scale theo chiều dài rig; không yêu cầu collider proxy bằng collision mesh tuyệt đối.

### Q. Hoàn thiện contact evidence độc lập

- Việc: cung cấp orientation đã nối; nếu thêm occlusion/scale cue phải đo từ signal thật và mô tả directional convention; history chỉ giữ state, không tạo bằng chứng contact.
- File: contactObservation, depthRelation, handContactProbe, human semantic/body regions, runtime.
- Gate: tay đi qua mặt ở phía trước không tự bị hút lên mặt; contact đang có được hold ngắn khi che; stale hand/face/pose không xác nhận mới.

### R. Nghiệm thu contact vùng trước trước

- Việc: palm/edge chạm forehead/cheek/chin/headTop/shoulder/chest; target = surface - rotated probe; kiểm normal orientation và slide across semantic boundaries.
- File: avatarContactRig, anchorMapping, posedAnchor, wristTarget, contactArmIk/correction/temporal.
- Gate: final probe error nhỏ và normal đúng; touch/hold/slide/release không snap; không scale bone; false positive scene được kiểm riêng. Correction vẫn opt-in trong giai đoạn này.

### S. Tay sau đầu và sau gáy

- Việc: staged motion phía trước→đỉnh→sau đầu; kết hợp history và fresh depth cue; backHead/backNeck surface theo head/neck pose; mất tay hoàn toàn phải tăng uncertainty/release.
- File: humanSemanticBodyModel, bodyRegions, contactRuntime, reconstruction/partial state, contact rig.
- Gate: không xuyên đầu trong quá trình đi ra sau; không hút tay đang ở phía trước sang sau; biết phân biệt inferred vs observed. Một webcam không nhìn thấy tay sau đầu hoàn toàn thì chỉ continuation có giới hạn, không cam kết đo được pose thật.

### T. Hai tay crossing và chống đổi danh tính

- Việc: kiểm matcher với duplicate label, side mismatch, một/two hand visible; depth order uncertainty; inter-arm correction tôn trọng observation và contact intent.
- File: handPoseMatching, bimanual features/temporal, avatarInterArmCollision, renderer coordinator.
- Gate: không swap trái/phải bởi candidate index hoặc nhiễu; không đẩy nhầm tay mạnh hơn; crossing theo chiều sâu ổn định cả hai thứ tự.
- Identity replay và duplicate-label test bắt đầu từ C/G, được chạy ở từng M1/M2 gate. Phối hợp inter-arm correction với contact intent hoàn thiện ở M3; không đợi contact mới kiểm matching.

### U. Contact thật giữa hai tay và ngón

- Việc: phân biệt palms together/clasp/interlace/heart semantic với contact constraints trên avatar; dùng actual palm/fingertip FK per model; contact-aware collider exclusions + bounded retarget assist.
- File: bimanual runtime/features, finger rig/contact/spatial; module target/constraint mới khi cần.
- Gate: chắp tay không bị generic capsule đẩy tách quá xa; heart/clasp không thành preset cứng; mất một bàn tay hold rồi nhả; fingertip reach giới hạn. Hiện tại bimanual preservation không đủ để gọi là physical contact solve.

### V. Tối ưu chống rung theo quality và tốc độ

- Việc: đo ablation từng filter/stabilizer/render damping/collider; tune static vs moving vs occluded; học adaptive filters XR nhưng map đơn vị/clock đúng.
- File: One Euro, armTemporalState, upperBodyTemporal, twist/finger temporal, renderer smoothing/config.
- Gate: giảm static jitter có số liệu cùng scene mà không tăng độ trễ quá budget; genuine fast motion không bị giữ như outlier; source-switch/reacquire không pumping.
- Việc xuyên suốt từ D: thử subject-scale adaptation cho cutoff/beta trong đơn vị đã chuẩn hóa; đo riêng đáp ứng khi người tiến/lùi camera để tránh pumping. Weighted stickiness/default-motion blending chỉ thử ở uncertainty/loss thích hợp, không thay observed pose đáng tin bằng pose đẹp. Giữ/bỏ bằng ablation jitter–latency–fidelity, không bằng cảm giác mượt.

### W. Tách inference khỏi main thread khi số liệu yêu cầu

- Việc: profile Face+Hands+Pose nối tiếp; thử worker/OffscreenCanvas, hand crop hoặc lịch staggered; latest-frame policy, monotonically increasing timestamp và stale-age budget.
- File: tracking pipeline/runtime/camera, raw mapper/types/metrics; worker adapter mới nếu cần; tham khảo XR workers/crop.
- Gate: responsiveness cải thiện trên máy mục tiêu; landmark crop được map về full image đúng; không trộn Hand/Pose khác thời điểm; restart/dispose không leak. Không mặc định worker hoặc detector confidence thấp luôn tốt hơn.
- Nếu C/D cho thấy serial inference chiếm khoảng 40–50 ms trên thiết bị mục tiêu và gây long task/stale frame, có thể đưa W lên M0/M1 sau chốt timestamp contract. Đây là dấu hiệu để profiling, không ngưỡng tự động quyết định dùng worker. Đo inference cost, transfer/queue overhead, throughput và detector→render age trước/sau.
- XR có nhánh bù dịch XY hand cũ theo chênh wrist Pose hiện tại–cũ; không phải bù đầy đủ rotation/deformation. Chỉ thử translation compensation với age/quality limit và đúng clock; tay xoay nhanh hoặc trễ quá budget phải reject/degrade, không ngoại suy như observation mới.

### X. Tích hợp đường chạy production/remote

- Việc: đưa pipeline đã nghiệm thu vào luồng gọi video; contract normalized rotations và contact/ownership metadata nếu cần; model capability fallback; render phía nhận.
- File: App/routes, AvatarCanvas, tracking hook, packet/transport hiện có và integration mới.
- Gate: người nhận thấy cùng semantic motion trên rig khác; không phụ thuộc DEV component; production không gửi raw frame/landmark. Đừng coi production build nhỏ hiện tại là pipeline đã nối.

### Y. Benchmark XR/VeilTalk và nghiệm thu đa máy

- Việc: cùng input/same camera conditions, cùng scene/model khi khả thi; đo quality riêng detector vs render; ba VRM, ít nhất máy phổ thông và máy yếu; ánh sáng/occlusion/FPS variation.
- File: replay/benchmark harness, diagnostics, report mới.
- Gate: từng feature có before/after, failure cases và latency/jitter/endpoint/collision/contact metrics; khác detector/rig thì ghi rõ confounder. Quan sát người dùng dùng để chọn scene, không thay số đo.
- Y mở rộng và xác nhận lại D2/N2 trên đa máy/model và production/remote; không phải lần đầu so XR. Không kết luận VeilTalk vượt XR hoặc đủ production chỉ từ kiến trúc gọn hơn, tuổi dự án hay số test.

### Z. Bật từng tính năng, ghi nhận phiên bản, giữ rollback

- Việc: defaults chỉ đổi khi scene gates đạt; sửa docs stale, lưu config/hash/source provenance; toggle baseline/endpoint/contact/conditioning/worker độc lập; update training handoff notes.
- File: motionConfig, processor options/harness, roadmap/status/acceptance docs.
- Gate: full tests + build + replay + webcam/3 VRM/performance đạt; regression partial-arm/twist cũ vẫn đạt; có baseline rollback. Không đánh dấu DONE bằng số test hoặc commit đơn lẻ.

## 9. Bộ nghiệm thu và chỉ số đề xuất

Các con số sau là **ngưỡng khởi đầu đề xuất**, chưa phải kết quả đo hiện tại hoặc tiêu chuẩn XR. Cần chốt từ baseline/máy mục tiêu sau C/D, rồi giữ cố định khi A/B.

| Chỉ số | Cách đo | Gate đề xuất ban đầu |
|---|---|---|
| Static jitter | RMS góc so rotation trung bình trong cửa sổ giữ pose; thêm wrist FK deviation | Giảm ít nhất 25% vs baseline ở scene đang rung; không làm xấu đáng kể scene tốt |
| Wrist image endpoint | FK wrist chiếu vào camera đã calibration/alignment; chuẩn hóa shoulder width | So baseline và XR; không dùng px nếu khác resolution/camera |
| Reach/length | L1/L2 từ FK so rig rest lengths | Không thay bone length; numeric error trong tolerance solver |
| Contact endpoint | Khoảng cách final avatar probe→posed surface anchor / total arm length | p95 ≤ 3% total arm length ở contact reachable, confident |
| Contact normal | Góc giữa probe normal và đối normal surface tại final FK | p95 ≤ 25° ở contact được xác nhận |
| False contact | Scene tay đi trước/qua mặt và near-not-touch có nhãn | Báo precision/recall, ưu tiên không hút nhầm; số label đủ trước đặt % |
| Identity | Swap left/right không chủ ý trong crossing replay | 0 swap trong bộ regression đã chốt |
| Temporal | Raw detector→packet→render age, movement response; p50/p95 | Không tăng p95 latency >20 ms do một feature corrective mới, trừ tradeoff được ghi rõ |
| Occlusion | Mất wrist/elbow/hand 80/180/250/600/1200 ms và dài hơn | Policy hold/return/reacquire đúng nguồn; không inference vô hạn từ datum cũ |
| Finger fidelity | MCP/PIP/DIP/abduction, extension false curl, pinch tip distance trên rig | Giữ open/point/peace đúng; không dùng gesture accuracy thay endpoint error |
| Performance | Inference/processor/render time, long tasks, frame drops, stale age | Chốt theo hardware; không tăng cost khi feature tắt |

### Scene matrix bắt buộc

1. Hai tay buông/giữ trước ngực 10 giây: jitter và drift.
2. Giơ tay trên đầu, chạm forehead/headTop/ear/mouth; cánh tay đủ và bị crop.
3. Trước đầu→trên đầu→sau đầu/gáy; quay đầu trong khi tay giữ contact.
4. Tay qua mặt nhưng cách xa; palm xoay cả hai mặt; contact thật rồi rút tay.
5. Tay chĩa camera, duỗi gần thẳng, chuyển trước/sau mặt phẳng ảnh.
6. Mất riêng wrist: upper vẫn hoạt động; mất riêng elbow: bend history không flip.
7. Hai tay crossing ở cả depth orders, detector đổi label/candidate order.
8. Chắp/vỗ/clasp/interlace/heart; mất một hand rồi hai hand.
9. Open/fist/point/peace/thumb up/down/pinch/OK/crossed fingers, frontal và edge-on.
10. Torso yaw/lean/shrug kết hợp nâng tay; kiểm wrist baseline khi cha chuyển động.
11. Full-rate/staggered, 10/15/30 detector Hz, render 30/60; duplicate/stale/discontinuity.
12. Model/session/camera restart, calibration khi tay không neutral; ba VRM có proportions khác.

## 10. Thứ tự ưu tiên để bắt đầu

| Mốc | Phạm vi và thứ tự | Đầu ra có thể review | Điều kiện chuyển mốc |
|---|---|---|---|
| M0 — Baseline và so sánh sớm | A/B; C/D; D2. Capture baseline lỗi trước khi sửa B; có thể làm replay và phân loại test song song | Config/hash, phân loại tám test lỗi, bộ replay, số đo từng tầng, báo cáo XR đầu tiên và matrix thử nghiệm | Baseline tái lập; lỗi test có kết luận hợp đồng; số đo không lẫn rig/detector/clock. XR benchmark chưa chạy phải ghi thiếu, không gọi M0 hoàn tất |
| M1 — Hợp đồng dữ liệu và quyền sửa pose | E/F/G; thiết kế ownership/smoothing của O; reset matrix | Coordinate/rig contract ba VRM, provenance/calibration eligibility, metadata wiring, reset rules, coordinator contract | Integration test qua caller thật; camera/source/model/calibration transitions đúng; raw evidence bất biến; một nơi có quyền correction cuối được xác định |
| M2 — Nền chuyển động chính xác | H; thử riêng I/J/K/L; nghiệm thu M/N; N2. Identity T và jitter/latency V chạy cùng mọi thay đổi | Quyết định geometry canonical, báo cáo A/B mỗi cơ chế, baseline wrist/twist/finger, benchmark lần hai | Không regression partial-arm/neutral/identity; ngón và endpoint đạt gate trên ba rig; jitter–latency tradeoff rõ; test/build đạt. Không đạt thì quay lại nền |
| M3 — Contact và collision | Thực thi O; P/Q; R trước; S sau; phối hợp T; U cuối | Final correction coordinator, collider/profile, contact evidence, contact vùng trước/sau đầu và hai tay có report riêng | Final rendered FK giữ anchor/normal/bone length; false-contact/crossing/loss gates đạt; không hút tay để che baseline sai |
| M4 — Hiệu năng và sản phẩm | V tiếp tục; W khi profiling cần; X/Y/Z | Production/remote integration, benchmark đa máy/model, defaults đã nghiệm thu, rollback và docs | Full tests/build/replay/webcam/performance đạt theo scope; không phụ thuộc DEV harness; chỉ bật tính năng có bằng chứng |

**Việc đầu tiên là A/B/C/D/D2**, không bắt đầu bằng contact hoặc thay toàn bộ arm solver. Sau M0, dùng số đo để chọn các thử nghiệm M2 ưu tiên. Hợp đồng O phải có từ M1, còn code phối hợp correction được hoàn thiện trước R/S/U. T và V là kiểm tra liên tục; W có thể lên sớm nếu profiling yêu cầu, nhưng vẫn phải giữ coordinate/timestamp/reset contract.

Mỗi mốc lưu: commit/config/model fingerprint, recording/fixture, lệnh kiểm chứng, kết quả đạt/không đạt, known limitations và quyết định bật/tắt. Chưa có benchmark webcam hiện tại; các mốc là kế hoạch, không là trạng thái đã hoàn thành. Ước lượng thời gian chỉ chốt sau M0 khi rõ capture, hardware và lỗi nền.

Các việc cần giữ bất biến suốt kế hoạch: upper vẫn cập nhật khi wrist mất; lower giữ local delta có giới hạn; observation khác inference; neutral không drift qua occlusion; forearm twist khác wrist swing; finger observation không bị label thay pose; không kéo dài xương; final rendered FK là căn cứ chất lượng.

## 11. Tài liệu tham chiếu nội bộ và chỗ cần cập nhật

- `docs/AR9_HAND_BODY_CONTACT_IMPLEMENTATION_PLAN.md`: xác nhận webcam prerequisite fail; cần cập nhật flags, caller world orientation và renderer correction ownership.
- `docs/P4_T10_PHASE3B_PARTIAL_ARM_ACCEPTANCE_REPORT.md`: PASS lịch sử case A/B; mô tả anatomy/palm branch cũ không dùng thay code continuity hiện tại.
- `docs/P4_T10_PHASE3B4_WRIST_RECONSTRUCTION_STATUS_AND_ACCEPTANCE.md`: đối chiếu source arbitration mới và integration gate.
- `docs/AR6_CONTINUOUS_FINGER_TRACKING_IMPLEMENTATION_PLAN.md`: đối chiếu continuous default ở processor vs harness.
- `docs/12_CURRENT_IMPLEMENTATION_STATUS.md`: trạng thái dự án, không thay manual measurement của bản hiện tại.
- `C:/project/SystemAnimatorOnline/docs/mocap-study/README.vi.md`: ghi chú XR, manifest và snapshot bảy source gốc.

Điểm chưa thể khẳng định từ đọc code: XR tự xử lý hand↔hand vật lý tốt hơn; khoảng cách metric chính xác từ một webcam; pose thật khi tay bị đầu che hoàn toàn; VeilTalk hiện đã ít jitter/ít latency hơn hoặc kém hơn bao nhiêu; contact đã đạt trên ba VRM. Các câu này chỉ có thể chốt sau bộ benchmark trên.
