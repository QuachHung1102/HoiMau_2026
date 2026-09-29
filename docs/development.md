# Hướng dẫn phát triển

## Môi trường

`package.json` yêu cầu Node `>= 22.11.0`. Dùng npm với `package-lock.json`; `npm ci` cài theo lockfile. Phiên bản React/React Native lấy từ `package.json`; không nâng cấp trong thay đổi thư mục.

Android cần JDK, Android SDK và emulator hoặc thiết bị. Phiên bản SDK/NDK/Kotlin ở `android/build.gradle`; Gradle wrapper ở `android/gradle/wrapper/gradle-wrapper.properties`. Kiểm tra môi trường theo cấu hình thực tế trước build.

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

## Quy ước

- Đọc [phạm vi](product/mobile-scope.md) và [kiến trúc](architecture.md) trước khi thêm feature.
- Dùng lại component/dependency có sẵn; mỗi thay đổi có đầu ra và kiểm tra phù hợp.
- Không commit khóa ký, token hoặc dữ liệu sức khỏe thật. Tạo mẫu cấu hình chỉ chứa tên biến và giá trị không nhạy cảm khi tích hợp backend.
- Cập nhật tài liệu liên quan cùng mã; giữ chú thích mã theo quy ước hiện có.
