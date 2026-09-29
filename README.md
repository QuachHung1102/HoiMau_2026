# Hồi Máu

Ứng dụng theo dõi sức khỏe và thói quen có yếu tố game hóa. Mã hiện tại là React Native template; nghiệp vụ trong đặc tả chưa được triển khai. “QUEST” là tên tạm trong đặc tả gốc.

## Bắt đầu

```sh
npm ci
npm start
```

Mở terminal khác và chạy `npm run android`. Với iOS, xem [hướng dẫn phát triển](docs/development.md) để chuẩn bị môi trường macOS.

## Tài liệu

- [Mục lục tài liệu](docs/README.md)
- [Đặc tả gốc](docs/product/SPEC-QUEST-001-dac-ta-he-thong.md)
- [Phạm vi mobile và quyết định mở](docs/product/mobile-scope.md)
- [Kiến trúc và quy tắc thư mục](docs/architecture.md)
- [Kiểm thử và phát hành](docs/testing-and-release.md)
- [Kế hoạch triển khai](docs/superpowers/plans/2026-09-10-project-implementation.md)
- [Thiết kế giao diện](design/hoiMau.pen)

## Cấu trúc hiện tại

```text
src/app/       Điểm gốc React của ứng dụng
__tests__/     Kiểm thử tích hợp ứng dụng
android/       Dự án native Android
ios/           Dự án native iOS
design/        Tệp thiết kế nguồn
docs/          Tài liệu sản phẩm, kỹ thuật và kế hoạch
index.js       Đăng ký ứng dụng với React Native
```

Kiểm tra trước khi gửi thay đổi:

```sh
npm run lint
npx tsc --noEmit
npm test -- --runInBand
```
