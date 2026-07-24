TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**TÀI LIỆU THIẾT KẾ GIAO DIỆN NGƯỜI DÙNG**

*(UI/UX Design Document)*

**VEILTALK**

Thiết kế giao diện hệ thống giao tiếp qua nhân vật ảo

Phiên bản tài liệu: 1.0

Trạng thái: Bản nháp (Draft)

Ngày cập nhật: 21/06/2026

Người soạn thảo: Lê Thị Tú Phương — MSSV 23020695

Lớp: K68 — Khoa Công nghệ Thông tin

Mục lục

## 1. Triết lý và Nguyên tắc Thiết kế

### 1.1. Định hướng tổng quan

VeilTalk là ứng dụng giao tiếp qua nhân vật ảo — điều này đặt ra một thách thức thiết kế độc đáo: giao diện phải tôn vinh nhân vật ảo như trung tâm trải nghiệm, không phải chỉ là một tính năng phụ. Người dùng mục tiêu là những ai quan tâm đến sự riêng tư và cũng là những người quen thuộc với văn hóa VTuber — họ kỳ vọng một không gian có tính cách, không phải một công cụ hội họp thông thường.

Aesthetic chủ đạo: Ethereal Dark — huyền bí, tinh tế, lấy cảm hứng từ không gian vũ trụ và văn hóa avatar Nhật Bản. Màu sắc xoay quanh trục violet-indigo, với các lớp glassmorphism và ánh sáng mềm để tạo cảm giác chiều sâu mà không rối mắt.

### 1.2. Năm nguyên tắc thiết kế cốt lõi

| **Nguyên tắc**            | **Áp dụng trong VeilTalk**                                                                                                                                                |
|---------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Avatar First**          | Nhân vật ảo phải là phần tử trực quan lớn nhất và nổi bật nhất trong mọi màn hình liên quan đến cuộc gọi. Preview avatar luôn hiển thị theo thời gian thực khi có webcam. |
| **Privacy by Visual**     | Giao diện truyền đạt cảm giác bảo vệ — không bao giờ hiển thị ảnh đại diện thật trong context cuộc gọi. Icon và biểu tượng nhấn mạnh sự ẩn danh.                          |
| **Depth Without Clutter** | Glassmorphism và gradient tạo chiều sâu thị giác, nhưng không thêm element thừa. Mỗi element phải có lý do tồn tại.                                                       |
| **Instant Feedback**      | Mọi tương tác phải có phản hồi trực quan ngay lập tức — avatar phải phản ứng trong vòng 100ms, nút phải có hover/press state rõ ràng.                                     |
| **Inclusive Experience**  | Hỗ trợ cả dark và light mode theo hệ thống; đảm bảo contrast ratio tối thiểu 4.5:1 (WCAG AA) cho tất cả text; keyboard navigation đầy đủ.                                 |

### 1.3. Công cụ thiết kế

- Figma: thiết kế giao diện chính, prototyping tương tác, design system components.

- FigJam: user flow diagrams, brainstorming, card sorting.

- Handshake: xuất design tokens sang code (CSS variables cho frontend).

- Lottie: animation cho loading states và avatar idle animations.

## 2. Hệ thống Thiết kế (Design System)

### 2.1. Bảng màu (Color Palette)

Hệ thống màu được chia làm hai lớp: Primitive Colors (màu gốc không thay đổi) và Semantic Tokens (alias có nghĩa ngữ cảnh, thay đổi giữa dark/light mode). Mọi component chỉ được dùng Semantic Tokens — không hardcode màu gốc trong component.

Primitive Colors — trục màu chính

| **Token**       | **Dark** | **Light** | **Mục đích**                           |
|-----------------|----------|-----------|----------------------------------------|
| **violet-50**   | \#F5F3FF | \#F5F3FF  | Nền violet nhạt nhất (light mode only) |
| **violet-200**  | \#DDD6FE | \#DDD6FE  | Border violet nhạt                     |
| **violet-400**  | \#A78BFA | \#A78BFA  | Violet trung tính                      |
| **violet-600**  | \#7C3AED | \#7C3AED  | Primary brand color                    |
| **violet-800**  | \#5B21B6 | \#5B21B6  | Violet đậm                             |
| **violet-950**  | \#2E1065 | \#2E1065  | Violet sâu nhất                        |
| **indigo-900**  | \#1E1B4B | \#1E1B4B  | Gần đen — text/nền dark                |
| **midnight**    | \#0D0B14 | \#0D0B14  | Background dark mode                   |
| **cyan-400**    | \#22D3EE | \#22D3EE  | Accent phụ — trạng thái active         |
| **cyan-600**    | \#0891B2 | \#0891B2  | Accent phụ đậm hơn                     |
| **neutral-50**  | \#FAFAFA | \#FAFAFA  | Background light mode                  |
| **neutral-900** | \#171717 | \#171717  | Text đậm nhất                          |

Semantic Tokens — ánh xạ dark/light

| **Token**          | **Dark**   | **Light**  | **Mục đích**                           |
|--------------------|------------|------------|----------------------------------------|
| **bg-base**        | \#0D0B14   | \#FAF8FF   | Background toàn trang                  |
| **bg-surface**     | \#1A1528   | \#FFFFFF   | Card, modal, sidebar                   |
| **bg-elevated**    | \#241E35   | \#F3EEFF   | Dropdown, tooltip, popover             |
| **bg-overlay**     | \#312848   | \#EDE9FE   | Hover state, subtle emphasis           |
| **border-subtle**  | \#312848   | \#E5DAF8   | Đường viền nhạt                        |
| **border-default** | \#4C3A7A   | \#C4B5FD   | Đường viền thông thường                |
| **text-primary**   | \#F5F3FF   | \#1E1B4B   | Text chính                             |
| **text-secondary** | \#A78BFA   | \#6D28D9   | Text phụ, placeholder                  |
| **text-muted**     | \#6B7280   | \#9CA3AF   | Text mờ, disabled                      |
| **accent-primary** | \#7C3AED   | \#7C3AED   | Nút chính, link, focus ring            |
| **accent-hover**   | \#6D28D9   | \#6D28D9   | Hover state của accent                 |
| **accent-glow**    | \#7C3AED40 | \#7C3AED20 | Box shadow glow của accent             |
| **accent-2**       | \#22D3EE   | \#0891B2   | Secondary accent — online status, live |
| **success**        | \#10B981   | \#059669   | Thành công, connected                  |
| **warning**        | \#F59E0B   | \#D97706   | Cảnh báo, reconnecting                 |
| **error**          | \#EF4444   | \#DC2626   | Lỗi, disconnected                      |

### 2.2. Typography

Font chính: Outfit (Google Fonts) — geometric sans-serif, hiện đại, gợi cảm giác tech-futuristic phù hợp với aesthetic VeilTalk. Font phụ cho body text: Inter — tối ưu legibility cho đoạn văn dài. Hệ thống dùng modular scale với ratio 1.25 (Major Third). Typography không thay đổi theo dark/light mode.

| **Token**       | **Dark**           | **Light**  | **Mục đích**                    |
|-----------------|--------------------|------------|---------------------------------|
| **Token**       | Size / Line-height | Font       | Mục đích                        |
| **display-2xl** | 72px / 80px        | Outfit 700 | Hero text — màn hình onboarding |
| **display-xl**  | 60px / 72px        | Outfit 700 | Tên app lớn, splash screen      |
| **display-lg**  | 48px / 56px        | Outfit 600 | Page title lớn                  |
| **display-md**  | 36px / 44px        | Outfit 600 | Section header nổi bật          |
| **text-xl**     | 20px / 30px        | Inter 600  | Header màn hình (h1 trong app)  |
| **text-lg**     | 18px / 28px        | Inter 500  | Sub-header, card title          |
| **text-md**     | 16px / 24px        | Inter 400  | Body text chính                 |
| **text-sm**     | 14px / 20px        | Inter 400  | Caption, label form             |
| **text-xs**     | 12px / 16px        | Inter 400  | Timestamp, tag, badge text      |

### 2.3. Spacing System

Dựa trên base unit 4px. Tất cả spacing, padding, margin dùng bội số của 4.

| **Token**    | **Dark** | **Light** | **Mục đích**                               |
|--------------|----------|-----------|--------------------------------------------|
| **space-1**  | 4px      | 4px       | Gap nội tuyến nhỏ nhất, icon padding       |
| **space-2**  | 8px      | 8px       | Padding icon button, gap giữa icon và text |
| **space-3**  | 12px     | 12px      | Padding compact                            |
| **space-4**  | 16px     | 16px      | Padding button, gap card element           |
| **space-5**  | 20px     | 20px      | Gap section nhỏ                            |
| **space-6**  | 24px     | 24px      | Padding card, padding input                |
| **space-8**  | 32px     | 32px      | Gap giữa các section                       |
| **space-10** | 40px     | 40px      | Margin lớn, padding page mobile            |
| **space-12** | 48px     | 48px      | Bottom bar height, avatar callout padding  |
| **space-16** | 64px     | 64px      | Khoảng cách section lớn                    |

### 2.4. Border Radius & Shadow

*Border radius là thuộc tính hình học của component — không thay đổi theo dark/light mode. Tất cả radius dùng cùng một giá trị cho cả hai theme.*

| **Token**         | **Dark**                                       | **Light**             | **Mục đích**                            |
|-------------------|------------------------------------------------|-----------------------|-----------------------------------------|
| **radius-sm**     | 6px                                            | 6px                   | Badge, tag, input nhỏ                   |
| **radius-md**     | 12px                                           | 12px                  | Button, card nhỏ                        |
| **radius-lg**     | 16px                                           | 16px                  | Card thông thường, modal                |
| **radius-xl**     | 24px                                           | 24px                  | Bottom sheet, avatar card               |
| **radius-2xl**    | 32px                                           | 32px                  | Avatar preview container                |
| **radius-full**   | 9999px                                         | 9999px                | Pill button, badge tròn, avatar         |
| **shadow-sm**     | 0 1px 3px \#7C3AED20                           | 0 1px 3px \#00000010  | Card nổi nhẹ                            |
| **shadow-md**     | 0 4px 16px \#7C3AED30                          | 0 4px 12px \#00000015 | Modal, dropdown                         |
| **shadow-glow**   | 0 0 32px \#7C3AED50, 0 0 8px \#7C3AED30        | 0 0 20px \#7C3AED30   | Avatar container khi active, nút call   |
| **shadow-avatar** | 0 0 60px \#7C3AED60, inset 0 0 30px \#7C3AED10 | 0 0 40px \#7C3AED40   | Avatar trong video call — hiệu ứng aura |

### 2.5. Motion & Animation

Tất cả animation phải tôn trọng prefers-reduced-motion. Duration và easing chuẩn hóa để giao diện cảm thấy nhất quán.

| **Token**           | **Dark**                          | **Light** | **Mục đích**                               |
|---------------------|-----------------------------------|-----------|--------------------------------------------|
| **duration-fast**   | 100ms                             | 100ms     | Hover state, ripple, color transition      |
| **duration-normal** | 200ms                             | 200ms     | Fade in/out, dropdown, tooltip             |
| **duration-slow**   | 350ms                             | 350ms     | Modal open/close, page transition          |
| **duration-avatar** | 16ms                              | 16ms      | Avatar render loop (60fps = 16ms/frame)    |
| **ease-out**        | cubic-bezier(0, 0, 0.2, 1)        |           | Phần tử xuất hiện — cảm giác nhẹ nhàng đến |
| **ease-in**         | cubic-bezier(0.4, 0, 1, 1)        |           | Phần tử biến mất — nhanh gọn               |
| **ease-spring**     | cubic-bezier(0.34, 1.56, 0.64, 1) |           | Avatar bounce, button press — có spring    |

## 3. Thư viện Components

### 3.1. Button

| **Variant**                | **Đặc tả visual**                                                                                       |
|----------------------------|---------------------------------------------------------------------------------------------------------|
| **Primary**                | bg-accent-primary, text trắng, radius-md, shadow-glow khi hover, scale(0.97) khi press, min-width 120px |
| **Secondary**              | bg-transparent, border 1.5px border-default, text-primary, hover: bg-overlay                            |
| **Ghost**                  | bg-transparent, text-secondary, hover: bg-overlay, không có border                                      |
| **Danger**                 | bg-error, text trắng — chỉ dùng cho xóa tài khoản, xóa video                                            |
| **Call (chuyên dụng)**     | Tròn 64px, bg-success, icon phone trắng, shadow-glow xanh lá — nút bắt đầu gọi                          |
| **End Call (chuyên dụng)** | Tròn 64px, bg-error, icon phone-off trắng — nút kết thúc cuộc gọi                                       |
| **Icon Only**              | Tròn 40px hoặc 48px, bg-bg-elevated, hover: bg-overlay — nút mic, camera, ...                           |

### 3.2. Input & Form

| **Variant**     | **Đặc tả visual**                                                                                             |
|-----------------|---------------------------------------------------------------------------------------------------------------|
| **Default**     | bg-bg-elevated, border border-subtle, focus: border-accent-primary + shadow-glow nhạt, radius-md, height 48px |
| **Search**      | Có icon search bên trái, padding-left: space-10, clear button bên phải khi có text                            |
| **Password**    | Có toggle show/hide icon bên phải                                                                             |
| **Error state** | border-error, text-error hiển thị dưới input, icon cảnh báo                                                   |
| **Label**       | text-sm font-medium, text-primary, margin-bottom: space-2                                                     |
| **Helper text** | text-xs, text-muted, margin-top: space-1                                                                      |

### 3.3. Avatar Preview Component

Đây là component quan trọng nhất — xuất hiện ở màn hình avatar setup, home sidebar, video call. Phải được thiết kế cẩn thận.

| **State**                  | **Visual**                                                                                       |
|----------------------------|--------------------------------------------------------------------------------------------------|
| **Idle (không có webcam)** | Avatar ở tư thế đứng thở nhẹ (idle animation Lottie), bg gradient violet-midnight, shadow-avatar |
| **Tracking Active**        | Avatar cử động theo người dùng, viền pulse cyan nhạt 2px, badge 'LIVE' xanh lá góc trên phải     |
| **Tracking Lost**          | Avatar freeze ở tư thế cuối, overlay mờ 20%, icon warning nhỏ góc dưới phải, không hiện lỗi lớn  |
| **Loading Model**          | Skeleton shimmer animation trong container, progress bar violet mỏng ở đáy container             |
| **Call — Speaker Active**  | shadow-avatar full glow, pulse ring tím ngoài container đồng bộ với giọng nói                    |
| **Call — Muted**           | Overlay mờ nhạt, icon microphone gạch chéo nhỏ góc dưới, avatar vẫn cử động                      |

### 3.4. Chat Bubble

| **Loại**              | **Đặc tả**                                                                     |
|-----------------------|--------------------------------------------------------------------------------|
| **Gửi (bản thân)**    | bg-accent-primary, text trắng, radius-xl radius-br-sm, căn phải, max-width 75% |
| **Nhận (người khác)** | bg-bg-elevated, text-primary, radius-xl radius-bl-sm, căn trái, max-width 75%  |
| **Timestamp**         | text-xs text-muted, hiện khi hover hoặc theo nhóm tin nhắn                     |
| **Status icon**       | Sent: check đơn; Delivered: check đôi; Read: check đôi màu cyan                |
| **Tin nhắn đầu nhóm** | Avatar nhỏ 24px + tên hiển thị bên trên bubble đầu tiên trong chuỗi liên tiếp  |

### 3.5. Bottom Navigation Bar

4 tab chính: Conversations (icon bubble), Search (icon search), Videos (icon play), Profile (icon user). Active tab: icon màu accent-primary + label text-xs. Inactive: icon text-muted. Background: bg-surface với blur backdrop nếu có glassmorphism. Height: 64px + safe area inset.

### 3.6. Call Controls Bar

Thanh điều khiển xuất hiện dưới màn hình video call. Layout: căn giữa, gap đều nhau.

- Mic toggle (Icon Only, bg thay đổi khi mute): 48px — bật/tắt microphone

- Tracking toggle (Icon Only): 48px — bật/tắt webcam tracking. Khi TẮT: avatar freeze ở tư thế cuối, không dừng cuộc gọi. Label tooltip: 'Dừng theo dõi' / 'Bắt đầu theo dõi' — KHÔNG dùng chữ 'Camera' tránh nhầm với bật/tắt video thật như Zoom/Meet

- End Call (Call button đỏ): 64px — to nhất vì action quan trọng nhất

- Chat toggle (Icon Only): 48px — mở overlay tin nhắn

- More options (Icon Only): 48px — flip camera (đổi camera trước/sau nếu có), báo cáo sự cố

*Lưu ý: 'Record' không có trong More options vì quay video với nhân vật ảo là tính năng độc lập (SCR-16, flow 6.2) — không phải record cuộc gọi đang diễn ra. Đặt nhầm ở đây gây nhầm lẫn về scope tính năng.*

## 4. Danh sách Màn hình (Screen Inventory)

| **ID**     | **Tên màn hình — Tương ứng UC/FR**                                                |
|------------|-----------------------------------------------------------------------------------|
| **SCR-01** | Splash Screen                                                                     |
| **SCR-02** | Onboarding Slide 1 — Giới thiệu VeilTalk                                          |
| **SCR-03** | Onboarding Slide 2 — Cách hoạt động                                               |
| **SCR-04** | Onboarding Slide 3 — Bảo mật & riêng tư                                           |
| **SCR-05** | Đăng ký tài khoản (UC-00 / FR-01)                                                 |
| **SCR-06** | Đăng nhập (UC-00 / FR-02)                                                         |
| **SCR-07** | Avatar Setup — Chọn model (UC-03 / FR-04)                                         |
| **SCR-08** | Avatar Setup — Tùy chỉnh màu sắc, trang phục (FR-04)                              |
| **SCR-09** | Avatar Setup — Xem trước & xác nhận (UC-03)                                       |
| **SCR-10** | Home — Danh sách trò chuyện                                                       |
| **SCR-11** | Tìm kiếm người dùng (UC-05 / FR-22)                                               |
| **SCR-12** | Màn hình Chat (FR-11, FR-12)                                                      |
| **SCR-13** | Video Call — Gọi đi (đang kết nối)                                                |
| **SCR-14** | Video Call — Đang gọi (main screen) (FR-13, FR-14)                                |
| **SCR-15** | Video Call — Nhận cuộc gọi (incoming)                                             |
| **SCR-16** | Thư viện Video (FR-17)                                                            |
| **SCR-17** | Xem Video (FR-17)                                                                 |
| **SCR-18** | Profile & Cài đặt (FR-03, FR-22 discoverable)                                     |
| **SCR-19** | Xác nhận xóa tài khoản (NFR-27)                                                   |
| **SCR-20** | Error / No Connection state                                                       |
| **SCR-21** | Quên mật khẩu — Out of scope MVP (nút disabled ở SCR-06 với tooltip 'Sắp ra mắt') |

## 5. Đặc tả Chi tiết Màn hình

### 5.1. SCR-01 — Splash Screen

| **Thuộc tính**      | **Đặc tả**                                                                                                                                                                   |
|---------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Mục đích**        | Hiển thị 2-3 giây khi app khởi động, load resources, kiểm tra session JWT còn hạn không.                                                                                     |
| **Background**      | bg-midnight (#0D0B14) — dark mode absolute, không phụ thuộc system theme để đảm bảo nhất quán lần đầu mở app.                                                                |
| **Center element**  | Logo VeilTalk: icon mặt nạ trừu tượng (mask/visor) kích thước 80×80px, màu violet-400. Chữ VEILTALK bên dưới, font Outfit 700, 32px, gradient text từ violet-400 → cyan-400. |
| **Animation**       | Logo fade in (0→1, 400ms ease-out), sau đó pulse glow nhẹ mỗi 2 giây. Loading spinner mỏng 2px màu violet dưới logo.                                                         |
| **Chuyển màn hình** | Nếu có session hợp lệ → SCR-10 (Home). Lần đầu mở → SCR-02 (Onboarding). Session hết hạn → SCR-06 (Login).                                                                   |

### 5.2. SCR-02/03/04 — Onboarding (3 slides)

| **Thuộc tính**             | **Đặc tả**                                                                                                                                                                                              |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Layout**                 | Full screen illustration trên 60% màn hình, text + CTA dưới 40%. Dots indicator giữa. Nút 'Bỏ qua' góc trên phải từ slide 1.                                                                            |
| **Slide 1 — Illustration** | Nhân vật avatar 3D floating với hiệu ứng particle. Headline: 'Giao tiếp theo cách của bạn'. Sub: 'Thể hiện bản thân qua nhân vật ảo độc đáo — khuôn mặt thật, luôn được bảo vệ.'                        |
| **Slide 2 — Illustration** | Webcam → magic transform → avatar (arrow animation). Headline: 'Công nghệ theo dõi thời gian thực'. Sub: 'AI nhận diện chuyển động của bạn và điều khiển nhân vật ảo ngay lập tức, ngay trên thiết bị.' |
| **Slide 3 — Illustration** | Shield icon với khóa, glow violet. Headline: 'Riêng tư từ thiết kế'. Sub: 'Khuôn mặt thật không bao giờ rời khỏi thiết bị bạn. Chỉ nhân vật ảo và âm thanh được truyền đi.'                             |
| **Slide 3 — CTA**          | Nút Primary 'Bắt đầu' (full width) + text link 'Đã có tài khoản? Đăng nhập' phía dưới.                                                                                                                  |
| **Swipe gesture**          | Hỗ trợ swipe ngang để chuyển slide. Transition: slide + fade 300ms.                                                                                                                                     |

### 5.3. SCR-05 — Đăng ký tài khoản

| **Thuộc tính**        | **Đặc tả**                                                                                                                                                     |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Header**            | Logo nhỏ + 'Tạo tài khoản' (text-xl, Outfit). Back button góc trái nếu có thể quay về onboarding.                                                              |
| **Form fields**       | Email input, Password input (có toggle show/hide), Display name input. Thứ tự này vì email + password là thông tin bảo mật, tên hiển thị là thông tin cá nhân. |
| **Password strength** | 4-segment progress bar dưới password field: đỏ (yếu) → cam → vàng → xanh lá (mạnh). Label realtime: 'Cần chữ hoa và số'.                                       |
| **CTA**               | Nút Primary 'Đăng ký' full-width. Disabled cho đến khi tất cả field hợp lệ.                                                                                    |
| **Footer**            | Text-sm: 'Bằng cách đăng ký, bạn đồng ý với Điều khoản sử dụng và Chính sách bảo mật' — link underline violet.                                                 |
| **Error handling**    | Email đã tồn tại: inline error text-error dưới email field. Không dùng toast để không che form.                                                                |
| **Sau đăng ký**       | Chuyển thẳng sang SCR-07 (Avatar Setup) — người dùng mới phải thiết lập avatar trước khi dùng app.                                                             |

### 5.4. SCR-06 — Đăng nhập

| **Thuộc tính** | **Đặc tả**                                                                                                                            |
|----------------|---------------------------------------------------------------------------------------------------------------------------------------|
| **Header**     | Logo + 'Chào mừng trở lại' subtitle dạng greeting thay vì 'Đăng nhập' khô khan.                                                       |
| **Form**       | Email, Password. Nút 'Quên mật khẩu?' căn phải phía trên nút submit (ngoài phạm vi MVP — disabled với tooltip 'Sắp ra mắt').          |
| **Error**      | Sai email/mật khẩu: error banner trên cùng form (không inline để tránh tiết lộ field nào sai — nhất quán với FR-02 anti-enumeration). |
| **Footer**     | Link 'Chưa có tài khoản? Đăng ký ngay'                                                                                                |
| **Auto-fill**  | Hỗ trợ password manager autofill — đặt autocomplete='email' và autocomplete='current-password' đúng.                                  |

### 5.5. SCR-07 — Avatar Setup: Chọn Model

| **Thuộc tính**     | **Đặc tả**                                                                                                                                                                                                           |
|--------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Header**         | Progress indicator: 3 bước (Chọn → Tùy chỉnh → Xem trước). Bước 1 active.                                                                                                                                            |
| **Layout**         | Grid 2 cột: các avatar model dựng sẵn. Mỗi card: avatar thumbnail 3D (animated idle), tên model bên dưới. Dùng animated ở đây vì số card ít (≤ 6), animation giúp user đánh giá tính cách từng model trước khi chọn. |
| **Selected state** | Card selected: border 2px accent-primary + checkmark góc trên phải + shadow-glow nhạt. Không selected: border-subtle.                                                                                                |
| **Card size**      | Hình vuông, khoảng 160×180px trên mobile. Corner radius-xl.                                                                                                                                                          |
| **Model variety**  | Ít nhất 6 model dựng sẵn: phong cách anime, chibi, realistic, fantasy, sci-fi, minimal — đa dạng để ai cũng tìm được phong cách phù hợp.                                                                             |
| **CTA**            | Nút Primary 'Tiếp theo' ở bottom, disabled cho đến khi chọn 1 model.                                                                                                                                                 |

### 5.6. SCR-08 — Avatar Setup: Tùy chỉnh

| **Thuộc tính**           | **Đặc tả**                                                                                                    |
|--------------------------|---------------------------------------------------------------------------------------------------------------|
| **Header**               | Bước 2/3. Back button để quay về bước 1.                                                                      |
| **Preview**              | Avatar model đã chọn hiển thị phía trên, kích thước lớn (chiếm 45% màn hình), xoay chậm 360° để thấy toàn bộ. |
| **Customization panels** | Tab navigation ngang dưới preview: Tóc / Mắt / Trang phục / Phụ kiện (chỉ những category model đó hỗ trợ).    |
| **Color picker**         | Swatches màu phổ biến + nút '+ Tùy chỉnh' mở color wheel full. Preview cập nhật realtime khi chọn màu.        |
| **Outfit selector**      | Grid thumbnail nhỏ của các outfit. Scroll ngang trong panel.                                                  |
| **Reset**                | Nút ghost 'Đặt lại' để về customization mặc định.                                                             |
| **CTA**                  | Nút Primary 'Tiếp theo' ở bottom.                                                                             |

### 5.7. SCR-09 — Avatar Setup: Xem trước & Xác nhận

| **Thuộc tính**        | **Đặc tả**                                                                                                                                                                          |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Header**            | Bước 3/3 — 'Nhân vật ảo của bạn'                                                                                                                                                    |
| **Camera permission** | Nếu chưa cấp quyền camera: prompt card giải thích tại sao cần camera + nút 'Cấp quyền'. Nếu từ chối: hiển thị avatar ở tư thế tĩnh + note 'Bạn có thể cấp quyền sau trong Cài đặt'. |
| **Preview area**      | Kích thước lớn, chiếm 55% màn hình. Khi có camera: nhân vật ảo phản chiếu chuyển động thật thời gian thực. shadow-avatar đầy đủ. Badge 'LIVE' nếu đang tracking.                    |
| **Fun moment**        | Text nhỏ phía trên preview: 'Thử vẫy tay hoặc nhướn mày xem nào 👋' — khuyến khích user tương tác lần đầu.                                                                          |
| **Instructions**      | 3 bullet point ngắn bên dưới: ánh sáng đủ, cách camera 50-80cm, khuôn mặt rõ trong khung.                                                                                           |
| **CTA**               | Nút Primary 'Hoàn tất & Bắt đầu' → chuyển sang SCR-10 (Home).                                                                                                                       |
| **Back**              | Nút ghost 'Tùy chỉnh lại' → quay về SCR-08.                                                                                                                                         |

### 5.8. SCR-10 — Home: Danh sách Trò chuyện

| **Thuộc tính**         | **Đặc tả**                                                                                                                                                                                                                                                                                               |
|------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Layout tổng thể**    | Bottom navigation bar (4 tab). Content area ở giữa. Header minimal với search icon và avatar nhỏ của user.                                                                                                                                                                                               |
| **Header**             | Chữ 'Trò chuyện' (text-xl, Outfit). Icon search mở search bar inline. Avatar nhỏ 36px góc phải mở profile.                                                                                                                                                                                               |
| **Conversation list**  | List vertical. Mỗi item: avatar nhỏ 48px + tên hiển thị + preview tin nhắn cuối + timestamp. Tin nhắn chưa đọc: bold + badge đếm màu accent-primary.                                                                                                                                                     |
| **Empty state**        | Khi chưa có trò chuyện: illustration nhỏ + text 'Chưa có trò chuyện nào. Tìm bạn bè để bắt đầu!' + nút 'Tìm người dùng' → SCR-11.                                                                                                                                                                        |
| **Avatar trong list**  | Hiển thị nhân vật ảo dạng thumbnail TĨNH (frame đầu tiên của idle animation) — khác với SCR-07 dùng animated vì list có thể dài, animate nhiều item cùng lúc tốn CPU và gây giật scroll. Online indicator: chấm xanh cyan 10px cạnh avatar.                                                              |
| **No-avatar fallback** | Khi người kia chưa setup avatar: hiển thị avatar generic mặc định của hệ thống (hình mặt nạ VeilTalk) thay vì ảnh đại diện hoặc initials — nhất quán với Privacy by Visual.                                                                                                                              |
| **Swipe action**       | Swipe trái trên item: nút 'Ẩn' (không phải 'Xóa') màu cam — ẩn conversation khỏi danh sách trên thiết bị này. Confirmation tooltip: 'Cuộc trò chuyện sẽ hiện lại khi có tin nhắn mới.' Dùng 'Ẩn' thay 'Xóa' vì API không có endpoint DELETE /conversations — hành vi đúng là ẩn local, không xóa server. |

### 5.9. SCR-11 — Tìm kiếm Người dùng

| **Thuộc tính**       | **Đặc tả**                                                                                                                                |
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| **Trigger**          | Tab search trong bottom nav hoặc nút 'Tìm người dùng' từ empty state.                                                                     |
| **Search bar**       | Prominent full-width search input, auto-focus khi vào màn hình. Placeholder: 'Nhập email chính xác...'                                    |
| **Privacy note**     | Text-xs text-muted phía dưới search bar: 'Chỉ tìm được người đã bật tùy chọn cho phép tìm kiếm' — ghi chú nhẹ nhàng, không phải cảnh báo. |
| **Kết quả tìm thấy** | Card kết quả: avatar nhân vật ảo + tên hiển thị + nút 'Nhắn tin'. Không hiện email để bảo vệ privacy.                                     |
| **Không tìm thấy**   | Text-muted 'Không tìm thấy người dùng với email này.' — cùng message cho cả hai case (không tồn tại / chưa bật discoverable).             |
| **Rate limit UI**    | Nếu 429: disabled input + countdown 'Thử lại sau 45 giây' — progress bar đếm ngược.                                                       |
| **Lịch sử tìm kiếm** | Lưu local 5 email gần nhất, hiện dạng chip xóa được dưới search bar khi input trống.                                                      |

### 5.10. SCR-12 — Màn hình Chat

| **Thuộc tính**     | **Đặc tả**                                                                                                                                                                                                                                                                                                  |
|--------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Header**         | Avatar nhỏ 40px + tên người dùng. Icon video call (→ SCR-13). Back button.                                                                                                                                                                                                                                  |
| **Avatar header**  | Nhân vật ảo, không ảnh thật — nhất quán với nguyên tắc Privacy by Visual.                                                                                                                                                                                                                                   |
| **Message area**   | Scroll vertical, mới nhất ở dưới. Load more khi scroll lên (cursor pagination). Grouping theo thời gian: 'Hôm nay', 'Hôm qua', ngày cụ thể.                                                                                                                                                                 |
| **Input bar**      | Fixed bottom: text input + nút gửi. Input expand khi gõ nhiều dòng (max 5 dòng). Gửi bằng Enter (hoặc Shift+Enter để xuống dòng).                                                                                                                                                                           |
| **Trạng thái gõ**  | 'Đang soạn tin...' xuất hiện dưới message cuối khi người kia đang gõ, animation 3 chấm nhảy. Yêu cầu ADD: Messaging WebSocket cần bổ sung hai message type TYPING (gửi khi bắt đầu gõ) và TYPING_STOP (gửi khi dừng gõ hoặc sau 3 giây không gõ thêm) — hiện tại ADD chưa định nghĩa, cần cập nhật đồng bộ. |
| **Message status** | Check đơn xám (sent) → check đôi xám (delivered) → check đôi cyan (read). Hiện timestamp khi tap vào bubble.                                                                                                                                                                                                |
| **Offline banner** | Banner vàng phía trên input: 'Bạn đang ngoại tuyến. Tin nhắn sẽ được gửi khi có kết nối.' — không chặn gõ tin nhắn.                                                                                                                                                                                         |

### 5.11. SCR-13/14/15 — Video Call

| **Thuộc tính**                | **Đặc tả**                                                                                                                                                                                                                   |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **SCR-13: Gọi đi**            | Full screen dark. Avatar của user lớn ở giữa (xoay nhẹ idle). Animated ring pulse. Tên người nhận + 'Đang kết nối...'. Nút End Call đỏ ở dưới.                                                                               |
| **SCR-13: Timeout**           | Sau 30 giây không có phản hồi từ B (nhất quán với UC-01 SRS): ring pulse dừng, text đổi thành 'Không có ai trả lời', nút 'Gọi lại' và 'Nhắn tin'. Tự động ngắt sau thêm 3 giây nếu user không làm gì, quay về SCR-12 (Chat). |
| **SCR-14: Đang gọi — Layout** | Hai avatar chiếm phần lớn màn hình: người kia lớn (80% width), bản thân nhỏ góc dưới phải (picture-in-picture 100×133px). Tap vào PiP để swap.                                                                               |
| **SCR-14: Controls**          | Bottom controls bar với 5 nút như đã định nghĩa ở mục 3.6. Auto-hide sau 3 giây không tương tác, hiện lại khi tap màn hình.                                                                                                  |
| **SCR-14: Avatar effects**    | Người đang nói: shadow-avatar pulse đồng bộ với amplitude giọng nói. Muted: overlay nhẹ 15% + icon mic gạch chéo nhỏ.                                                                                                        |
| **SCR-14: Reconnecting**      | Khi mất kết nối: avatar freeze, overlay mờ 30%, spinner nhỏ + 'Đang kết nối lại... (3s)'. Không crash màn hình.                                                                                                              |
| **SCR-14: Chat overlay**      | Tap icon chat: slide up panel 40% màn hình, blur backdrop. Có thể nhắn tin mà không thoát cuộc gọi.                                                                                                                          |
| **SCR-15: Incoming call**     | Full screen. Avatar của người gọi lớn + glow effect + tên. Hai nút: Accept (xanh) + Decline (đỏ). Vibration pattern cho điện thoại.                                                                                          |
| **Không có avatar**           | Nếu một bên chưa setup avatar: hiển thị avatar default của hệ thống (nhân vật ảo generic) + badge 'Chưa có nhân vật ảo'.                                                                                                     |

### 5.12. SCR-16/17 — Thư viện Video

| **Thuộc tính**              | **Đặc tả**                                                                                                                                                                                                                                                                                                                                                                                                       |
|-----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **SCR-16: Layout**          | Grid 2 cột (mobile) hoặc 3 cột (tablet). Mỗi thumbnail: frame đầu video + title + duration + date. Status badge: 'Đang quay' (pulse đỏ) / 'Đang xử lý' (pulse tím) / 'Lỗi' (đỏ).                                                                                                                                                                                                                                 |
| **Storage indicator**       | Progress bar nằm ngang phía trên grid với 3 trạng thái: Bình thường (\< 80%): màu violet. Gần đầy (80-100%): màu cam + text cảnh báo 'Còn X MB'. Đã đầy / vượt quota (≥ 100%): màu đỏ + banner 'Đã dùng hết dung lượng. Xóa bớt video để quay thêm.' — FAB record disabled. Trường hợp server trả về storage_used_bytes \> storage_limit_bytes (race condition): hiển thị đúng con số thực tế, không cap ở 100%. |
| **Recording button**        | FAB (Floating Action Button) tròn góc dưới phải: icon record. Bị disabled + tooltip 'Xóa bớt video để giải phóng dung lượng' khi hết quota.                                                                                                                                                                                                                                                                      |
| **Resume recording dialog** | Khi app khởi động và phát hiện có video ở trạng thái recording (browser crash trước đó): hiển thị dialog bottom sheet tại SCR-16. Nội dung: 'Bạn có phiên quay dở chưa hoàn tất' + tên video + thời gian bắt đầu + dung lượng đã upload. Hai nút: 'Tiếp tục quay' (Primary) và 'Hủy và xóa' (Ghost). Nếu user chọn Hủy: gọi POST /videos/{id}/abort.                                                             |
| **SCR-16: Long press**      | Long press trên thumbnail: context menu (Đổi tên, Xóa). Không có swipe để tránh xóa nhầm.                                                                                                                                                                                                                                                                                                                        |
| **SCR-17: Video detail**    | Full screen video player. Controls chuẩn (play/pause, seek bar, fullscreen). Dưới player: title (editable inline) + date + duration.                                                                                                                                                                                                                                                                             |
| **SCR-17: Empty failed**    | Khi status = failed: placeholder màu đỏ nhạt + icon cảnh báo + text 'Video này không thể phát do lỗi upload' + nút 'Xóa'.                                                                                                                                                                                                                                                                                        |

### 5.13. SCR-18 — Profile & Cài đặt

| **Thuộc tính**          | **Đặc tả**                                                                                                                                                                                                                                |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Header**              | Avatar nhân vật ảo lớn 96px + tên hiển thị + email. Nút 'Chỉnh sửa' → form edit inline.                                                                                                                                                   |
| **Avatar section**      | Nút 'Thay đổi nhân vật ảo' → flow avatar setup lại (SCR-07).                                                                                                                                                                              |
| **Settings sections**   | Phân nhóm rõ: (1) Tài khoản — tên, email; (2) Riêng tư — toggle discoverable (FR-22, mặc định TẮT); (3) Thông báo; (4) Giao diện — theme toggle (dark/light/system); (5) Về ứng dụng; (6) Đăng xuất; (7) Xóa tài khoản (đỏ, ở cuối cùng). |
| **Discoverable toggle** | Toggle với label rõ ràng: 'Cho phép người khác tìm tôi qua email'. Sub-text xám nhỏ: 'Khi bật, người dùng khác có thể tìm thấy bạn bằng địa chỉ email.' Default: TẮT.                                                                     |
| **Nguy hiểm zone**      | Section 'Xóa tài khoản' tách biệt bằng divider đỏ nhạt. Text đỏ. Tap → SCR-19 confirmation.                                                                                                                                               |

## 6. User Flows Chính

Mỗi flow mô tả con đường người dùng đi qua các màn hình, bao gồm cả happy path và các nhánh xử lý ngoại lệ quan trọng.

### 6.1. Flow Onboarding → Lần đầu gọi video

| **Bước** | **Màn hình → Hành động → Kết quả**                                            |
|----------|-------------------------------------------------------------------------------|
| **1**    | SCR-01 (Splash) → Auto detect lần đầu → SCR-02                                |
| **2**    | SCR-02/03/04 (Onboarding) → Swipe qua 3 slides → 'Bắt đầu' → SCR-05           |
| **3**    | SCR-05 (Đăng ký) → Điền form → Submit → SCR-07                                |
| **4**    | SCR-07 (Chọn model) → Tap model → 'Tiếp theo' → SCR-08                        |
| **5**    | SCR-08 (Tùy chỉnh) → Chỉnh màu/outfit → 'Tiếp theo' → SCR-09                  |
| **6**    | SCR-09 (Xem trước) → Cấp quyền camera → Xem avatar live → 'Hoàn tất' → SCR-10 |
| **7**    | SCR-10 (Home) → Empty state → 'Tìm người dùng' → SCR-11                       |
| **8**    | SCR-11 (Search) → Nhập email → Tìm thấy → 'Nhắn tin' → SCR-12                 |
| **9**    | SCR-12 (Chat) → Tap icon video call → SCR-13 (Đang gọi)                       |
| **10**   | SCR-13 → Người kia accept → SCR-14 (Cuộc gọi đang diễn ra)                    |

### 6.2. Flow Quay video với nhân vật ảo

| **Bước**                 | **Màn hình → Hành động → Kết quả**                                                                                                                                                        |
|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1**                    | SCR-10 (Home) → Tab Videos (bottom nav) → SCR-16 (Thư viện)                                                                                                                               |
| **2**                    | SCR-16 → Tap FAB record → Kiểm tra quota → Nếu đủ: mở record screen                                                                                                                       |
| **3**                    | Record screen → Tap 'Bắt đầu quay' → Avatar tracking bắt đầu → Chunk upload tự động                                                                                                       |
| **4**                    | Đang quay → Tap 'Dừng' → POST /videos/{id}/finalize → 202 Accepted                                                                                                                        |
| **5**                    | Về SCR-16 → Video với badge 'Đang xử lý' xuất hiện → MinIO webhook → Badge đổi thành ready                                                                                                |
| **Nhánh: Hết quota**     | Bước 2: FAB disabled + tooltip → User xóa video cũ → Quota giải phóng → FAB active lại                                                                                                    |
| **Nhánh: Browser crash** | Video ở trạng thái recording → User mở lại app → App kiểm tra video recording ở SCR-16 → Hiện Resume Recording Dialog (đặc tả tại mục 5.12) → User chọn 'Tiếp tục quay' hoặc 'Hủy và xóa' |

## 7. Responsive Design & Accessibility

### 7.1. Breakpoints

| **Breakpoint**          | **Đặc tả layout**                                                                                                                                                         |
|-------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Mobile (\< 640px)**   | Layout 1 cột, bottom navigation, avatar preview chiếm 50-55% màn hình trong call.                                                                                         |
| **Tablet (640–1024px)** | Grid 2-3 cột cho video library, sidebar navigation thay bottom nav, avatar preview lớn hơn.                                                                               |
| **Desktop (\> 1024px)** | Sidebar cố định 280px, content area co giãn, video call: avatar lớn hơn đáng kể. (Ngoài phạm vi MVP chính nhưng nên cân nhắc khi thiết kế để không phải redesign về sau.) |

### 7.2. Accessibility Checklist

- Contrast ratio tối thiểu 4.5:1 cho text thông thường, 3:1 cho text lớn (WCAG AA).

- Tất cả interactive elements có focus ring rõ ràng: outline 2px accent-primary, offset 2px.

- Icon-only buttons phải có aria-label mô tả hành động (đặc biệt call controls).

- Error messages phải được đọc bởi screen reader — dùng aria-live='polite' cho inline errors.

- Avatar animations phải dừng khi prefers-reduced-motion: reduce.

- Touch targets tối thiểu 44×44px theo Apple HIG và Android guidelines.

- Hỗ trợ dynamic font size — không hardcode px cho font size ở component, dùng rem.

### 7.3. Dark / Light Mode Implementation

Theme được áp dụng qua CSS custom properties (design tokens) ở :root. JavaScript detect system preference qua matchMedia('(prefers-color-scheme: dark)') và áp class 'dark' vào \<html\>. User override được lưu server-side qua PUT /users/me/settings (field: theme = 'dark' \| 'light' \| 'system') để đồng bộ cross-device — user đăng nhập trên thiết bị khác sẽ giữ nguyên preference. ADD cần bổ sung field theme vào endpoint /users/me/settings. Tất cả màu trong component đều dùng CSS variable — không có hardcode HEX trong component CSS.

*— Hết tài liệu —*
