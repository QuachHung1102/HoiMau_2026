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
| Xác thực | Bốn màn đăng nhập (S02), đăng ký (S03), quên mật khẩu (S04), mật khẩu mới (S55) với mã khôi phục 8 chữ số (`LIMITS.resetCode`), tóm tắt điều khoản `legalVi`, thông báo phiên hết hạn trên S02 | 18 | Jest với `fetch` giả (thân yêu cầu, không có `Idempotency-Key`, từng mã lỗi, kiểm tra trước khi gửi và trường được đưa lên đầu, bấm hai lần chỉ gửi một yêu cầu, huỷ khi rời màn, mật khẩu không nằm lại trong bộ nhớ đệm), `tsc`, ảnh chụp `s02-*`, `s03-*`, `s04-*`, `s55-*` trong bản xem trước; chưa chạy trên thiết bị (bàn phím, gợi ý tự điền, bàn phím số, đọc lỗi bằng TalkBack); máy chủ chưa có các route này |
| Onboarding | Bốn bước hồ sơ (S05, lỗi nhập S60, dưới 16 tuổi S61), mức vận động (S06), mục tiêu (S07, bảng an toàn S43), lộ trình ước tính (S08, đã điều chỉnh an toàn S62) và màn `Targets` đọc `GET /me/prescription`; `OnboardingProvider` giữ dữ liệu trong bộ nhớ (không ghi số đo xuống đĩa, xoá khi đổi tài khoản và sau khi hoàn tất); các phần dùng lại `BiometricsFields`, `TimezoneField`, `SafetySheet`, `TargetsView` | 19 | Jest với `fetch` giả (cả luồng kết thúc bằng một `POST /onboarding` đủ bảy trường rồi vào nhóm chính, giới hạn từng trường lấy từ `LIMITS`, lỗi trường trước quy tắc tuổi, tuổi 15 không gửi gì, hướng giảm mỡ bị từ chối mở S43, con số trên S08 bằng `calculatePrescription`, khoảng kcal bằng `calorieWindow`, thử lại dùng lại `Idempotency-Key`, bấm hai lần gửi một yêu cầu, lỗi máy chủ đưa về đúng bước, quét AsyncStorage không có số đo), `tsc`, ảnh chụp `s05-profile`, `s60-profile-errors`, `s61-under-16`, `s06-activity`, `s07-archetype`, `s43-safety-sheet`, `s08-targets`, `s62-targets-clamped`, `s08-targets-macro-adjusted` trong bản xem trước; chưa chạy trên thiết bị (bàn phím số có dấu phẩy, cuộn tới trường lỗi, TalkBack, nút Back); máy chủ chưa có các route này |
| Ghi khi mất mạng | Hàng đợi thao tác chờ gửi theo từng tài khoản (`pendingActions.ts`, khóa `pending:v1:<userId>`, tối đa 500), `useQueuedWrite` (ghi xuống máy trước rồi mới gửi; kết quả đã xác nhận / đang chờ gửi / bị từ chối), `usePendingSync` (gửi lại khi có phiên, khi app trở lại, sau mỗi yêu cầu thành công, mỗi 30 giây và khi bấm **Thử lại**), dải trạng thái S38 phía trên app (`PendingBanner`: "Bạn đang ngoại tuyến", số ghi nhận đã lưu trên máy), thông báo ghi nhận bị từ chối (`RejectedNotice`) và hộp hỏi lại khi đăng xuất mà còn ghi nhận chưa gửi | 24 | Jest với `fetch` giả và AsyncStorage giả (ghi xuống đĩa trước khi gửi, khởi động lại vẫn đúng thứ tự và đúng định danh, lỗi mạng / 5xx / 429 / 401 giữ lại, lỗi 4xx của API thì bỏ và báo, hai lần gửi cùng lúc chỉ gửi một lần, không gửi dưới tài khoản khác, `occurredAt` sau 60 giây, dữ liệu hỏng được giữ bản sao và báo một lần, phiên hết hạn giữ hàng đợi, đăng xuất hỏi trước khi bỏ), `tsc`, ảnh chụp `s38-offline-banner`, `s38-pending-actions`, `s38-rejected-day-closed` trong bản xem trước; chưa chạy trên thiết bị (AppState thật, AsyncStorage thật qua lần tắt app, vùng an toàn phía trên của dải trạng thái, TalkBack) |
| Hôm nay | Màn **Hôm nay** (S09) là màn gốc của tab đầu: cấp và xu, thẻ Mầm, ô ghi nước một chạm, bốn chỉ số, hai việc chính, chuỗi ngày, lối vào các màn khác; trạng thái vừa ghi nhận (S57: "Đã ghi nhận · +10 XP" kèm **Hoàn tác** trong 5 giây), chưa lưu được (S58: hoàn nguyên ô nước, nêu lý do và **Thử lại**), đang chờ gửi; màn giải thích chỉ số (S47). `useDay` (`GET /day`, khóa `['day']`, giữ bản gần nhất trên máy để mở app khi mất mạng; đọc lại khi app trở lại màn hình và đúng lúc ngày khép lại; khi ngày đã giữ đã qua mà chưa hỏi được máy chủ thì dựng một ngày tạm cùng nhiệm vụ, chưa có gì hoàn thành, kèm dòng "Ngày mới chưa được đồng bộ…", để ghi nhận đầu tiên của buổi sáng vẫn thực hiện được và nằm chờ gửi), `applyPending` (phủ các ghi nhận chưa gửi lên dữ liệu ngày, không cộng phần thưởng), `useTick` (ghi một lần tick qua hàng đợi, hoàn tác qua `POST …/undo`), `pushCelebrations` / `useCelebrationQueue` (hàng chờ lớp chúc mừng). Tab chưa có màn gốc hiện thông báo "Phần này đang được hoàn thiện" cùng nút **Đăng xuất** | 25 | Jest với `fetch` giả đóng vai các route ngày (ô nước đổi ngay khi chạm, phần thưởng chỉ hiện sau khi máy chủ xác nhận và lấy số từ câu trả lời, mất mạng thì giữ ô và ghi "Đang chờ gửi", bị từ chối thì hoàn nguyên, hai lần chạm nhanh là hai định danh, tối đa 8 phần tính cả phần đang chờ, hoàn tác lấy số từ máy chủ và hết hạn sau 5 giây, mở app khi mất mạng dùng dữ liệu đã giữ, sang ngày mới thì đọc lại dữ liệu ngày hoặc hiện ngày tạm nếu mất mạng, câu trả lời đến sau khi phiên kết thúc không được ghi lại), `tsc`, ảnh chụp `s09-today`, `s09-today-streak-hidden`, `s09-today-mam-tired`, `s09-today-pending`, `s09-today-new-day-offline`, `s57-today-just-recorded`, `s58-today-not-saved`, `s47-stats-explainer` trong bản xem trước; chưa chạy trên thiết bị (TalkBack với thanh hoàn tác, vùng chạm của hàng ô nước, chuyển động); máy chủ chưa có các route này |
| Ghi nhận ngày (lần 2) | **Nhiệm vụ hôm nay** (S10, mở từ "Xem tất cả nhiệm vụ"): phần "Giữ nhịp hôm nay" (buổi tập chính → danh mục bài tập, bữa ăn theo mục tiêu → S16) và "Thói quen nhỏ" (uống nước, đứng dậy một chút ghi bằng `useTick`; thanh phản hồi S11 "Đã ghi nhận" kèm **Hoàn tác** 5 giây; nhiệm vụ ẩn là một hàng khóa "Mở vào buổi tối" cho tới khi máy chủ mở khóa); **Khép lại hôm nay** (S45: nút tắt kèm lý do "Mở từ 18:00" khi nhiệm vụ ẩn còn khóa, `POST /day/bedtime` qua hàng đợi, "Chúc bạn nghỉ ngon" và dòng thưởng chỉ khi câu trả lời có sự kiện `QUEST_COMPLETED`, đã ghi rồi thì không có gì để ghi lại); **Ghi bữa ăn** (S16: số kcal 1–5000 và tên món tối đa 60 ký tự lấy từ `LIMITS`, kiểm tra trước khi gửi, `POST /nutrition/log` qua hàng đợi, tổng và phần thưởng lấy từ câu trả lời, nói trước khi lưu rằng bữa đã ghi không xóa được, không có Hoàn tác); `useLogKcal`; nhắc đứng dậy (`standUpTimer` là hàm thuần nhận thời gian qua đối số, `useStandUp` giữ đồng hồ và `AppState`: 60 phút ở nền trước, rời app quá 10 phút thì dừng, trạng thái giữ ở khóa `standup:v1:<userId>` chỉ gồm thời gian và bị xóa khi đăng xuất, nhắc bằng thanh thông báo trong app, không dùng thông báo của hệ điều hành) | 26 | Jest với `fetch` giả đóng vai các route ngày (hàng nhiệm vụ ghi một lần và hoàn tác, chờ gửi và bị từ chối theo đúng trạng thái ghi, ngày tạm khi chưa hỏi được máy chủ, nút ghi giờ nghỉ tắt khi khóa và chỉ có thưởng khi có sự kiện, số kcal sai không gửi gì, tổng lấy từ máy chủ, `DAY_CLOSED`, không có Hoàn tác cho bữa ăn, đồng hồ nhắc: 60 phút, 5 phút ở nền vẫn tính, 11 phút ở nền thì dừng, giữ qua lần mở lại, xóa khi đăng xuất), `tsc`, ảnh chụp `s10-quest-board`, `s10-quest-board-hidden-revealed`, `s10-quest-board-all-done`, `s11-recorded-undo`, `s45-end-of-day`, `s45-end-of-day-too-early`, `s45-end-of-day-marked`, `s16-manual-kcal`, `s16-manual-kcal-error` trong bản xem trước; chưa chạy trên thiết bị (thanh nhắc khi app ở nền trước thật, `AppState` thật, TalkBack, bàn phím số); máy chủ chưa có các route này |
| Lộ trình và tập luyện | Màn **Lộ trình** (S12) là màn gốc của tab thứ hai: tình hình hôm nay lấy từ `useDay` (buổi tập chính, bữa ăn) và ba lối vào (thực đơn, chọn buổi tập, mục tiêu); **Chọn buổi tập** (S17: chip thời lượng, không gian, dụng cụ đang có; `GET /workout/catalog` do máy chủ lọc và sắp xếp, app không lọc lại; bài được gợi ý đầu tiên là thẻ nổi bật "Hợp với …"; không có bài nào thì là trạng thái S48 với "Xóa bớt bộ lọc", khác hẳn trạng thái lỗi tải); **Chi tiết buổi tập** (S18: ba giai đoạn, từng động tác kèm số lần, lời dặn an toàn lấy nguyên văn từ `healthVi`, năng lượng luôn ghi là ước tính); **Buổi tập** (S19, tạm dừng S41, hỏi trước khi thoát S63) là luồng toàn màn hình phía trên các tab: `sessionClock.ts` là các hàm thuần nhận thời gian qua đối số (thời gian tập = từ lúc bắt đầu đến hiện tại trừ mọi quãng tạm dừng), màn hình chỉ đọc `Date.now()` mỗi 250 ms chứ không đếm số lần hẹn giờ chạy; rời app thì buổi tập tự tạm dừng và không tự chạy lại; nút Back của Android mở hộp thoại thay vì đóng buổi tập; mỗi buổi tập là một thao tác với một mã duy nhất tạo lúc bắt đầu và dùng lại cho mọi lần gửi (`POST /workout/complete` qua hàng đợi, `useCompleteWorkout`); **Kết quả** (S20 hoàn thành, S64 buổi tập dở) chỉ mở khi đã có câu trả lời của máy chủ nên XP, xu và "đã hoàn thành" luôn là số của máy chủ; buổi tập mới chỉ lưu trên máy thì nói "đang chờ gửi" và không nêu phần thưởng; bị từ chối thì nêu lý do kèm "Thử lại" với đúng mã cũ; lời nhắc đứng dậy không hiện đè lên buổi tập (`useStandUpHold`) | 27 | Jest với `fetch` giả đóng vai ba route tập luyện theo hợp đồng API và dữ liệu bài tập thật chép từ `server/content` (đồng hồ: 60 s tập, 300 s tạm dừng, 30 s tập ra 90 s; lịch 14 chặng cộng lại đúng thời lượng; đồng hồ đi theo giờ thật khi bị bỏ lỡ lần hẹn giờ; rời app thì tạm dừng; Back mở hộp thoại; "Tập tiếp" trở lại đúng thời gian còn lại; gửi một lần với mã của buổi tập, thử lại dùng lại mã; chip đổi thì hỏi lại máy chủ với đúng tham số; S48 khác lỗi tải; kết quả theo câu trả lời), `tsc`, ảnh chụp `s12-plan`, `s17-catalog`, `s48-catalog-empty`, `s18-workout-detail`, `s19-focus-session`, `s41-focus-paused`, `s63-exit-dialog`, `s20-result-completed`, `s64-result-partial`, `s20-result-queued` trong bản xem trước; chưa chạy trên thiết bị (đồng hồ khi khóa màn hình, nút Back thật, TalkBack, giữ màn hình sáng thuộc Task 35); máy chủ chưa có ba route này; hình minh họa động tác và màn `MoveDemo` thuộc Task 36 |

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

Quy tắc sổ đăng ký: toàn bộ tên route và tham số khai báo một lần trong `src/app/routes.ts` (`RootParamList`); `src/app/screens.tsx` xuất năm mảng `authScreens`, `onboardingScreens`, `tabRoots`, `detailScreens`, `focusScreens`. Một tính năng thêm màn hình bằng một dòng import và một phần tử trong mảng tương ứng, không sửa gì khác trong `src/app/`. Thứ tự tab cố định trong `navigation.tsx`. `__tests__/routes.test.ts` kiểm tra mọi màn đã đăng ký đều có trong `RootParamList`.

Quy tắc điều hướng theo tên:

- `navigate('<màn gốc của tab>')` (`Today`, `Plan`, `Guild`, `Profile`) dùng được từ mọi nơi trong phần chính của app: từ tab khác, từ màn chi tiết, từ luồng buổi tập. Kết quả luôn giống nhau: luồng buổi tập đóng lại, tab đó được chọn và hiện màn gốc của nó (màn chi tiết đang mở trong tab đó được đóng).
- Liên kết tới route đã khai báo nhưng chưa có màn hình trong sổ đăng ký thì không làm gì và không báo lỗi, cho tới khi màn đó có mặt.
- Mọi lệnh điều hướng khác không được xử lý (tên không khai báo, route của nhóm không đang hiển thị, Back khi không còn gì để lùi) ghi `console.error` kèm tên route khi chạy bản dev.

Thanh thông báo ngắn (snackbar) của toàn app nằm phía trên điều hướng và tự nâng lên trên thanh tab khi màn gốc của một tab đang hiển thị.

### API client

`src/shared/api/client.ts` là đường duy nhất tới API (`api.get`, `api.write`); địa chỉ gốc ở `src/shared/api/config.ts`. Client chỉ gửi và nhận JSON, gắn `Authorization: Bearer` khi có phiên, gắn `Idempotency-Key` (UUID v4 từ `newActionId()`) cho các lần ghi mà hợp đồng API đánh dấu là idempotent (tra trong `OPERATIONS` của `domain/contract/operations.ts`; các route đăng nhập, đăng ký, đăng xuất, quên và đặt lại mật khẩu không có khóa) và hủy yêu cầu sau 10 giây. Nơi gọi có thể truyền `signal` để tự hủy; khi đó lời gọi kết thúc bằng chính lỗi hủy, không phải `ApiError`. Mọi thất bại khác thành `ApiError` với `status`, `code`, `details`: mã của máy chủ khi có, `NETWORK` khi không gửi được, `TIMEOUT` khi quá hạn, `INTERNAL` khi phản hồi không đúng dạng lỗi hoặc không dựng được yêu cầu. Client không ghi log, không tự cache và không đưa token, URL hay nội dung yêu cầu vào lỗi. Chuỗi tiếng Việt cho từng mã lỗi nằm ở `src/shared/i18n/vi/`.

### Phiên đăng nhập

`src/shared/api/session.ts` giữ phiên. Token chỉ nằm trong keychain của hệ điều hành (react-native-keychain) và trong bộ nhớ khi đang đăng nhập; không ghi vào AsyncStorage, cache truy vấn, log hay thông báo lỗi. Mở app thì phiên được khôi phục từ keychain.

Đăng xuất theo thứ tự: thu hồi phiên trên máy chủ (nếu lỗi hoặc quá hạn 10 giây vẫn tiếp tục, để đăng xuất được cả khi mất mạng), xóa keychain, xóa cache truy vấn trong bộ nhớ (các yêu cầu đang chạy bị hủy), xóa cache trên đĩa của tài khoản đó. Nếu keychain không xóa được, app thử lại một lần; vẫn không được thì ghi đè bằng mật khẩu rỗng, và lần mở app sau coi mật khẩu rỗng là chưa đăng nhập, để token không còn dùng lại được trên máy dùng chung. Khi máy chủ trả `401 SESSION_INVALID` cho một yêu cầu có token, phiên kết thúc đúng một lần dù nhiều yêu cầu cùng nhận 401; lỗi 401 của chính các biểu mẫu đăng nhập, đăng ký là lỗi thường của biểu mẫu.

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
