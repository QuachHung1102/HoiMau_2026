# Bàn giao UX/UI Hồi Máu

- [Mở bộ xem trước](index.html): ảnh màn hình, lối mở GIF và video động tác mẫu, không tự phát chuyển động.
- [Thiết kế chỉnh sửa được](hoiMau.pen): màn chức năng, trạng thái, component và hình ảnh.
- [Phân tích màn hình / luồng UX](../docs/design/screen-map.md).
- [Hệ thống thiết kế](../DESIGN.md): font, màu, khoảng cách, icon và quy ước native.
- [Animation](../docs/design/animation.md): trigger, timing, easing, lifecycle và Reduce Motion.
- [Xem chuyển động trực tiếp](motion/playground.html): 55 chuyển động, 39 cốt lõi và 16 điểm nhấn, có công tắc giảm chuyển động.
- [Mầm tách lớp](assets/mam/): 5 giai đoạn × 3 tâm trạng, điểm xoay nằm sẵn trong SVG.
- [Động tác mẫu](motion/exercises/): 6 video WebM lặp, không tiếng, kèm ảnh tư thế chính; khung xương tại `assets/exercise/rig-side.svg`.
- Kiểm tra bàn giao: `node design/check.mjs`; thêm `--sync` để sinh lại gallery, dữ liệu playground và bảng danh mục chuyển động.
- [Danh mục màn đã xuất](screens.json), [nguồn hình ảnh](assets/sources.json), [metadata GIF](motion/manifest.json).

## Cách đọc

Tìm frame theo mã S trong tài liệu màn hình. Các frame trạng thái không bắt buộc trở thành route riêng. Frame được kéo dài để hiển thị đủ nội dung; app thực tế dùng vùng cuộn, safe area và navigation native.

Số đo, tên người, số xu, thứ hạng và nội dung tài khoản là dữ liệu minh họa. Mục tiêu năng lượng minh họa được tính từ công thức đặc tả bằng lệnh, không phải đơn kê y tế. Ảnh món ăn không thay thế dữ liệu dinh dưỡng đã duyệt.

Đây là bộ thiết kế tĩnh gồm 82 khung S01–S82, chưa nối prototype tương tác và chưa triển khai màn React Native. GIF là minh họa chuyển động, không được xác nhận phát động trực tiếp bên trong editor `.pen`; dùng đường dẫn GIF hoặc trang xem trước.

## Thư viện và tài sản

- Icon trên canvas lấy từ Lucide qua công cụ thiết kế; triển khai app cần dùng bộ icon tương thích, giữ cùng nét và ý nghĩa.
- Font tiêu đề Be Vietnam Pro; nội dung Inter. Khi đóng gói font vào app, kèm license của bản font sử dụng và kiểm tra hiển thị dấu tiếng Việt.
- `assets/mam.svg` là linh vật vector tạo riêng trong lần thiết kế. PNG nội dung được xuất cục bộ; `.pen` dùng đường dẫn tương đối để bộ thiết kế có thể di chuyển cùng thư mục.
- `assets/sources.json` ghi nguồn stock Unsplash hoặc nguồn AI cho mỗi PNG. Nguồn stock hiện ghi URL ảnh trả bởi công cụ; thông tin tác giả và điều kiện sử dụng cần được hoàn thiện trước phát hành thương mại.
- GIF có bản tĩnh cùng tên hậu tố `-static.png`. Trình xem mặc định dùng bản tĩnh.

## Kết quả review

Review độc lập: **PASS cho bản thiết kế tĩnh trong các màn đại diện được xem**. Không có xác nhận toàn bộ runtime, trình đọc màn hình, vùng chạm, lưu dữ liệu hoặc hiệu năng native. Các nội dung đó nằm trong cổng kiểm thử khi triển khai.
