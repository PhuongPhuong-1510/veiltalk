# Đợt 2: đầu/cơ thể, hai tay và đầu ngón

> Cập nhật 07/10/2026: các cơ chế contact trong trang webcam đã bật sẵn theo [cấu hình tích hợp](XR_TRACKING_RUNTIME_PART2_NOTES.vi.md). Các bước bật công tắc bên dưới ghi lại quy trình thử nghiệm trước đây.

Ngày 02/10/2026. Triển khai opt-in và bổ sung quan sát ở renderer; chưa nghiệm thu webcam hay kết luận hơn XR bằng đo thực tế. Mốc code trước đợt này: `8ebee95ea7a05345db78241394ca07174104ee1c`.

## Đối chiếu lại cả bảy nguồn XR

Đã mở lại cả bảy file theo đường dẫn gốc. Với file lớn, đọc sâu những đoạn liên quan đến đợt 2 và tìm các điểm gọi/khai báo; không tuyên bố đã hiểu mọi dòng của hơn 2 MB nguồn. Manifest ghi SHA-256, số dòng và phạm vi đọc sâu để quay lại kiểm chứng.

| File XR | Phạm vi đọc lại đợt này | Bằng chứng và giới hạn |
|---|---|---|
| `js/mocap_lib_module.js` | 954–1036, 1176–1250 | Hand/Pose wrist matching, sửa hình học bàn tay và lọc landmarks tương đối cổ tay. Giữ matcher/continuous fingers hiện có của VeilTalk. Không sao chép công thức cũ hoặc giả định dấu trục. |
| `js/one_euro_filter.js` | Toàn file | Scalar/vector/quaternion filtering và clock. VeilTalk tiếp tục dùng temporal/filter hiện hữu; không chồng một bộ lọc mới lên toàn pose. |
| `images/XR Animator/animate.js` | 12859–12895; tìm cấu hình fingertip, arm IK, collider | UI đổi phản ứng collider đầu `sphere`/`z_push`; không là bằng chứng tự thân về dedicated hand↔hand IK. |
| `MMD.js/MMD_SA.js` | 14717–14760, 14826–14918 | Palm proxy theo kích thước model, head collider, hướng phản ứng dựa vào rotation cơ thể. Có những kiểm tra cụ thể của XR, không coi mọi nhánh là quy luật giải phẫu để bê nguyên vào VRM. |
| `jThree/MMDplugin/v2.1.2_jThree.MMD.js` | 3941–4048 | Arm IK phối hợp shoulder và A/T pose conversion; khác quy ước của normalized VRM. Giữ rest/parent-local contract của VeilTalk. |
| `jThree/index.js` | 96–170, tìm collision/hand/wrist | Hạ tầng bounding box/scene/camera. Chưa thấy thuật toán dedicated contact đầu ngón trong phạm vi này. |
| `js/SA_system_emulation.readable.js` | 7971–8070, 8401–8625 | Bộ lọc reference-point/fingertip riêng; plane/sphere/line magnet; fingertip offset từ `_fingertips`, scale và wrist rotation; body-frame z push. Không đủ bằng chứng gọi đây là solver đan ngón vật lý hoàn chỉnh. |

Thiết kế mới học cách dùng hình học của model, hệ cơ thể và can thiệp có giới hạn. Trọng số/ngưỡng trong code mới là lựa chọn VeilTalk cần thử A/B, không gán là giá trị XR.

## Thay đổi và các file phụ trách

| Phần | File VeilTalk | Kết quả |
|---|---|---|
| Bằng chứng trước/sau của người | `observedBodyDepth.ts`, `bodyLocalDepth.ts`, `avatarMotionProcessor.ts` | Lấy dấu từ Pose thật trước retarget/constraints. Cần Pose mới và torso/landmarks đủ tin cậy; đầu dùng trung điểm hai tai. Renderer chỉ giữ dấu gần đây trong 600 ms; duplicate/held/reconstructed không làm mới. Mất hips/ears thì cue tương ứng không được suy thành đo thật. |
| Tay sau đầu/thân | `avatarRenderer.ts`, các query/correction hiện có | `Body-local depth barrier` dùng cue người thay cho hướng FK đã bị chỉnh của avatar, giảm nguy cơ một correction trước đó tự củng cố dấu sai. Không tự hút tay vào đầu; correction chỉ xử lý penetration và tiếp tục tôn trọng contact ownership. |
| Hai tay bắt chéo | `avatarInterArmCollision.ts`, `avatarRenderer.ts` | Thứ tự trước/sau theo hướng cơ thể thay cho Z toàn cảnh; memory hết hạn. Giới hạn tổng dịch chuyển, budget theo thời gian render, không chấp nhận nghiệm làm tăng xuyên collider đầu/thân của từng tay. |
| Đề xuất tiếp xúc đầu ngón | `fingertipContactEvidence.ts`, `avatarMotionProcessor.ts`, `avatarPoseTypes.ts` | Matching một–một, tối đa hai cặp, ba sample khác nhau và tối thiểu 80 ms. Hand/Pose phải mới, đúng bên, depth wrist tương thích và góc ngón được quan sát. Metadata chỉ là đề xuất; chồng ảnh 2D không đủ để ép tiếp xúc. |
| Chỉnh đầu ngón theo model | `fingertipContactIk.ts`, `avatarRenderer.ts` | Tìm chỉnh flexion nhỏ trên chuỗi đủ ba đốt, dùng flex axis theo rig; không viết arm/wrist quaternion. Giới hạn tốc độ và 20° so với baseline packet, giữ cửa sổ flexion của continuous solver; hoàn tác nếu không cải thiện hoặc tăng penetration của tip proxy vào collider cơ thể. Giữ nguyên abduction/twist đang có. |
| Hình học đầu ngón | `fingertipContactIk.ts` | Ưu tiên node `tip/end` thật từ raw graph, chuyển offset sang normalized control bone. Khi không có node, ước lượng phần cuối bằng 0.65 đoạn xương trước, ghi `estimated-distal`; chuỗi thiếu đốt không được chỉnh. Đây chưa phải fit bề mặt mesh. |
| FK sau renderer | `renderedContactGeometry.ts`, `contactRuntime.ts`, `avatarRenderer.ts` | Đo lại raw-bone positions sau VRM transfer và raw shoulder translation; đổi raw rest axes sang semantic axes trước khi dùng probe. Báo body/inter-arm penetration proxy, sai số contact anchor có fingerprint guard và khoảng cách tip cuối. |
| UI/replay/audit | Hai trang motion preview/dev, `audit-motion-rigs.mjs` | Có công tắc đầu ngón riêng, số đo cuối trong panel và snapshot replay. Experimental defaults vẫn tắt. Audit thêm gap fixture trên hình học xương ba VRM. |

Partial-arm, wrist reconstruction, observed-length calibration, neutral, hand twist, wrist swing, continuous fingers, contact FSM và quy tắc contact ownership được giữ lại. Test tích hợp xác nhận bật intent đầu ngón không làm thay đổi quaternion do processor tạo và không sửa raw input. Chỉnh cuối ở renderer vẫn cần nghiệm thu trên webcam.

## Kết quả kiểm tra

- **985 test / 120 file pass**; tăng 18 test so với mốc 967.
- TypeScript + Vite build và lint exit 0. Còn cảnh báo bundle lớn/whitespace hiện hữu.
- Ba VRM, 30 joint ngón/model, sáu cảnh synthetic/model × năm biến thể, không có rotation không hữu hạn.
- Fixture gap đầu ngón trên actual raw rest graph, một bước 1/60 s, giảm khoảng cách:

| Model | Probe trỏ | Gap trước → sau (đơn vị graph model) |
|---|---|---|
| `reference-avatar.vrm` | estimated-distal | 0.005883 → 0.003529 |
| `reference-avatar-1.vrm` | estimated-distal | 0.006077 → 0.003855 |
| `reference-avatar-2.vrm` | end-node | 0.005796 → 0.004587 |

Fixture này cố ý đặt wrist node để tạo gap nhằm kiểm tra tầng ngón/axes; không phải chuyển động webcam, không kiểm chứng full arm retarget hoặc normalized VRM skin. Unit test riêng kiểm tra bridge raw end-node → normalized bone, giới hạn góc, rollback, stale/loss/identity, rigid-transform invariance và giữ wrist. Các số trên không được dùng để tuyên bố chất lượng XR hoặc độ chính xác da/ngón thực.

## Test webcam

Mở `http://127.0.0.1:5175/dev/avatar-renderer`, reload để tạo processor mới. Đầu tiên dùng baseline, ghi replay, rồi bật từng nhóm để xác định nguồn cải thiện/regression:

1. Giữ `Constraints`, `Hand twist`, `Continuous fingers (AR6)` và `Bone smoothing` như cấu hình cũ.
2. Bật `Body-local depth barrier (A/B)` để thử trước/sau đầu, thân và tay bắt chéo. Để torso/hips và hai tai được tracking khi kiểm tra cue này; khi thiếu cue, xem diagnostic thay vì coi đó là đo depth thật.
3. Bật `Hand-body contact (AR9 shadow)` và `Apply AR9 correction` khi thử chạm đầu/cơ thể. So thêm các cảnh tay lướt gần mặt nhưng không chạm để kiểm tra hút sai. Contact được ưu tiên trước fingertip assist.
4. Bật `Palms-together assist (A/B)` để thử chắp tay; thử riêng với hai tay tách ra để kiểm tra nhả.
5. Bật `Fingertip contact assist (A/B)` để thử hai ngón trỏ chạm nhau, hai ngón cái và chạm chéo thumb/index. Cần nhìn rõ hai tay/ngón và chuỗi xương đủ. Có thể kết hợp sau khi đã có baseline cho từng lớp.

Lặp trên ba avatar: trước đầu → trên đầu → sau đầu → về trước; xoay thân trong lúc giữ tư thế; che wrist hoặc elbow ngắn rồi đưa lại; bắt chéo hai tay theo cả hai thứ tự; tip chạm → tách; overlap 2D nhưng một tay xa camera hơn; đổi model/restart camera. Panel hiển thị `Final raw-bone FK`, `finalContactErrors`, `finalFingertipGaps`, `leftProbe/rightProbe` và `Fingertip` reason. Replay ghi pose cuối có sequence/clock riêng, có thể trễ input một draw; không ghép hai sequence khác nhau để đánh giá endpoint.

## Phạm vi chưa hoàn thành

Chưa có nghiệm thu webcam/browser, ground truth hoặc đo XR đối chứng. Chưa mô phỏng mesh contact/SDF, chiều dày đầu ngón được fit từ skin, contact force, self-collision từng phalanx, bimanual arm target cho heart/clasp/interlace hay full finger interlacing. Với hai tay xa nhau trên avatar, tip assist sẽ từ chối thay vì kéo cánh tay để làm giả tiếp xúc. Ngưỡng/gates và proxy cần chỉnh theo replay thật. Các đợt camera/anatomical constraints, remote và profiling/defaults của kế hoạch A–Z tiếp tục riêng.
