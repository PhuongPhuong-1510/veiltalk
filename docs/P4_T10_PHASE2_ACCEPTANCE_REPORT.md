# P4-T10 — Phase 2 Acceptance Report

> Ngày review: 27/07/2026  
> Phạm vi: parent-local, rest-relative arm retargeting foundation  
> Trạng thái P4-T10: **IN PROGRESS**

## A. Executive verdict

**PHASE 2 PASS WITH CONDITIONS**

- H1 world-to-local đã được sửa trong production solver và renderer.
- Sáu preset bắt buộc cùng `bothForward`, `twistReferenceA/B` đạt `0.00°` trên normalized
  skeleton của model VRM tham chiếu.
- Full suite 106/106, targeted Phase 2 30/30, lint và build PASS.
- H2 twist ambiguity vẫn mở đúng phạm vi; không có scope creep sang IK/palm fusion.
- Tracking-loss snap và lifecycle/resource runtime acceptance chưa hoàn chỉnh.

Verdict này không đồng nghĩa P4-T10 đã hoàn thành.

## B. Scope reconstructed from code

Phase 2 tạo `NormalizedAvatarRigProfile`, capture rest basis từ normalized VRM bones (local/world
position + rotation, parent rest world rotation, child direction và mapping parent/child), solve
bốn khớp upper/lower arm theo parent → child, phát parent-local rest-relative delta và áp
`restLocal × deltaLocal` trong renderer. Coordinate conversion giữ `(x,-y,-z)`.

Phase 2 không triển khai full two-bone IK, elbow pole, swing–twist, palm orientation, chân
hoặc tracking-loss return animation hoàn chỉnh. Không đổi model và không thêm dependency
toán học/IK.

## C. Files changed

| File | Loại | Thay đổi Phase 2 |
|---|---|---|
| `frontend/src/lib/avatar-motion/avatarPoseTypes.ts` | Production | Định nghĩa joint quaternion là parent-local rest-relative delta |
| `frontend/src/lib/avatar-motion/normalizedRigProfile.ts` | Production | Profile plain-data, version/generation/fingerprint; cache position/rotation local + world, parent rotation, child direction và hierarchy; validation và deep-freeze |
| `frontend/src/lib/avatar-motion/jointSolver.ts` | Production | World target → parent-local → rest-relative; solve upper trước lower |
| `frontend/src/lib/avatar-motion/avatarMotionProcessor.ts` | Production | Cài/xóa profile, reset filter, không solve khi thiếu profile |
| `frontend/src/lib/avatar-renderer/modelLoader.ts` | Production | Capture normalized rest local/world/parent/direction theo model generation |
| `frontend/src/lib/avatar-renderer/modelTypes.ts` | Production | Gắn rig profile vào loaded model |
| `frontend/src/lib/avatar-renderer/avatarRenderer.ts` | Production | Tái tạo absolute local bằng `rest × delta`, smooth/apply absolute |
| `frontend/src/components/dev/AvatarRendererDevHarness.tsx` | DEV | Profile wiring, nine frozen presets và quaternion evidence |
| `frontend/src/lib/avatar-renderer/avatarDiagnostics.ts` | DEV | Đo applied world direction từ rest basis và bone world quaternion |
| `jointSolver.test.ts`, `avatarRendererMath.test.ts`, `modelLoader.test.ts`, `avatarMotionProcessor.test.ts`, `avatarDiagnostics.test.ts` | Test | Math, hierarchy, profile, determinism và regression coverage |

## D. Git and dependency evidence

HEAD vẫn là commit P4-T09 `7e74df5`; Phase 1 và Phase 2 đang nằm chung trong working tree
chưa commit, nên Git không thể tách provenance hai phase một cách tuyệt đối. P4-T10 đã thêm
`@pixiv/three-vrm@3.5.5` và `@types/three@0.185.1`; không có dependency mới riêng cho math
Phase 2. Model local bị ignore vì metadata `redistribution=disallow`.

## E. Production solver implementation

Luồng thực tế:

```text
RawTrackingFrameV1
→ tracking state / direction filter
→ solveParentLocalArmRotations()
→ optional constraint trên deltaLocal
→ AvatarPosePacketV1
→ AvatarRenderer.applyPose()
→ restLocal × deltaLocal
→ optional absolute-local slerp
→ normalized bone.quaternion
```

Công thức:

```text
qSwingWorld  = fromTo(restWorldDirection, targetDirection)
qTargetWorld = qSwingWorld × qRestWorld
qTargetLocal = inverse(qParentTargetWorld) × qTargetWorld
qDeltaLocal  = inverse(qRestLocal) × qTargetLocal
qAppliedLocal = qRestLocal × qDeltaLocal
```

Lower arm dùng target world của upper arm đã solve trong cùng packet. Solver không đọc bone
state của renderer hoặc frame trước. Position và scale không bị ghi khi apply pose.

## F. H1 verdict

**Confirmed fixed.** Code production có parent-target inverse, rest-relative delta và
rest-relative reconstruction. Automated parent/grandparent/A-B-A tests và deterministic
real-model presets đều PASS; lỗi Phase 1 từ 90–180° giảm về `0.00°`.

## G. H2 verdict

**Still open.** Solver vẫn chỉ dùng một segment direction; không có bend-plane secondary
orientation, pole target, swing–twist decomposition hoặc palm fusion. Twist A/B cho cùng
upper-arm output là bằng chứng giới hạn này còn tồn tại.

## H. H3/H6 status

H3 vẫn rejected: profile lấy rest basis từ normalized skeleton thật. H6 vẫn rejected:
production conversion không đổi khỏi `(x,-y,-z)`; webcam evidence Phase 1 xác nhận semantic
trái/phải, lên/xuống và hướng camera.

## I. Deterministic model evidence

Điều kiện đo: `reference-avatar.vrm` VRM 0.x, normalized humanoid, filter OFF, constraints
OFF, smoothing OFF, conversion `(x,-y,-z)`, tolerance `≤2°`.

| Pose | Left upper | Left lower | Right upper | Right lower |
|---|---:|---:|---:|---:|
| T-pose | 0.00° | 0.00° | 0.00° | 0.00° |
| Arms down | 0.00° | 0.00° | 0.00° | 0.00° |
| Left arm up | 0.00° | 0.00° | 0.00° | 0.00° |
| Right arm up | 0.00° | 0.00° | 0.00° | 0.00° |
| Left elbow 90° | 0.00° | 0.00° | 0.00° | 0.00° |
| Right elbow 90° | 0.00° | 0.00° | 0.00° | 0.00° |
| Both forward | 0.00° | 0.00° | 0.00° | 0.00° |
| Twist reference A | 0.00° | 0.00° | 0.00° | 0.00° |
| Twist reference B | 0.00° | 0.00° | 0.00° | 0.00° |

Phase 1 baseline lưu trong `P4_T10_PHASE1_DIAGNOSTICS_REPORT.md`: arms-down/arm-up/elbow
từng có sai số 90–180° do world/local và parent compounding.

## J. Automated test evidence

```text
npm.cmd test -- --run --reporter=verbose
Test Files: 21 passed; Tests: 106 passed; Skipped: 0

npm.cmd test -- --run src/lib/avatar-motion/jointSolver.test.ts \
  src/lib/avatar-motion/avatarMotionProcessor.test.ts \
  src/lib/avatar-renderer/avatarRendererMath.test.ts \
  src/lib/avatar-renderer/avatarDiagnostics.test.ts \
  src/lib/avatar-renderer/modelLoader.test.ts --reporter=verbose
Test Files: 5 passed; Tests: 30 passed; Skipped: 0
```

Coverage gồm identity/rotated parent, grandparent, hierarchy, finite/normalized quaternion,
zero direction, A-B-A determinism, six required presets, profile lifecycle và renderer
`rest × delta`. Math tests dùng Object3D fixture; real-model confidence đến từ browser
diagnostics, không giả làm automated VRM integration test.

## K. UI/browser evidence

Chrome được dùng với route `/dev/avatar-renderer`; version chính xác chưa ghi nhận. Model,
material, canvas và nine frozen presets đã chạy thật. Runtime khoảng 73–77 renderer FPS,
frame p95 2.5–2.8 ms; tracking dao động khoảng 22–27 FPS theo log.

Webcam khi nhìn đủ vai–khuỷu–cổ tay: không trôi/giật; khi tracking trở lại không nhảy. Khi
cổ tay rời khung, người dùng thấy snap. Console capture cuối và browser version là
`UNVERIFIED`.

## L. Lifecycle/resource evidence

Code có duplicate-rAF guard, cancel frame, `ResizeObserver.disconnect`, stale-load disposal,
model/geometry/skeleton/material/texture disposal và listener cleanup. Chưa có runtime
measurement trước/sau reload 10 lần, route remount và background/resume; leak verdict là
`UNVERIFIED`, không phải PASS.

## M. Build and production isolation

`npm.cmd run lint` và `npm.cmd run build` PASS; Vite build 1,820 modules. DEV route được
guard bằng `import.meta.env.DEV`. Production `dist` không chứa `P4-T10`, `Retargeting
Diagnostics`, `Frozen presets`, `twistReference`, `bothForward` hoặc `DEV ONLY`.

## N. Privacy evidence

Avatar modules không có network/WebSocket/WebRTC code, camera/canvas capture, MediaRecorder,
disk/storage persistence hoặc raw landmark console logging. Frozen raw frame chỉ ở memory.
Packet serialization test xác nhận không chứa `landmarks` hoặc `facialTransform`.

## O. Regressions and open issues

| Mức | Vấn đề | Trạng thái |
|---|---|---|
| Critical | Regression H1 | Không phát hiện |
| High | H2 twist ambiguity | Mở |
| High | Wrist/palm orientation | Chưa triển khai |
| High | Snap khi cổ tay mất khỏi camera | Mở; loss transition |
| Medium | `returning` chưa tạo target blend về rest thật | Mở |
| Medium | Constraint chỉ clamp tổng góc delta | Cần review khi triển khai twist |
| Medium | Lifecycle reload/background runtime | Chưa xác minh |
| Medium | Model license production | Chưa giải quyết |
| Low | Exact Chrome version/console capture cuối | Chưa ghi nhận |

## P. Phase 3 recommendation

Ưu tiên tracking-loss hold/return/recovery transition; sau đó triển khai elbow plane/pole và
swing–twist stabilization; palm orientation fusion là bước riêng khi hand landmarks đủ tin
cậy. Constraint nên được đánh giá lại trong swing/twist space. Không cần viết lại H1.

## Q. Acceptance checklist

| Tiêu chí | Kết quả | Evidence |
|---|---|---|
| H1 world→local fixed | PASS | Production formula + model diagnostics |
| Rest-relative apply | PASS | Renderer `rest × delta` |
| Parent→child hierarchy | PASS | Upper solved trước lower |
| Không feedback/drift | PASS | Stateless solver + A-B-A |
| Rest/arms/elbow presets | PASS | Nine presets 0.00° |
| Numeric safety | PASS | Zero/finite/normalized tests |
| Tests/lint/build | PASS | 106/106, 30/30, lint/build |
| Production isolation | PASS | Không có diagnostic strings trong dist |
| Privacy | PASS | Không egress/capture/persistence |
| Browser real-model | PASS | Frozen diagnostics |
| Webcam stable input | PASS | Không trôi khi đủ landmark |
| Webcam loss transition | FAIL | Snap khi mất cổ tay |
| Resource lifecycle runtime | UNVERIFIED | Chưa reload 10 lần/background |
| H2 hoàn tất | FAIL | One-vector ambiguity còn mở |
| Không scope creep | PASS | Không IK/twist/palm fusion |

## R. Exact commands executed

```text
npm.cmd test -- --run --reporter=verbose                         exit 0
npm.cmd test -- --run <5 Phase-2 test files> --reporter=verbose  exit 0
npm.cmd run lint                                                  exit 0
npm.cmd run build                                                 exit 0
git status --short                                                exit 0
git diff --stat                                                   exit 0
git diff --name-status                                            exit 0
git diff -- docs                                                  exit 0
git diff -- frontend/package.json frontend/package-lock.json      exit 0
git log --oneline --decorate -n 10                                exit 0
```

Các search code/bundle/privacy dùng `rg -n`; search diagnostic strings trong production
bundle không có match. Không có code, test, dependency, model hoặc commit nào được thay đổi
trong vòng review tạo ra verdict này.
