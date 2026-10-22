# Kiểm thử và phát hành

## Hiện trạng

Bản dùng nội bộ đầu tiên (giai đoạn 1 của đặc tả §11: một người đăng ký, nhận mục tiêu, ghi nhận ba ngày liên tiếp và thấy chuỗi tăng đúng qua mốc nửa đêm) đã được chứng minh **không cần thiết bị**: ở mức HTTP với server và PostgreSQL thật, và một lần bằng chính cây ứng dụng React Native chạy trong Jest, nói chuyện với server dev thật.

**Chưa có lần chạy nào trên thiết bị**, thật hay giả lập. Máy phát triển không chạy được emulator (ảo hóa CPU đang tắt trong firmware) và chưa có điện thoại nào được cắm. Những gì chỉ kiểm được trên thiết bị (keychain thật, TalkBack, font, cử chỉ, chuyển động, bàn phím, hiệu năng…) được gom dần vào danh sách nội bộ `.superpowers/sdd/device-checks.md` (không nằm trong Git); Task 54 chạy danh sách đó khi có thiết bị và ghi kết quả vào tài liệu này.

Các mục của ma trận bên dưới là yêu cầu cho toàn sản phẩm; bảng sau nói lớp kiểm chứng nào đang có và nó chứng minh tới đâu.

| Lớp | Lệnh | Chứng minh | Không chứng minh |
|---|---|---|---|
| Jest của app | `npm test -- --runInBand` | Render và tương tác của từng màn hình, hook và thành phần (React Native Testing Library), với `fetch` giả trả lời như server; keychain và AsyncStorage là mock; không chạm mạng. Bỏ qua `__tests__/e2e/`. | Hành vi native, bố cục thật, font, hiệu năng; việc server thật trả lời đúng như bản giả. |
| Logic thuần `domain/` | `npm run domain:test` | Công thức năng lượng, ngày logic, chuỗi, kinh tế, thú, hợp đồng; ngưỡng phủ 90 % (NFR-09). | Cách app và server dùng chúng. |
| Test của server | `npm run server:test` | Route qua HTTP và hàm SQL trên PostgreSQL 18 thật (cụm test, cổng 54329), đồng hồ test, job thật; gồm cả bộ đầu-cuối HTTP bên dưới. | App. |
| Hiệu năng và quan trắc của server | `npm run server:perf` (hiệu năng); `observability.test.ts` và `metrics.test.ts` trong `npm run server:test` | p95 của sáu endpoint trên 2 000 người dùng, 300 tổ đội, 30 ngày dữ liệu (NFR-01); mỗi dòng sổ cái có đúng một dòng log và không giá trị cá nhân nào trong log; cảnh báo `job_late` ở phút 91 (NFR-10); các câu SQL của chỉ số §12 trả đúng số trên fixture. | Thời gian trên điện thoại (khởi động, vẽ, cuộn, bộ nhớ): xem danh sách thiết bị. Chỉ số M-06 (cần phân tích phía máy khách, chưa xây). |
| Đầu-cuối HTTP | trong `npm run server:test` (`server/test/e2e/slice1.test.ts`) | Đăng ký → onboarding → ba ngày logic liên tiếp ở `Asia/Ho_Chi_Minh` (tám lần tick nước, calo trong dải, buổi tập ≥ 50 %, một lượt ghi lúc 23:50 và một lúc 00:30 giờ địa phương), `day-close` ngay sau mỗi 03:00: chuỗi 1, 2, 3, kỷ lục 3, tổng XP và xu bằng tổng phần thưởng của nhiệm vụ, thú `HAPPY`. Gửi lại mọi lượt ghi với đúng `Idempotency-Key` cũ và chạy `day-close` thêm hai lần: sổ cái không đổi một dòng, dòng mồi nhử không đổi. Cùng luồng cho `America/New_York` qua 08/03/2026 (bắt đầu giờ mùa hè) vẫn ra chuỗi 3. | App; mạng thật giữa máy và điện thoại. |
| Đầu-cuối qua app | `npm run test:e2e` (cần server dev, xem dưới) | Cây `<App />` thật, không `fetch` giả: Chào mừng → đăng nhập bằng tài khoản kịch bản `fresh` → bốn bước onboarding → Hôm nay → một lần tick nước được server xác nhận ("1 / 8 phần") → bảng nhiệm vụ → ghi calo → thư viện bài tập → chi tiết → buổi tập kết thúc qua hộp thoại khi đồng hồ đã qua 50 % → kết quả hoàn thành → hai việc chính trên Hôm nay đã xong; rồi dời đồng hồ server qua 03:00, chạy `day-close`, app làm mới và thấy chuỗi 1 (chỉ số và màn hành trình). | Keychain, AsyncStorage, chạm, vẽ và chuyển động thật (vẫn là mock và môi trường Jest; chuyển động ở trạng thái tĩnh); `adb reverse`; hai đồng hồ lệch nhau. |
| Ba cổng lược đồ | `npm run db:verify`, `npm run db:api-check`, `npm run db:mutation-check` | Catalog đúng thiết kế (vai trò, quyền, RLS, policy, hàm); một request thật không đọc hay ghi được dữ liệu người khác; cổng 1 biết báo lỗi khi từng hàng rào bị phá (xem [backend](backend.md#ba-cổng-kiểm)). | Thân hàm và code Node (phần đó do test của server giữ). |
| Bản xem trước | `npm run preview`, `node tools/preview/shot.mjs <tên>` | Bố cục, nội dung và từng trạng thái thiết kế của mỗi màn hình, render bằng react-native-web trong Chromium. | Hành vi native: vùng an toàn, font đóng gói, đo chữ, đổ bóng. |
| Build native | `cd android; .\gradlew.bat assembleDebug --console=plain` và `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output <tệp>` | Dự án Android biên dịch ra APK debug; bundle Metro bản phát hành dựng được, không chứa `react-native-web` hay `vite`; font nằm trong APK. | APK chạy được trên máy. |
| Kiểu và lint | `npm run lint`, `npx tsc --noEmit`, `npx tsc -p tools/preview`, `npm run server:typecheck` | Kiểu của app, `domain/`, bản xem trước và server; ESLint trên `src/`, `domain/`, `server/`, `__tests__/`, `tools/` và các tệp cấu hình JS ở gốc repo. | Hành vi. |

### Yêu cầu phi chức năng đã đo (Task 51)

| NFR | Yêu cầu | Phép đo | Kết quả (23/10/2026, Ryzen 5 5600X, 31,9 GiB, Windows 11, Node 24.8.0, PostgreSQL 18.4 nhúng, một máy) |
|---|---|---|---|
| NFR-01 | p95 của API < 300 ms; bảng xếp hạng < 500 ms | `npm run server:perf`: 200 lần gọi tuần tự mỗi endpoint qua HTTP thật, 2 000 người dùng, 300 tổ đội, 30 ngày dữ liệu | p95: `GET /day` 8,0 ms; `POST /day/quests/WATER_8/progress` 12,4 ms; `GET /me` 7,0 ms; `GET /nutrition/plan` 8,1 ms; `GET /guilds/me` 9,5 ms; `GET /leaderboard?week=current` 3,1 ms (lần tính bảng đầu tiên 167 ms). `day-close` 2 000 người: 3,40 s; `weekly-rollover`: 10,32 s. Đồng hồ đóng băng, nên lần chạy lặp lại được. Chi tiết và số dòng: [backend](backend.md#hiệu-năng-checksperftestts-npm-run-serverperf). |
| NFR-01 (thiết bị) | thời gian phản hồi người dùng thấy | chưa đo: khởi động nguội, Today đầu tiên, cuộn, bộ nhớ sau 45 phút nằm trong `.superpowers/sdd/device-checks.md` (Task 54) | **chưa có số**; số của server không phải số của điện thoại. |
| NFR-10 | log có cấu trúc cho mọi bút toán sổ cái; cảnh báo khi `day-close` trễ | `server/test/observability.test.ts` | Số dòng log `evt:'ledger'` bằng số dòng `xp_ledger` + `coin_ledger` mới (và cùng nội dung); không email, mật khẩu, token, mã, số đo, calo hay câu nhật ký nào trong log (có đối chứng); `job_late` ở phút 91, không ở phút 90. |
| §12 M-01…M-05, M-07 | tiêu chí thành công | `server/scripts/metrics.sql`, `server/test/metrics.test.ts` | Câu lệnh chạy được và đúng trên fixture; chưa có số thật vì chưa có người dùng thật. M-06 không đo được từ server. |

### Chạy bộ đầu-cuối qua app

```sh
npm run server:dev                                   # terminal 1: API dev ở http://127.0.0.1:8787/api/v1
npm --prefix server run scenario -- fresh            # terminal 2
E2E_BASE_URL=http://127.0.0.1:8787/api/v1 npm run test:e2e
```

Trong PowerShell: `$env:E2E_BASE_URL='http://127.0.0.1:8787/api/v1'; npm run test:e2e`. Không đặt `E2E_BASE_URL` thì bộ test tự bỏ qua và in lý do; `npm test` không bao giờ chạy nó.

- Bộ test tự dựng lại kịch bản `fresh` lúc bắt đầu (nên chạy lại được), lấy email, mật khẩu và giờ server từ chính đầu ra của kịch bản, rồi đặt đồng hồ của "thiết bị" (`Date` trong Jest) bằng giờ đó. Buổi tập được "tập" bằng cách dời đồng hồ thiết bị, không chờ thật.
- Thời gian của server chỉ được dời bằng `npm --prefix server run scenario -- clock <ISO>` và `day-close` chỉ chạy bằng `npm --prefix server run jobs -- day-close`, đúng như người ở terminal làm. Mốc 03:00 lấy từ `closesAt` của `GET /day`.
- Khi xong, bộ test dựng lại `fresh` và trả đồng hồ về giờ thật (`scenario -- clock off`). Nó dời đồng hồ của cả cơ sở dữ liệu dev, nên cũng từ chối chạy khi có tài khoản dev đã onboarding không phải `demo-*@hoimau.test` (xem [backend](backend.md#kịch-bản-phát-triển-và-dịch-chuyển-thời-gian-scriptsscenariots-scriptsscenariosts)).
- Chạy xong thì dừng `server:dev` (Ctrl+C); nếu nó bị buộc dừng, chạy `npm run db:cleanup`.

### Trợ năng và độ phủ (Task 49)

Hai bộ quét chạy trong `npm test` và phải luôn xanh:

- `__tests__/a11y-sweep.test.tsx` render **mọi** mục xem trước (`tools/preview/entries/*.tsx`) trong Jest và kiểm tra cây đã render: mọi phần tử bấm được có `accessibilityRole` và có tên (nhãn hoặc chữ bên trong; vùng bấm ẩn có chủ đích như lớp nền của sheet thì không cần); thành phần đang tắt / đang bận / đã chọn / đã đánh dấu thì báo đúng `accessibilityState`; không có nút đang bật mà bấm không làm gì; mọi ảnh (`Image`, SVG) có nhãn hoặc bị ẩn khỏi trình đọc màn hình; thanh tiến độ có `accessibilityValue` và một con số nhìn thấy; không có chữ rỗng hay khóa dịch thô (`/^[A-Z_]{4,}$/`); không `Text` nào được render với chiều cao cố định (kiểm trên cây render của các mục, không phải quét mã nguồn). Các mục tự gõ và bấm để tới trạng thái thiết kế (lỗi, xác nhận) được chạy qua một `document` giả dựa trên chính cây render. Mỗi bộ điều khiển như vậy (`beginDrive` trong `tools/preview/harness.tsx`) báo khi bắt đầu và khi đã làm xong bước cuối; bộ quét chờ đến khi không còn bộ nào chạy rồi cho màn hình thêm 300 ms để hiện kết quả của bước cuối, và **đánh trượt** mục nào vẫn còn đang điều khiển sau 15 giây. Vậy điều được bảo đảm là: mọi bước của mục đã chạy trước khi kiểm; với các mục S02 lỗi, S26 mã sai, S52 sai mật khẩu, S41 tạm dừng, S63 hộp thoại thoát, S20 chờ gửi và S20 bị từ chối, bộ quét còn kiểm chữ riêng của trạng thái đó có trên màn hình. Với các mục còn lại, trạng thái do câu trả lời bất đồng bộ sau bước cuối tạo ra chỉ được chờ 300 ms. Thêm các kiểm tra tĩnh trên mã nguồn: chỉ `src/shared/ui/Touchable.tsx` được lấy `Pressable` / `TouchableOpacity` / `TouchableHighlight` / `TouchableWithoutFeedback` / `TouchableNativeFeedback` / `Button` của `react-native`, ở bất kỳ tệp nào trong `src/` kể cả test (nhập theo tên, `import * as`, `require`, cả hai kiểu dấu nháy); không tắt co giãn chữ; `maxFontSizeMultiplier` chỉ ở `src/app/TabBar.tsx`; không viết chữ tiếng Việt trong `src/features`, `src/app`, `src/shared/ui` (kể cả dạng tổ hợp NFD hay `\u…`).
- `__tests__/coverage-sweep.test.ts`: mỗi mã khung S01…S82 trong `docs/design/screen-map.md` có ít nhất một mục xem trước; mọi route khai báo trong `RootParamList` đều được đăng ký trong `src/app/screens.tsx` và ngược lại; mọi route đã đăng ký đều tới được (là gốc của một tab / ngăn xếp, hoặc là đích của một `navigate(...)` trong mã app). Bộ in ba con số này.
- Mỗi bộ có đối chứng âm: một `Pressable` không nhãn, không vai trò làm phép kiểm tra trượt; mã khung bịa `S99` bị báo thiếu; một route chỉ được nhắc trong chú thích bị báo là không tới được (chú thích bị bỏ trước khi quét).
- `node design/check.mjs` kiểm tra độ tương phản ≥ 4,5:1 cho mọi cặp màu chữ / nền mà bộ thành phần `src/shared/ui/` dùng, cả ở ba giao diện màu, và ≥ 3:1 (tương phản phi văn bản, WCAG 1.4.11) cho viền ô nhập `field-line` so với `white` và với `bg` của cả ba giao diện; lệnh in ra các tỉ lệ này.

Những gì máy ở đây không kiểm được nằm trong danh sách kiểm tra trên thiết bị (Task 54): thứ tự đọc và tiêu điểm của TalkBack sau khi chuyển màn và sau khi đóng lớp phủ, cỡ chữ 2.0 thật ở bề rộng 360 dp, vùng bấm 48 dp trên màn hình thật, độ tương phản trên tấm nền thật (kể cả viền ô nhập `field-line`), bàn phím che ô đang nhập.

### Chuyển động (Task 50)

Bộ quét `__tests__/motion-sweep.test.tsx` chạy trong `npm test` và phải luôn xanh:

- **Danh mục.** Mọi mục `tier: 1` của `design/motion/catalog.json` có ít nhất một tệp trong `src/` mang dấu `// motion: <id>` cạnh mã cài đặt nó (`exercise-*` là mọi mục `kind: "exercise"`, do `RigPlayer` vẽ); mục `tier: 2` hoặc có dấu như vậy, hoặc ghi "tĩnh (tier 2)". Dấu nào ghi sai id cũng bị đánh trượt. Bảng dưới được sinh từ mã bằng `MOTION_TABLE_WRITE=1 npx jest __tests__/motion-sweep.test.tsx -t "table in docs"`; bộ quét so bảng trong tệp này với bảng vừa sinh, nên sửa tay là trượt. Dấu chỉ chứng minh mã cài đặt tồn tại ở đó, không chứng minh nó đẹp hay mượt: nhiều mục tier 1 dựng ở trạng thái cuối (ví dụ `journal-saved`, `ticket-granted`, `ticket-freeze`: dòng "đã lưu" hay thẻ vé hiện ngay), điều đó được ghi trong chú thích cạnh dấu.
- **Giảm chuyển động.** Mỗi mục xem trước được render hai lần, với `motion: 'FULL'` rồi `'REDUCED'` (bộ quét ép lựa chọn này vào `withApp`): ở lần thứ hai không một `Animated.timing / spring / loop / sequence / parallel` nào được `start`, và mọi chuỗi chữ hiện ở lần đầu cũng hiện ở lần thứ hai (chữ thêm, như số giây đếm ngược, thì được). Hoạt ảnh `animation: 'none'` của `@react-navigation/bottom-tabs` (một `timing` dài 0 ms mỗi lần đổi tab) được đếm riêng vì không chuyển động gì.
- **Vòng đời** của `Mam`, `RigPlayer`, `LoadingState`, ngọn lửa chuỗi và `BreathingGuide`: vòng lặp chạy khi màn hình có tiêu điểm và app ở nền trước, dừng khi `active` thành false, khi `AppState` sang `background`, khi gỡ khỏi cây (các bộ lắng nghe `AppState` đều được gỡ và không bộ hẹn giờ nào của `src/` còn lại); một màn ăn mừng đã chạy xong không chạy lại khi app trở về hay màn lấy lại tiêu điểm.
- **Quét tĩnh `src/`:** không hàm gọi lại của `.start(` / `.addListener(` nào gọi api, mutation, điều hướng hay đặt trạng thái "đã lưu" (hiện chỉ có ba hàm ghi nhớ "đã chạy xong" vào một `ref`, và các bộ nghe chỉ vẽ); mọi `setTimeout` / `setInterval` được giữ trong biến và có `clearTimeout` / `clearInterval` tương ứng; mọi `Animated.loop` nằm trong tệp có `useLoopGate` hoặc `AppState`; mọi hoạt ảnh được `start` đều có `stop` trong cùng tệp.
- Đối chứng âm: một mục đồ giả bắt đầu `Animated.loop` dưới giảm chuyển động bị bắt; một mục mất chữ khi giảm bị bắt còn chữ thêm thì không; mục thiếu dấu tier 1 và dấu sai id bị báo; hàm gọi lại có `api.post`, bộ hẹn giờ không xóa và bộ hẹn giờ không giữ biến đều bị báo.

Những gì chỉ thiết bị kiểm được (bật / tắt "Giảm chuyển động" của hệ thống khi app đang mở, 60 fps trên máy yếu, vòng lặp dừng khi khóa màn hình) nằm trong danh sách kiểm tra trên thiết bị (Task 54).

<!-- motion-table:start -->
| id | tier | kind | tệp cài đặt |
|---|---|---|---|
| press-scale | 1 | micro | src/shared/ui/Touchable.tsx |
| check-draw | 1 | micro | src/shared/ui/Toggles.tsx |
| switch-slide | 1 | micro | src/shared/ui/Toggles.tsx |
| tab-pill | 1 | micro | src/app/TabBar.tsx |
| chip-select | 2 | micro | src/shared/ui/Toggles.tsx |
| list-stagger | 2 | transition | src/features/guild/LeaderboardScreen.tsx, src/features/notifications/InboxScreen.tsx, src/features/progression/DayHistoryScreen.tsx, src/features/progression/JourneyScreen.tsx, src/features/quests/QuestBoardScreen.tsx |
| number-roll | 1 | feedback | src/features/onboarding/TargetsView.tsx, src/features/progression/LevelsScreen.tsx, src/features/shop/ShopScreen.tsx, src/shared/ui/Badges.tsx |
| progress-fill | 1 | feedback | src/features/guild/GuildScreen.tsx, src/features/nutrition/MealPlanScreen.tsx, src/features/pet/PetScreen.tsx, src/shared/ui/LevelStrip.tsx |
| skeleton-shimmer | 1 | ambient | src/shared/ui/States.tsx |
| snackbar-undo | 1 | feedback | src/shared/ui/Snackbar.tsx |
| field-error | 1 | feedback | src/shared/ui/Notices.tsx, src/shared/ui/TextField.tsx |
| pending-pulse | 1 | ambient | src/features/quests/WaterTracker.tsx, src/features/sync/PendingBanner.tsx |
| water-check-in | 1 | feedback | src/features/quests/WaterTracker.tsx |
| quest-complete | 1 | reward | src/features/quests/QuestBoardScreen.tsx |
| mam-idle | 1 | mascot | src/features/auth/WelcomeScreen.tsx, src/shared/ui/mam/Mam.tsx |
| mam-happy | 1 | mascot | src/features/dashboard/CompanionCard.tsx, src/shared/ui/mam/Mam.tsx |
| mam-cheer | 1 | celebration | src/features/workout/WorkoutResultScreen.tsx, src/shared/ui/mam/Mam.tsx |
| mam-tired | 1 | mascot | src/shared/ui/mam/Mam.tsx |
| mam-wave | 2 | mascot | src/features/auth/WelcomeScreen.tsx |
| mam-sleep | 2 | mascot | src/features/quests/EndOfDayScreen.tsx |
| exercise-xoay-vai | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-squat | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-chong-day-tua-ban | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-chung-chan-lui | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-plank-tua-goi | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-tha-long-vai | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-nghieng-co-nhe | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-mo-nguc | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-gian-co-tay | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-xoay-than-khi-ngoi | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-cui-nguoi-gian-lung | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-cong-va-vong-lung | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-gian-dui-truoc | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-gian-bap-chan | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-xoay-hong | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-dung-len-ngoi-xuong-ghe | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-chong-day-tua-tuong | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-nhon-got | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-cau-mong | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-tay-chan-doi-dien | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-squat-cam-ta-tay | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-day-vai-voi-ta-tay | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-cheo-ta-tay | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-gap-hong-voi-ta-tay | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-cuon-ta-tay-truoc | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-keo-day-khang-luc | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-buoc-ngang-voi-day-khang-luc | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-di-bo-tai-cho | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-nang-dau-goi | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-got-cham-mong | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-dang-tay-buoc-ngang | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-di-bo-nhanh | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-chay-bo-nhe | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-nhun-nhe-tai-cho | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-leo-nui-tua-ban | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-di-bo-cham | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-tho-bung | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-tho-ra-dai | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-tho-vuong | 1 | exercise | src/features/workout/RigPlayer.tsx |
| exercise-tha-long-tung-vung | 1 | exercise | src/features/workout/MoveDemoView.tsx, src/features/workout/RigPlayer.tsx |
| xp-float | 1 | reward | src/features/quests/WaterTracker.tsx |
| coin-fly | 2 | reward | src/features/dashboard/TodayScreen.tsx |
| reject-revert | 1 | feedback | src/features/quests/WaterTracker.tsx |
| hidden-quest-reveal | 2 | transition | src/features/quests/QuestBoardScreen.tsx |
| end-of-day-sky | 2 | ambient | src/features/quests/EndOfDayScreen.tsx |
| welcome-sprout | 2 | mascot | src/features/auth/WelcomeScreen.tsx |
| onboarding-step | 1 | transition | src/features/onboarding/StepScreen.tsx |
| archetype-lift | 2 | micro | src/features/onboarding/ArchetypeStepScreen.tsx |
| meal-swap | 1 | transition | src/features/nutrition/MealDetailScreen.tsx, src/features/nutrition/MealSwapScreen.tsx |
| focus-ring | 1 | feedback | src/features/workout/FocusSessionScreen.tsx |
| focus-demo | 1 | ambient | src/features/workout/FocusSessionScreen.tsx, src/features/workout/WorkoutDetailScreen.tsx |
| focus-breathe | 2 | ambient | src/features/workout/BreathingGuide.tsx |
| focus-pause | 1 | transition | src/features/workout/FocusSessionScreen.tsx |
| workout-complete | 1 | celebration | src/features/workout/WorkoutResultScreen.tsx |
| streak-flame | 1 | ambient | src/shared/ui/Badges.tsx |
| streak-reset-soft | 2 | transition | src/features/progression/JourneyScreen.tsx |
| purchase-unlock | 1 | reward | src/features/shop/ShopItemScreen.tsx |
| theme-apply | 2 | transition | src/app/MeTheme.tsx |
| nudge-sent | 1 | feedback | src/features/guild/NudgeScreen.tsx |
| rank-roll | 2 | feedback | tĩnh (tier 2) |
| unread-dot | 2 | micro | src/features/dashboard/TodayScreen.tsx, src/features/notifications/InboxScreen.tsx |
| journal-saved | 1 | feedback | src/features/journal/JournalFeedbackScreen.tsx |
| quote-reveal | 2 | transition | src/features/journal/JournalFeedbackScreen.tsx |
| ticket-granted | 1 | reward | src/features/journal/JournalFeedbackScreen.tsx |
| ticket-freeze | 1 | feedback | src/features/journal/TicketsScreen.tsx, src/features/progression/JourneyScreen.tsx |
| level-up | 1 | celebration | src/features/progression/CelebrationHost.tsx, src/shared/ui/OverlayCelebration.tsx |
| streak-milestone | 1 | celebration | src/features/progression/CelebrationHost.tsx, src/shared/ui/OverlayCelebration.tsx |
| mam-evolve | 1 | celebration | src/features/progression/CelebrationHost.tsx, src/shared/ui/OverlayCelebration.tsx |
| stage-path | 2 | transition | src/features/pet/PetStagesScreen.tsx |
<!-- motion-table:end -->

### Lần chạy gần nhất (18/10/2026, Task 29, Windows)

Mọi lệnh dưới đây đã chạy thật và thoát 0:

- `npm run server:test`: 429/429 test (gồm hai test đầu-cuối HTTP).
- `npm run test:e2e` với server dev và kịch bản `fresh`: 1 bộ / 1 test.
- `npx jest --runInBand` ba lần (một lần chạy song song với một tiến trình Jest khác): mỗi lần 85 bộ / 1473 test, không có dòng `console.warn` / `console.error`.
- `npx tsc --noEmit`, `npx tsc --noEmit -p tools/preview`, `npm run lint`.
- `npm run db:verify` (169/169), `npm run db:api-check` (65/65), `npm run db:mutation-check` (2411/2411 và 2546/2546 với lược đồ tương lai).
- `assembleDebug` ra `android/app/build/outputs/apk/debug/app-debug.apk`; APK có đủ năm tệp font của `src/assets/fonts`. Bundle phát hành dựng được, không có chuỗi `react-native-web`, không có từ `vite` đứng riêng (chuỗi con "vite" chỉ nằm trong tên `companionInvite`).
- `node tools/preview/shot.mjs` cho cả 87 mục xem trước đã đăng ký.

## Ma trận kiểm chứng

| Phạm vi | Kiểm tra cần có | Cổng nghiệm thu |
|---|---|---|
| Nền ứng dụng | Render, lint, typecheck, khởi động native | Mở app trên từng nền tảng cam kết |
| Auth/hồ sơ | Hết hạn phiên, sai chủ sở hữu, biên dữ liệu, snapshot | Không đọc/ghi hồ sơ người khác |
| F-02/F-03 | Công thức, clamp, dữ liệu biên, chỉ số dẫn xuất | Kết quả từ test thực thi, không tính nhẩm |
| F-06/F-07 | Retry, tick khác nhau, undo, race, lên cấp | Không cộng trùng hoặc mất thao tác hợp lệ |
| F-08 | Ranh giới ngày, DST, đổi timezone, ngày không log, job lặp | Chuỗi/kỷ lục đúng chính sách đã chốt |
| Offline | Mất mạng, restart, đổi tài khoản, qua ngày đóng | Không mất queue hoặc gửi sang tài khoản khác |
| F-04/F-05 | Hết ứng viên, giới hạn đổi món, tập dở, background | Nhật ký và thời gian tập đúng |
| F-09/F-10 | Tiến hóa, mood, mua đồng thời, không đủ xu | Xu/kho đồ nhất quán trong transaction |
| F-11/F-12 | Thiếu thành viên, vào/rời nhóm, chốt lặp, mute, hạn mức | Không lộ số đo hoặc nhắc ngoài chính sách |
| F-13 | Nhật ký riêng tư, mã hóa, retry, giới hạn vé, cứu chuỗi | Không log nội dung hoặc cấp/thưởng trùng |
| Quyền riêng tư | Xuất JSON, xóa tài khoản/cache, job xóa cứng | Chủ sở hữu kiểm soát dữ liệu |
| Accessibility | TalkBack/VoiceOver, chữ lớn, nhãn, tương phản, giảm chuyển động | Dùng được các luồng chính |
| Hiệu năng | Đo khởi động/dashboard/API, ghi rõ môi trường | Đối chiếu NFR; chốt phép đo mobile thay LCP web |

Áp dụng ngưỡng coverage NFR-09 cho các hàm nghiệp vụ được đặc tả nêu tên ở nơi chúng thực sự chạy, kể cả backend riêng. Coverage client template không đại diện cho nghiệp vụ.

## Quy trình phát hành dự kiến

- Chốt phạm vi, người sở hữu, commit build và môi trường API.
- Chạy lint, typecheck, unit/integration tests; build từng nền tảng trên môi trường hỗ trợ.
- Trên staging dùng dữ liệu giả, chạy onboarding → ghi nhận → chốt ngày → mở lại; kiểm tra mất mạng và phiên hết hạn.
- Thử migration trên bản sao dữ liệu, backup và phục hồi. Chứng minh các job chạy lại an toàn.
- Duyệt nội dung sức khỏe, quyền, thông báo, chính sách dữ liệu, asset và giấy phép.
- Kiểm tra bản ký trên thiết bị thật, ghi lỗi còn biết và cách xử lý. Chỉ phát hành qua tài khoản/kênh được chủ dự án cho phép.
- Theo dõi lỗi, API, job và chỉ số §12 bằng sự kiện không chứa số đo/nhật ký.

## Khi phát hành lỗi

Dừng mở rộng phân phối. Khôi phục server tương thích app đang cài; không trông chờ mọi người cập nhật ngay. Không tự đảo migration phá dữ liệu. Dùng quy trình backup/phục hồi đã thử nghiệm khi cần, đối soát sổ cái và job trước khi mở lại.

Lưu bằng chứng cùng bản phát hành: commit, lệnh/kết quả test, thiết bị, môi trường, migration, smoke test, lỗi mở và người duyệt. Lần tổ chức tài liệu này chưa tạo pipeline hoặc bản release.
