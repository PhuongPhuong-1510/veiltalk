# Kế hoạch nghiên cứu tiếp xúc tay–mặt và ánh xạ lên avatar

Ngày lập: 02/10/2026. Mốc code khảo sát: `be9c634c768bdf4ebfbc81b984c3b7eda9a56a10`.

Trạng thái: đề cương nghiên cứu ứng dụng, chưa triển khai thuật toán mới, chưa có kết quả thực nghiệm. Đây là phần nghiên cứu tiếp nối AR9, dùng lại pipeline contact hiện có. Các con số nghiệm thu dưới đây là mục tiêu đề xuất, không phải độ chính xác đã đạt hay bảo đảm sẽ đạt.

## 1. Mục tiêu và giới hạn kết luận

Mục tiêu là tái hiện đúng **vùng giải phẫu, phần bàn tay tiếp xúc, vị trí và hướng tiếp xúc trên từng avatar**, đồng thời hạn chế nhận nhầm tay đang lơ lửng trước mặt thành chạm mặt. Khi quan sát không đủ, thuật toán phải biểu diễn sự không chắc chắn và giảm hoặc từ chối correction.

Phạm vi chính: má trái/phải, thái dương trái/phải, trán và cằm; hai bên tay; lòng bàn tay, cạnh phía ngón cái, cạnh phía ngón út. Đầu ngón trỏ–mặt là nhánh tiếp theo với gate riêng. Mũi, môi, quanh mắt là vùng kiểm tra nhầm lẫn và nhánh mở rộng, chưa tự động cho phép correction. Đỉnh đầu, tai và sau đầu vẫn thuộc AR9 rộng hơn, không dùng kết quả mặt phía trước để tuyên bố đã xử lý chúng.

Một webcam RGB là đầu vào khi chạy sản phẩm. Camera phụ được phép dùng trong thí nghiệm để xác minh nhãn chạm/không chạm, không truyền vào thuật toán. Phân biệt ba kết luận: nhận đúng ý nghĩa thao tác; tạo tiếp xúc hợp lý trên avatar; đo đúng tiếp xúc 3D của người thật. Hai kết luận đầu không tự chứng minh kết luận thứ ba.

## 2. Cơ sở dữ liệu và nguồn

Face Landmarker Web trả về 478 landmark mặt, cùng blendshape và ma trận biến đổi nếu bật các tùy chọn tương ứng. Các đầu ra này cung cấp hình học và tư thế để xây dựng giả thuyết vùng mặt; API không xuất nhãn tiếp xúc tay–mặt. [Tài liệu Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

Hand Landmarker trả về 21 landmark ảnh, landmark world và handedness. `z` của landmark ảnh có gốc tại cổ tay; landmark world dùng mét với gốc ở tâm hình học bàn tay. Vì vậy Hand world không trực tiếp cho vị trí tuyệt đối của tay so với đầu. [Tài liệu Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js).

Pose Landmarker có gốc độ sâu ảnh và world ở trung điểm hông. Các bộ dữ liệu Hand, Pose và Face cần một phép đăng ký tọa độ có kiểm chứng trước khi tính khoảng cách xuyên bộ. Việc cùng có trường `x/y/z` không chứng minh chúng thuộc cùng không gian. [Tài liệu Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

Tài liệu Face Mesh/Face Geometry mô tả screen coordinates theo mô hình weak perspective và bước chuyển sang metric space với camera ảo, canonical model và phép fit. Đây là cơ sở nghiên cứu hệ đầu cục bộ; không được hiểu rằng Tasks Web tự cung cấp toàn bộ hệ metric thống nhất với Hand/Pose. Phải kiểm tra quy ước của đúng phiên bản/model đang dùng. [Nguồn chính thức Face Mesh](https://github.com/google-ai-edge/mediapipe/wiki/MediaPipe-Face-Mesh).

Tài liệu học thuật nền để đọc sâu trong P0: [Real-time Facial Surface Geometry from Monocular Video on Mobile GPUs](https://arxiv.org/abs/1907.06724), [MediaPipe Hands: On-device Real-time Hand Tracking](https://arxiv.org/abs/2006.10214). Đề cương đã đối chiếu mô tả API và abstract hai bài; chưa coi đây là tổng quan học thuật đầy đủ hay bằng chứng cho thuật toán contact được đề xuất.

P0 bổ sung tổng quan có bảng đối chiếu nguồn sơ cấp: tìm theo `contact-aware motion retargeting`, `monocular hand-face interaction`, `hand-object contact estimation`, `self-contact reconstruction`; đọc phương pháp và evaluation của các bài liên quan. Mỗi nguồn ghi loại cảm biến, hệ tọa độ, contact representation, dữ liệu/ground truth, độ trễ, cách xử lý occlusion và khả năng áp dụng với VRM/Web. Phương pháp dùng depth sensor, multiview hoặc offline optimization được tách khỏi phương pháp RGB realtime. Không chuyển số accuracy từ bài toán khác thành kỳ vọng của VeilTalk và chưa tuyên bố tính mới học thuật trước bước này.

## 3. Hiện trạng đã kiểm tra trong repository

| Lớp | Bằng chứng trong code | Ý nghĩa cho nghiên cứu |
|---|---|---|
| Thu nhận dữ liệu | `frontend/src/lib/tracking/mediaPipeRuntime.ts:124–125`; `rawTrackingMapper.ts:55–59` | Blendshape, matrix và toàn bộ landmark mặt được giữ. Không cần thay model trước khi có bằng chứng dữ liệu hiện tại thiếu. |
| Mô hình mặt người | `humanSemanticBodyModel.ts:120–199` | Má/thái dương dựng bằng nội suy một số mốc 2D và hệ số cố định; confidence chủ yếu dựa vào mốc hữu hạn và nguồn suy ra. Chưa phải xác suất landmark nhìn thấy/chạm đúng. |
| Hướng đầu | `humanSemanticBodyModel.ts:264,334–336`; `humanBodyRegions.ts:18` | Có tham số yaw, hiện chủ yếu giảm confidence bên xa. Các lời gọi quan sát/vùng trong `ContactRuntime.update` chưa truyền yaw và chưa dùng matrix mặt để dựng hệ đầu 3D. |
| Chọn phần bàn tay | `handContactProbe.ts:11–44`; `contactObservation.ts:39–58` | Có ba rigid probe. Chi phí chọn probe/vùng chưa chứa orientation; orientation chỉ tham gia confidence sau khi đã chọn. Đầu ngón chưa thuộc hand–body contract. |
| Độ sâu | `contactRuntime.ts:207–225,303–315` | Có phép cộng offset Hand-image z vào Pose-image wrist z; không thấy hệ số đăng ký thang đo tại nhánh này. `posePrior` và `probeDepth` cùng phụ thuộc depth model đã dựng, không phải hai phép đo độc lập. Occlusion và scaleChange đang là `null`. |
| Trạng thái tiếp xúc | `contactTemporal.ts:107–126` | Acquire yêu cầu `surface-compatible`, unknown chỉ giữ contact ngắn. Comment trong `contactRuntime.ts:233–234` còn mô tả unknown acquire fallback, không khớp FSM thực tế; cần đồng bộ đặc tả/comment khi triển khai. |
| Ánh xạ avatar | `avatarContactRig.ts:91–96`; `contactAnchorMapping.ts` | Đã có surface liên tục theo family đầu, tránh nhảy theo nhãn patch; vẫn là ellipsoid theo rig, chưa chứng minh khớp da mặt từng VRM. Thái dương có nhãn người nhưng chưa có region correction riêng trong contract. |
| Đo cuối pipeline | `renderedContactGeometry.ts`; `avatarRenderer.ts:getFinalArmSnapshot` | Có raw-bone/normalized FK và proxy collision. Cần phân biệt sai số proxy với sai số trên skinned mesh; snapshot renderer có sequence riêng. |
| Nghiệm thu | `docs/AR9_HAND_BODY_CONTACT_IMPLEMENTATION_PLAN.md`; `docs/MOTION_ROUND2_CONTACT.vi.md` | AR9 có code opt-in, tài liệu ghi webcam gate chưa đạt. Các test/audit synthetic được ghi trong tài liệu không thay thế nghiệm thu camera. |

Những điểm trên là bằng chứng code và rủi ro cần thí nghiệm. Chưa có recording của lỗi cụ thể để kết luận nguyên nhân ảnh bị lệch, mức đóng góp của từng lỗi hay giới hạn cuối cùng của webcam.

## 4. Câu hỏi và giả thuyết nghiên cứu

| Mã | Giả thuyết có thể bác bỏ | Thí nghiệm quyết định |
|---|---|---|
| H1 | Patch nhiều landmark trong hệ đầu cải thiện phân biệt má/thái dương/trán khi đầu xoay so với ellipse ảnh hiện tại. | Cùng recording, giữ nguyên detector/probe/depth/solver, chỉ đổi mô hình vùng; đo macro-F1 và nhầm lẫn theo yaw. |
| H2 | Chọn đồng thời vùng và probe bằng hình học + orientation giảm nhầm lòng/cạnh tay. | So chi phí hiện tại với chi phí có orientation; giữ nguyên face model và FSM; đo confusion, số lần đổi probe sai. |
| H3 | Đăng ký thang đo và biểu diễn uncertainty giảm nhận nhầm overlap 2D thành contact. | So depth hiện tại với depth đã đăng ký và phương án unknown bảo thủ; tập hard negative và bootstrap đang chạm sẵn. |
| H4 | Surface/avatar probe khớp mesh giảm lỗi cuối ngay cả khi ý định contact đã được gán đúng. | Cấp region/probe/contact đúng bằng nhãn chuẩn, so ellipsoid với surface đã fit trên nhiều VRM. |
| H5 | Đo và sửa có giới hạn sau chuỗi renderer làm giảm residual mà không tăng xuyên hay giật. | Đo trước IK, sau IK, sau blend/renderer/VRM; bật riêng refinement, kiểm rollback và chi phí. |

Chấp nhận một giả thuyết khi cải thiện xuất hiện trên người/session/điều kiện chưa dùng để tuning và không đánh đổi bằng tăng hút sai hoặc giảm coverage quá mức. Không mặc định “nhiều landmark hơn” sẽ tốt hơn.

## 5. Chuẩn hóa hệ tọa độ và đồng bộ thời gian

Lập bảng contract cho mọi nguồn: origin, unit, scale, trục, dấu z, handedness, mirror, kích thước/crop ảnh, timestamp nguồn, tuổi mẫu và nguồn đo/suy ra. Khóa phiên bản package thực tế từ lockfile, hash các model `.task`, fingerprint VRM và cấu hình thí nghiệm.

Giữ ba tầng rõ ràng: image-aspect để đối chiếu hình chiếu; hệ đầu/camera đã đăng ký để suy luận hình học; avatar head-local/hand-local để retarget. Không nhân nghịch đảo ma trận mặt trực tiếp với raw normalized `x/y/z`. Trước đó phải xác định hai dữ liệu có cùng unit, origin và projection hay không.

Thử nghiệm dấu trục/mirror bằng chuyển động trái/phải, tiến/lùi, yaw/pitch/roll đã biết; kiểm cả hai tay. CSS mirror không làm thay đổi semantic side. Kiểm ma trận theo layout thực tế, phép chiếu lại và sai số reprojection, không suy quy ước chỉ từ tên biến.

Hand world cung cấp hình dạng và hướng tương đối. Đăng ký vị trí tay có thể neo vào Pose wrist, nhưng cần fit scale/rotation, camera và residual qua nhiều frame; một mốc chung đơn lẻ không đủ chứng minh đăng ký 3D đầy đủ. Offset depth chỉ được cộng sau chuyển đổi đã xác minh; nếu không xác định được scale đáng tin cậy, dùng cue mềm và trả unknown.

Không coi `posePrior` và `probeDepth` xuất phát từ cùng Pose/Hand model là hai bằng chứng độc lập. Kiểm nguồn gốc cue trong log; fit score có calibration thay vì nhân hoặc cộng tùy ý rồi gọi đó là xác suất.

Contact chỉ được tích lũy bằng mẫu detector mới; ghi riêng skew giữa Face/Hand/Pose. Với cue cũ, giảm confidence hoặc từ chối acquisition. Không gia hạn dwell bằng frame render trùng. Giữ sequence đầu vào → packet → render cuối; không đánh giá hai snapshot khác sequence như cùng một thời điểm.

## 6. Phương pháp đề xuất

### 6.1 Vùng mặt liên tục trong hệ đầu

Giữ mô hình 2D hiện tại làm baseline. Nhánh thử nghiệm dựng patch từ tập landmark quanh vùng mắt, mũi, miệng và contour; định nghĩa nhãn trong hệ đầu, không chia vùng theo X màn hình khi đầu xoay. Dùng topology đã kiểm chứng của model cụ thể, không tùy ý nối toàn bộ 478 điểm; các điểm iris không được coi là mặt da để tiếp xúc.

So hai mức: polygon/triangulation theo hình chiếu có pose compensation; surface đầu 3D đã đăng ký với phép chiếu nhất quán. Bắt đầu với mức đơn giản hơn, chỉ tăng độ phức tạp nếu H1 hoặc H3 cần. Robust fit loại outlier và ghi residual. Ma trận rigid mô tả tư thế đầu; blendshape/landmark cần xử lý riêng nếu biểu cảm làm đổi bề mặt.

Mỗi patch có normal/tangent, tọa độ cục bộ liên tục, độ tin cậy và vùng biên mềm. Giữ contact qua ranh giới má→thái dương theo tọa độ surface; nhãn giải phẫu không tự reset khóa contact. Đánh giá riêng roll/pitch, không chỉ yaw.

Landmark hữu hạn không chứng minh điểm đang nhìn thấy. Confidence vùng cần dựa vào residual, tuổi mẫu, biến thiên thời gian, hình chiếu và mức phù hợp của head pose; không giả định có per-point visibility đáng tin cậy nếu API không cung cấp. Không suy bàn tay ở trước/sau chỉ từ việc một landmark mặt biến mất.

### 6.2 Phần bàn tay tiếp xúc và vùng tiếp xúc

Rigid stage: lòng bàn tay, cạnh radial và cạnh ulnar. Dùng nhiều điểm/polygon hoặc capsule thay cho chỉ một centroid; bổ sung độ dày bề mặt ước lượng có provenance. Hand-world basis chỉ được so với normal mặt sau khi kiểm quy ước trục/camera chung.

Chọn đồng thời `(facePatch, handProbe)` bằng chi phí gồm khoảng cách phù hợp với uncertainty, orientation, chất lượng hình học và tính liên tục. So phương án orientation tham gia selection với phương án hiện tại chỉ tác động confidence cuối. Chi phí history không được lấn át bằng chứng mới mâu thuẫn. Khi hai lựa chọn tương đương, ghi ambiguity thay vì ép label.

Nhánh đầu ngón: bắt đầu riêng ngón trỏ, dựng tip proxy từ chuỗi ngón và surface pad; kiểm nút end thật/estimated và local offset của từng avatar. `fingertipContactEvidence.ts` hiện phục vụ hai tay chạm đầu ngón, không chứng minh đã có đầu ngón–mặt. Tạo contract/ownership riêng để tránh arm, wrist và finger solver ghi đè nhau. Mở rộng ngón khác sau khi trỏ–mặt đạt gate.

### 6.3 Suy luận chạm, gần và không rõ

Giữ riêng các đại lượng: vùng đang gần; mức phù hợp độ sâu; contact thực sự được suy ra. Các trạng thái đầu ra tối thiểu là `separated`, `near`, `contact-compatible`, `unknown`; nhãn này là suy luận, không phải sensor đo lực/chạm.

Cue gồm projection distance, hand orientation, depth đã đăng ký, apparent scale có bù foreshortening, chuyển động tương đối tay–đầu và residual. Đầu di chuyển cùng tay không được hiểu thành tay trượt trên mặt. Occlusion ordering chỉ thêm khi có phép đo/phương pháp riêng được thẩm định; landmark-only không mặc nhiên có mask tay–mặt. Phân loại cue đo thật và cue từ cùng prior.

Học hoặc fit trọng số trên development, chọn threshold trên validation, khóa trước test. Nếu đủ nhãn, thử logistic calibration nhỏ trên feature hình học; mô hình sequence lớn chỉ là nhánh sau khi feature baseline thất bại có bằng chứng. Đánh giá calibration và đường precision–coverage; không gọi weighted score là probability nếu chưa hiệu chuẩn.

Unknown không acquire correction mạnh; chỉ giữ contact đã xác nhận trong grace có hạn. Không lấy hold/độ ổn định của renderer làm bằng chứng người đang chạm. Bootstrap camera khi đã chạm cần gate độc lập và hard negative giữ tay lơ lửng ổn định. Thử các khoảng grace/blend trên validation, không sao chép hằng số hiện tại như kết luận khoa học.

### 6.4 Surface và probe cho từng avatar

Giữ ellipsoid là baseline và fallback. Nhánh mới fit bề mặt mặt từ mesh da đủ điều kiện hoặc cấu hình anchor thủ công đã xác minh. Loại tóc, kính, phụ kiện và mắt khỏi surface contact; tên mesh không được coi là bằng chứng phân vùng đủ tin cậy. Lưu quality/source của profile. Avatar không fit được dùng fallback có giới hạn hoặc từ chối correction ở vùng đó.

Ánh xạ bằng nhãn vùng + tọa độ liên tục trong patch; không sao chép vertex index MediaPipe sang VRM có topology khác. Lưu face anchor theo head-local và probe theo hand/finger-local. Với mặt biểu cảm, xác định anchor có đi theo skin/morph hay chỉ head rigid; đo ảnh hưởng khi cười, há miệng. Surface khác tỷ lệ không buộc bảo toàn khoảng cách metric của mặt người.

Fit riêng palm pad/edge/tip so với mesh bàn tay; bone FK không tương đương vị trí da. Với ít avatar hỗ trợ, profile thủ công có thể là giải pháp hợp lý hơn fit tự động chưa được thẩm định. So hai phương án bằng cùng oracle và avatar chưa dùng tuning.

### 6.5 IK, chống xuyên và đo sau renderer

Phép tính mục tiêu rigid ban đầu:

```text
p_wrist_target = p_face_target - R_hand * o_probe_local
e_contact = ||p_probe_final - p_face_target|| / H_avatar
e_normal = acos(clamp(n_probe_final · (-n_face), -1, 1))
```

`H_avatar` là chiều cao mặt được đo cố định từ cằm đến mốc trán đã định nghĩa cho model, không phải bounding box gồm tóc. Quy ước normal phải được xác minh theo probe; với tip, không áp gate normal của lòng bàn tay một cách máy móc.

Hai-bone IK giữ chiều dài xương, reach domain, bend continuity và joint limits. Ưu tiên nghiệm gần pose quan sát, không xoay cổ tay quá mức để giảm một residual. Giảm influence hoặc reject nếu target không đạt; báo reach/joint/collision reason. Không kéo dài xương để giả tiếp xúc.

Ghi residual tại các tầng: retarget baseline, target anchor, IK, blend/correction, normalized/raw bones sau VRM và surface mesh cuối. Nếu IK đúng nhưng mesh cuối sai, không tuning detector để bù lỗi renderer. Đo cả gap, penetration, normal và lệch khỏi đúng patch; contact error nhỏ trên một proxy sai không được coi là thành công.

Refinement sau pose cuối chỉ thử khi residual tầng renderer chứng minh cần: số vòng cố định, correction budget, rollback khi tăng penetration/joint violation/jitter. Contact runtime tiếp tục sở hữu target và quyền chỉnh; không tạo một IK cạnh tranh không có contract trong renderer. Kiểm tương tác với body-depth barrier, bimanual assist, fingertip assist và smoothing bằng bật từng lớp.

## 7. Bộ dữ liệu và nhãn chuẩn

### 7.1 Pilot rồi mới khóa benchmark

Pilot 2–3 người để kiểm recording, độ rõ camera phụ, quy trình nhãn và phân bố lỗi; dữ liệu này không dùng làm test cuối. Benchmark engineering đề xuất 12–16 người, ưu tiên 16 để chia 8 development / 4 validation / 4 test; chọn người đa dạng hình mặt, kích thước tay, tay thuận và điều kiện sử dụng. Đây là quy mô nghiên cứu ứng dụng ban đầu; chưa đủ tự động suy ra hiệu lực cho toàn bộ người dùng.

Mỗi người khoảng 24 clip ngắn 8–12 giây, lặp thao tác trong clip. Với 16 người khoảng 384 clip; frame và lần lặp trong cùng người không được coi là mẫu độc lập. Có phiên khác ngày/camera để kiểm thay đổi calibration. Điều kiện stress được phân bổ cân bằng, không cần quay tích Descartes của mọi yếu tố.

| Yếu tố | Các trường hợp bắt buộc |
|---|---|
| Vùng | Hai má, hai thái dương, trán, cằm; biên má–thái dương, má–tai và gần mũi/môi |
| Probe | Palm, radial edge, ulnar edge; ngón trỏ ở nhánh sau; cả tay trái/phải và chạm chéo bên |
| Hướng đầu | Yaw 0°, khoảng ±30°, ±60°; nhóm pitch/roll; góc cực đoan là stress, không gộp với nhóm nhìn rõ |
| Chuyển động | Approach→touch→hold→release; slide; xoay đầu khi đang giữ; bật camera khi đã chạm |
| Hard negative | Tay che hình chiếu mặt nhưng cách mặt; giữ yên gần má; tiến camera; lướt qua mặt; đổi palm→edge gần vùng |
| Quan sát | Ánh sáng đủ/yếu/ngược; tay che mặt; mất wrist/elbow ngắn; detector khác nhịp; đổi camera/model |

Tối thiểu khoảng 40% clip chứa hard negative; cân bằng thời lượng chạm/không chạm khi báo frame metric. Phân bổ 24 clip theo thiết kế cân bằng, bảo đảm mọi ô bắt buộc có người/clip, bổ sung nếu pilot thấy thiếu. Đầu ngón có dataset/gate riêng, không tính thành công nhờ rigid stage.

### 7.2 Ground truth và oracle

Video chính và camera phụ đồng bộ bằng tín hiệu nhìn thấy, đo sai số đồng bộ. Gán nhãn onset/offset contact, vùng, probe, hold/slide, occlusion và mức chắc chắn; lưu khoảng thời gian nhãn không rõ. Camera phụ thường giúp xác minh có khoảng hở, nhưng không tự cung cấp ground truth 3D metric nếu chưa hiệu chuẩn camera và reconstruction. Không báo sai số contact người theo mm khi không có phép đo này.

Hai người gán nhãn độc lập một phần dữ liệu và toàn bộ ca khó; hòa giải bất đồng, báo mức đồng thuận và tolerance thời gian. Người gán nhãn không xem output thuật toán. Clip theo hướng dẫn “chạm má” vẫn cần kiểm bằng hình ảnh; script thao tác không tự là ground truth.

Nhãn bề mặt avatar là một nguồn độc lập: artist/reviewer xác minh patch/normal trên mesh da và hand pad, không lấy ellipsoid đang đánh giá làm oracle. Dựng fixture với target/probe biết trước để đo H4/H5; đánh giá rendered mesh ở nhiều góc. Nhãn contact người là chuẩn cho H1–H3, fixture mesh avatar là chuẩn cho H4–H5; không đánh đồng hai chuẩn.

Chia theo người, session và clip; cấm tách frame cùng clip sang development và test. Dùng ít nhất 3 VRM phát triển/validation và một VRM khác để test generalization. Không tuning theo lỗi test. Nếu cần sửa sau khi xem test, tạo vòng test mới và ghi phiên bản đề cương.

Recording raw/video phục vụ nghiên cứu phải do người tham gia chủ động ghi và lưu trong phạm vi được đồng ý. Giữ tracking local-only như AR9; không thêm raw/video vào packet production. Nhãn lưu file riêng có ID/hash trỏ vào replay, tránh phá parser `MotionRecordingV1`; đổi schema chỉ khi có version/migration.

## 8. Thiết kế so sánh và quy nguyên nhân

Khóa cấu hình smoothing/constraints/calibration và dữ liệu đầu vào cho mọi biến thể. Detector inference chỉ chạy lại khi thí nghiệm thật sự đổi detector; replay raw giống nhau để so downstream công bằng. Reset state giữa clip/variant và giữ warm-up/calibration giống nhau.

| Biến thể | Thay đổi so baseline | Kết luận được phép |
|---|---|---|
| B0 | Contact tắt, retarget hiện tại | Đo lỗi nền arm/wrist/hand, không đánh giá detector contact |
| B1 | AR9 hiện tại bật với cấu hình cố định | Baseline toàn contact đang có |
| A1 | Chỉ model mặt/head pose mới | H1 |
| A2 | Chỉ joint region/probe selection mới | H2 |
| A3 | Chỉ registration/uncertainty/depth mới | H3 |
| A4 | Chỉ profile surface/probe avatar mới | H4, với intent oracle để tách lỗi detector |
| A5 | Chỉ refinement cuối có giới hạn | H5, đo cả renderer |
| C1 | Kết hợp những nhánh đã vượt gate | Hiệu quả tổng và tương tác |
| C1-minus-X | Lần lượt bỏ một cơ chế đã kết hợp | Cơ chế nào thực sự đóng góp, có phụ thuộc cơ chế khác không |

Thêm thí nghiệm cung cấp region/probe/contact bằng nhãn chuẩn, cung cấp orientation chuẩn từ fixture và cung cấp anchor chuẩn. Nếu oracle intent vẫn lệch mesh, ưu tiên sửa mapping/IK/renderer. Nếu oracle giải được nhưng inferred intent sai, ưu tiên H1–H3. Nếu B0 sai side/axes/open-hand, sửa prerequisite trước khi dùng contact bù.

Đánh giá cùng clip/người cho từng biến thể, báo chênh lệch và khoảng tin cậy 95% bằng bootstrap theo người (hoặc cụm session), không bootstrap từng frame như độc lập. Báo riêng mỗi vùng/probe/yaw/avatar và ca unknown. Thí nghiệm synthetic kiểm invariants; camera thật kiểm chất lượng tác vụ. Không dùng test count thay cho bằng chứng tác vụ.

## 9. Chỉ số và mục tiêu nghiệm thu dự kiến

Định nghĩa trước phiên test: contact event matching one-to-one theo overlap thời gian và tolerance onset, đề xuất ban đầu temporal IoU ≥0,3 và tolerance onset 150 ms; P1 kiểm tính hợp lý rồi khóa. Báo thêm event detection không ràng buộc onset để tách lỗi nhận biết và lỗi trễ. Vùng/probe đo trên cửa sổ contact đã có nhãn; `unknown` tính vào missed contact/coverage phù hợp, không âm thầm loại để nâng precision. Nhãn ground truth không xác định được tách thành nhóm ambiguity có số lượng/thời lượng riêng; không dùng chúng làm positive/negative chắc chắn. Báo event và frame metric; tỷ lệ hút sai còn đo theo clip không chạm và sự kiện/phút.

| Chỉ số | Cách đo | Mục tiêu đề xuất cho nhóm nhìn rõ |
|---|---|---|
| Nhận contact | Precision/recall sự kiện; nhầm hút trên hard negative; unknown/coverage | Precision ≥95%, recall ≥85%; hút sai ở ≤5% clip hard negative |
| Vùng và probe | Macro-F1; confusion theo vùng, probe và side | Mỗi bài toán macro-F1 ≥0,90; báo kết quả kết hợp vùng+probe riêng |
| Coverage | Tỷ lệ observation đủ nhãn mà có quyết định và tỷ lệ correction thực sự được áp | Decision coverage ≥80%; không che reject của solver trong coverage |
| Gap cuối | Khoảng cách probe skin đến target skin đúng patch / H_avatar; median/p95 | p95 ≤3% H_avatar trên contact đủ quan sát và target có thể với |
| Xuyên cuối | Độ xuyên signed vào skin surface, tách khỏi proxy collision | p95 ≤1% H_avatar; ca >3% phải được liệt kê và gate fail nếu chưa xử lý |
| Hướng tiếp xúc | Góc normal cuối theo loại probe | p95 ≤20° cho palm/edge; tip dùng tiêu chí riêng |
| Giữ ổn định | RMS điểm tiếp xúc trong head-local ở cửa sổ hold, sau trừ chuyển động đầu | RMS ≤1% H_avatar; giảm đổi nhãn/probe sai so B1 |
| Thời gian | Onset nhãn→decision; onset→pose cuối ổn định; release nhãn→nhả correction | p95 decision ≤250 ms; visual settle ≤450 ms; release ≤350 ms |
| Chi phí | Thời gian contact CPU riêng + frame time toàn app trên máy đã định cấu hình | Contact thêm p95 ≤3 ms trên máy desktop tham chiếu; profiling máy yếu riêng |
| Bất biến | Chiều dài xương, giới hạn khớp, NaN, reset, stale, không contact | Không kéo dài xương; không NaN; không correction tự phát khi tắt/không có bằng chứng |

Nhóm khó (yaw lớn, che khuất, ánh sáng yếu) báo riêng precision–coverage, recall và thời gian khôi phục; không mặc định đạt cùng ngưỡng. Mọi metric phải có denominator, số người/event và khoảng tin cậy. Threshold chốt sau pilot/validation và trước test; không hạ threshold sau khi xem test để tuyên bố pass. Thêm mục tiêu tương đối: giảm ít nhất 30% p95 gap so B1 trên cùng điều kiện, nếu B1 có lỗi đáng kể; không dùng chỉ số tương đối khi baseline đã gần zero.

Một biến thể không được nhận khi precision/coverage đẹp lên bằng cách loại toàn bộ ca khó khỏi báo cáo, hoặc gap giảm nhưng false attraction/xuyên/jitter tăng. Kết quả chưa có interval đủ rõ chỉ được mô tả là tín hiệu cần thu thêm dữ liệu. Quyết định bật mặc định cần thêm manual webcam, performance, privacy và regression gate AR9 hiện có.

## 10. Work package, thứ tự và sản phẩm bàn giao

Ước lượng dưới đây cho một kỹ sư chính, có người hỗ trợ recording/gán nhãn; chưa bao gồm thời gian chờ người tham gia. Tổng ban đầu khoảng 5–7 tuần làm việc. Đây là ước lượng có điều kiện, điều chỉnh sau pilot; nhánh đầu ngón thêm khoảng 1–2 tuần nếu prerequisite đạt.

| Giai đoạn | Công việc và điểm tích hợp | Sản phẩm | Gate để đi tiếp | Ước lượng |
|---|---|---|---|---|
| P0 | Tổng quan nguồn sơ cấp về contact/retargeting; khóa B0/B1; trace timestamp/coordinate/cue; kiểm arm/wrist/open hand; `contactRuntime`, mapper, replay, renderer diagnostics | Evidence matrix, coordinate spec, baseline report và taxonomy lỗi | Phân biệt lỗi nền và contact; trục/mirror/sequence kiểm chứng; không gọi cue heuristic là metric | 3–4 ngày |
| P1 | Pilot, nhãn camera phụ, oracle mesh, công cụ so replay; `MotionReplayPanel`, recorder, evaluator offline | Annotation spec, pilot recordings và benchmark protocol đã khóa | Nhãn chạm/không chạm đủ rõ, metric có denominator, dữ liệu test tách được | 3–4 ngày |
| P2 | H1/H2; surface head-local và joint region/probe scoring; `humanSemanticBodyModel`, `humanBodyRegions`, `handContactProbe`, `contactObservation` | A1/A2 opt-in, regression đúng trục, confusion theo yaw/probe | Cải thiện validation, không đảo side hay tăng probe flip | 4–6 ngày |
| P3 | H3; scale registration, freshness, correlated cues, uncertainty/FSM; `contactDepthRelation`, `contactRuntime`, `contactTemporal` | A3, calibration plots và báo cáo hard negative/bootstrap | Hút sai giảm, coverage/recall hợp lý; unknown không tự tạo touch | 4–6 ngày |
| P4 | H4/H5; fit face/hand mesh, local anchors, IK residual cuối; `avatarContactRig`, `contactAnchorMapping`, `contactWristTarget`, `contactPoseCorrection`, `renderedContactGeometry`, renderer | A4/A5, oracle fixture trên ≥3 VRM, profile provenance và rollback | Gap/xuyên/joint/jitter đạt validation; bằng chứng final skin, không chỉ bone FK | 5–7 ngày |
| P5 | Combined ablation, test người/session/avatar mới, profiling và báo cáo | Reproducible experiment bundle, acceptance report và phạm vi hỗ trợ | Đạt gate đã khóa; ca fail/unknown được công bố; regression AR9 pass | 4–6 ngày |
| P6 | Nhánh trỏ–mặt sau rigid stage; ownership ngón/arm/wrist và skin tip | Contract mới và báo cáo riêng | Chuỗi ngón/probe/IK đáng tin; không gây regression rigid stage | Thêm 5–10 ngày |

Thu và gán nhãn benchmark có thể làm xen kẽ P2–P4 sau khi protocol P1 khóa; thay đổi protocol phải lưu version. Nếu không có nhóm người/camera phụ, vẫn làm P0 và synthetic oracle, nhưng kết quả chỉ là kiểm chứng kỹ thuật nội bộ, chưa nghiệm thu khả năng nhận contact người.

## 11. Quy tắc dừng, chuyển hướng và bàn giao

Nếu arm/wrist/side sai trong B0, dừng tuning contact ở ca đó và sửa lớp nền. Nếu đăng ký depth không đạt residual/stability trên validation, bỏ tuyên bố metric, dùng conservative unknown và đánh giá precision–coverage. Nếu mô hình đa landmark không hơn baseline, giữ baseline và ghi H1 chưa được ủng hộ.

Nếu mesh fit tự động không ổn định, chuyển profile thủ công cho avatar hỗ trợ và thử holdout theo contract rõ ràng. Nếu final refinement tốn budget hoặc gây competing ownership, giữ nó ở diagnostics và sửa nguồn sai lệch upstream. Nếu detector contact không phân biệt được hai quan sát RGB gần như giống nhau, báo nhóm ambiguity được đo thay vì khẳng định webcam khiến mọi ca đều không sửa được.

Bàn giao cuối gồm: đặc tả coordinate/time và schema; benchmark/annotation manifest; cấu hình và hash nguồn/model; code opt-in; log thí nghiệm và metric có confidence interval; ảnh/video cuối từ nhiều góc; error taxonomy trước/sau; performance report; acceptance report với danh sách avatar/vùng/probe/điều kiện được hỗ trợ. Ghi rõ phần đã đo, phần chỉ có synthetic test và phần chưa nghiên cứu.

Việc đầu tiên khi triển khai là **P0: lấy baseline và trace của một ca chạm má, một ca chạm trán, một ca cạnh tay–thái dương và một ca tay trước mặt nhưng không chạm**, với input→intent→anchor→IK→final skin cùng sequence. Chỉ sau đó mới quyết định nhánh nào cần sửa trước.
