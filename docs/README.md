# Hệ thống tài liệu

| Tài liệu | Nội dung | Cập nhật khi |
|---|---|---|
| [Đặc tả gốc](product/SPEC-QUEST-001-dac-ta-he-thong.md) | Nghiệp vụ, dữ liệu, API và yêu cầu sản phẩm | Chốt thay đổi nghiệp vụ |
| [Phạm vi mobile](product/mobile-scope.md) | Điều chỉnh từ web sang mobile và quyết định mở | Chốt nền tảng hoặc quy tắc còn mâu thuẫn |
| [Kiến trúc](architecture.md) | Thư mục và ranh giới client/server | Thêm module hoặc thay đổi luồng dữ liệu |
| [Phát triển](development.md) | Cài đặt, chạy, quy ước đóng góp | Thay đổi môi trường hoặc lệnh |
| [Kiểm thử và phát hành](testing-and-release.md) | Ma trận kiểm chứng và cổng phát hành | Thêm nghiệp vụ hoặc tích hợp |
| [Thiết kế nguồn](../design/hoiMau.pen) | Tệp thiết kế để đối chiếu khi triển khai | Duyệt thay đổi giao diện |
| [Phân tích màn hình](design/screen-map.md) | Màn chức năng, trạng thái và luồng UX | Thay đổi luồng sử dụng |
| [Animation](design/animation.md) | GIF, timing, easing và giảm chuyển động | Thay đổi tương tác |
| [Bộ xem trước](../design/index.html) | Ảnh màn hình và liên kết GIF | Xuất lại thiết kế |

## Quy tắc duy trì

- Tài liệu dành cho người đọc viết tiếng Việt; đường dẫn và định danh mã nguồn dùng tiếng Anh.
- Đặc tả gốc được giữ nguyên nội dung khi chuyển thư mục. Phạm vi mobile là đề xuất, chưa thay thế quyết định sản phẩm chưa được duyệt.
- Dẫn mã F/R/NFR và mục của đặc tả thay vì sao chép toàn bộ quy tắc sang nhiều nơi.
- Phân biệt hiện trạng, đề xuất và kết quả đã kiểm chứng. Chỉ đánh dấu hoàn thành khi có bằng chứng kiểm thử hoặc đầu ra được nghiệm thu.
- Khi có API thật, thêm `docs/api/openapi.yaml` cùng thay đổi server. Khi có quyết định kiến trúc lớn, thêm `docs/decisions/` với bối cảnh, lựa chọn, hệ quả và trạng thái. Chưa tạo tài liệu rỗng.
- Người thay đổi mã cập nhật tài liệu liên quan trong cùng thay đổi; người review kiểm tra liên kết và lệnh chạy.
- Ghi chú nội bộ agent phải ở đường dẫn được Git bỏ qua, không đưa vào bộ tài liệu này.
