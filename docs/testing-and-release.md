# Kiểm thử và phát hành

## Hiện trạng

Test hiện có chỉ render ứng dụng mẫu. Các kịch bản dưới đây là yêu cầu triển khai, chưa phải test đã có hoặc đã pass.

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
