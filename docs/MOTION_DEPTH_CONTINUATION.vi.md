# Triển khai tiếp depth và hướng tránh xuyên theo cơ thể

Ngày 02/10/2026. HEAD trước đợt này: `8b636f8e2093c39969e7c87267133004f6052eba` (đã chứa đợt triển khai trước). Các thay đổi mới nằm trong working tree. Không sửa nguồn XR.

## Code mới đã nối vào runtime

### Relative arm depth fusion

`frontend/src/lib/avatar-motion/armDepthFusion.ts` chạy theo từng side sau Hand matching, chỉ dùng shoulder/elbow/wrist quan sát thật và Pose-world wrist được arbitration chấp nhận. Nó tạo **mục tiêu retarget**, không thay raw landmarks, không ghi depth đã sửa vào calibration, không thay geometry solver khi thiếu joint.

- Palm apparent size dùng trung bình wrist→middle MCP và index→little MCP, chia shoulder image width. Sửa aspect ratio; dùng Hand-world geometry để kiểm view/foreshortening, không dùng Hand-world làm vị trí tuyệt đối trong body-world.
- Bù foreshortening của vai từ Pose-world để không hiểu nhầm torso yaw thành tay tiến camera. Từ chối shoulders/palm quá edge-on và palm ngoài khung.
- Cần tám observation khác timestamp, cùng pose tương đối ổn định, để lấy median palm ratio/depth/length làm reference. Đây là reference tương đối cho phiên, không phải đo khoảng cách camera theo mét.
- Ratio đi qua One Euro. Palm cue đầy ảnh hưởng freshness đến 200 ms, giảm về zero ở 1000 ms; duplicate/invalid view không gia hạn cue.
- Foreshortening độc lập dùng elbow→Hand wrist **trên ảnh**, shoulder image/world scale và chiều dài lower arm đã calibration (hoặc median từ reference thật). Dấu Z cần Pose hoặc hemisphere history; hình chiếu tự nó không quyết định trước/sau.
- Pose vẫn chiếm ưu thế; trọng số palm tối đa .35, geometry tối đa .2. Khi dấu mạnh mâu thuẫn, giữ Pose; correction bị giới hạn .12 tổng chiều dài người và reach sphere. Những hệ số này là cấu hình thử nghiệm ban đầu, chưa được webcam A/B chứng minh tối ưu.
- Output vào `ArmSpatialEvidence.depthTargetOffset` → `retargetArmEndpoint` → các hướng avatar có exact L1/L2. Chỉ canonical solver quyết định final arm frame; không thêm solver suy elbow liên tiếp.
- Diagnostic nằm trong `arms.left/right.depthFusion`: calibration count, ratio/reference, age, từng weight, từng depth, uncertainty và rejection reason. `applied` ở đây nghĩa cue đề xuất thay target; flag `relative-depth-objective` xác nhận arm solver đã dùng target.

### Body-local depth barrier

`bodyLocalDepth.ts` và `avatarCollisionQuery.ts` dùng forward axis của **body pose hiện tại**, không global camera Z. Renderer lưu ordering head/torso theo từng tay từ pose SEW; trong vùng gần mid-plane có thể dùng ordering mới quan sát để hướng correction về đúng hemisphere. Evidence rõ ở điểm va chạm hiện tại có ưu tiên hơn history.

History chỉ sống 600 ms, không được gia hạn bởi held/reconstructed pose hoặc renderer vẽ lại một detector sample. Tắt công tắc/model change xóa memory. Chỉ đổi normal của **va chạm đang xuyên** ở forearm/hand; không tạo lực hút ở tay đang cách xa cơ thể, không chiếm chain mà body contact đã sở hữu. Exact-length IK, bend hemisphere và correction budget cũ vẫn áp dụng; chỉ publish correction làm collision score tốt hơn.

Đây là chính sách hướng clearance, **không phải sao chép toàn bộ magnet/peak-barrier/z-push của XR**, không phải một quan sát chứng minh tay người thật đang ở sau đầu. Fit collider/semantic contact và final skin FK vẫn cần nghiệm thu.

### Rig-local swing/twist limits

`armDofConstraints.ts` phân rã quaternion rest-relative theo `anatomicalRestBasis.primaryLocal` của từng rig, giới hạn swing và axial twist riêng. Upper swing 160°, upper axial 60°; lower swing 150°, lower axial 165°. Không gộp cả hai vào một total-angle cap. Có continuity ở cả swing antipode và axial antipode.

Đường này opt-in, thay generic arm geometry clamp khi Constraints bật. Minimal-twist upper-arm và Hand twist/swing/neutral pipeline của VeilTalk vẫn giữ; Hand twist correction vẫn có limits của chính nó. **Chưa có shoulder cone bất đối xứng, elbow hinge axis theo calibration giải phẫu hoặc anatomical validator cho mọi model.** Không gọi L hoàn tất từ module này.

## Công tắc và cách thử

Trang `http://127.0.0.1:5173/dev/avatar-renderer` có thêm:

1. **Relative arm depth fusion (A/B)**: giữ hai vai và palm tương đối frontal, giữ tư thế ổn định khoảng 1–2 giây rồi đưa tay gần/xa camera. Nếu mới bật mà chưa đủ observation hợp lệ, vẫn dùng nền cũ.
2. **Body-local depth barrier (A/B)**: thử tay đi trước ngực, hai bên đầu, sau đầu; nó tác động khi renderer phát hiện xuyên proxy. Không cần bật Apply AR9 correction để thử clearance; contact-owned chain được bảo vệ nếu AR9 đang sửa.
3. **Rig-local swing/twist limits (A/B)**: cần giữ **Constraints** bật. So giơ tay, gập khuỷu, pronation và gần 180°; tắt công tắc khôi phục clamp cũ.

Ba công tắc mặc định tắt. Trang `/avatar/motion` cũng có các tùy chọn trong **Tính năng chuyển động đang thử nghiệm**, cùng bộ lọc shape/rig reach/body contact/palms assist từ đợt trước. Có thể bật cùng nhau để stress test; benchmark nên bật riêng để biết cơ chế nào gây lợi/hại.

Replay metadata lưu cả ba flags. Offline A/B hiện có năm variants: baseline, wrist-relative shape, rig endpoint, relative depth và rig-local DOF. Body-local barrier chạy ở renderer nên **không được tính thành hiệu quả trong benchmark processor-only**.

## Kiểm chứng và giới hạn

Các regression kiểm calibration timestamp, raw invariance, calibration length không bị depth contaminate, partial-arm được giữ, palm expiry/edge-on, shoulder yaw/scale, geometry depth cần dấu, body rotation/translation, duplicate renderer draws, posterior correction/no attraction, swing/axial separation và antipodal continuity.

Kết quả cuối và SHA source được lưu ở `docs/motion-review/depth-phase-manifest.json`; logs `depth-phase-tests.log`, `depth-phase-build.log`, `depth-phase-lint.log`. Rig audit đọc rest graph ba VRM, sáu synthetic scenes/model và năm processor variants. Nó không nghiệm thu normalized/raw skin render hoặc camera.

Lượt chốt: **962 test đạt / 116 file**, TypeScript + Vite build đạt, lint exit 0 (warnings cũ vẫn còn). Sáu HTTP route/module/bundle đều 200; source hash DEV khớp source trên đĩa. DEV chạy tại `http://127.0.0.1:5173/dev/avatar-renderer`, production preview local tại `http://127.0.0.1:5174/avatar/motion`. Reload trang để nhận class processor mới nếu tab đã mở từ đợt trước.

Chưa có webcam recording, benchmark XR cùng video hay số đo độ trễ đầu–cuối của đợt này. Chưa bật mặc định các thử nghiệm. Fingertip IK/interlace vật lý, projection objective có camera alignment đầy đủ, collider fit thực tế, full anatomical hinge/cone, remote integration và gates D2/N2/Y vẫn chưa hoàn tất. W vẫn phụ thuộc profiling; không thêm worker chỉ vì có trong danh sách.

## Đối chiếu nguồn XR đã đọc lại

- `SA_system_emulation.readable.js:6906–6967`: palm/shoulder ratio, parameters và temporal cue; nhánh có điều kiện, không mọi mode đều dùng.
- `SA_system_emulation.readable.js:7505–7543`: cue-age decay .2→1 second, blend có gate, arm-length reach bound.
- `SA_system_emulation.readable.js:6123–6169`: projected lengths và `sin(acos(...))`; cần evidence khác để xác định dấu.
- `MMD_SA.js:14847–14887`: chuyển body-local frame và hướng correction; offsets/quy ước MMD không được chép thẳng sang VRM của VeilTalk.

Các module runtime VeilTalk dùng geometry, clock và rig contract riêng; giữ điểm mạnh có sẵn thay vì thay toàn bộ pipeline bằng XR.
