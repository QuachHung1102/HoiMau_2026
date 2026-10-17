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
| Đầu-cuối HTTP | trong `npm run server:test` (`server/test/e2e/slice1.test.ts`) | Đăng ký → onboarding → ba ngày logic liên tiếp ở `Asia/Ho_Chi_Minh` (tám lần tick nước, calo trong dải, buổi tập ≥ 50 %, một lượt ghi lúc 23:50 và một lúc 00:30 giờ địa phương), `day-close` ngay sau mỗi 03:00: chuỗi 1, 2, 3, kỷ lục 3, tổng XP và xu bằng tổng phần thưởng của nhiệm vụ, thú `HAPPY`. Gửi lại mọi lượt ghi với đúng `Idempotency-Key` cũ và chạy `day-close` thêm hai lần: sổ cái không đổi một dòng, dòng mồi nhử không đổi. Cùng luồng cho `America/New_York` qua 08/03/2026 (bắt đầu giờ mùa hè) vẫn ra chuỗi 3. | App; mạng thật giữa máy và điện thoại. |
| Đầu-cuối qua app | `npm run test:e2e` (cần server dev, xem dưới) | Cây `<App />` thật, không `fetch` giả: Chào mừng → đăng nhập bằng tài khoản kịch bản `fresh` → bốn bước onboarding → Hôm nay → một lần tick nước được server xác nhận ("1 / 8 phần") → bảng nhiệm vụ → ghi calo → thư viện bài tập → chi tiết → buổi tập kết thúc qua hộp thoại khi đồng hồ đã qua 50 % → kết quả hoàn thành → hai việc chính trên Hôm nay đã xong; rồi dời đồng hồ server qua 03:00, chạy `day-close`, app làm mới và thấy chuỗi 1 (chỉ số và màn hành trình). | Keychain, AsyncStorage, chạm, vẽ và chuyển động thật (vẫn là mock và môi trường Jest; chuyển động ở trạng thái tĩnh); `adb reverse`; hai đồng hồ lệch nhau. |
| Ba cổng lược đồ | `npm run db:verify`, `npm run db:api-check`, `npm run db:mutation-check` | Catalog đúng thiết kế (vai trò, quyền, RLS, policy, hàm); một request thật không đọc hay ghi được dữ liệu người khác; cổng 1 biết báo lỗi khi từng hàng rào bị phá (xem [backend](backend.md#ba-cổng-kiểm)). | Thân hàm và code Node (phần đó do test của server giữ). |
| Bản xem trước | `npm run preview`, `node tools/preview/shot.mjs <tên>` | Bố cục, nội dung và từng trạng thái thiết kế của mỗi màn hình, render bằng react-native-web trong Chromium. | Hành vi native: vùng an toàn, font đóng gói, đo chữ, đổ bóng. |
| Build native | `cd android; .\gradlew.bat assembleDebug --console=plain` và `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output <tệp>` | Dự án Android biên dịch ra APK debug; bundle Metro bản phát hành dựng được, không chứa `react-native-web` hay `vite`; font nằm trong APK. | APK chạy được trên máy. |
| Kiểu và lint | `npm run lint`, `npx tsc --noEmit`, `npx tsc -p tools/preview`, `npm run server:typecheck` | Kiểu của app, `domain/`, bản xem trước và server; ESLint trên `src/`, `domain/`, `server/`, `__tests__/`, `tools/` và các tệp cấu hình JS ở gốc repo. | Hành vi. |

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
