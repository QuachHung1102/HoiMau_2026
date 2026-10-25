# Hồi Máu

Ứng dụng theo dõi sức khỏe và thói quen có yếu tố game hóa (React Native, Android trước) với backend riêng Node + PostgreSQL. Phiên bản `0.1.0`. Toàn bộ vòng lặp của đặc tả (đăng ký, onboarding, nước, calo, buổi tập, đóng ngày lúc 03:00, chuỗi ngày, Mầm, cửa hàng, tổ đội, nhật ký, quyền riêng tư) đã được dựng và kiểm chứng trong test, trên server thật; **ứng dụng chưa chạy trên bất kỳ thiết bị hay emulator nào**, vì máy phát triển chưa có cái nào. Xem [Kiểm thử và phát hành](docs/testing-and-release.md#hiện-trạng). “QUEST” là tên tạm trong đặc tả gốc.

## Chạy demo trên điện thoại Android

Đây là việc đầu tiên nên đọc nếu bạn muốn xem ứng dụng chạy: [Chạy demo trên Android với server trên máy](docs/development.md#chạy-demo-trên-android-với-server-trên-máy). Tóm tắt: server dev chạy trên PC này, điện thoại cắm USB, `npm run demo:reverse` chuyển cổng 8787 (API) và 8081 (Metro) từ điện thoại về PC, rồi mở app và đăng nhập bằng tài khoản của kịch bản mẫu. Các bước đó chưa được chạy trên thiết bị nào; bản hướng dẫn nói rõ bước nào đã chạy thật.

## Bắt đầu phát triển

```sh
npm ci
npm run server:install
npm run server:dev        # API dev ở http://127.0.0.1:8787/api/v1
npm start                 # terminal khác: Metro
```

Mở terminal khác và chạy `npm run android` (cần thiết bị hoặc emulator). Không có thiết bị thì xem giao diện bằng bản xem trước trên trình duyệt: `npm run preview`. Với iOS và chi tiết môi trường, xem [hướng dẫn phát triển](docs/development.md). Cần Node `>= 24.8`.

## Tài liệu

Mục lục đầy đủ, kèm quy tắc duy trì, ở [docs/README.md](docs/README.md). Những tài liệu chính:

- [Hướng dẫn phát triển và chạy demo](docs/development.md)
- [Kiến trúc và bản đồ module](docs/architecture.md)
- [Backend](docs/backend.md) và [hợp đồng API (OpenAPI)](docs/api/openapi.yaml)
- [Kiểm thử và phát hành](docs/testing-and-release.md): ma trận kiểm chứng, danh mục kiểm tra phát hành, bản debug đã dựng
- [Quyết định kiến trúc](docs/decisions/0001-nen-tang-va-backend.md) và [vì sao nghiệm thu không cần thiết bị](docs/decisions/0002-kiem-chung-khong-co-thiet-bi.md)
- [Phạm vi mobile và sổ quyết định](docs/product/mobile-scope.md)
- [Đặc tả gốc](docs/product/SPEC-QUEST-001-dac-ta-he-thong.md)
- [Thiết kế giao diện](design/hoiMau.pen)
- Danh sách kiểm tra trên thiết bị: sẽ có (`docs/kiem-thu-tren-thiet-bi.md`, chạy khi có thiết bị)

## Cấu trúc hiện tại

```text
src/app/          Điểm gốc ứng dụng: vỏ, điều hướng, sổ đăng ký màn hình
src/features/     Màn hình và hook theo tính năng (auth, onboarding, dashboard, quests, nutrition, workout, progression, pet, shop, guild, notifications, journal, settings, sync)
src/shared/       Token, font, chuyển động, thành phần cơ bản, API client, kho lưu cục bộ, mô-đun native, i18n
src/assets/       Font, ảnh món ăn, ảnh nhật ký, dữ liệu và ảnh tư thế động tác mẫu
domain/           Logic nghiệp vụ thuần TypeScript dùng chung cho app và server; domain/contract/ là kiểu của hợp đồng API
server/           Backend Node 24 + PostgreSQL (package riêng): sql/, src/ (route, job, read model), content/, scripts/ (dev, kịch bản), checks/ (ba cổng, hiệu năng), test/
__tests__/        Test Jest ở mức ứng dụng (gồm hai bộ quét trợ năng và chuyển động); __tests__/e2e/ là bộ đầu-cuối cần server dev
tools/preview/    Bản xem trước trên trình duyệt (react-native-web) và công cụ chụp ảnh
scripts/          Lệnh gốc: demo:reverse, bundle domain, trích xuất động tác mẫu
android/, ios/    Dự án native (Android được build; iOS chưa)
design/           Tệp thiết kế nguồn, ảnh xuất, hoạt ảnh
docs/             Tài liệu sản phẩm, kỹ thuật và hợp đồng API
index.js          Đăng ký ứng dụng với React Native
```

## Lệnh thường dùng

```sh
npm test -- --runInBand        # Jest của app (không chạm mạng)
npm run domain:test            # logic thuần, ngưỡng phủ 90 %
npm run server:test            # test của server trên PostgreSQL thật, gồm bộ đầu-cuối HTTP
npm run test:e2e               # cây <App /> thật với server dev; cần E2E_BASE_URL (xem Kiểm thử và phát hành)
npm run db:verify              # cổng lược đồ 1; cổng 2 và 3: npm run db:api-check, npm run db:mutation-check
npm run server:perf            # hiệu năng của server
npm run demo:reverse           # adb reverse cho demo trên điện thoại
npm --prefix server run scenario -- list   # kịch bản dev và đồng hồ test
```

Kiểm tra trước khi gửi thay đổi:

```sh
npm run lint
npx tsc --noEmit
npx tsc --noEmit -p tools/preview
npm run server:typecheck
npm test -- --runInBand
npm run domain:test
npm run server:test
git diff --check
```

Danh sách lệnh đầy đủ và cổng mạng ở [hướng dẫn phát triển](docs/development.md).
