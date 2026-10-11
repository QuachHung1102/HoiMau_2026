# Kiến trúc và hệ thống thư mục

## Hiện trạng

`index.js` đăng ký component từ `src/app/App.tsx`. Ứng dụng đã có vỏ: phiên đăng nhập, API client, cache theo tài khoản, điều hướng theo trạng thái phiên và màn Chào mừng (xem [Vỏ ứng dụng](#vỏ-ứng-dụng)); màn hình của từng tính năng được thêm dần vào sổ đăng ký màn hình. Ngoài ra có: logic nghiệp vụ thuần trong `domain/` (chạy bằng Node và Jest), bộ nền giao diện trong `src/shared/` (token, font, chuyển động, thành phần cơ bản), backend trong `server/` (xem [backend](backend.md)) và bản xem trước trên trình duyệt `tools/preview/` (react-native-web, chỉ để kiểm tra bố cục). Bảng dưới liệt kê từng phần đã triển khai và cách kiểm chứng.

## Trạng thái triển khai

| Khu vực | Màn hình / thành phần | Task | Kiểm chứng |
| --- | --- | --- | --- |
| Giao diện nền | Token màu/chữ/khoảng cách, ba bảng màu, font Be Vietnam Pro và Inter, token chuyển động, `useReducedMotion`, `AppText`, `Screen`, `Touchable`, `Button`, `Icon`, `Card`, `ListRow` | 10 | Jest (có test chống lệch `DESIGN.md` và `design/motion/tokens.json`), `tsc`, ảnh chụp `kit-primitives` và `kit-primitives-forest` trong bản xem trước; chưa chạy trên thiết bị |
| Giao diện nền | Ô nhập và lựa chọn (`TextField`, `SelectField`, `Checkbox`, `Switch`, `SegmentedControl`, `FilterChip`), thông báo (`InlineError`, `DisabledReason`), trạng thái tải/lỗi/trống, `Snackbar` có đếm ngược hoàn tác, `Dialog`, `BottomSheet` | 11 | Jest (vai trò, trạng thái truy cập, bộ đếm giờ, giảm chuyển động), `tsc`, ảnh chụp `kit-fields`, `kit-field-errors`, `kit-toggles`, `kit-states-*`, `kit-snackbar-undo`, `kit-dialog`, `kit-sheet` trong bản xem trước; chưa chạy trên thiết bị |
| Giao diện nền | Thành phần trò chơi (`StatBar`, `ProgressBar`, `LevelStrip`, `CoinChip`, `StreakChip`, `RewardChip`, `LockChip`, `OwnedChip`, `FrostDot`, `OfflineBadge`, `ProgressRing`, `MilestoneBadge`), lớp chúc mừng toàn màn hình `OverlayCelebration`, linh vật `Mam` (5 giai đoạn × 3 tâm trạng, trang phục mũ cáo) vẽ bằng react-native-svg | 12 | Jest (nhãn và giá trị truy cập, 15 tổ hợp giai đoạn × tâm trạng, vòng lặp dừng khi rời màn/vào nền/giảm chuyển động), `tsc`, ảnh chụp `kit-game-components`, `kit-game-rings`, `kit-mam-grid`, `kit-mam-sizes`, `s65-level-up`, `s66-streak-milestone`, `s69-mam-evolve` trong bản xem trước; chưa chạy trên thiết bị |
| Vỏ ứng dụng | API client (`api`, `ApiError`), phiên (`SessionProvider`, `useSession`), cache theo tài khoản, sổ route và sổ đăng ký màn hình, điều hướng theo phiên, thanh tab, màn Chào mừng (S01), trạng thái đang tải / lỗi tải khi mở app (S39) | 17 | Jest (header và mã lỗi của client, timeout, 401 chỉ kết thúc phiên một lần, token chỉ nằm trong keychain, thứ tự đăng xuất, cache tách theo tài khoản, các nhóm điều hướng chạy với sổ đăng ký giả, thanh tab), `tsc`, ảnh chụp `s01-welcome`, `s39-loading`, `s39-error` trong bản xem trước; chưa chạy trên thiết bị (keychain thật, nút Back, vùng an toàn của thanh tab) |

## Vỏ ứng dụng

### Điều hướng

`src/app/navigation.tsx` dựng một stack gốc (native-stack); nội dung của stack đi theo phiên:

| Trạng thái | Nhóm màn hình | Ghi chú |
| --- | --- | --- |
| Chưa đăng nhập | `authScreens` (hiện có màn Chào mừng; đăng nhập, đăng ký, quên mật khẩu được đăng ký sau) | Khi máy chủ báo phiên hết hạn, app về nhóm này và mở màn đăng nhập (khi màn đó đã được đăng ký) để hiện thông báo; `useSession().expired` cho biết lý do |
| Đã đăng nhập, `me.user.onboarded` là `false` | `onboardingScreens` | Không có thanh tab |
| Đã đăng nhập, đã onboarding | Bốn tab **Hôm nay / Lộ trình / Tổ đội / Cá nhân** | Mỗi tab là một stack: màn gốc trong `tabRoots` rồi tới mọi màn trong `detailScreens`, nên màn chi tiết mở trong tab xuất phát và Back trở về đúng tab; màn chi tiết không hiện thanh tab |
| Đang trong buổi tập | `focusScreens`, mở toàn màn hình phía trên các tab | Thanh tab không chen vào được; cử chỉ vuốt để quay lại bị tắt |

Trong lúc đọc phiên từ keychain hoặc chờ `GET /me`, app hiện trạng thái đang tải. Nếu `GET /me` lỗi và không có dữ liệu để dùng, app hiện trạng thái lỗi với **Thử lại** và **Đăng xuất**. Nhóm nào chưa có màn hình trong sổ đăng ký thì hiện thông báo "Phần này đang được hoàn thiện" kèm **Đăng xuất**.

Quy tắc sổ đăng ký: toàn bộ tên route và tham số khai báo một lần trong `src/app/routes.ts` (`RootParamList`); `src/app/screens.tsx` xuất năm mảng `authScreens`, `onboardingScreens`, `tabRoots`, `detailScreens`, `focusScreens`. Một tính năng thêm màn hình bằng một dòng import và một phần tử trong mảng tương ứng, không sửa gì khác trong `src/app/`. Thứ tự tab cố định trong `navigation.tsx`. Liên kết tới route chưa đăng ký thì không làm gì cho tới khi màn đó có mặt; `__tests__/routes.test.ts` kiểm tra mọi màn đã đăng ký đều có trong `RootParamList`.

Thanh thông báo ngắn (snackbar) của toàn app nằm phía trên điều hướng và tự nâng lên trên thanh tab khi màn gốc của một tab đang hiển thị.

### API client

`src/shared/api/client.ts` là đường duy nhất tới API (`api.get`, `api.write`); địa chỉ gốc ở `src/shared/api/config.ts`. Client chỉ gửi và nhận JSON, gắn `Authorization: Bearer` khi có phiên, gắn `Idempotency-Key` (UUID v4 từ `newActionId()`) cho mọi lần ghi và hủy yêu cầu sau 10 giây. Mọi thất bại thành `ApiError` với `status`, `code`, `details`: mã của máy chủ khi có, `NETWORK` khi không gửi được, `TIMEOUT` khi quá hạn, `INTERNAL` khi phản hồi không đúng dạng lỗi. Client không ghi log, không tự cache và không đưa token, URL hay nội dung yêu cầu vào lỗi. Chuỗi tiếng Việt cho từng mã lỗi nằm ở `src/shared/i18n/vi/`.

### Phiên đăng nhập

`src/shared/api/session.ts` giữ phiên. Token chỉ nằm trong keychain của hệ điều hành (react-native-keychain) và trong bộ nhớ khi đang đăng nhập; không ghi vào AsyncStorage, cache truy vấn, log hay thông báo lỗi. Mở app thì phiên được khôi phục từ keychain.

Đăng xuất theo thứ tự: thu hồi phiên trên máy chủ (nếu lỗi hoặc quá hạn 10 giây vẫn tiếp tục, để đăng xuất được cả khi mất mạng), xóa keychain, xóa cache truy vấn trong bộ nhớ, xóa cache trên đĩa của tài khoản đó. Khi máy chủ trả `401 SESSION_INVALID` cho một yêu cầu có token, phiên kết thúc đúng một lần dù nhiều yêu cầu cùng nhận 401; lỗi 401 của chính các biểu mẫu đăng nhập, đăng ký là lỗi thường của biểu mẫu.

### Cache trên đĩa

`src/shared/storage/cache.ts` chỉ lưu hai thứ, tách theo tài khoản, trong AsyncStorage (khóa `cache:v1:<userId>:<tên>`): `Me` gần nhất và trạng thái ngày gần nhất. Số đo cơ thể, nhật ký và token không bao giờ được ghi vào đây. Giá trị hỏng đọc ra như chưa có gì.

Mở app khi mất mạng: nếu `GET /me` thất bại vì `NETWORK` hoặc `TIMEOUT` và đã có `Me` trong cache của đúng tài khoản, app dùng bản đó để người đã đăng nhập vẫn vào được; nếu chưa có cache thì hiện trạng thái lỗi. Lỗi khác từ máy chủ (ví dụ 500) không được che bằng cache.

## Cấu trúc phát triển

Tạo thư mục khi có mã thực sự sử dụng. Cây dưới đây là bản đồ đích, không phải danh sách module đã triển khai.

```text
src/
  app/                 App.tsx (provider), navigation.tsx, routes.ts, screens.tsx (sổ đăng ký), TabBar.tsx
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

`app` kết hợp feature; feature dùng `shared` và kiểu route từ `src/app/routes.ts`; `shared` không import ngược feature. Không truy cập chi tiết nội bộ feature khác. Không gom mọi thứ vào `utils/`, không thêm alias hoặc barrel export chỉ để rút ngắn import.

Giữ `android/`, `ios/`, `index.js` và cấu hình công cụ ở gốc theo cấu hình React Native hiện có. `design/` chứa thiết kế nguồn; asset được sử dụng mới vào `src/assets/`.

## Ranh giới hệ thống đề xuất

Client hiển thị, thu thập dữ liệu, phản hồi lạc quan và gửi thao tác. Server xác thực chủ sở hữu, tính mục tiêu chính thức, ghi sổ cái, xử lý giao dịch và chốt ngày. Cơ sở dữ liệu có thẩm quyền cho XP, xu, chuỗi và kho đồ.

```text
Màn hình → API client → API xác thực → nghiệp vụ → cơ sở dữ liệu
              ↑                            ↑
      hàng đợi cục bộ                tác vụ nền theo lịch
```

Backend nằm trong `server/` của repo này; cấu trúc và cách kiểm chứng ở [backend](backend.md).

## Ghi dữ liệu và mất mạng

Mỗi thao tác ghi có định danh bền vững; retry dùng lại định danh đó. Các lần uống nước khác nhau phải có định danh khác nhau dù cùng nhiệm vụ/ngày. Server kiểm tra payload, chủ sở hữu, hạn mức và transaction; client không tự xác nhận thưởng.

Hàng đợi giữ qua khởi động lại, gắn với tài khoản và giữ thứ tự khi thao tác phụ thuộc nhau. Không gửi hàng đợi dưới phiên tài khoản khác. API trả thời gian/ngày logic có thẩm quyền; chốt chính sách thao tác gửi muộn trước khi triển khai.

Không lưu token trong kho không mã hóa, không ghi số đo hoặc nhật ký vào log/analytics. Cache phân tách theo tài khoản và được dọn theo quy trình đăng xuất/xóa tài khoản đã chốt.
