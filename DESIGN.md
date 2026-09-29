---
name: Hồi Máu
description: Đồng hành với việc nhỏ mỗi ngày, ghi nhận tiến bộ bằng hành vi thực tế.
colors:
  primary: "#2458D3"
  soft: "#EAF0FF"
  lime: "#D8F58A"
  bg: "#F7F9FC"
  ink: "#182743"
  muted: "#56647B"
  line: "#DCE3EE"
  white: "#FFFFFF"
  error: "#B63838"
  flame: "#C2410C"
  flame-soft: "#FFF1E6"
  frost: "#0E7490"
  frost-soft: "#E3F6F9"
  gold: "#B45309"
  gold-soft: "#FFF4DB"
  forest-primary: "#166534"
  forest-soft: "#E4F2E6"
  forest-bg: "#F4F8F3"
  sky-primary: "#0369A1"
  sky-soft: "#E3F1FA"
  sky-bg: "#F5F9FC"
typography:
  headline:
    fontFamily: "Be Vietnam Pro"
    fontSize: "28px"
    fontWeight: 700
  body:
    fontFamily: "Inter"
    fontSize: "16px"
  secondary:
    fontFamily: "Inter"
    fontSize: "15px"
  caption:
    fontFamily: "Inter"
    fontSize: "14px"
  nav-label:
    fontFamily: "Inter"
    fontSize: "11px"
rounded:
  button: "14px"
  surface: "20px"
spacing:
  screen: "22px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    height: "52px"
  button-secondary:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.button}"
    height: "52px"
  button-on-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    height: "52px"
  surface:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.surface}"
  nav-item:
    typography: "{typography.nav-label}"
    height: "60px"
---

# Design System: Hồi Máu

## Overview

**Creative North Star: "Mầm khỏe mỗi ngày"**

Hồi Máu là một người bạn nhắc nhẹ: nền sáng, chữ rõ, khoảng nghỉ thoáng và màu xanh tập trung vào hành động. Mầm mang sự ấm áp đến những lần ghi nhận nhỏ; tiến bộ được diễn đạt bằng điều người dùng đã làm, không bằng phán xét cơ thể hay việc đứt chuỗi.

Tài liệu này chốt hệ thống của bản thiết kế bàn giao, dựa trên canvas và ảnh xuất trong [design/exports](design/exports). Đây là thiết kế tĩnh và nguyên tắc triển khai; chưa phải xác nhận rằng ứng dụng React Native đã có các component, trạng thái hoặc tính năng tương ứng. Định hướng hình ảnh được đề xuất trong lần thiết kế này, chưa thay thế một bộ nhận diện thương hiệu đã được duyệt. Ràng buộc sản phẩm nằm tại [PRODUCT.md](PRODUCT.md).

**Key Characteristics:**

- Một hành động chính nổi bật tại từng điểm quyết định.
- Tiếng Việt gần gũi, động viên, không trách móc.
- Hình ảnh thực phẩm thật đi cùng minh họa nhẹ và linh vật riêng.
- Phân lớp bằng sắc độ và khoảng cách; trang trí phục vụ việc ghi nhận nhanh.

## Colors

Các token ở frontmatter là nguồn giá trị chuẩn; phần dưới mô tả cách dùng.

### Primary

- **Xanh hành động — `primary`:** nút chính, biểu tượng tương tác, liên kết và trạng thái đang chọn; cũng dùng làm nền khối đồng hành của Mầm.
- **Xanh dịu — `soft`:** nền nút phụ, vùng giải thích và nền mục điều hướng đang chọn.

### Secondary

- **Lime mầm non — `lime`:** điểm nhấn lạc quan và nút nổi trên khối xanh. Dùng chữ `ink` để giữ khả năng đọc.

### Neutral

- **Nền sương — `bg`:** nền màn hình.
- **Mực xanh đậm — `ink`:** tiêu đề và nội dung chính.
- **Mực dịu — `muted`:** hướng dẫn, mô tả và thông tin bổ sung.
- **Đường phân cách — `line`:** viền trường nhập và ranh giới cần thiết.
- **Trắng — `white`:** bề mặt nhập liệu, thanh điều hướng và chữ trên nền xanh chính.

Màu `error` dành cho thông báo lỗi. Luôn đi cùng lời giải thích và cách xử lý; không chỉ đổi màu để báo trạng thái. Chưa định nghĩa bảng màu tối; dark theme chờ triển khai native và kiểm tra tương phản riêng.

### Trạng thái và phần thưởng

- **Lửa — `flame` / `flame-soft`:** chuỗi từ 3 ngày trở lên và huy hiệu cột mốc. Luôn đi kèm số ngày.
- **Băng — `frost` / `frost-soft`:** ngày được giữ bằng vé giữ nhịp. Luôn kèm biểu tượng bông tuyết và chữ “Đã dùng vé”.
- **Vàng xu — `gold` / `gold-soft`:** số dư xu và giá vật phẩm. Không dùng cho XP.

Đây là màu trạng thái, không thay thế `primary` cho hành động chính.

### Chủ đề mua bằng xu

Chủ đề chỉ thay ba vai trò `primary`, `soft`, `bg`; `lime`, `ink`, `muted`, `line`, `error` và màu trạng thái giữ nguyên. **Rừng xanh:** `forest-primary`, `forest-soft`, `forest-bg`. **Bầu trời:** `sky-primary`, `sky-soft`, `sky-bg`. Mọi cặp chữ/nền của chủ đề được kiểm tra tương phản bằng `design/check.mjs`. Chủ đề là vật phẩm thẩm mỹ, không ảnh hưởng XP, chuỗi hay điểm tổ đội (R-10.1).

## Typography

**Display Font:** Be Vietnam Pro cho tiêu đề chính. **Body Font:** Inter cho nội dung, nút và nhãn. Cặp chữ giữ dấu tiếng Việt rõ ràng, tiêu đề có cá tính nhưng nội dung đọc nhanh. Fallback sang font hệ thống của nền tảng khi font chưa tải; cần kiểm tra lại xuống dòng.

### Hierarchy

- **Headline:** vai trò `headline` dành cho tên màn hình và lời nhấn mạnh chính.
- **Body:** vai trò `body` cho nội dung đọc và lời nhắc quan trọng.
- **Secondary / Caption:** mô tả dưới tiêu đề, giải thích và thông tin bổ sung.
- **Navigation label:** nhãn ngắn dưới icon; không dùng cỡ này cho đoạn nội dung.

Các cỡ trong token mô tả canvas, không phải giới hạn cứng khi triển khai. React Native phải giữ font scaling; trên iOS hỗ trợ Dynamic Type. Cho phép chữ xuống dòng, bề mặt tăng chiều cao và nội dung cuộn; không thu nhỏ chữ để ép vừa thiết kế. Line height chưa được chuẩn hóa thành token: kiểm tra dấu tiếng Việt và font thật trên thiết bị trước khi chốt.

## Layout

Màn hình mẫu rộng (390px), lề nội dung dùng `spacing.screen`, nhịp giữa các cụm lớn dùng `spacing.section`. Chiều cao frame được chủ động kéo dài để trình bày đủ nội dung, không phải mô phỏng chính xác chiều cao một thiết bị. Khi triển khai, dùng chiều rộng khả dụng, nội dung cuộn và safe area thật; không scale cả ảnh thiết kế để vừa máy.

Vùng status mẫu cao (56px) chỉ phục vụ trình bày. Hệ điều hành quản lý status bar và inset thực tế. Thanh điều hướng dưới đứng ngoài nội dung cuộn; màn chi tiết dùng Back native. Kiểm tra phần cuối nội dung không bị thanh điều hướng, bàn phím hoặc home indicator che.

Vùng chạm Android tối thiểu (48dp), kể cả icon nhỏ; đây là yêu cầu triển khai, không thể suy ra vùng chạm từ kích thước nét vẽ. Nút có thể tăng chiều cao khi chữ lớn. Trên iOS, ánh xạ về navigation, safe area, bàn phím, picker và thông báo quyền của nền tảng; không sao chép status bar hay hộp thoại hệ thống từ canvas. Chưa có breakpoint tablet được xác nhận.

## Elevation & Depth

Bề mặt chủ yếu phẳng. Nền trắng, xanh dịu và nền trang tạo thứ bậc; viền mảnh giúp nhận diện ô nhập. Không có bộ shadow token được chốt. Không thêm bóng đổ mặc định vào mọi hàng nội dung hoặc biến toàn bộ màn hình thành chồng thẻ.

## Shapes

Nút bo góc theo `rounded.button`; khối lớn, ô nhập lớn và ảnh chính theo `rounded.surface`. Đường cong mềm giữ cảm giác thân thiện nhưng không biến mọi thành phần thành viên thuốc. Icon dùng Lucide nét thống nhất; không trộn emoji vào bộ icon chức năng. Ảnh có khung cắt rõ ràng, giữ chủ thể và không bóp méo tỷ lệ.

## Components

### Buttons

Nút chính rõ hành động, dùng các token `button-primary`, `button-secondary` và `button-on-primary`. Nhãn viết như một hành động cụ thể: “Ghi nhận nước”, “Ghi món đã ăn”, “Lưu điều mình vừa viết”. Không dùng màu lime làm nền chung cho mọi nút.

Trạng thái nhấn, focus, disabled, loading và phản hồi lưu cần được triển khai bằng component native. Loading không được làm mất nhãn; ngăn gửi trùng trong lúc xử lý. Phân biệt “đã lưu”, “đang chờ đồng bộ” và “thử lại” bằng lời rõ ràng. Các trạng thái vận hành này không được xem là đã hoạt động chỉ vì có màn minh họa.

### Cards / Containers

Khối đồng hành dùng nền xanh và Mầm; khối giải thích dùng nền xanh dịu. Các hàng nhiệm vụ và bữa ăn ưu tiên icon hoặc thumbnail, tiêu đề, mô tả và chevron. Cho phép toàn hàng là vùng chạm có nhãn trợ năng; ảnh trang trí không được đọc lặp lại nội dung.

### Inputs / Fields

Ô nhật ký dùng bề mặt trắng, viền `line` và góc bo bề mặt. Khi triển khai cần nhãn truy cập được, focus nhìn thấy, bàn phím phù hợp và lỗi tại đúng trường. Placeholder không thay thế nhãn. Dòng “Chỉ mình bạn đọc được” diễn đạt yêu cầu quyền riêng tư, không chứng minh cơ chế bảo mật đã tồn tại.

### Navigation

Thanh chính gồm **Hôm nay / Lộ trình / Tổ đội / Cá nhân**. Icon mẫu (22px), nhãn dùng `nav-label`, vùng mục dùng `nav-item`. Mục chọn có nền xanh dịu cùng icon và chữ xanh; trạng thái chọn cũng phải được cung cấp cho trình đọc màn hình. Không chỉ dùng màu để truyền đạt trang hiện tại.

### Thành phần bổ sung

Khung `C · Thành phần` trong `hoiMau.pen` là nguồn chuẩn: `StatBar` (4 chỉ số, luôn kèm số), `LevelStrip`, `CoinChip`, `StreakChip` (chỉ khi chuỗi ≥ 3), `RewardChip`, `Snackbar` (hoàn tác có thanh đếm ngược), `InlineError`, `DisabledReason`, `Switch` (luôn kèm nhãn trạng thái), `FilterChip`, `LockChip`, `OwnedChip`, `ProgressRing`, `MilestoneBadge` (đã đạt: màu `flame`; chưa đạt: nền trắng, viền `line`, chữ `muted`, luôn kèm nhãn trạng thái), `FrostDot`, `EmptyState`, `OverlayCelebration`, `Dialog`, `BottomSheet`. Trạng thái của mọi thành phần phải đọc được bằng chữ hoặc biểu tượng, không chỉ bằng màu.

### Mầm, hình ảnh và chuyển động

Linh vật Mầm nằm tại [design/assets/mam.svg](design/assets/mam.svg). Ảnh stock và ảnh AI trong thiết kế là nội dung minh họa; xem lại nguồn và quyền sử dụng trước khi phát hành. Hình món ăn thể hiện thực phẩm dễ nhận biết; minh họa nhật ký dùng không gian yên tĩnh. Không diễn giải ảnh hoặc nội dung tài khoản mẫu thành dữ liệu sức khỏe thật.

Mầm có 5 giai đoạn một chiều — Hạt giống, Mầm nhú, Chồi non, Cây xanh, Cây huyền thoại — tại `design/assets/mam/stage-*.svg`, và 3 tâm trạng — Vui, Bình thường, Buồn ngủ — là các nhóm `face-*` trong cùng tệp. Buồn ngủ là đáy: mắt khép hờ, lá rủ, lời mời quay lại; không có trạng thái ốm hay héo. Các nhóm chuyển động mang sẵn điểm xoay (`transform-origin` theo đơn vị viewBox 128) để web và React Native dùng chung. Trang phục (ví dụ `skin-fox.svg` — Mũ cáo nhỏ) là lớp phủ, không đổi giai đoạn.

Chuyển động được đặc tả bằng dữ liệu: token tại [design/motion/tokens.json](design/motion/tokens.json), danh mục tại [design/motion/catalog.json](design/motion/catalog.json), xem trực tiếp tại [design/motion/playground.html](design/motion/playground.html). Chi tiết và bảng danh mục ở [đặc tả animation](docs/design/animation.md). Ba GIF cũ trong `design/motion/` là tư liệu tham khảo, không phải nguồn chuẩn. Động tác mẫu dùng khung xương `design/assets/exercise/rig-side.svg` với keyframe loại `exercise` trong catalog; video WebM lặp, không tiếng và ảnh tư thế chính nằm ở `design/motion/exercises/`.

Khi Reduce Motion bật, dùng trạng thái tĩnh và lời xác nhận; không cần chạy nhảy hoặc phóng to để người dùng hiểu kết quả. Animation không trì hoãn thao tác tiếp theo, không là tín hiệu duy nhất rằng dữ liệu đã lưu, và không được tự xác nhận ghi nhận thành công trước kết quả lưu thực tế.

## Do's and Don'ts

### Do:

- **Do** giữ token frontmatter làm nguồn giá trị chuẩn của bản thiết kế.
- **Do** dùng lời nhắc nhẹ, phản hồi lưu rõ và hành động gắn với đời thực.
- **Do** kiểm tra chữ lớn, trình đọc màn hình, bàn phím, safe area và Reduce Motion trên thiết bị.
- **Do** dùng control native cho quyền hệ thống và tương tác đặc thù nền tảng.

### Don't:

- **Don't** ép chiều cao nội dung theo frame xuất ảnh hoặc cố định status bar mẫu trong ứng dụng.
- **Don't** dùng màu, phần thưởng hay chuyển động làm tín hiệu trạng thái duy nhất.
- **Don't** dùng cân nặng hoặc chuỗi ngày để đánh giá giá trị người dùng.
- **Don't** coi bản thiết kế tĩnh là bằng chứng rằng lưu dữ liệu, bảo mật, đồng bộ hoặc dark theme đã được triển khai.
