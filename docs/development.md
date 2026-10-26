# Hướng dẫn phát triển

Muốn xem ứng dụng chạy trên điện thoại: đi thẳng tới [Chạy demo trên Android với server trên máy](#chạy-demo-trên-android-với-server-trên-máy).

## Môi trường

`package.json` yêu cầu Node `>= 24.8` (backend chạy TypeScript trực tiếp bằng Node). Dùng npm với `package-lock.json`; `npm ci` cài theo lockfile. Phiên bản React/React Native lấy từ `package.json`; không nâng cấp trong thay đổi thư mục.

Android cần JDK, Android SDK và emulator hoặc thiết bị. Phiên bản SDK/NDK/Kotlin ở `android/build.gradle`; Gradle wrapper ở `android/gradle/wrapper/gradle-wrapper.properties`. Kiểm tra môi trường theo cấu hình thực tế trước build.

### Android trên Windows

Cài vào `%LOCALAPPDATA%\Android\Sdk` bằng `cmdline-tools\latest\bin\sdkmanager.bat` (cmdline-tools tải từ dl.google.com/android/repository, giải nén vào `cmdline-tools\latest`):

```sh
sdkmanager "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```

- Chấp nhận license: chạy `yes | sdkmanager --licenses` trong Git Bash. PowerShell/cmd không đẩy được "y" vào lệnh này.
- Tạo `android/local.properties` (đã git-ignore): `sdk.dir=C\:\\Users\\<tên>\\AppData\\Local\\Android\\Sdk`. Gradle chỉ cần file này; `ANDROID_HOME` chỉ cần khi gọi `adb`/`sdkmanager` bằng tên, hoặc thêm `platform-tools` vào PATH.
- Build debug: `cd android; .\gradlew.bat assembleDebug --console=plain` (APK ở `android/app/build/outputs/apk/debug/app-debug.apk`). Lần đầu ~6 phút (tải dependency, biên dịch C++ cho 4 ABI); thêm `-PreactNativeArchitectures=x86_64` để build một ABI cho emulator. Phiên bản ứng dụng là `0.1.0` (`package.json` và `versionName` trong `android/app/build.gradle`; một test giữ hai nơi bằng nhau). Bản debug đã dựng từ commit cuối, kèm kích thước và SHA-256, ghi ở [Kiểm thử và phát hành](testing-and-release.md#bản-debug-đã-dựng).
- Sau khi sửa phần native, xóa `android/app/.cxx` trước khi build (xem "Sau khi sửa phần native" trong mục demo bên dưới).
- Bundle JavaScript bản phát hành (kiểm tra Metro dựng được; chưa phải phát hành): `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output <tệp>`.
- Emulator x86_64 cần ảo hóa phần cứng: bật SVM (AMD) / VT-x (Intel) trong BIOS, rồi cài driver (`extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat` với quyền admin) hoặc bật Windows Hypervisor Platform. Kiểm tra: `emulator -accel-check`. Không có ảo hóa thì emulator báo "x86_64 emulation currently requires hardware acceleration" và không chạy được; ảnh arm64 cũng bị từ chối trên máy x86 ("does not support arm64 CPU architecture"). Khi đó dùng thiết bị thật bật USB debugging.
- Chạy emulator: `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Medium_Phone_API_36.1`.

iOS cần macOS với Xcode, Ruby/Bundler và CocoaPods. Môi trường Windows không kiểm chứng được build iOS.

## Ba code base

Repo có ba code base dùng chung một cây thư mục; mỗi code base có công cụ kiểm tra riêng.

| Thư mục | Nội dung | Công cụ kiểm tra |
|---|---|---|
| `src/` | App React Native | Jest (`npm test`), `tsc` gốc, ESLint |
| `domain/` | Logic thuần TypeScript dùng chung cho app và server (không phụ thuộc gói ngoài) | `node --test` (`npm run domain:test`, ngưỡng phủ 90 %), `tsc` gốc, ESLint |
| `server/` | Backend Node 24 + PostgreSQL (có `package.json` riêng) | `node --test` (`npm run server:test`), `tsc` riêng của server, ESLint |

Jest bỏ qua `server/`, `domain/`, `tools/`, `design/`, `android/`, `ios/` và `__tests__/e2e/` (bộ đầu-cuối chạy bằng `npm run test:e2e`); `tsc` gốc bỏ qua `server/`, `tools/`, `design/` và các tệp `domain/**/*.test.ts`. `npm run lint` kiểm tra `src/`, `domain/`, `server/`, `__tests__/`, `tools/` và các tệp cấu hình `*.js` ở gốc repo.

Mọi lệnh gốc của repo (`package.json`):

```sh
npm start                    # Metro
npm run android              # build, cài và mở app debug trên thiết bị (cần Metro đang chạy)
npm run ios                  # chỉ trên macOS; chưa từng được build
npm test                     # Jest của app (cổng nghiệm thu dùng npm test -- --runInBand)
npm run test:e2e             # cây <App /> thật với server dev; cần E2E_BASE_URL (xem "Bộ đầu-cuối qua app" bên dưới)
npm run lint                 # ESLint: src, domain, server, __tests__, tools, *.js ở gốc
npm run preview              # bản xem trước trên trình duyệt (xem mục dưới)
npm run preview:shot -- <tên> [out.png]   # chụp một mục xem trước
npm run domain:test          # test và ngưỡng phủ 90 % của domain/
npm run domain:bundle-check  # bundle domain/ bằng Metro (scripts/domain-bundle-entry.js)
npm run demo:reverse         # adb reverse tcp:8787 và tcp:8081 cho demo trên điện thoại
npm run server:install       # cài dependency của server/ (npm ci)
npm run server:typecheck     # tsc của server/
npm run server:test          # test của server/ trên PostgreSQL thật
npm run server:dev           # chạy API dev (cổng 8787) trên cơ sở dữ liệu dev
npm run server:perf          # kiểm tra hiệu năng
npm run db:verify            # cổng 1: kiểm lược đồ SQL
npm run db:api-check         # cổng 2: tấn công qua API bằng vai trò app thật
npm run db:mutation-check    # cổng 3: kiểm chứng bằng đột biến
npm run db:cleanup           # dọn tiến trình PostgreSQL mồ côi của dự án
npm run content:count        # đếm nội dung seed
```

Lệnh của riêng `server/` (chạy bằng `npm --prefix server run <tên>`): `scenario` (kịch bản dev và đồng hồ test, xem [backend](backend.md#kịch-bản-phát-triển-và-dịch-chuyển-thời-gian-scriptsscenariots-scriptsscenariosts)) và `jobs` (chạy một job một lần trên cơ sở dữ liệu dev, ví dụ `npm --prefix server run jobs -- day-close`). Các lệnh `typecheck`, `test`, `db:*`, `perf` và `dev` của `server/` chính là những lệnh gốc cùng tên ở trên.

### PostgreSQL và cổng mạng

- **Không bao giờ kết nối dịch vụ PostgreSQL hệ thống / cổng 5432.** Máy phát triển có dịch vụ `postgresql-x64-18` riêng; dự án không có thông tin đăng nhập của nó và không được dừng, cấu hình lại hay chạm vào nó.
- Cơ sở dữ liệu dự án là PostgreSQL thật chạy qua gói `embedded-postgres`: cổng **54329** cho test, cổng **54330** cho dev. API dev dùng cổng 8787 (chỉ nghe `127.0.0.1`), Metro dùng 8081. Test và các lệnh `db:*` dùng chung một cụm test nên mỗi lúc chỉ chạy một lệnh (xem [backend](backend.md#một-cụm-test-mỗi-lúc-một-lượt-chạy)).
- Thư mục dữ liệu (`server/.pgdata/`, `server/.pgdata-dev/`) phải có đường dẫn chỉ gồm ký tự ASCII và đã được Git bỏ qua, cùng `server/.outbox/` và `server/.env`.
- Nếu một lần chạy bị buộc dừng, tiến trình PostgreSQL có thể bị bỏ lại và lần khởi động sau lỗi: chạy `npm run db:cleanup`. Chỉ chạy lệnh này khi không còn lượt test hay `server:dev` nào đang diễn ra (nó không phân biệt cụm bị bỏ lại với cụm đang dùng). Dừng `server:dev` bình thường bằng Ctrl+C.

### Không có thiết bị Android

Máy phát triển không có thiết bị thật và emulator không chạy được (chưa bật ảo hóa phần cứng trong BIOS). Vì vậy giao diện được kiểm bằng Jest (render và tương tác), `tsc`, ESLint và ảnh chụp từ bộ xem trước trình duyệt; build native (`gradlew.bat assembleDebug`) và bundle Metro chỉ chạy ở các mốc kiểm tra. Không tuyên bố hành vi trên thiết bị khi chưa chạy trên thiết bị; các mục cần kiểm tra trên máy thật được gom thành một danh sách để chạy khi có thiết bị (`docs/kiem-thu-tren-thiet-bi.md`, sẽ có). Lý do và phạm vi: [quyết định 0002](decisions/0002-kiem-chung-khong-co-thiet-bi.md).

## Cài đặt và chạy

Tại gốc repo:

```sh
npm ci
npm start
```

Trong terminal riêng:

```sh
npm run android
```

Trên macOS:

```sh
bundle install
cd ios
bundle exec pod install
cd ..
npm run ios
```

Thêm màn hình bằng cách đăng ký trong `src/app/screens.tsx` (xem [kiến trúc](architecture.md#vỏ-ứng-dụng)). Khi thêm dependency native, đọc yêu cầu cài đặt của dependency và build lại app.

### Chạy app với API dev

App chỉ có một địa chỉ API: `API_BASE_URL = 'http://localhost:8787/api/v1'` trong `src/shared/api/config.ts` (HTTP thường: bản debug cho phép, bản phát hành thì không, xem [Kiểm thử và phát hành](testing-and-release.md#quy-trình-phát-hành-chưa-chạy)). Trên thiết bị hoặc emulator Android, `localhost` là chính thiết bị đó, nên phải chuyển cổng về máy phát triển bằng `adb reverse`. Các bước đầy đủ, theo thứ tự, ở mục tiếp theo. Quy trình này chưa được chạy trên máy hiện tại vì không có thiết bị (xem mục "Không có thiết bị Android").

### Chạy demo trên Android với server trên máy

App luôn nói chuyện với server thật ở `localhost:8787` (không có chế độ giả lập trong app), nên demo cần: server chạy trên máy này, dữ liệu mẫu trong đó, và thiết bị Android nhìn thấy cổng 8787 qua `adb reverse`.

**Điều kiện**

- Một thiết bị: emulator (cần bật ảo hóa phần cứng, xem "Android trên Windows") hoặc điện thoại Android cắm USB, đã bật Tùy chọn nhà phát triển, Gỡ lỗi USB và chấp nhận hộp thoại cho máy tính này. APK debug có đủ 4 ABI, arm64 chạy được. Kiểm tra: `adb devices` phải liệt kê thiết bị ở trạng thái `device`.
- `adb` trong PATH. Trong PowerShell, cho phiên hiện tại: `$env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"` (thêm `;$env:LOCALAPPDATA\Android\Sdk\emulator` để gọi `emulator`). Riêng `npm run demo:reverse` tự tìm `adb` trong `ANDROID_HOME`, `ANDROID_SDK_ROOT` hoặc `%LOCALAPPDATA%\Android\Sdk\platform-tools` khi PATH chưa có.
- Đã build APK debug (`cd android; .\gradlew.bat assembleDebug`) hoặc để `npm run android` build.

**Các bước** (mỗi lệnh chạy lâu để một terminal riêng)

1. Server: `npm run server:dev`. Đợi dòng `API ready: http://127.0.0.1:8787/api/v1` (lần đầu khoảng 40 giây). Kiểm tra: `curl http://127.0.0.1:8787/api/v1/healthz` trả 200 `{"ok":true,"db":true,...}`. Server chỉ nghe `127.0.0.1`, nên điện thoại không vào được bằng IP mạng LAN hay `10.0.2.2`; chỉ `adb reverse` mới tới được.
2. Dữ liệu mẫu (server phải đang chạy): `npm --prefix server run scenario -- list` để xem danh sách, rồi `npm --prefix server run scenario -- <tên>`. Tài khoản `demo-<tên>@hoimau.test`, mật khẩu `matkhau123`, tên hiển thị "An". Những kịch bản cho thấy nhiều nhất:

   | Tên | Cho thấy |
   | --- | --- |
   | `guild4` | tổ đội "Tổ Bốn Mùa" bốn người, hoạt động tuần này (đăng nhập `demo-guild4@hoimau.test`) |
   | `streak6` | chuỗi 6 ngày, 20:00 hôm nay; hoàn thành nhiệm vụ chính là gần mốc 7 ngày |
   | `rich` | cấp 8, 500 xu, cửa hàng và đặc quyền |
   | `ticket` | chuỗi 5 vừa đứt hôm qua, có 1 vé đóng băng để cứu chuỗi |

   Ngày trong dữ liệu mẫu bám theo ngày thật của máy (kịch bản kết thúc vào "hôm nay" theo giờ Việt Nam), nên không cần chỉnh ngày giờ điện thoại; để điện thoại ở giờ tự động. Mọi kịch bản dùng chung một đồng hồ test đang đứng yên ở giờ lệnh in ra (dòng `clock:`), và chạy kịch bản khác sẽ đổi nó: **chạy kịch bản muốn trình diễn sau cùng**. `npm --prefix server run scenario -- clock off` trả đồng hồ về giờ thật (dữ liệu giữ nguyên). Muốn đóng ngày để thấy mốc 7 ngày: xem "Kịch bản phát triển và dịch chuyển thời gian" trong [backend](backend.md). Lệnh từ chối chạy nếu cơ sở dữ liệu dev có tài khoản thật đã onboarding (thêm `--include-real-users` nếu chấp nhận).
3. Chuyển cổng: `npm run demo:reverse` (chạy `adb reverse tcp:8787 tcp:8787` và `tcp:8081`, rồi in danh sách). Làm lại sau mỗi lần cắm lại thiết bị hoặc khởi động lại emulator.
4. Metro: `npm start`. Rồi, ở terminal khác, `npm run android` (cài và mở app debug). Hoặc cài APK đã build: `adb install -r android\app\build\outputs\apk\debug\app-debug.apk` rồi mở app. APK debug không chứa JavaScript mà lấy từ Metro, nên Metro phải đang chạy và bước 3 đã làm.
5. Đăng nhập bằng tài khoản ở bước 2.

**Sau khi sửa phần native** (thêm hoặc đổi module native, `codegenConfig`, dependency native trong `package.json`): xóa `android/app/.cxx` rồi build lại (`Remove-Item -Recurse -Force android\app\.cxx; cd android; .\gradlew.bat assembleDebug`), nếu không APK có thể giữ mã sinh ra cũ (thiếu `HoiMauNative`). Không cần xóa khi chỉ đổi JavaScript.

**Lỗi ở lần chạy đầu**: `adb logcat "*:E" ReactNativeJS` (lỗi hệ thống và nhật ký JavaScript). App báo không kết nối được mạng: `adb reverse --list` phải có `tcp:8787`, và `healthz` ở bước 1 phải trả 200. Màn hình đỏ hoặc trắng: xem logcat, rồi `npm start -- --reset-cache`.

**Dừng**: Ctrl+C ở terminal của `server:dev` và của Metro, `npm --prefix server run scenario -- clock off`, `adb reverse --remove-all`.

Các bước 1 và 2 đã được chạy thật trên máy phát triển ngày 22/10/2026 (server lên, `healthz` 200, kịch bản `streak6` rồi đăng nhập và `GET /day` trả đúng ngày hôm nay). Các bước 3 đến 5 chưa được chạy vì máy không có thiết bị.

### Bộ đầu-cuối qua app

Cây `<App />` thật chạy trong Jest và nói chuyện với server dev thật (không `fetch` giả); không cần thiết bị. Ba lệnh, hai đầu tiên ở terminal riêng:

```sh
npm run server:dev                                   # terminal 1: API dev
npm --prefix server run scenario -- fresh            # terminal 2: dựng tài khoản `fresh`
E2E_BASE_URL=http://127.0.0.1:8787/api/v1 npm run test:e2e
```

PowerShell: `$env:E2E_BASE_URL='http://127.0.0.1:8787/api/v1'; npm run test:e2e`. Không đặt `E2E_BASE_URL` thì bộ test tự bỏ qua; `npm test` không bao giờ chạy nó. Bộ test dời đồng hồ test của cơ sở dữ liệu dev rồi trả về giờ thật, nên chạy xong thì dừng `server:dev`. Mô tả đầy đủ ở [Kiểm thử và phát hành](testing-and-release.md#chạy-bộ-đầu-cuối-qua-app).

## Kiểm tra thay đổi

```sh
npm run lint
npx tsc --noEmit
npx tsc --noEmit -p tools/preview     # bản xem trước (tsc gốc bỏ qua tools/)
npm run server:typecheck
npm test -- --runInBand
npm run domain:test
npm run server:test                   # khi đổi server/, domain/ hoặc hợp đồng API
git diff --check
```

PowerShell có thể dùng `npm.cmd`, `npx.cmd` nếu execution policy chặn `.ps1`. Khi Metro giữ cache cũ, dừng và chạy `npm start -- --reset-cache`. Khi thiết bị không kết nối, kiểm tra `adb devices`. Jest pass không chứng minh build native thành công.

Jest: module native cần mock trong `jest.setup.js` (AsyncStorage dùng mock chính thức `@react-native-async-storage/async-storage/jest`, Keychain mock tay, safe-area dùng `react-native-safe-area-context/jest/mock`). `jest.config.js` mở rộng `transformIgnorePatterns` cho gói chỉ phát hành ESM (`@react-navigation`, async-storage, `lucide-react-native`) và transform `.mjs`. Test render nhớ `unmount()`, nếu không Jest treo vì timer của navigation.

AsyncStorage 3.x: `import AsyncStorage from '@react-native-async-storage/async-storage'` vẫn dùng `getItem`/`setItem`; có thêm `createAsyncStorage(tên)`. Build in ra cảnh báo "ksp-2.2.0-2.0.2 is too old for kotlin-2.2.10" từ AsyncStorage; build vẫn thành công.

## Xem trước màn hình trên trình duyệt (chỉ để dev)

Máy không có emulator, nên có harness render component React Native trong Chromium bằng `react-native-web` (Vite) để xem layout, nội dung, state. Đây là công cụ QA cục bộ: không vào bundle app và `src/` không import nó. Không chứng minh hành vi native: safe-area inset luôn 0, font hệ thống thay cho font bundle, `react-native-keychain` là stub trong bộ nhớ, đổ bóng/ripple/đo chữ khác Android.

```sh
npm run preview                           # dev server; mở ?screen=<tên>, thiếu tên thì liệt kê các màn hình
npm run preview:shot -- <tên> [out.png]   # PNG 390x844 @2x, mặc định node_modules/.cache/hoi-mau/preview/<tên>.png
```

Thêm màn hình: mỗi tính năng có một tệp `tools/preview/entries/<tính năng>.tsx` xuất `entries` (`'tên': () => withApp(...)`); `registry.tsx` tự gom các tệp đó nên không cần sửa. `withApp(node, tùy chọn)` trong `tools/preview/harness.tsx` bọc các provider của app và nhận:

- `theme`, `motion`: bảng màu và chế độ chuyển động.
- `queries`: dữ liệu mẫu nạp sẵn vào cache truy vấn.
- `fetchStub`: trả lời thay cho mạng; không có thì mọi yêu cầu mạng đều lỗi.
- `session`: `{ userId }` là đã đăng nhập (token giả nằm trong keychain stub), `null` hoặc bỏ trống là chưa đăng nhập.
- `route`: `{ name, params }` mở điều hướng thật của app tại route đó (có thanh tab và cổng phiên); khi đó `node` có thể là `null`. Route chỉ hiện khi `session` và dữ liệu `['me']` nạp sẵn khớp với nhóm của nó.

Tệp trong `entries/` phải import được dưới Jest: không tạo `QueryClient`, timer hay `NavigationContainer` ở cấp module. Ví dụ với các màn của vỏ ứng dụng:

```sh
npm run preview:shot -- s01-welcome   # màn Chào mừng
npm run preview:shot -- s39-loading   # đang tải khi mở app
npm run preview:shot -- s39-error     # lỗi tải khi mở app
```

Ảnh chụp dùng Chromium trong cache Playwright (`%LOCALAPPDATA%\ms-playwright`), hoặc `PREVIEW_BROWSER=<đường dẫn exe>`, hoặc Chrome/Edge cài sẵn. Typecheck riêng cho harness: `npx tsc -p tools/preview`.

## Quy ước

- Đọc [phạm vi](product/mobile-scope.md) và [kiến trúc](architecture.md) trước khi thêm feature.
- Dùng lại component/dependency có sẵn; mỗi thay đổi có đầu ra và kiểm tra phù hợp.
- Không commit khóa ký, token hoặc dữ liệu sức khỏe thật. Tạo mẫu cấu hình chỉ chứa tên biến và giá trị không nhạy cảm khi tích hợp backend.
- Cập nhật tài liệu liên quan cùng mã; giữ chú thích mã theo quy ước hiện có.
