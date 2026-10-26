# Hệ thống tài liệu

Muốn xem ứng dụng chạy thì đọc đầu tiên: [Chạy demo trên Android với server trên máy](development.md#chạy-demo-trên-android-với-server-trên-máy).

| Tài liệu | Nội dung | Cập nhật khi |
|---|---|---|
| [Chạy demo](development.md#chạy-demo-trên-android-với-server-trên-máy) | Các bước đưa ứng dụng lên điện thoại Android với server và dữ liệu mẫu trên máy này | Đổi lệnh, cổng hoặc kịch bản mẫu |
| [Phát triển](development.md) | Cài đặt, mọi lệnh gốc, cổng mạng, bản xem trước, bộ đầu-cuối, dọn cụm cơ sở dữ liệu | Thay đổi môi trường hoặc lệnh |
| [Đặc tả gốc](product/SPEC-QUEST-001-dac-ta-he-thong.md) | Nghiệp vụ, dữ liệu, API và yêu cầu sản phẩm | Chốt thay đổi nghiệp vụ |
| [Phạm vi mobile](product/mobile-scope.md) | Bảng chuyển từ web sang mobile đã chọn và sổ quyết định D-01…D-10 | Chốt hoặc đổi một quyết định |
| [Kiến trúc](architecture.md) | Bản đồ module `src/`, `domain/`, `server/`, luồng dữ liệu, hàng đợi ngoại tuyến, bảng trạng thái triển khai | Thêm module hoặc thay đổi luồng dữ liệu |
| [Backend](backend.md) | Cơ sở dữ liệu, mô hình vai trò, lược đồ SQL, ba cổng kiểm, từng mảng nghiệp vụ, hiệu năng; có mục lục ở đầu | Thêm file SQL, đổi vai trò, cổng kiểm hoặc cách chạy cơ sở dữ liệu |
| [Hợp đồng API](api/openapi.yaml) | OpenAPI 3.1 của mọi route (53 thao tác), mã lỗi, `Idempotency-Key`; khớp từng dòng với `domain/contract/` và với các route server nạp | Đổi route, thân yêu cầu / trả lời hoặc mã lỗi (cùng lúc với server và `domain/contract/`) |
| [Quyết định 0001: nền tảng và backend](decisions/0001-nen-tang-va-backend.md) | Android trước, backend trong repo, PostgreSQL với RLS, xác thực email + mật khẩu | Đổi nền tảng, backend hoặc cách xác thực |
| [Quyết định 0002: kiểm chứng không có thiết bị](decisions/0002-kiem-chung-khong-co-thiet-bi.md) | Vì sao nghiệm thu dựa vào Jest, bản xem trước, đầu-cuối HTTP và build native; phần nào còn chờ thiết bị | Có thiết bị hoặc đổi cách nghiệm thu |
| [Kiểm thử và phát hành](testing-and-release.md) | Ma trận kiểm chứng và kết quả mới nhất, danh mục kiểm tra phát hành, quy trình phát hành, ghi chú triển khai server, bản debug đã dựng | Thêm nghiệp vụ hoặc tích hợp; mỗi lần dựng bản debug |
| [Kiểm thử trên thiết bị](kiem-thu-tren-thiet-bi.md) | Danh sách kiểm tra chạy khi có thiết bị hoặc emulator: chuẩn bị, từng khối kiểm tra, cột kết quả để trống (chưa chạy lần nào) | Có thiết bị, hoặc thêm một hành vi chỉ thiết bị mới kiểm được |
| [Phân tích màn hình](design/screen-map.md) | Màn chức năng, trạng thái và luồng UX | Thay đổi luồng sử dụng |
| [Animation](design/animation.md) | GIF, timing, easing và giảm chuyển động | Thay đổi tương tác |

## Quy tắc duy trì

- Tài liệu dành cho người đọc viết tiếng Việt; đường dẫn và định danh mã nguồn dùng tiếng Anh.
- Đặc tả gốc được giữ nguyên nội dung khi chuyển thư mục. Sổ quyết định trong phạm vi mobile ghi các quyết định đã chốt (D-01…D-10) và ưu tiên hơn đặc tả ở những điểm bị ghi đè.
- Dẫn mã F/R/NFR và mục của đặc tả thay vì sao chép toàn bộ quy tắc sang nhiều nơi.
- Phân biệt hiện trạng, đề xuất và kết quả đã kiểm chứng. Chỉ đánh dấu hoàn thành khi có bằng chứng kiểm thử hoặc đầu ra được nghiệm thu. Điều chưa chạy trên thiết bị thì nói là chưa chạy.
- Đổi API thì sửa `docs/api/openapi.yaml`, `domain/contract/` và server trong cùng thay đổi: `npm run domain:test` (đối chiếu YAML với `OPERATIONS`) và `npm run server:test` (các route server nạp phải đúng bằng `OPERATIONS`) sẽ đỏ nếu lệch. Quyết định kiến trúc lớn thì thêm một tệp trong `docs/decisions/` với bối cảnh, lựa chọn, hệ quả và trạng thái. Chưa tạo tài liệu rỗng.
- Người thay đổi mã cập nhật tài liệu liên quan trong cùng thay đổi; người review kiểm tra liên kết và lệnh chạy. Tài liệu người đọc không liên kết tới đường dẫn bị Git bỏ qua.
- Ghi chú làm việc cá nhân phải ở đường dẫn được Git bỏ qua, không đưa vào bộ tài liệu này.
