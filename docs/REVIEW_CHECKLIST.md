# Checklist Soát Code — VeilTalk

Tài liệu này dành cho **AI đóng vai người soát** (Codex, Copilot, hoặc Claude Code ở phiên khác
với phiên đã viết code). Người soát **chỉ báo cáo, không sửa**.

Với mỗi vấn đề, báo cáo theo mẫu:

```
[MỨC ĐỘ] file:dòng — mục checklist bị vi phạm
Mô tả ngắn. Trích dẫn tài liệu nếu có.
```

Mức độ: **CHẶN** (không được merge) / **CẦN SỬA** / **GỢI Ý**.

---

## A. Riêng tư — mức CHẶN

Đây là lý do tồn tại của sản phẩm. Vi phạm là chặn merge, không thương lượng.

- [ ] Không có chỗ nào gửi khung hình webcam, ảnh, hay video khuôn mặt ra khỏi trình duyệt
- [ ] Chỉ truyền skeleton data (góc khớp, blendshape) và audio
- [ ] Không log dữ liệu khuôn mặt hay ảnh ra console/file
- [ ] Server không nhận, không xử lý, không lưu bất kỳ dữ liệu hình ảnh nào từ camera
- [ ] MediaPipe và Three.js chỉ chạy phía client

## B. Bảo mật xác thực — mức CHẶN

- [ ] Mật khẩu được băm trước khi lưu, không bao giờ lưu dạng thô
- [ ] JWT secret lấy từ biến môi trường, **không hard-code trong source**
- [ ] Access token và refresh token có thời hạn đúng như đặc tả
- [ ] Token bị thu hồi được kiểm tra qua blacklist trong Redis
- [ ] Không có credential, khóa API, hay chuỗi kết nối nào nằm trong code
- [ ] Endpoint cần đăng nhập đều thực sự được bảo vệ, không sót

## C. Chống dò tài khoản — mức CHẶN

- [ ] Đăng nhập sai: email không tồn tại và sai mật khẩu trả **cùng một thông báo**
- [ ] Thời gian phản hồi hai trường hợp trên không chênh lệch rõ rệt
- [ ] Tìm kiếm người dùng không tiết lộ email nào đang tồn tại
- [ ] `is_discoverable` mặc định FALSE
- [ ] Tìm kiếm có giới hạn tần suất, trả 429 khi vượt

## D. Dữ liệu

- [ ] Không dùng DELETE thật, chỉ đặt `deleted_at`
- [ ] Mọi truy vấn đều lọc `deleted_at IS NULL`
- [ ] Truy vấn dùng tham số ràng buộc, không nối chuỗi SQL
- [ ] Không có truy vấn N+1 trong vòng lặp
- [ ] Migration mới không sửa file migration đã chạy
- [ ] Kiểu dữ liệu và ràng buộc khớp với `docs/03_DATABASE.md`

## E. Khớp đặc tả API

- [ ] Đường dẫn, phương thức, mã trạng thái đúng `docs/04_API.md`
- [ ] Tên trường trong request/response đúng đặc tả, không tự đổi
- [ ] Lỗi trả về theo đúng định dạng chuẩn đã quy định
- [ ] Phân trang dùng cursor như đặc tả, không dùng offset
- [ ] Endpoint có yêu cầu idempotency thì thực sự xử lý idempotency key

## F. Chất lượng code

- [ ] Controller mỏng, logic nằm ở service
- [ ] Package chia theo tính năng, không theo tầng
- [ ] Ngoại lệ được xử lý, không nuốt lỗi im lặng (`catch` rỗng)
- [ ] Không có `System.out.println` hay `console.log` sót lại
- [ ] Không có code chết, biến thừa, import thừa
- [ ] Không có `TODO` hay `FIXME` chưa xử lý mà không ghi rõ lý do

## G. Kiểm thử

- [ ] Có test cho luồng chính
- [ ] Có test cho ít nhất một trường hợp lỗi
- [ ] Test tương ứng với TC-xx trong `docs/07_DEVELOPMENT_AND_TESTING.md` nếu có
- [ ] Test chạy được độc lập, không phụ thuộc thứ tự

## H. Frontend

- [ ] Component khớp đặc tả màn hình SCR-xx trong `docs/05_UI_UX.md`
- [ ] Dùng design token, không hard-code màu và khoảng cách
- [ ] Có xử lý trạng thái đang tải và trạng thái lỗi
- [ ] Có trạng thái rỗng nếu màn hình đó cần
- [ ] Không rò rỉ tài nguyên: hủy đăng ký sự kiện, dừng stream webcam khi rời màn hình
- [ ] Vòng lặp render không tạo object mới mỗi khung hình

## I. Tài liệu

- [ ] Thay đổi endpoint đã cập nhật `docs/04_API.md`
- [ ] Thay đổi schema đã cập nhật `docs/03_DATABASE.md`
- [ ] File/thư mục mới đã ghi vào `docs/06_CODEBASE_GUIDE.md`
- [ ] Task đã đánh dấu hoàn thành trong `docs/09_ROADMAP_AND_TASKS.md`

---

## Trọng tâm theo loại task

Không phải task nào cũng soát hết mọi mục. Ưu tiên:

| Loại task | Mục cần soát kỹ |
|---|---|
| Xác thực, tài khoản | A, B, C, D, E |
| Nhắn tin, WebSocket | B, D, E, F |
| Upload video, MinIO | B, D, E |
| Tracking, render avatar | **A**, F, H |
| WebRTC, signaling | **A**, B, F |
| Màn hình giao diện | H, F |

## Điều KHÔNG cần báo cáo

Để tránh nhiễu, bỏ qua những thứ sau trừ khi được hỏi riêng:

- Ý kiến về phong cách đặt tên nếu đã nhất quán trong file
- Đề xuất tái cấu trúc lớn nằm ngoài phạm vi task
- Gợi ý thêm tính năng
- Đề xuất đổi thư viện
