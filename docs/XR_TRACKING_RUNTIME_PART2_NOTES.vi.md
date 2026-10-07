# Ghi chú XR dòng 501–1500: nhận diện bàn tay ở xa

## Cập nhật 2026-10-07: cấu hình webcam tích hợp

Theo kết quả thử của người dùng, hai trang `/avatar/motion` và `/dev/avatar-renderer` dùng chung `INTEGRATED_MOTION_PROFILE`. Các cơ chế hỗ trợ hai tay, giới hạn rig, chiều sâu cánh tay, lọc Pose Z/Hand, Hand worker, Pose guided ROI, ngưỡng Hand thích nghi, ổn định cánh tay, dynamics, constraints, hand twist, AR6, AR9 shadow + correction, các cơ chế tiếp xúc mặt (kể cả đầu ngón trỏ) và bone smoothing đều được yêu cầu bật khi mở trang. Các công tắc A/B và chọn preset nghiên cứu đã rời giao diện. `Finger gesture (legacy)` vẫn tắt vì AR6 sở hữu chuyển động ngón.

Đây là **cấu hình được yêu cầu**, chưa phải kết luận mọi cơ chế sẽ có tác dụng trên mọi frame/VRM. `Hand input: full-frame` vẫn hợp lệ khi Pose không đủ tin cậy hoặc ROI cần quay lại toàn ảnh; `confidence: normal` hợp lệ khi người gần camera; `adaptive model: unavailable` nghĩa là detector phụ chưa dùng được nên hệ thống dùng detector thường. Worker cũng có đường dự phòng về main thread. Trạng thái runtime vẫn hiển thị để kiểm tra webcam. Bề mặt da mặt dùng nhận diện tự động; trang Diagnostics giữ nhập tên vật liệu thủ công khi avatar không nhận diện được da mặt.

Trạng thái hiện tại: **đã bật trong cấu hình webcam tích hợp theo yêu cầu người dùng; chờ kiểm tra lại bằng webcam thật sau khi gộp**. Hai cơ chế dưới đây xử lý tình huống webcam mất nhận diện bàn tay khi người đứng xa. Nếu webcam vẫn nhận đủ tay mà avatar rung hoặc đặt tay sai, cần kiểm tra tầng xử lý chuyển động.

## Tổng hợp quyết định sau khi đọc XR dòng 1–1500

**Đã có code; cần thử trên webcam, theo thứ tự:**

1. Dùng Pose wrist và độ rộng vai để tạo vùng ảnh quanh bàn tay nhỏ/xa. Thử ghép hai vùng tay vào một ảnh đầu vào để Hand detector chỉ chạy một lần; đổi landmark về tọa độ webcam và kiểm tra lại với Pose wrist. Khi Pose không đáng tin, dùng đường toàn ảnh hiện tại.
2. Nếu bước 1 vẫn bỏ sót tay ở xa, thử thay đổi ngưỡng nhận diện Hand theo kích thước người trong ảnh. Cơ chế có giới hạn chuyển chế độ; không dùng ngưỡng `0.1` của XR.

**Đã có trong VeilTalk, không làm lại:** Hand worker chạy song song dưới dạng tùy chọn, `RawTrackingFrameV1` giữ measurement gốc, lọc riêng Pose Z, lọc hình dạng ngón tương đối với cổ tay/lòng bàn tay, ghép Hand với Pose wrist và giữ danh tính trái/phải qua thời gian.

**Chưa đưa vào đợt này:** công thức XR sửa Hand Z, ép chiều dài đốt ngón, dựng lại Pose 3D và đảo/xóa handedness theo heuristic của XR. Chỉ nghiên cứu khi có lỗi cụ thể và video tái hiện.

**Tiêu chí giữ thay đổi:** trên cùng video, khi người đứng xa avatar nhận đủ hai tay thường xuyên hơn, trong khi số lần nhận nhầm, đổi trái/phải, giật và độ trễ không tăng đáng kể. Ghi rõ model, cấu hình, khoảng cách và trạng thái worker khi so A/B. Chưa có kết quả webcam để khẳng định cải thiện.

## Giải thích ngắn gọn

Khi người đứng xa webcam, bàn tay xuất hiện rất nhỏ trong toàn bộ ảnh. Bộ nhận diện Hand có thể bỏ sót, khiến tay nhân vật đứng yên hoặc lúc có lúc mất dù người thật vẫn đang cử động.

**Việc muốn làm trước:** dùng vị trí cổ tay do Pose tìm được để cắt vùng ảnh quanh hai bàn tay, phóng các vùng đó vào một ảnh đầu vào và chạy Hand detector một lần. Sau đó đổi kết quả về đúng vị trí trên ảnh webcam. Nếu Pose không xác định được cổ tay đáng tin, quay về cách nhận diện toàn ảnh hiện tại.

**Chỉ thử tiếp nếu vẫn mất tay ở xa:** làm bộ nhận diện bớt khắt khe khi người đứng xa. Cách này có thể bắt lại tay yếu nhưng cũng có thể nhận nhầm đồ vật thành tay, nên phải thử riêng sau bước crop.

Ví dụ cần kiểm tra: người dùng đứng xa, đưa cả hai tay lên nhưng avatar chỉ cử động một tay. Chỉ giữ thay đổi nếu avatar nhận đủ tay thường xuyên hơn mà không tăng nhận nhầm, đảo trái/phải, giật hoặc trễ. Nếu webcam đã nhận đủ hai tay nhưng avatar vẫn rung/sai vị trí, hai việc này không giải đúng lỗi.

## 1. Crop vùng tay theo cổ tay Pose

- Dùng cổ tay Pose đủ tin cậy để chọn vùng ảnh quanh từng bàn tay; đưa vùng đó vào Hand Landmarker nhằm giúp bàn tay nhỏ chiếm nhiều diện tích đầu vào hơn.
- Kích thước vùng ảnh dựa trên độ rộng hai vai quan sát được, có giới hạn tối thiểu/tối đa và phần đệm tại mép ảnh. Nếu có hai tay, thử ghép hai vùng vào một canvas để vẫn chỉ chạy một lần Hand Landmarker: dùng vùng chung khi hai tay gần nhau, bố trí hai vùng riêng khi cách xa. So sánh cách ghép này với đường full frame vì ảnh ghép có thể gây nhận nhầm hoặc sai handedness.
- Đổi toàn bộ landmark Hand từ tọa độ vùng crop về tọa độ frame gốc trước khi đưa vào `RawTrackingFrameV1` và bộ ghép Hand–Pose.
- Nếu thiếu cổ tay Pose, crop quá nhỏ/sai hoặc tay ra mép ảnh, dùng đường nhận diện toàn frame. Với Hand worker hiện chạy đồng thời Face/Pose trên cùng frame, ROI cần Pose từ frame trước hoặc phải thay đổi thứ tự chạy; chỉ dùng Pose cũ trong giới hạn tuổi mẫu và nới vùng theo mức di chuyển. Giữ timestamp và tuổi mẫu chính xác; đo chi phí crop/worker.
- Chỉ nhận kết quả crop sau khi đổi tọa độ về ảnh gốc và kiểm tra lại vị trí Hand wrist với Pose wrist/ROI. VeilTalk đã có ghép Hand–Pose, nên mở rộng gate theo độ rộng vai thay vì sao chép logic đảo/xóa nhãn của XR.
- Thử A/B trên cùng video ở nhiều khoảng cách. Chỉ giữ nếu tăng tỷ lệ bắt lại tay xa mà không tăng rõ nhận nhầm, đổi trái/phải hoặc độ trễ.

## 2. Ngưỡng nhận diện Hand thích nghi theo kích thước người trong ảnh

- Dùng độ rộng hai vai quan sát được trong ảnh làm dấu hiệu người gần/xa; khi người xa, thử một ngưỡng Hand nhạy hơn. Không mặc định sao chép mức `0.1` của XR.
- Chỉ đổi chế độ khi đo vai đáng tin; dùng hai ngưỡng vào/ra và khoảng chờ để tránh đổi liên tục. Giữ đường quay về detector thường khi detector phụ không khả dụng.
- Thử riêng sau mục 1, trên cùng video có cả tay xa, nền dễ nhận nhầm và tay bị che. Đo tỷ lệ mất tay, nhận nhầm, ghép sai tay và độ trễ.

## Nền hiện có

Hand worker song song, Pose Z conditioning, dữ liệu raw riêng và ghép Hand với cổ tay Pose đã có trong VeilTalk; không cần làm lại. Hai cơ chế trên nay đã nối vào đầu vào Hand detector ở cả luồng chính và worker: Pose đủ mới (tối đa 120 ms) tạo vùng crop, hai vùng gần dùng khung chung, hai vùng xa được ghép trên một canvas 512×512, kết quả đổi về tọa độ webcam và kiểm tra khoảng cách cổ tay. Sau hai frame crop không thấy tay, frame kế tiếp chạy lại toàn ảnh. Ngưỡng Hand nhạy dùng detector thứ hai với detection/tracking `0.3`, presence `0.5`, chuyển theo độ rộng vai với hai ngưỡng và thời gian chờ 1 giây; nếu thiết bị không tải được detector thứ hai thì dùng ngưỡng thường. Cả hai được yêu cầu bật trong profile mới. Cơ chế XR tham khảo nằm trong `C:/project/SystemAnimatorOnline/js/mocap_lib_module.js` (chọn detector khoảng dòng 611–675; tạo crop khoảng dòng 1276–1360). Đây vẫn là giả thuyết cải thiện tay xa, chưa có benchmark webcam VeilTalk/XR đối chứng.

## Bổ sung từ XR dòng 1000–1500

- XR kiểm tra Hand landmark 0/9 có nằm trong vùng crop dự kiến và so khoảng cách Hand wrist–Pose wrist theo độ rộng vai (khoảng dòng 1012–1129). VeilTalk đã có matcher theo Pose wrist, tuổi mẫu và continuity; khi thêm crop cần kiểm tra lại ngưỡng cho tay xa, tránh nhận nhầm khi thử Hand confidence thấp.
- XR lọc hình dạng ngón tương đối với lòng bàn tay (khoảng dòng 1237–1245). VeilTalk đã có `HandLandmarkConditioner` lọc hình dạng tương đối với cổ tay và chuẩn hóa theo bề rộng lòng bàn tay; profile mới bật sẵn. Không cần làm lại.
- XR sửa Z bàn tay và ép chiều dài tối thiểu của đốt ngón (khoảng dòng 1179–1234). Chưa có bằng chứng webcam cho thấy VeilTalk cần hai heuristic này. Mã XR có dòng tính `dz` từ Y ở khoảng dòng 1219, nên không sao chép công thức; chỉ nghiên cứu riêng nếu xuất hiện lỗi ngón cụ thể.
- XR bắt đầu lấy hướng nhìn từ iris trong phần Face (khoảng dòng 1367–1500). VeilTalk có gaze solver dựa trên Face blendshapes và VRM LookAt, chưa dùng trực tiếp tâm iris 468/473. Để riêng cho đợt nghiên cứu gaze nếu có lỗi mắt nhìn sai; không gộp vào thử nghiệm tay xa.
