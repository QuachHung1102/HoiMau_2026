# Hồi Máu

Ứng dụng theo dõi sức khỏe và thói quen có yếu tố game hóa (React Native, Android trước) với backend riêng Node + PostgreSQL. Vòng lặp cốt lõi của giai đoạn 1 (đăng ký, onboarding, nước, calo, buổi tập, đóng ngày lúc 03:00, chuỗi ngày) đã chạy từ đầu đến cuối trong test, chưa chạy trên thiết bị; xem [Kiểm thử và phát hành](docs/testing-and-release.md#hiện-trạng). “QUEST” là tên tạm trong đặc tả gốc.

## Bắt đầu

```sh
npm ci
npm run server:install
npm run server:dev        # API dev ở http://127.0.0.1:8787/api/v1
npm start                 # terminal khác: Metro
```

Mở terminal khác và chạy `npm run android` (cần thiết bị hoặc emulator). Không có thiết bị thì xem giao diện bằng bản xem trước trên trình duyệt: `npm run preview`. Với iOS và chi tiết môi trường, xem [hướng dẫn phát triển](docs/development.md).

## Tài liệu

- [Mục lục tài liệu](docs/README.md)
- [Đặc tả gốc](docs/product/SPEC-QUEST-001-dac-ta-he-thong.md)
- [Phạm vi mobile và quyết định mở](docs/product/mobile-scope.md)
- [Kiến trúc và quy tắc thư mục](docs/architecture.md)
- [Backend](docs/backend.md)
- [Kiểm thử và phát hành](docs/testing-and-release.md)
- [Thiết kế giao diện](design/hoiMau.pen)

## Cấu trúc hiện tại

```text
src/app/          Điểm gốc ứng dụng: vỏ, điều hướng, sổ đăng ký màn hình
src/features/     Màn hình và hook theo tính năng (auth, onboarding, dashboard, quests, nutrition, workout, progression, sync)
src/shared/       Token, font, chuyển động, thành phần cơ bản, API client, i18n
domain/           Logic nghiệp vụ thuần TypeScript dùng chung cho app và server
server/           Backend Node 24 + PostgreSQL (package riêng): SQL, route, job, kịch bản dev, ba cổng kiểm
__tests__/        Test Jest ở mức ứng dụng; __tests__/e2e/ là bộ đầu-cuối cần server dev
tools/preview/    Bản xem trước trên trình duyệt (react-native-web) và công cụ chụp ảnh
android/, ios/    Dự án native
design/           Tệp thiết kế nguồn
docs/             Tài liệu sản phẩm, kỹ thuật và kế hoạch
index.js          Đăng ký ứng dụng với React Native
```

## Lệnh thường dùng

```sh
npm test -- --runInBand        # Jest của app (không chạm mạng)
npm run domain:test            # logic thuần, ngưỡng phủ 90 %
npm run server:test            # test của server trên PostgreSQL thật, gồm bộ đầu-cuối HTTP
npm run test:e2e               # cây <App /> thật với server dev; cần E2E_BASE_URL (xem Kiểm thử và phát hành)
npm run db:verify              # cổng lược đồ 1; cổng 2 và 3: npm run db:api-check, npm run db:mutation-check
npm --prefix server run scenario -- list   # kịch bản dev và đồng hồ test
```

Kiểm tra trước khi gửi thay đổi:

```sh
npm run lint
npx tsc --noEmit
npx tsc --noEmit -p tools/preview
npm run server:typecheck
npm test -- --runInBand
```
