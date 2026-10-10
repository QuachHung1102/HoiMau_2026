# 0001. Nền tảng và backend

Trạng thái: **Đã chốt** (2026-10-11, chủ dự án ủy quyền toàn quyền cho nhóm triển khai). Liên quan: D-01, D-02, D-03 trong [sổ quyết định](../product/mobile-scope.md#sổ-quyết-định).

## Bối cảnh

Đặc tả gốc mô tả sản phẩm web. Repo chỉ có app React Native, chưa có backend nào ngoài repo, chưa có tài khoản cửa hàng ứng dụng hay khóa ký bản phát hành. Máy phát triển là Windows, không có macOS, không có Docker, không có thiết bị Android và emulator không chạy được. Máy có sẵn một dịch vụ PostgreSQL hệ thống mà dự án không có thông tin đăng nhập.

## Lựa chọn

- **Android trước.** Mobile thay thế web. Android là nền tảng duy nhất được xác minh; dự án iOS giữ khả năng biên dịch về nguyên tắc nhưng không tuyên bố hoạt động.
- **Backend trong repo**, thư mục `server/`: Node 24 chạy TypeScript trực tiếp, `node:http`, driver `pg`, không ORM, không framework web.
- **PostgreSQL với RLS.** Ba vai trò (`app_conn`, `app_anon`, `app_auth`), đổi vai trò theo từng request, bảo mật cấp hàng trên mọi bảng dữ liệu người dùng, ghi đặc quyền chỉ qua hàm `SECURITY DEFINER`, lược đồ là các tệp SQL có thứ tự và chạy lại được, kèm ba cổng kiểm chứng. Môi trường local dùng PostgreSQL thật qua `embedded-postgres` ở cổng 54329 (test) và 54330 (dev), không bao giờ chạm dịch vụ hệ thống ở cổng 5432.
- **Thư mục `domain/` dùng chung.** Logic thuần TypeScript (năng lượng, XP, chuỗi, linh vật, tổ đội, thực đơn) được app và server cùng import; server là nguồn quyết định, app chỉ dùng để xem trước.
- **Xác thực email + mật khẩu.** Băm `scrypt`, token phiên ngẫu nhiên lưu băm phía server, có thể thu hồi; đặt lại mật khẩu bằng mã 6 chữ số gửi qua email.
- **Không có push từ xa, OAuth hay phát hành lên cửa hàng.** Hộp thư trong app là kênh thông báo bảo đảm; email dev ghi ra tệp cục bộ.

## Hệ quả

- Một repo chứa ba code base (`src/`, `domain/`, `server/`) với công cụ kiểm tra riêng; Jest chỉ chạy app, `node --test` chạy `domain/` và `server/`.
- Yêu cầu Node `>= 24.8`.
- Kiểm chứng giao diện dựa vào Jest, `tsc`, ESLint và bộ xem trước trình duyệt; hành vi trên thiết bị chỉ được kiểm khi có thiết bị.
- Sản phẩm giao là bản debug đã kiểm chứng và quy trình phát hành bằng tài liệu; phát hành thật cần tài khoản cửa hàng và khóa ký do chủ dự án cung cấp.
- Cấu hình SMTP và nội dung sức khỏe được ghi nhận nhưng chưa được kiểm chứng hay duyệt bởi chuyên gia.
