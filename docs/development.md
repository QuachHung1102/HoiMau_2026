# Hướng dẫn phát triển

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
- Build debug: `cd android; .\gradlew.bat assembleDebug` (APK ở `android/app/build/outputs/apk/debug/app-debug.apk`). Lần đầu ~6 phút (tải dependency, biên dịch C++ cho 4 ABI); thêm `-PreactNativeArchitectures=x86_64` để build một ABI cho emulator.
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

Jest bỏ qua `server/`, `domain/`, `tools/`, `design/`, `android/`, `ios/`; `tsc` gốc bỏ qua `server/`, `tools/`, `design/` và các tệp `domain/**/*.test.ts`. `npm run lint` kiểm tra `src/`, `domain/`, `server/`, `__tests__/`, `tools/`.

Lệnh gốc của repo:

```sh
npm run domain:test          # test và ngưỡng phủ của domain/
npm run domain:bundle-check  # bundle domain/ bằng Metro (cần scripts/domain-bundle-entry.js)
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

Các lệnh `server:*`, `db:*`, `content:count` và `domain:*` chỉ chạy được khi `server/`, `domain/` và `scripts/domain-bundle-entry.js` đã có trong repo.

### PostgreSQL và cổng mạng

- **Không bao giờ kết nối dịch vụ PostgreSQL hệ thống / cổng 5432.** Máy phát triển có dịch vụ `postgresql-x64-18` riêng; dự án không có thông tin đăng nhập của nó và không được dừng, cấu hình lại hay chạm vào nó.
- Cơ sở dữ liệu dự án là PostgreSQL thật chạy qua gói `embedded-postgres`: cổng **54329** cho test, cổng **54330** cho dev. API dev dùng cổng 8787.
- Thư mục dữ liệu (`server/.pgdata/`, `server/.pgdata-dev/`) phải có đường dẫn chỉ gồm ký tự ASCII và đã được Git bỏ qua, cùng `server/.outbox/` và `server/.env`.
- Nếu một lần chạy bị buộc dừng, tiến trình PostgreSQL có thể bị bỏ lại và lần khởi động sau lỗi: chạy `npm run db:cleanup`.

### Không có thiết bị Android

Máy phát triển không có thiết bị thật và emulator không chạy được (chưa bật ảo hóa phần cứng trong BIOS). Vì vậy giao diện được kiểm bằng Jest (render và tương tác), `tsc`, ESLint và ảnh chụp từ bộ xem trước trình duyệt; build native (`gradlew.bat assembleDebug`) và bundle Metro chỉ chạy ở các mốc kiểm tra. Không tuyên bố hành vi trên thiết bị khi chưa chạy trên thiết bị; các mục cần kiểm tra trên máy thật được gom thành một danh sách để chạy khi có thiết bị.

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

Sửa `src/app/App.tsx` để thay đổi màn hình hiện tại. Khi thêm dependency native, đọc yêu cầu cài đặt của dependency và build lại app.

## Kiểm tra thay đổi

```sh
npm run lint
npx tsc --noEmit
npm test -- --runInBand
git diff --check
```

PowerShell có thể dùng `npm.cmd`, `npx.cmd` nếu execution policy chặn `.ps1`. Khi Metro giữ cache cũ, dừng và chạy `npm start -- --reset-cache`. Khi thiết bị không kết nối, kiểm tra `adb devices`. Jest pass không chứng minh build native thành công.

Jest: module native cần mock trong `jest.setup.js` (AsyncStorage dùng mock chính thức `@react-native-async-storage/async-storage/jest`, Keychain mock tay, safe-area dùng `react-native-safe-area-context/jest/mock`). `jest.config.js` mở rộng `transformIgnorePatterns` cho gói chỉ phát hành ESM (`@react-navigation`, async-storage, `lucide-react-native`) và transform `.mjs`. Test render nhớ `unmount()`, nếu không Jest treo vì timer của navigation.

AsyncStorage 3.x: `import AsyncStorage from '@react-native-async-storage/async-storage'` vẫn dùng `getItem`/`setItem`; có thêm `createAsyncStorage(tên)`. Build in ra cảnh báo "ksp-2.2.0-2.0.2 is too old for kotlin-2.2.10" từ AsyncStorage; build vẫn thành công.

## Xem trước màn hình trên trình duyệt (chỉ để dev)

Máy không có emulator, nên có harness render component React Native trong Chromium bằng `react-native-web` (Vite) để xem layout, nội dung, state. Đây là công cụ QA cục bộ: không vào bundle app, không import từ `src/`. Không chứng minh hành vi native: safe-area inset luôn 0, font hệ thống thay cho font bundle, `react-native-keychain` là stub trong bộ nhớ, đổ bóng/ripple/đo chữ khác Android.

```sh
npm run preview                           # dev server; mở ?screen=<tên>, thiếu tên thì liệt kê các màn hình
npm run preview:shot -- <tên> [out.png]   # PNG 390x844 @2x, mặc định .superpowers/preview/<tên>.png
```

Thêm màn hình: một dòng trong `tools/preview/registry.tsx` (`'tên': () => <Component />`, bọc provider và fixture trong hàm đó). Ảnh chụp dùng Chromium trong cache Playwright (`%LOCALAPPDATA%\ms-playwright`), hoặc `PREVIEW_BROWSER=<đường dẫn exe>`, hoặc Chrome/Edge cài sẵn. Typecheck riêng cho harness: `npx tsc -p tools/preview`.

## Quy ước

- Đọc [phạm vi](product/mobile-scope.md) và [kiến trúc](architecture.md) trước khi thêm feature.
- Dùng lại component/dependency có sẵn; mỗi thay đổi có đầu ra và kiểm tra phù hợp.
- Không commit khóa ký, token hoặc dữ liệu sức khỏe thật. Tạo mẫu cấu hình chỉ chứa tên biến và giá trị không nhạy cảm khi tích hợp backend.
- Cập nhật tài liệu liên quan cùng mã; giữ chú thích mã theo quy ước hiện có.
