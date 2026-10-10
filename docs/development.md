# Hướng dẫn phát triển

## Môi trường

`package.json` yêu cầu Node `>= 22.11.0`. Dùng npm với `package-lock.json`; `npm ci` cài theo lockfile. Phiên bản React/React Native lấy từ `package.json`; không nâng cấp trong thay đổi thư mục.

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

## Quy ước

- Đọc [phạm vi](product/mobile-scope.md) và [kiến trúc](architecture.md) trước khi thêm feature.
- Dùng lại component/dependency có sẵn; mỗi thay đổi có đầu ra và kiểm tra phù hợp.
- Không commit khóa ký, token hoặc dữ liệu sức khỏe thật. Tạo mẫu cấu hình chỉ chứa tên biến và giá trị không nhạy cảm khi tích hợp backend.
- Cập nhật tài liệu liên quan cùng mã; giữ chú thích mã theo quy ước hiện có.
