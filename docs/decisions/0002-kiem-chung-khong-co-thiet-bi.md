# 0002. Kiểm chứng khi chưa có thiết bị

Trạng thái: **Đã chốt**, xem lại ngay khi có một thiết bị Android hoặc một emulator chạy được (2026-10-23, chủ dự án ủy quyền toàn quyền cho nhóm triển khai). Liên quan: D-01 và D-03 trong [sổ quyết định](../product/mobile-scope.md#sổ-quyết-định), [quyết định 0001](0001-nen-tang-va-backend.md).

## Bối cảnh

Suốt quá trình xây dựng, máy phát triển (Windows 11) không có cách nào chạy ứng dụng Android thật:

- Emulator không khởi động được. Ảo hóa phần cứng đang tắt trong firmware (AMD SVM); chỉ chủ máy mới bật được trong BIOS rồi cài driver hypervisor. Ảnh arm64 bị emulator từ chối trên máy x86.
- Chưa có điện thoại nào được cắm vào máy (`adb devices` trống).
- Không có macOS, nên iOS không build được; không có Docker.

Cùng lúc, sản phẩm có rất nhiều logic phải đúng: tính năng lượng, ngày logic 03:00, chuỗi, sổ cái, tổ đội, quyền riêng tư. Chờ thiết bị rồi mới kiểm là bỏ phí phần lớn thứ kiểm được ngay.

## Lựa chọn

Nghiệm thu theo lớp, mỗi lớp nói rõ nó chứng minh gì và không chứng minh gì (bảng đầy đủ ở [Kiểm thử và phát hành](../testing-and-release.md#hiện-trạng)):

1. **Jest** cho app: render và tương tác từng màn hình bằng React Native Testing Library, với `fetch` giả trả lời đúng như server; hai bộ quét chạy trên mọi mục xem trước (trợ năng, chuyển động và giảm chuyển động) cùng bộ quét độ phủ màn hình.
2. **Bản xem trước trên trình duyệt** (`tools/preview/`, react-native-web): kiểm bố cục, nội dung và từng trạng thái thiết kế bằng ảnh chụp so với bản thiết kế.
3. **Đầu-cuối qua HTTP** trên PostgreSQL 18 thật: đăng ký → onboarding → ba ngày logic liên tiếp, đóng ngày, gửi lại mọi lượt ghi; cùng ba cổng lược đồ (`db:verify`, `db:api-check`, `db:mutation-check`) và test của từng route.
4. **Đầu-cuối qua app**: cây `<App />` thật trong Jest nói chuyện với server dev thật, không `fetch` giả.
5. **Build native**: `assembleDebug` ra APK và bundle Metro bản phát hành dựng được, để bắt lỗi mà Jest không thấy (mã native, codegen, cấu hình Gradle, tài nguyên).

Mỗi nghiệp vụ có đúng một nơi quyết định (server, kèm `domain/` dùng chung), nên các lớp 3 và 4 chứng minh phần nghiệp vụ mà không cần màn hình thật.

## Hệ quả

- **Không tuyên bố hành vi trên thiết bị.** Tài liệu, báo cáo và giao diện không được nói điều gì chạy trên điện thoại khi chưa ai chạy. Nơi nào chỉ có Jest hoặc ảnh xem trước làm bằng chứng thì ghi đúng như vậy.
- **Những gì chỉ thiết bị kiểm được** được gom thành một danh sách để chạy khi có thiết bị: keychain và Keystore thật, `AsyncStorage` thật, font đóng gói và dấu tiếng Việt chồng, thứ tự đọc và tiêu điểm của TalkBack, cỡ chữ lớn và vùng bấm 48 dp, bàn phím che ô nhập, nút Back và cử chỉ, giữ màn hình sáng và bảng chia sẻ tệp (module native `HoiMauNative`), `AbortController` và `Intl` trên Hermes, hoạt ảnh native và 60 fps, bật tắt "Giảm chuyển động" của hệ thống khi app đang mở, cổng `adb reverse` và HTTP thường tới `localhost`, khởi động nguội, thời gian tới màn Hôm nay đầu tiên, cuộn mượt, bộ nhớ sau 45 phút. Danh sách đó sẽ là `docs/kiem-thu-tren-thiet-bi.md` (chưa viết); chạy xong thì kết quả ghi vào [Kiểm thử và phát hành](../testing-and-release.md#hiện-trạng).
- **Rủi ro còn lại được nêu thẳng**: lần chạy đầu tiên trên thiết bị có thể lộ lỗi mà các lớp trên không thấy. Hướng dẫn demo ([Chạy demo trên Android](../development.md#chạy-demo-trên-android-với-server-trên-máy)) chỉ ra bước nào đã chạy thật (server và kịch bản mẫu) và bước nào chưa (mọi thứ cần thiết bị).
- **iOS** vẫn chưa build, chưa kiểm chứng (D-01).
- **Chỉ số hiệu năng của server** đo được trên máy này; chỉ số của điện thoại thì không (NFR-01 phía thiết bị chưa có số).
- Khi có thiết bị: bật SVM hoặc cắm điện thoại, làm theo hướng dẫn demo, chạy danh sách kiểm tra, ghi kết quả, rồi cập nhật quyết định này sang trạng thái "đã thay thế" hoặc "đã hoàn tất".
