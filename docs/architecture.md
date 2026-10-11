# Kiến trúc và hệ thống thư mục

## Hiện trạng

`index.js` đăng ký component từ `src/app/App.tsx`; component vẫn hiển thị màn hình mẫu và chưa có router, API client hay lưu trữ bền vững. Đã có: logic nghiệp vụ thuần trong `domain/` (chạy bằng Node và Jest), bộ nền giao diện trong `src/shared/` (token, font, chuyển động, thành phần cơ bản) và bản xem trước trên trình duyệt `tools/preview/` (react-native-web, chỉ để kiểm tra bố cục). Bảng dưới liệt kê từng phần đã triển khai và cách kiểm chứng.

## Trạng thái triển khai

| Khu vực | Màn hình / thành phần | Task | Kiểm chứng |
| --- | --- | --- | --- |
| Giao diện nền | Token màu/chữ/khoảng cách, ba bảng màu, font Be Vietnam Pro và Inter, token chuyển động, `useReducedMotion`, `AppText`, `Screen`, `Touchable`, `Button`, `Icon`, `Card`, `ListRow` | 10 | Jest (có test chống lệch `DESIGN.md` và `design/motion/tokens.json`), `tsc`, ảnh chụp `kit-primitives` và `kit-primitives-forest` trong bản xem trước; chưa chạy trên thiết bị |
| Giao diện nền | Ô nhập và lựa chọn (`TextField`, `SelectField`, `Checkbox`, `Switch`, `SegmentedControl`, `FilterChip`), thông báo (`InlineError`, `DisabledReason`), trạng thái tải/lỗi/trống, `Snackbar` có đếm ngược hoàn tác, `Dialog`, `BottomSheet` | 11 | Jest (vai trò, trạng thái truy cập, bộ đếm giờ, giảm chuyển động), `tsc`, ảnh chụp `kit-fields`, `kit-field-errors`, `kit-toggles`, `kit-states-*`, `kit-snackbar-undo`, `kit-dialog`, `kit-sheet` trong bản xem trước; chưa chạy trên thiết bị |
| Giao diện nền | Thành phần trò chơi (`StatBar`, `ProgressBar`, `LevelStrip`, `CoinChip`, `StreakChip`, `RewardChip`, `LockChip`, `OwnedChip`, `FrostDot`, `OfflineBadge`, `ProgressRing`, `MilestoneBadge`), lớp chúc mừng toàn màn hình `OverlayCelebration`, linh vật `Mam` (5 giai đoạn × 3 tâm trạng, trang phục mũ cáo) vẽ bằng react-native-svg | 12 | Jest (nhãn và giá trị truy cập, 15 tổ hợp giai đoạn × tâm trạng, vòng lặp dừng khi rời màn/vào nền/giảm chuyển động), `tsc`, ảnh chụp `kit-game-components`, `kit-game-rings`, `kit-mam-grid`, `kit-mam-sizes`, `s65-level-up`, `s66-streak-milestone`, `s69-mam-evolve` trong bản xem trước; chưa chạy trên thiết bị |

## Cấu trúc phát triển

Tạo thư mục khi có mã thực sự sử dụng. Cây dưới đây là bản đồ đích, không phải danh sách module đã triển khai.

```text
src/
  app/                 App.tsx, điều hướng và provider cấp ứng dụng
  features/
    auth/              Đăng nhập và phiên làm việc
    onboarding/        Hồ sơ, số đo và mục tiêu
    dashboard/         Tổng quan và chỉ số dẫn xuất
    quests/            Nhiệm vụ và ghi nhận trong ngày
    progression/       XP, cấp và chuỗi ngày
    nutrition/         Thực đơn và nhật ký calo
    workout/           Danh mục bài tập và phiên tập
    pet/               Hiển thị linh vật
    shop/              Cửa hàng và kho đồ
    guild/             Tổ đội và bảng xếp hạng
    notifications/     Thông báo, quyền và cài đặt nhận
    journal/           Nhật ký và vé đóng băng
    settings/          Tùy chọn, xuất dữ liệu, xóa tài khoản
  shared/
    ui/                Thành phần được nhiều tính năng dùng
    api/               HTTP, xác thực, lỗi và hợp đồng API
    storage/           Lưu cục bộ và hàng đợi thao tác
    theme/             Token giao diện từ thiết kế
    i18n/              Chuỗi tiếng Việt và quy tắc nội dung
  assets/              Ảnh, font, âm thanh được ứng dụng sử dụng
```

Mỗi feature bắt đầu bằng màn hình và tệp API/types cần thiết. Test logic đặt cạnh mã (`*.test.ts`, `*.test.tsx`); test tích hợp toàn ứng dụng ở `__tests__/`. Chỉ tách `components/` hoặc `hooks/` khi có nhu cầu.

`app` kết hợp feature; feature dùng `shared`; `shared` không import ngược feature. Không truy cập chi tiết nội bộ feature khác. Không gom mọi thứ vào `utils/`, không thêm alias hoặc barrel export chỉ để rút ngắn import.

Giữ `android/`, `ios/`, `index.js` và cấu hình công cụ ở gốc theo cấu hình React Native hiện có. `design/` chứa thiết kế nguồn; asset được sử dụng mới vào `src/assets/`.

## Ranh giới hệ thống đề xuất

Client hiển thị, thu thập dữ liệu, phản hồi lạc quan và gửi thao tác. Server xác thực chủ sở hữu, tính mục tiêu chính thức, ghi sổ cái, xử lý giao dịch và chốt ngày. Cơ sở dữ liệu có thẩm quyền cho XP, xu, chuỗi và kho đồ.

```text
Màn hình → API client → API xác thực → nghiệp vụ → cơ sở dữ liệu
              ↑                            ↑
      hàng đợi cục bộ                tác vụ nền theo lịch
```

Backend cần cho phạm vi đầy đủ nhưng chưa có ở repo. Chọn nơi đặt mã và stack ở bước chốt nền tảng; không tạo monorepo hoặc service trước quyết định đó. Stack web trong đặc tả không tự động áp dụng cho mobile.

## Ghi dữ liệu và mất mạng

Mỗi thao tác ghi có định danh bền vững; retry dùng lại định danh đó. Các lần uống nước khác nhau phải có định danh khác nhau dù cùng nhiệm vụ/ngày. Server kiểm tra payload, chủ sở hữu, hạn mức và transaction; client không tự xác nhận thưởng.

Hàng đợi giữ qua khởi động lại, gắn với tài khoản và giữ thứ tự khi thao tác phụ thuộc nhau. Không gửi hàng đợi dưới phiên tài khoản khác. API trả thời gian/ngày logic có thẩm quyền; chốt chính sách thao tác gửi muộn trước khi triển khai.

Không lưu token trong kho không mã hóa, không ghi số đo hoặc nhật ký vào log/analytics. Cache phân tách theo tài khoản và được dọn theo quy trình đăng xuất/xóa tài khoản đã chốt.
