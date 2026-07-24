# Bộ lệnh làm việc với AI — VeilTalk

**File này dành cho BẠN, không phải cho AI.** Mở bên cạnh khi làm việc, chép nguyên câu, thay mã task cho đúng.

File tương ứng dành cho AI là `AGENTS.md` ở gốc repo.

---

## PHẦN 1 — Vòng lặp mỗi task (dùng nhiều nhất)

### Lệnh 1 — Giao task

*(Bật Plan mode trước: Shift + Tab)*

> Làm task **P2-T14**.
>
> Đọc mô tả task trong `docs/09_ROADMAP_AND_TASKS.md`, đọc các tài liệu mà task đó tham chiếu, và đọc code của các task phụ thuộc nếu đã có.
>
> Trình bày kế hoạch: sẽ tạo/sửa file nào, logic ra sao, test gì. Chưa viết code.

### Lệnh 2 — Sau khi đọc kế hoạch

Nếu ổn:
> Kế hoạch được. Làm đi.

Nếu chưa hiểu:
> Giải thích rõ hơn bước 3 — tại sao lại làm như vậy, có cách nào khác không?

Nếu sai:
> Bước 2 sai. Theo `docs/04_API.md` mục 3.2 thì phải [X]. Sửa kế hoạch lại.

Nếu nó đi quá xa:
> Bước 5 và 6 nằm ngoài phạm vi task này. Bỏ đi.

### Lệnh 3 — Sau khi code xong

> Chạy test. Nếu đỏ thì sửa cho đến khi xanh, báo tôi từng lỗi đã sửa.
>
> Sau đó cập nhật tài liệu bị ảnh hưởng và đánh dấu task hoàn thành trong `docs/09_ROADMAP_AND_TASKS.md`.
>
> Cuối cùng tóm tắt: đã tạo/sửa file nào, phần nào tôi cần đọc kỹ để hiểu.

### Lệnh 4 — Học code (đừng bỏ bước này)

> Giải thích file [tên file] như đang dạy người mới học. Nói rõ tại sao cần từng phần, và nếu hội đồng hỏi "tại sao chọn cách này" thì trả lời thế nào.

### Lệnh 5 — Soát chéo (chạy bằng Codex hoặc Copilot, KHÔNG dùng lại phiên đã viết code)

> Đọc `docs/REVIEW_CHECKLIST.md`. Soát toàn bộ thay đổi trong nhánh [tên nhánh] theo checklist đó.
>
> Với mỗi vấn đề: ghi rõ file, dòng, mục checklist bị vi phạm, mức độ nghiêm trọng. Chỉ báo cáo, không sửa gì.

### Lệnh 6 — Commit

> Commit theo chuẩn conventional commits, ghi rõ mã task trong message.

---

## PHẦN 2 — Đầu và cuối mỗi phase

### Đầu phase — định hướng

> Đọc toàn bộ phần **P2** trong `docs/09_ROADMAP_AND_TASKS.md` và toàn bộ `docs/04_API.md`.
>
> Tổng hợp cho tôi:
> - Phase này có bao nhiêu task, tổng bao nhiêu giờ
> - Thứ tự bắt buộc do phụ thuộc
> - Task nào rủi ro nhất, vì sao
> - Có chỗ nào trong tài liệu mâu thuẫn hoặc thiếu không
>
> Chưa viết code.

### Cuối phase — rà soát nhất quán

> Đọc `docs/01_PRODUCT_REQUIREMENTS.md`, `docs/04_API.md`, `docs/03_DATABASE.md` và toàn bộ code đã viết trong phase này.
>
> Tìm chỗ code không khớp tài liệu. Với mỗi chỗ lệch, nói rõ nên sửa code hay sửa tài liệu và vì sao.

### Cuối phase — cập nhật bản đồ code

> Cập nhật `docs/06_CODEBASE_GUIDE.md`: thư mục nào chứa gì, file quan trọng nào làm gì, luồng dữ liệu đi từ đâu tới đâu. Viết để phiên sau đọc là biết ngay code nằm đâu.

---

## PHẦN 3 — Khi có vấn đề

### AI hiểu sai lặp lại

Đóng phiên, mở phiên mới. Rồi dạy hệ thống thay vì sửa từng lần:

> Ghi vào `AGENTS.md` quy tắc: [điều vừa bị hiểu sai]. Đặt vào mục quy ước code.

### Lỗi không rõ nguyên nhân

> Lỗi: [dán nguyên log]
>
> Đừng đoán. Đọc code liên quan, nêu 3 giả thuyết, rồi đề xuất cách kiểm chứng từng giả thuyết. Chưa sửa gì.

### Code chạy nhưng bạn không tin

> Viết test bao phủ các trường hợp biên của [chức năng]. Tham khảo `docs/07_DEVELOPMENT_AND_TESTING.md`. Nếu test làm lộ ra bug thì báo tôi trước khi sửa.

### Cần cắt phạm vi

> Tôi còn [X] giờ và chưa xong [danh sách task]. Đọc `docs/09_ROADMAP_AND_TASKS.md` mục thứ tự ưu tiên cắt giảm, đề xuất cắt gì để vẫn demo được đầy đủ luồng chính.

---

## PHẦN 4 — Lệnh riêng cho VeilTalk

### Bản thử rủi ro (làm TRƯỚC khi code thật)

> Tạo một file HTML độc lập, không backend, không React, không theo kiến trúc dự án. Mục đích duy nhất: kiểm chứng phần rủi ro nhất.
>
> Yêu cầu: webcam → MediaPipe Face + Hand + Pose Landmarker → điều khiển model VRM bằng Three.js và @pixiv/three-vrm → hiện FPS và độ trễ tracking→render lên góc màn hình.
>
> Đây là bản vứt đi, ưu tiên chạy được hơn code đẹp.

### Đo hiệu năng

> Đo theo phương pháp trong `docs/10_PERFORMANCE.md`: độ trễ tracking→render bằng `performance.now()`, FPS bằng bộ đếm requestAnimationFrame, độ trễ cuộc gọi bằng `RTCPeerConnection.getStats()`.
>
> Chạy 60 giây, báo min / trung bình / p95 / max. Điền kết quả vào `docs/10_PERFORMANCE.md`.

### Kiểm tra ràng buộc riêng tư (chạy trước mỗi lần merge vào main)

> Rà toàn bộ code frontend. Xác nhận không có chỗ nào gửi khung hình webcam hoặc ảnh khuôn mặt ra khỏi trình duyệt. Chỉ được truyền skeleton data và audio. Đây là NFR-06, không được vi phạm.

### Sau khi chốt hướng nghiên cứu

> Hướng nghiên cứu đã chốt là: [mô tả].
>
> Đọc `docs/01_PRODUCT_REQUIREMENTS.md` và `docs/02_SYSTEM_ARCHITECTURE.md`. Liệt kê những chỗ cần sửa để phù hợp: yêu cầu mới cần thêm, ADR cần viết, thành phần kiến trúc cần thêm. Chỉ liệt kê, chưa sửa.

---

## PHẦN 5 — Quy tắc bỏ túi

- **Một phiên = một task.** Xong thì đóng.
- **Sửa cùng một lỗi hai lần** → đóng phiên, mở mới.
- **Plan mode + Effort cao** cho lúc nghĩ. **Manual** cho lúc thực thi.
- **Không tin "đã xong"** nếu chưa thấy test chạy xanh.
- **Người viết code không được là người soát code.**
- **Mỗi phase tự viết tay ít nhất một task** — để hiểu thật.
- **Chụp màn hình khi vừa làm xong**, đừng đợi lúc bảo vệ.
- **Hỏi "tại sao"** ít nhất một lần mỗi task.
- Phát hiện AI hiểu sai điều gì → **ghi ngay vào AGENTS.md**.

---

## Số liệu tham chiếu

Đã kiểm chứng bằng máy trên bản .docx gốc:

| Loại mã | Số lượng | Nằm ở file |
|---|---|---|
| FR-01 → FR-32 | 32 | `01_PRODUCT_REQUIREMENTS.md` |
| NFR-01 → NFR-32 | 32 | `01_PRODUCT_REQUIREMENTS.md` |
| SCR-01 → SCR-21 | 21 | `05_UI_UX.md` |
| TC-01 → TC-58 | 58 | `07_DEVELOPMENT_AND_TESTING.md` |
| Task Pn-Txx | 83 | `09_ROADMAP_AND_TASKS.md` |

Phân bố task: P0=7, P1=6, P2=26, P3=4, P4=24, P5=6, P6=5, P7=5.
Tổng ước tính trong tài liệu: ~280–320 giờ.
