# Bàn giao triển khai nghiên cứu tiếp xúc tay–mặt

> Cập nhật 07/10/2026: trang webcam hiện bật sẵn AR9 shadow, correction và cấu hình Combined + index tip. Các bước bật công tắc bên dưới mô tả quy trình A/B cũ; tham khảo [cấu hình tích hợp](XR_TRACKING_RUNTIME_PART2_NOTES.vi.md) khi test giao diện hiện tại. Nhập vật liệu da mặt thủ công chỉ cần khi nhận diện tự động thất bại.

Ngày: 2026-10-02. Bản thuật toán: `face-contact-v1-2026-10-02`.

Đã triển khai pipeline thử nghiệm từ landmark đến mục tiêu tiếp xúc, IK, bước hiệu chỉnh cuối và công cụ đánh giá. Các công tắc mặc định tắt để giữ AR9 làm đối chứng. Chưa có recording webcam có nhãn nên chưa nghiệm thu các chỉ tiêu precision/recall, gap thực tế, latency hay điều kiện che khuất trong kế hoạch nghiên cứu.

Kiểm tra cuối sau sửa diagnostics: **128 file / 1.022 test qua**, production build qua, lint 44 file TypeScript/TSX thay đổi qua không có diagnostic. Lint toàn `src` ở lần triển khai trước qua nhưng có warning sẵn ở các file khác; build còn cảnh báo chunk lớn. Audit skin CPU ba VRM qua, có fallback vùng trên một model như mô tả bên dưới. `git diff --check` qua. Không có kiểm thử Browser/WebGL/webcam trong phiên này.

## Những phần đã có

| Phần | Cài đặt và bằng chứng |
|---|---|
| P0: đối chứng, tọa độ, provenance | Kiểm tra AR9 trước sửa: 985 test qua. Cấu hình all-false có test giữ nguyên rotations và không sửa raw frame. Topology MediaPipe pin commit, SHA-256 và giấy phép đầy đủ. Replay giữ clock từng detector. |
| P1: ghi, nhãn, đánh giá | Sáu scene mặt mới; replay V1 tương thích bản cũ; sidecar JSON gắn SHA-256 replay, mã người/phiên/split. GUI tạo/sửa/nạp/xuất nhãn và chạy các ablation; CLI đánh giá offline. |
| P2: vùng mặt, loại probe | Correspondence 468 điểm mesh nền trong output 478 điểm, barycentric trên tam giác quan sát, bù aspect, chọn mặt trước, phân biệt vùng theo canonical UV. Chọn joint region–probe có orientation, continuity, runner-up margin; bảo vệ mắt, mũi và miệng. |
| P3: chiều sâu | Fit XY scale Hand/Pose riêng, nối tại wrist và nose, báo residual, skew, chất lượng, uncertainty floor. Không cộng trực tiếp normalized z giữa ba detector. Chỉ warm up bằng sample mới, depth unknown không tự acquire. |
| P4: avatar | Chọn tam giác skinned phù hợp vật liệu, skin weight và vùng hình học. Fit extent da độc lập sphere collision nhỏ của rig. Anchor gắn ba vertex + barycentric; sampler theo skinning và morph hiện tại. Fit rigid probe bàn tay gần da; thiếu vùng thì fallback proxy. |
| P4: kiểm tra cuối | Đo sau VRM update, shoulder translation, chống xuyên và morph. Refiner thuộc contact owner, giới hạn dịch/chuyển góc, giữ chiều dài xương; rollback nếu gap, normal, local penetration, clearance hoặc giới hạn khớp xấu đi. |
| P5: so sánh | Baseline, từng cơ chế, Combined, Combined-minus và index riêng. Đếm abstention/coverage; recall có missed positive do unknown; confusion/macro-F1 vùng/probe; event matching one-to-one IoU 0,3, onset báo riêng. Bootstrap theo người, không theo frame. |
| P6: ngón trỏ | Chỉ dùng chuỗi ba đốt đầy đủ với observation mới đủ chất lượng. Contact chạy sau continuous fingers khi bật index để dùng FK đúng frame. Vị trí cuối dùng distal FK; flex assist tối đa 6° quanh pose quan sát, kiểm giới hạn gập, không dịch xương/wrist. Có test thứ tự pipeline và bất biến. |

## Contract tọa độ và thời gian

- Human image: `x`, `y * videoHeight/videoWidth`, face z tương đối theo chiều rộng ảnh. 10 iris landmark không thuộc topology nền.
- Canonical UV: x dương là phía trái giải phẫu của người; nhãn giữ vertex correspondence khi roll/mirror. UV không phải texture UV của VRM và không phải index vertex của avatar.
- Relative depth: fit positive scale sau centering, Hand world local displacement nối vào Pose world wrist; face local displacement nối vào Pose world nose. Đây là ước lượng weak perspective có tương quan và uncertainty, không phải đo chạm theo milimét.
- Avatar anchor: head semantic local + fingerprint model. `skinBinding` giữ mesh path, ba vertex index và weights. Chỉ sampler của model tương ứng được dùng.
- Registration: tối đa age 150 ms, skew 100 ms, ít nhất bốn sample mới; face freshness cho nhận intent tối đa 100 ms. Final refinement age tối đa 250 ms **riêng từng tay**; sample trùng không tăng dwell/warmup. Các ngưỡng là giả thuyết kỹ thuật cần chỉnh trên validation.
- Recorder có thể đọc pose đã render của packet trước. Evaluator nối final skin theo `sequence` và kiểm timestamp khi có, bỏ duplicate/unmatched; không nối theo chỉ số mảng.

## Cách test webcam

1. Chạy `npm.cmd run dev` trong `frontend`, mở `/dev/avatar-renderer`. Chọn `reference-avatar-2` để bắt đầu.
2. Bật camera, để vai, khuỷu và tay trong khung; căn neutral. Bật `Hand-body contact (AR9 shadow)` và `Apply AR9 correction`.
3. Trong **Nghiên cứu tiếp xúc tay–mặt**, chọn **Combined**. Kiểm capability/material/regionCoverage. Thử lòng bàn tay lên từng má, trán, cạnh tay lên thái dương, giữ rồi trượt; xoay đầu nhẹ. So với **AR9 baseline** trên cùng replay.
4. Thử tay trước mặt nhưng còn cách mặt, vẫy qua mặt, quay đầu, che tay/mặt ngắn, dừng/bật lại camera. Nếu data yếu, đọc `registration.reason`, `uncertaintyFaceHeights`, `selectionMargin`, phase và correctionReason; tránh tăng confidence chỉ để ép chạm.
5. Chọn scene tương ứng, thu đoạn khoảng 10 giây, dừng và xuất replay. Giữ đoạn khởi đầu đủ cho calibration, ghi điều kiện ánh sáng/yaw/che khuất trong metadata phiên.
6. Tạo mẫu nhãn. Điền khoảng `atMs` từ replay, side theo giải phẫu, `contact=true/false`, region (`leftCheek`, `rightCheek`, `forehead`, `leftTemple`, `rightTemple`…), probe (`palmCenter`, `radialEdge`, `ulnarEdge`, `indexTip`). Chỉ dùng `certainty=verified` khi đã xác nhận; ca không rõ giữ `contact=null`. Gộp một thao tác liên tục thành một khoảng.
7. Chạy **So các thuật toán chạm mặt**, xuất nhãn và kết quả. Chưa có verified labels thì điểm accuracy là null. Chỉ timing/diagnostic có dữ liệu.
8. Test ngón trỏ bằng **Combined + index tip** sau khi đã so rigid. Thử ngón duỗi và gập, xoay cổ tay, che đốt ngón; đọc nguồn tip `end-node` hoặc `estimated-distal`. Không coi nguồn estimated là điểm da đo được.

Trang `/avatar/motion` cũng có hai công tắc mới trong tính năng thử nghiệm: ánh xạ chạm mặt và đầu ngón trỏ. Bật cùng hỗ trợ chạm đầu/cơ thể. Chức năng nhãn/ablation đầy đủ nằm ở trang DEV.

Nếu vật liệu da không được nhận diện, phần DEV cho nhập exact material names và tải lại **avatar hiện tại**. Để trống để quay về tự động. Override vật liệu không tự sửa hình dạng, topology hole hay orientation; kiểm capability sau tải lại.

## Sửa theo diagnostics webcam ngày 2026-10-02

Log người dùng gửi cho thấy tay phải được chọn là `upperChest`, phase `near`, depth `unknown`, influence 0; cả hai tay `correctionRequested=false`. Tay trái không có observation hiện tại dù `region` còn giữ nhãn lịch sử. Đây là lỗi/chặn ở bước quan sát và xác nhận contact, trước khi yêu cầu IK. Log không chứa raw landmarks nên chưa thể khẳng định nguyên nhân của chính frame webcam đó.

- Trong chế độ joint selection, giữ probe khi phép chiếu MCP gần thẳng hàng nếu Hand-world có palm basis hợp lệ và geometry quality >= 0.65. Hình học 2D còn phải có độ dài quan sát được; hình chiếu co về một điểm vẫn bị loại. Không suy ra normal 3D từ đường thẳng 2D, không tự xác nhận contact chỉ từ world quality.
- Trong chế độ head surface hoặc joint selection, chặn capsule ngực lấn lên trên mặt phẳng vai, với dung sai 0.12 bán kính ngang ngực. Giới hạn theo trục vai–hông nên đi theo hướng nghiêng thân. Baseline giữ quy tắc cũ. Ngưỡng mới cần validation bằng replay thật.
- `research.observationTrace` ghi lý do không có probe/candidate, tọa độ probe, chi phí ứng viên và điểm được chọn. `research.inputs` ghi số điểm Image/World và lý do palm basis bị loại. `regionSource` phân biệt quan sát hiện tại với nhãn lịch sử.
- Registration phân biệt thiếu Hand-image, Hand-world, Pose-image, Pose-world, Face landmarks, mặt không hợp lệ và probe ngoài mặt. Không đăng ký độ sâu khuôn mặt cho ứng viên thân; báo `not-a-face-candidate` hoặc `no-contact-candidate` và xóa lịch sử đăng ký tương ứng.
- Nút DEV **Tải input + diagnostics contact JSON** tải một snapshot gồm input thực sự đã đưa qua processor, packet, cấu hình, contact diagnostics, rig và final arm snapshot. Final arm là lần render gần nhất, có thể khác sequence của packet; so sequence trước khi dùng để đánh giá. Snapshot hỗ trợ truy lỗi hình học, không thay replay khi đánh giá FSM hoặc acquisition theo thời gian.

Các regression mới bao phủ hình chiếu edge-on có/không có world support, giới hạn ngực với thân xoay, trace thiếu/degenerate/selected, lý do thiếu Hand-world và truyền world support xuyên runtime. Chưa tái hiện frame webcam người dùng vì thiếu raw input; chưa tuyên bố lỗi webcam đã được giải quyết.

## Lệnh tái lập

```powershell
cd C:\project\veiltalk\frontend
npm.cmd test -- --reporter=dot
npm.cmd run build
npm.cmd run lint
npm.cmd run contact:audit
npm.cmd run contact:manifest
npm.cmd run contact:evaluate -- replay.json labels.json result.json
# Không có nhãn: chỉ diagnostics/timing
npm.cmd run contact:evaluate -- replay.json - result.json
# Topology pin revision; chỉ cập nhật khi đã review commit mới
node scripts/generate-face-contact-topology.mjs
```

`docs/motion-review/face-contact-skin-audit.json` chứa hashes ba VRM, capability, mapping mẫu, skin displacement khi yaw và benchmark synthetic từng biến thể. Audit CPU dùng geometry/weights/bind matrices thực nhưng không chạy WebGL/normalized VRM transfer; không thay nghiệm thu render trên webcam.

`docs/motion-review/face-contact-implementation-manifest.json` lưu source hash cùng cách tính của Vite, base commit, package-lock hash, phiên bản package thực đã cài, CPU và hash sáu model/WASM MediaPipe local. Hash nguồn trỏ đến working tree triển khai, không phải một commit đã merge. Khởi động lại dev server sau sửa code trước khi thu để hash trong replay đúng với nguồn mới.

## Giới hạn đã biết và việc cần đo tiếp

- Hai model `reference-avatar` và `reference-avatar-2` ánh xạ được má trái/phải, trán và điểm thái dương trong audit. `reference-avatar-1` có atlas không phủ đủ các vùng mẫu, dùng proxy cho vùng thiếu. Đây là giới hạn fit hiện tại được báo rõ, chưa đạt gate ba avatar hỗ trợ đầy đủ.
- Vật liệu có chữ Skin và weight/head geometry chỉ tạo **mesh candidate**, không chứng minh segmentation da đúng. Skin dùng alpha mask vẫn có thể hợp lệ; sampler hình học không đọc texture alpha. Vùng bị cắt bởi texture cần kiểm thủ công trước khi đánh dấu hỗ trợ.
- Palm/edge skin-fit vẫn là rigid probe quanh hand frame. Đầu ngón dùng end node hoặc ước lượng distal. Chưa có mô hình biến dạng contact pad hay đo khoảng cách giữa hai full skin meshes.
- `localPenetration` là signed distance theo normal tam giác đích, **không phải** penetration toàn mesh. Clearance toàn thân hiện vẫn dùng sphere/capsule. Không tuyên bố đạt mục tiêu full-skin penetration của kế hoạch từ metric này.
- Final refinement chỉ sửa residual nhỏ của contact đã xác nhận. Không tự acquire và không hút tay xa lên mặt. Bề mặt/probe không có binding đầy đủ thì không chạy final skin pass.
- Processor A/B không đo hiệu quả A5 renderer. Kết quả finalSkin chỉ thuộc cấu hình đã ghi. Muốn so renderer cần phát cùng raw replay, thu final render cho từng config và kiểm ảnh/video.
- Confidence là score heuristic. Chưa fit classifier/calibration, chưa có reliability plot, multi-person holdout hoặc gate precision/recall. Bootstrap utility trả null khi chưa có tối thiểu năm người độc lập; vẫn cần thiết kế cỡ mẫu phù hợp.
- CPU p95 synthetic trong report chưa phải budget contact tăng thêm hay latency đầu–cuối; số liệu có ảnh hưởng cold start và máy chạy đồng thời. Chưa kết luận đạt mục tiêu p95 3 ms.
- Skill Browser không tìm thấy trình duyệt khả dụng trong phiên triển khai. Build/test qua không thay kiểm UI, GPU hoặc webcam. Các bước đó chờ phiên test thực tế của người dùng.

Nghiệm thu tiếp theo: thu/gán nhãn pilot, khóa threshold trên validation, chạy người/phiên/avatar chưa dùng để tuning, so renderer cuối nhiều góc và profiling cùng cấu hình. Lưu cả các ca fail/unknown để chỉnh nguồn lỗi, không chỉ chọn clip đẹp.
