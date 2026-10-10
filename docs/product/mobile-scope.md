# Phạm vi mobile và sổ quyết định

## Cơ sở lập kế hoạch

Repo dùng React Native. [Đặc tả gốc](SPEC-QUEST-001-dac-ta-he-thong.md) định vị sản phẩm web và loại native khỏi phạm vi; phần chuyển sang mobile được chốt tại [Sổ quyết định](#sổ-quyết-định) bên dưới.

Giữ các nhóm tính năng trong đặc tả. Bản nội bộ đầu tiên tập trung onboarding → mục tiêu → ghi nhận → XP → chuỗi. Dinh dưỡng và tập luyện tối thiểu cần có ngay để hoàn thành nhiệm vụ STORY; thư viện phong phú và Focus Mode hoàn thiện sau.

## Điều chỉnh nền tảng

| Đặc tả web | Hướng mobile | Nghiệm thu |
|---|---|---|
| Next.js client, CSS | React Native và StyleSheet hiện có | Chạy trên nền tảng được cam kết |
| IndexedDB | Kho bền vững tương thích React Native, chọn khi xây offline | Không mất thao tác khi restart |
| Web Push/VAPID | Chỉ hộp thư trong app, không push từ xa (D-03) | Từ chối quyền vẫn có thông báo trong app |
| Tab visibility | Vòng đời foreground/background | Hẹn giờ không tăng sai khi quay lại |
| Wake Lock, Escape, ARIA | Giữ màn hình nếu hỗ trợ, Back/Thoát và accessibility native | Thoát có xác nhận, trình đọc màn hình dùng được |
| prefers-reduced-motion | Tùy chọn giảm chuyển động của hệ điều hành | Tắt hiệu ứng không mất nội dung |
| Session web/Auth.js | Phiên mobile: token ngẫu nhiên lưu băm phía server, token trên máy giữ trong keychain; không OAuth (D-02) | Kiểm chứng hết hạn, thu hồi, đăng xuất |

Đây là yêu cầu chuyển đổi, chưa phải lựa chọn thư viện (ngoại trừ phần xác thực đã chốt ở D-02 và D-03: email + mật khẩu, không OAuth, không push từ xa). Kiểm tra tài liệu chính thức và tương thích dependency khi thực hiện từng tích hợp.

## Sổ quyết định

Ngày 2026-10-11, chủ dự án ủy quyền toàn quyền cho nhóm triển khai chốt D-01…D-10. Các kết luận dưới đây thay thế mọi nội dung "đề xuất" tương ứng ở trên và ở đặc tả; đặc tả vẫn là căn cứ cho mọi điểm không bị ghi đè tại đây. Quyết định nền tảng và backend được ghi thành bản ghi riêng ở [ADR 0001](../decisions/0001-nen-tang-va-backend.md).

| Mã | Ngày | Người quyết định | Kết luận |
|---|---|---|---|
| D-01 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Chỉ làm mobile, không giữ web. Android là nền tảng được xác minh; dự án iOS giữ khả năng biên dịch về nguyên tắc (không dùng JS chỉ dành cho Android mà thiếu bảo vệ theo nền tảng) nhưng không tuyên bố iOS chạy được, vì không có macOS để kiểm chứng. |
| D-02 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Backend chưa có bên ngoài nên đặt ngay trong repo, thư mục `server/`: Node 24 chạy TypeScript trực tiếp, `node:http`, driver `pg`, không ORM, không framework web. Cơ sở dữ liệu PostgreSQL với bảo mật cấp hàng (RLS) trên mọi bảng dữ liệu người dùng; logic thuần dùng chung nằm ở `domain/`. Xác thực bằng email và mật khẩu, không OAuth. |
| D-03 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Chưa có tài khoản cửa hàng ứng dụng hay khóa ký bản phát hành. Phạm vi giao là bản debug đã kiểm chứng cùng quy trình phát hành được ghi thành tài liệu; không dựng push từ xa (FCM/APNs), hộp thư trong app là kênh bảo đảm. Email gửi qua giao diện `Mailer` ghi ra tệp cục bộ ở môi trường dev; cấu hình SMTP được ghi lại nhưng chưa kiểm chứng. |
| D-04 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Vé đóng băng chuỗi dùng thủ công, `day-close` không bao giờ tự dùng vé. Vé áp dụng cho ngày logic hiện tại, hoặc cho ngày logic vừa đóng gần nhất trong vòng 12 giờ sau lúc đóng (đóng lúc 03:00 giờ địa phương thì còn đến 15:00). Ngày đóng mà thiếu nhiệm vụ STORY: nếu đã có vé cho ngày đó thì chuỗi giữ nguyên, nếu không thì chuỗi về 0 và giá trị trước khi đứt được giữ lại để cứu trong 12 giờ. `streakBest` không bao giờ giảm. Ngày đã đóng băng không tính hoàn thành hay bỏ lỡ: không tăng chuỗi, không tính vào "bỏ lỡ từ 3 ngày" của linh vật, đóng góp 0 vào điểm tổ đội. Mỗi ngày tối đa một vé. |
| D-05 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Mỗi request ghi mang `Idempotency-Key` là UUID do client sinh, riêng cho từng thao tác của người dùng (hai lần bấm uống nước là hai khóa); server lưu khóa → phản hồi theo từng người dùng và phát lại. Dòng sổ cái dùng id thao tác làm `refId`. Request ghi có thể mang `occurredAt`; server quy ra ngày logic và chỉ nhận nếu ngày đó còn mở, không ở tương lai và không quá 48 giờ, ngược lại trả `DAY_CLOSED` và client bỏ thao tác kèm giải thích. Ngày đã đóng không bao giờ mở lại. Hoàn tác chỉ áp dụng cho lần ghi gần nhất của nhiệm vụ đó, trong 10 giây ở server (giao diện hiển thị 5 giây), thực hiện bằng bút toán đảo ngược; điểm perk đã cấp cho một cấp độ không bao giờ bị thu hồi hay cấp lại. |
| D-06 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Tuổi = năm hiện tại theo múi giờ người dùng − `birthYear`; từ chối dưới 16 (S61) và trên 90. Macro dự phòng: nếu carb dưới 50 g sau khi hạ protein xuống 1,6 g/kg thì đặt carb = 50 g và chất béo nhận phần còn lại, không dưới 20 % kcal; nếu vẫn bất khả thi thì giữ protein 1,6 g/kg, chất béo 20 %, carb = phần còn lại (≥ 0) và đặt `macroAdjusted = true` kèm giải thích. Không bao giờ từ chối vì macro. Vẫn áp dụng §9.1 của đặc tả: thâm hụt tối đa 20 % dưới TDEE; BMI dưới 18,5 không được chọn ASSASSIN (S43). |
| D-07 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Tăng trưởng linh vật = XP kiếm được trong giai đoạn hiện tại ÷ cỡ giai đoạn: EGG 300, HATCHLING 1 200, JUVENILE 4 000, ADULT 12 000 XP; MYTHIC là giai đoạn cuối. Mốc chuỗi 7/30/100 ngày: huy hiệu + 50/200/500 xu. Thưởng tổ đội hằng tuần cho mỗi thành viên hoạt động: hạng 1 → 150 xu + huy hiệu, hạng 2 → 100 xu, hạng 3 → 60 xu, tổ đội có hạng khác → 20 xu. Chi phí perk: +2 lượt đổi món (3→5) = 2 điểm, nâng trần vé 2→3 = 3 điểm, mở một giao diện = 1 điểm. Nhật ký: +15 XP cho bài đầu tiên của mỗi ngày logic. Nhiệm vụ đứng lên vận động có `targetCount` = 6. Khi bản thiết kế đã duyệt có con số cụ thể (giá cửa hàng, tên vật phẩm) không mâu thuẫn đặc tả hay quyết định này thì số trong thiết kế được dùng để hiển thị. |
| D-08 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Tuần tổ đội chạy từ thứ Hai 00:00 đến Chủ nhật theo `Asia/Ho_Chi_Minh`, khớp theo nhãn `logicalDate`. Thành viên hoạt động = có ít nhất một DailyLog trong tuần. Ngày không có log tính 0. Người vào giữa tuần được lấy trung bình trên số ngày kể từ ngày tham gia; người rời trước lúc chốt tuần bị loại. Tổ đội có dưới 3 thành viên hoạt động thì không xếp hạng (S73). Tổ đội không hoạt động 14 ngày thì hiện gợi ý ở S76. |
| D-09 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Lược đồ bổ sung ngoài §4 của đặc tả: thông tin đăng nhập, phiên, mã đặt lại mật khẩu, khóa idempotency, buổi tập, thực đơn ngày kèm số lượt đổi, tùy chọn người dùng (khung giờ nhắc, tắt nhắc nhở, ẩn chuỗi, âm thanh, chuyển động), perk đã mở, thông báo trong app, ràng buộc duy nhất cho vé cấp hằng tuần, trạng thái xóa tài khoản. |
| D-10 | 2026-10-11 | chủ dự án ủy quyền toàn quyền cho nhóm triển khai | Chưa có người duyệt nội dung sức khỏe. Nội dung được viết từ công thức của đặc tả và hướng dẫn chung, gom trong một module nội dung dễ rà soát, và được ghi "chưa được chuyên gia duyệt" trong danh mục kiểm tra phát hành. Khối khủng hoảng (S56) chỉ hiển thị số công cộng của Việt Nam: 115 (cấp cứu) và 111 (tổng đài quốc gia bảo vệ trẻ em), đánh dấu cần duyệt; việc khớp từ khóa không bao giờ được ghi log. |

## Giới hạn

Không xây tính năng trong lần tổ chức repo này. Kế hoạch không bổ sung thiết bị đeo, nhận diện ảnh món ăn, chat tự do, tiền thật hoặc phân tích cảm xúc AI; giữ giới hạn của đặc tả.
