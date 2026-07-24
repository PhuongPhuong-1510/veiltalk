# Bộ lệnh làm việc với AI — VeilTalk

Mở file này bên cạnh khi làm. Chép nguyên câu, thay mã task cho đúng.

---

## PHẦN 0 — Chuẩn bị (làm một lần)

### 0.1 Dựng repo

```bash
mkdir veiltalk && cd veiltalk
git init
mkdir -p docs/_source docs/runbooks docs/screenshots
mkdir -p backend frontend signaling
# copy 9 file .docx vào docs/_source/
```

### 0.2 Bảo AI tạo bộ tài liệu

> Trong `docs/_source/` có 9 file .docx là tài liệu thiết kế của dự án.
>
> Chuyển từng file sang markdown theo ánh xạ dưới đây. **Giữ nguyên toàn bộ nội dung, không tóm tắt, không lược bỏ, không gộp, không tách.** Chỉ đổi định dạng và tên file.
>
> - VeilTalk_SRS.docx → docs/01_PRODUCT_REQUIREMENTS.md
> - VeilTalk_SAD_final.docx → docs/02_SYSTEM_ARCHITECTURE.md
> - VeilTalk_DDD.docx → docs/03_DATABASE.md
> - VeilTalk_API.docx → docs/04_API.md
> - VeilTalk_UIUX.docx → docs/05_UI_UX.md
> - VeilTalk_TestPlan.docx → docs/07_DEVELOPMENT_AND_TESTING.md
> - VeilTalk_Deploy.docx → docs/08_DEPLOYMENT_AND_OPERATIONS.md
> - VeilTalk_TaskList__1_.docx → docs/09_ROADMAP_AND_TASKS.md
> - VeilTalk_PerfReport.docx → docs/10_PERFORMANCE.md
>
> Làm từng file một, xong file nào báo file đó.

### 0.3 Kiểm chứng không mất nội dung

> Đối chiếu bản .docx gốc và bản .md vừa tạo. Đếm và báo cáo:
>
> - Số mã FR-xx (phải có FR-01 đến FR-22)
> - Số mã NFR-xx (phải có NFR-01 đến NFR-32)
> - Số mã TC-xx (phải có TC-01 đến TC-58)
> - Số mã SCR-xx (phải có SCR-01 đến SCR-21)
> - Số mã task (phải có 78)
> - Số bảng trong mỗi file
>
> Nếu có mã nào thiếu, chỉ rõ file nào và vị trí nào.

### 0.4 Tạo file điều khiển

> Tạo `AGENTS.md` ở gốc repo. Nội dung gồm:
> - Dự án là gì (1 đoạn ngắn)
> - Ngăn xếp công nghệ
> - Lệnh chạy build / test / dev
> - Quy ước code
> - Ràng buộc không được vi phạm (lấy từ NFR trong docs/01)
> - **Bảng chỉ đường**: task loại nào thì đọc file nào
> - Quy tắc cập nhật docs sau khi sửa code
>
> Giữ dưới 150 dòng — file này được đọc lại mỗi phiên.
>
> Sau đó tạo `CLAUDE.md` chỉ chứa một dòng: `@AGENTS.md`
>
> Tạo `docs/00_PROJECT_CONTEXT.md`: dự án làm cho ai, giải quyết vấn đề gì, bảng thuật ngữ, tổng quan công nghệ. Lấy nội dung từ docs/01 mục 1.
>
> Tạo `docs/06_CODEBASE_GUIDE.md` với khung rỗng, ghi chú "sẽ điền dần khi có code".

---

## PHẦN 1 — Vòng lặp mỗi task (dùng nhiều nhất)

### Lệnh 1 — Giao task

*(Bật plan mode trước: Shift+Tab hai lần)*

> Làm task **P2-T14**.
>
> Đọc mô tả task trong `docs/09_ROADMAP_AND_TASKS.md`, đọc các tài liệu mà task đó tham chiếu, và đọc code của các task phụ thuộc nếu đã có.
>
> Trình bày kế hoạch: sẽ tạo/sửa file nào, logic ra sao, test gì. Chưa viết code.

### Lệnh 2 — Sau khi đọc kế hoạch

Nếu ổn:
> Kế hoạch được. Làm đi.

Nếu có chỗ chưa hiểu:
> Giải thích rõ hơn bước 3 — tại sao lại làm như vậy, có cách nào khác không?

Nếu sai:
> Bước 2 sai. Theo `docs/04_API.md` mục 3.2 thì phải [X]. Sửa kế hoạch lại.

### Lệnh 3 — Sau khi code xong

> Chạy test. Nếu đỏ thì sửa cho đến khi xanh, báo tôi từng lỗi đã sửa.
>
> Sau đó cập nhật tài liệu bị ảnh hưởng và đánh dấu task hoàn thành trong `docs/09_ROADMAP_AND_TASKS.md`.
>
> Cuối cùng tóm tắt: đã tạo/sửa file nào, phần nào tôi cần đọc kỹ để hiểu.

### Lệnh 4 — Học code (đừng bỏ bước này)

> Giải thích file [tên file] như đang dạy người mới học. Nói rõ tại sao cần từng phần, và nếu hội đồng hỏi "tại sao chọn cách này" thì trả lời thế nào.

### Lệnh 5 — Review chéo (chạy bằng Codex hoặc Copilot)

> Review code trong [thư mục]. Kiểm tra:
> - Có khớp đặc tả trong `docs/04_API.md` không
> - Lỗ hổng bảo mật
> - Xử lý lỗi thiếu chỗ nào
> - Chỗ nào khó bảo trì
>
> Chỉ báo cáo, đừng sửa.

### Lệnh 6 — Commit

> Commit với message theo chuẩn conventional commits, ghi rõ mã task.

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

### Cuối phase — rà soát

> Đọc `docs/01_PRODUCT_REQUIREMENTS.md`, `docs/04_API.md`, `docs/03_DATABASE.md` và toàn bộ code đã viết trong phase này.
>
> Tìm chỗ code không khớp tài liệu. Với mỗi chỗ lệch, nói rõ nên sửa code hay sửa tài liệu và vì sao.

### Cuối phase — cập nhật bản đồ code

> Cập nhật `docs/06_CODEBASE_GUIDE.md`: thư mục nào chứa gì, file quan trọng nào làm gì, luồng dữ liệu đi từ đâu tới đâu. Viết để phiên sau đọc là biết ngay code nằm đâu.

---

## PHẦN 3 — Khi có vấn đề

### AI hiểu sai lặp lại

Đóng phiên, mở phiên mới. Rồi:

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

### Kiểm tra ràng buộc riêng tư

> Rà toàn bộ code frontend. Xác nhận không có chỗ nào gửi khung hình webcam hoặc ảnh khuôn mặt ra khỏi trình duyệt. Chỉ được truyền skeleton data và audio. Đây là NFR-06, không được vi phạm.

### Sau khi chốt hướng nghiên cứu

> Hướng nghiên cứu đã chốt là: [mô tả].
>
> Đọc `docs/01_PRODUCT_REQUIREMENTS.md` và `docs/02_SYSTEM_ARCHITECTURE.md`. Liệt kê những chỗ cần sửa để phù hợp: yêu cầu mới cần thêm, ADR cần viết, thành phần kiến trúc cần thêm. Chỉ liệt kê, chưa sửa.

---

## PHẦN 5 — Quy tắc bỏ túi

- **Một phiên = một task.** Xong thì đóng.
- **Sửa cùng một lỗi hai lần** → đóng phiên, mở mới.
- **Luôn plan mode** với task từ 2 giờ trở lên.
- **Không tin "đã xong"** nếu chưa thấy test chạy xanh.
- **Mỗi phase tự viết tay ít nhất một task** — để hiểu thật.
- **Chụp màn hình khi vừa làm xong**, đừng đợi lúc bảo vệ.
- **Hỏi "tại sao"** ít nhất một lần mỗi task.
- Phát hiện AI hiểu sai điều gì → **ghi ngay vào AGENTS.md**.
