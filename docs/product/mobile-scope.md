# Phạm vi mobile và quyết định cần chốt

## Cơ sở lập kế hoạch

Repo dùng React Native với Android và iOS. [Đặc tả gốc](SPEC-QUEST-001-dac-ta-he-thong.md) định vị sản phẩm web và loại native khỏi phạm vi. Kế hoạch **đề xuất mobile theo repo hiện tại**, không coi đây là quyết định sản phẩm đã duyệt.

Giữ các nhóm tính năng trong đặc tả. Bản nội bộ đầu tiên tập trung onboarding → mục tiêu → ghi nhận → XP → chuỗi. Dinh dưỡng và tập luyện tối thiểu cần có ngay để hoàn thành nhiệm vụ STORY; thư viện phong phú và Focus Mode hoàn thiện sau.

## Điều chỉnh nền tảng đề xuất

| Đặc tả web | Hướng mobile | Nghiệm thu |
|---|---|---|
| Next.js client, CSS | React Native và StyleSheet hiện có | Chạy trên nền tảng được cam kết |
| IndexedDB | Kho bền vững tương thích React Native, chọn khi xây offline | Không mất thao tác khi restart |
| Web Push/VAPID | Push native và hộp thư trong app | Từ chối quyền vẫn có thông báo trong app |
| Tab visibility | Vòng đời foreground/background | Hẹn giờ không tăng sai khi quay lại |
| Wake Lock, Escape, ARIA | Giữ màn hình nếu hỗ trợ, Back/Thoát và accessibility native | Thoát có xác nhận, trình đọc màn hình dùng được |
| prefers-reduced-motion | Tùy chọn giảm chuyển động của hệ điều hành | Tắt hiệu ứng không mất nội dung |
| Session web/Auth.js | Phiên mobile, OAuth/deep link và kho token cần chốt | Kiểm chứng hết hạn, thu hồi, đăng xuất |

Đây là yêu cầu chuyển đổi, chưa phải lựa chọn thư viện. Kiểm tra tài liệu chính thức và tương thích dependency khi thực hiện từng tích hợp.

## Sổ quyết định mở

| Mã | Câu hỏi cần quyết định | Chặn công việc |
|---|---|---|
| D-01 | Mobile thay thế web hay cùng tồn tại? Android hay cả iOS ở bản đầu? | Phạm vi và nghiệm thu nền tảng |
| D-02 | Backend đã có bên ngoài repo chưa? Ai sở hữu, stack nào, đặt mã đâu? | Auth, API, cơ sở dữ liệu |
| D-03 | Deadline, nhân lực, ngân sách và tài khoản phát hành là gì? | Lịch cam kết và phát hành |
| D-04 | F-08 tự dùng vé, F-13 cho dùng thủ công và cứu ngày đã đóng: chọn cơ chế nào, sửa chuỗi/điểm tuần ra sao? | StreakEngine và các job chốt |
| D-05 | Khóa theo nhiệm vụ/ngày ở §6.3 phân biệt các lần tăng tiến độ thế nào? Undo và request gửi muộn xử lý ra sao? | API ghi và offline |
| D-06 | `birthYear` không xác định ngày đủ tuổi; macro sau fallback vẫn không hợp lệ thì phản hồi gì? | Validation và EnergyCalculator |
| D-07 | XP→growth, thưởng chuỗi/tuần, chi phí perk, giới hạn thưởng nhật ký cụ thể ra sao? | Linh vật và kinh tế |
| D-08 | Tuần tổ đội dùng lịch chung nhưng ngày dùng múi giờ cá nhân: tính người vào/rời nhóm và ngày thiếu log thế nào? | GuildScorer |
| D-09 | Lược đồ thiếu lịch sử tập, thực đơn ngày/lượt đổi, tùy chọn nhắc, idempotency và cấp vé tuần: bổ sung mô hình nào? | Migration và hợp đồng API |
| D-10 | Ai duyệt nội dung sức khỏe, bản quyền và thông tin hỗ trợ khủng hoảng tại thị trường phát hành? | Nội dung và phát hành |

Các câu hỏi không chặn tổ chức repo/tài liệu. Chốt câu hỏi liên quan trước phần triển khai phụ thuộc; ghi ngày, người quyết định và kết luận tại đây. Không biến giả định thành quy tắc đã duyệt.

## Giới hạn

Không xây tính năng trong lần tổ chức repo này. Kế hoạch không bổ sung thiết bị đeo, nhận diện ảnh món ăn, chat tự do, tiền thật hoặc phân tích cảm xúc AI; giữ giới hạn của đặc tả.
