# Hồi Máu — Bản đồ màn hình

Tài liệu bàn giao UX/UI cho [bản thiết kế hoiMau.pen](../../design/hoiMau.pen), đối chiếu [đặc tả sản phẩm](../product/SPEC-QUEST-001-dac-ta-he-thong.md) và [phạm vi mobile](../product/mobile-scope.md). Mã S dùng để tìm frame thiết kế; mã F dẫn về tính năng trong đặc tả.

Đây là thiết kế tĩnh và quy ước điều hướng để triển khai. Nút, số liệu minh họa, trạng thái lưu, đồng bộ, mua vật phẩm và hẹn giờ trên canvas không chứng minh ứng dụng đã thực hiện chức năng đó. Tài liệu không thay thế các quyết định còn mở trong phạm vi mobile.

## Điều hướng chính

Thanh điều hướng dưới dùng các tab **Hôm nay / Lộ trình / Tổ đội / Cá nhân**, tương ứng Today / Plan / Guild / Profile. Màn gốc lần lượt là S09, S12, S25 hoặc S27, S31. Tab Tổ đội chọn màn trống hay màn chi tiết theo tư cách thành viên; không tạo thêm tab cho cửa hàng, linh vật hoặc nhật ký.

Màn chi tiết mở trong ngăn xếp của tab xuất phát; nút Quay lại trở về đúng nơi đã mở. Giữ lựa chọn tab và vị trí cuộn khi đổi tab. Onboarding và Focus Mode dùng luồng riêng, tránh để thao tác chuyển tab làm bỏ dở biểu mẫu hoặc buổi tập.

Các đường đi cần triển khai:

- Người mới: S01 → S03 → S05 (lỗi nhập: S60; dưới 16 tuổi: S61) → S06 → S07 (S43 khi bị chặn) → S08 hoặc S62 (mục tiêu đã điều chỉnh an toàn) → S09. Người đã có tài khoản: S01 → S02 → S09; hồ sơ chưa hoàn tất tiếp tục onboarding. Quên mật khẩu: S02 → S04 → S55 → S02.
- Ghi nhận ngày: S09 → S57 (đã lưu, Hoàn tác 5 giây) hoặc S58 (bị từ chối, thử lại); S09 → S10; từ nhiệm vụ ăn uống mở S13 hoặc S16, từ nhiệm vụ tập mở S18. Thanh chỉ số và "Hiểu các chỉ số" mở S47. "Khép lại hôm nay" mở S45. Xem chuỗi mở S21. LevelStrip mở S46.
- Dinh dưỡng: S12 → S13 → S14 → S15 → quay về bữa đã cập nhật; hết lượt đổi: S15 → S59 → S16 hoặc S46. Món ngoài thư viện đi S16 rồi trở về S13. Mục tiêu hiện hành xem tại S08.
- Tập luyện: S12 → S17 → S18 (mỗi động tác mở S82) → S19; tạm dừng chuyển sang S41, tiếp tục trở lại S19. Thoát hoặc kết thúc mở S63; đủ ≥ 50% thời lượng mở S20, dưới 50% mở S64, rồi về màn xuất phát.
- Tiến trình và vật phẩm: S31 hoặc S09 → S21 / S22 / S46; S22 → S68 (giai đoạn) hoặc S24 / S23 → S40 → S72 → S24; thiếu xu: S40 → S71 → S10. Lớp chúc mừng S65 (lên cấp), S66 (cột mốc chuỗi), S69 (tiến hóa) chỉ mở sau xác nhận của máy chủ. Chuỗi đứt: S21 hiển thị S67. Mầm mệt: S70. Perk ở S46 là tiện ích; hàng mua bằng xu ở S23 là vật phẩm thẩm mỹ.
- Tổ đội: S25 → S26 hoặc S42 → S27 → S28 (chưa đủ điều kiện: S73) / S29 (không gửi được: S74); nhóm không hoạt động 14 ngày: S76. Hộp thư S30 mở từ biểu tượng thông báo, rỗng thì S75.
- Riêng tư và chăm sóc bản thân: S31 → S32 → S33 hoặc S77 (được cấp vé) → S34 → S78; S31 → S35 → S36 (chưa cấp quyền: S80) / S37 (đổi hướng chưa đến lúc: S81) / S44 / S79. Nhật ký không có đường chia sẻ sang Tổ đội.

## Màn hình và bước tác vụ

Các mục dưới đây là đích điều hướng hoặc bước có mục đích riêng. Màn phản hồi và lớp trạng thái được tách ở bảng sau để không nhầm số frame với số route phải lập trình.

| Mã | Màn hình | Mục đích | Điểm vào | Thao tác chính / điểm ra | Đối chiếu |
|---|---|---|---|---|---|
| S01 | Chào mừng | Giới thiệu Hồi Máu và vòng lặp thói quen | Mở app chưa đăng nhập | Đăng ký S03, đăng nhập S02 | F-01 |
| S02 | Đăng nhập | Truy cập tài khoản | S01, phiên hết hạn | Đăng nhập; quên mật khẩu S04 | Xác thực §3, §7 |
| S03 | Đăng ký | Tạo tài khoản | S01, S02 | Tạo tài khoản rồi S05 | F-01, xác thực |
| S04 | Quên mật khẩu | Bắt đầu khôi phục quyền truy cập | S02 | Gửi yêu cầu; quay lại đăng nhập | Xác thực |
| S05 | Hồ sơ ban đầu | Thu thập số đo và thông tin cần cho mục tiêu | S03, onboarding dở | Xác thực dữ liệu, tiếp tục S06 | F-01 |
| S06 | Mức vận động | Chọn hoạt động thường ngày | S05 | Chọn mức, tiếp tục S07 | F-01, F-02 |
| S07 | Hệ phái | Chọn hướng nội dung phù hợp | S06; sửa hồ sơ | Chọn hệ phái; tiếp tục hoặc thấy S43 | F-01, §9 |
| S08 | Mục tiêu cá nhân | Giải thích năng lượng, nước và macro ước tính | S07; S12 | Hoàn tất onboarding hoặc quay lại kế hoạch | F-02, F-04, §9 |
| S09 | Hôm nay | Tổng quan việc cần làm và tiến trình ngày | Đăng nhập; tab Hôm nay | Ghi nhận nhanh, mở nhiệm vụ S10 | F-03, F-06, F-07, F-08 |
| S10 | Nhiệm vụ ngày | Phân biệt nhiệm vụ quyết định chuỗi với nhiệm vụ khác | S09 | Tăng tiến độ; mở tác vụ ăn / tập | F-06 |
| S12 | Lộ trình | Điểm vào dinh dưỡng và tập luyện | Tab Lộ trình | Mở S13, S17 hoặc S08 | F-02, F-04, F-05 |
| S13 | Thực đơn ngày | Xem các bữa và tiến độ ăn uống | S12, nhiệm vụ STORY | Mở món S14; nhập ngoài thư viện S16 | F-04 |
| S14 | Chi tiết món | Xem nội dung món, khẩu phần và dinh dưỡng | S13 | Ghi nhận; đổi món S15 | F-04 |
| S15 | Đổi món | Chọn món thay thế cho bữa đang xem | S14 | Chọn ứng viên, trở về bữa | F-04 |
| S16 | Nhập calo thủ công | Ghi món không có trong thư viện | S13, nhiệm vụ dinh dưỡng | Nhập và lưu; trả lại tổng ngày | F-04 |
| S17 | Thư viện bài tập | Tìm buổi tập theo điều kiện thực tế | S12 | Lọc thời lượng, không gian, dụng cụ; mở S18 | F-05 |
| S18 | Chi tiết bài tập | Chuẩn bị trước khi bắt đầu | S17, nhiệm vụ STORY | Xem hướng dẫn; bắt đầu S19 | F-05 |
| S19 | Đang tập trung | Hướng dẫn bài và theo dõi thời gian tập | S18 | Tạm dừng S41; âm thanh; kết thúc | F-05 |
| S21 | Tiến trình và chuỗi | Xem lịch sử, kỷ lục và điều kiện giữ chuỗi | S09, S31 | Xem ngày; mở vé S34 | F-07, F-08 |
| S22 | Linh vật | Xem giai đoạn tiến hóa và tâm trạng riêng biệt | S09, S31 | Xem đồ S24; mở cửa hàng S23 | F-09 |
| S23 | Cửa hàng | Duyệt vật phẩm thẩm mỹ bằng xu nội bộ | S22, S31 | Chọn vật phẩm, mở S40 | F-10 |
| S24 | Kho đồ | Xem và sử dụng đồ đã sở hữu | S22, sau mua hàng | Trang bị vật phẩm | F-10 |
| S26 | Tham gia tổ đội | Nhập mã mời | S25 | Kiểm tra mã; vào S27 | F-11 |
| S27 | Tổ đội của tôi | Xem thành viên và tiến độ chung | Tab Tổ đội khi đã tham gia | Mời bằng mã; S28; chọn người để mở S29 | F-11, F-12 |
| S28 | Bảng xếp hạng | Xem kết quả tuần và thời điểm cập nhật | S27 | Chọn tuần; quay lại tổ đội | F-11 |
| S29 | Gửi lời nhắc | Chọn lời động viên có sẵn | Thành viên trong S27 | Gửi khi đủ điều kiện; đóng | F-12 |
| S30 | Hộp thư | Đọc thông báo trong app | Biểu tượng thông báo | Mở nội dung; đánh dấu đã đọc | F-12, NFR-03 |
| S31 | Cá nhân | Điểm vào hồ sơ và tiện ích cá nhân | Tab Cá nhân | S21, S22, S32, S35, S46 | F-01, F-07, F-09, F-13 |
| S32 | Viết nhật ký | Ghi lại suy nghĩ riêng tư | S31 | Lưu, nhận phản hồi S33 | F-13, §10 |
| S34 | Vé đóng băng | Xem vé và ngày có thể áp dụng | S21, S33 | Chọn ngày, xem điều kiện, dùng vé | F-08, F-13; D-04 |
| S35 | Cài đặt | Điều chỉnh trải nghiệm và quản lý tài khoản | S31 | S36, S37, S44; âm thanh, giảm chuyển động, ẩn chuỗi | NFR-05, NFR-06, §9, §10 |
| S36 | Cài đặt thông báo | Điều chỉnh nhắc cá nhân và lời nhắc tổ đội | S35 | Bật/tắt; chọn khung giờ; mở quyền hệ thống | F-06, F-12 |
| S37 | Chỉnh sửa hồ sơ | Cập nhật tên, số đo và thông tin mục tiêu | S35, S31 | Lưu; xem mục tiêu tính lại | F-01, F-02 |
| S42 | Tạo tổ đội | Đặt tên và khởi tạo nhóm | S25 | Tạo, xem mã mời ở S27 | F-11 |
| S44 | Quyền riêng tư | Điểm vào tải dữ liệu và xóa tài khoản | S35 | Yêu cầu xuất; bắt đầu xác nhận xóa | §10 |
| S45 | Kết thúc ngày | Chủ động ghi nhận ý định nghỉ ngơi | S09 | Xác nhận giờ nghỉ; quay lại Hôm nay | F-06, §6.1 |
| S46 | Cấp độ và tiện ích | Giải thích XP, danh hiệu và perk | S31, S21 | Xem / mở khóa tiện ích khi hợp lệ | F-07, F-03; D-07 |
| S47 | Giải thích chỉ số | Cho biết dữ liệu tạo nên chỉ số nhân vật | Thanh chỉ số tại S09 | Đọc nguồn dữ liệu; về tác vụ liên quan | F-03 |

## Biến thể trạng thái và lớp phản hồi

Các frame này mô tả trạng thái của màn đang mở hoặc phản hồi sau thao tác. Khi triển khai, ưu tiên dùng cùng màn với dữ liệu trạng thái, snackbar, sheet hoặc dialog thích hợp; không mặc định biến từng frame thành route độc lập.

| Mã | Trạng thái | Mục đích | Xuất hiện từ | Thao tác / điểm ra | Đối chiếu |
|---|---|---|---|---|---|
| S11 | Đã ghi nhận / Hoàn tác | Phản hồi sau tăng tiến độ | S09 hoặc S10 | Hoàn tác trong thời hạn; tiếp tục; ưu tiên S57 (snackbar tại chỗ), S11 dùng khi ghi nhận từ màn không có vùng tiến độ | F-06, NFR-02 |
| S20 | Kết quả buổi tập | Thể hiện kết quả và phần thưởng sau ghi nhận | S19 | Về kế hoạch hoặc Hôm nay | F-05, F-07 |
| S25 | Tổ đội trống | Giải thích lợi ích khi chưa có nhóm | Tab Tổ đội | Tham gia S26; tạo S42 | F-11 |
| S33 | Phản hồi nhật ký | Xác nhận lưu và đưa câu động viên từ thư viện | S32 | Xem vé S34 hoặc trở về Cá nhân | F-13 |
| S38 | Mất mạng / chờ đồng bộ | Phân biệt lưu trên máy với đã đồng bộ | Màn có ghi nhận đang chờ mạng | Tiếp tục việc được hỗ trợ; thử lại khi có mạng | NFR-02, NFR-03; D-05 |
| S39 | Đang tải / lỗi tải | Truyền đạt việc chờ hoặc không lấy được dữ liệu | Màn đang truy vấn | Chờ; thử lại; quay lại | NFR-01, NFR-03 |
| S40 | Xác nhận mua | Cho kiểm tra vật phẩm và số xu trước giao dịch | S23 | Xác nhận mua; hủy; thành công mở kho; thiếu xu S71, thành công S72; chưa đủ cấp hiển thị ngay trên thẻ ở S23 | F-10 |
| S41 | Buổi tập tạm dừng | Giữ ngữ cảnh tập và tránh thoát nhầm | S19; xử lý vòng đời app | Tiếp tục; kết thúc sớm có xác nhận | F-05 |
| S43 | Mục tiêu bị chặn vì an toàn | Giải thích cấu hình không phù hợp | S07, cập nhật số đo | Sửa dữ liệu hoặc chọn hướng được phép | F-01, F-02, §9 |
| S48 | Thư viện không có kết quả | Tránh để người dùng mắc kẹt sau lọc | S17; áp dụng tương tự ở S15 | Xóa bớt bộ lọc; chọn phương án khác | F-04, F-05 |
| S57 | Hôm nay · Vừa ghi nhận | Xác nhận đã lưu và cho hoàn tác tại chỗ | S09 sau khi máy chủ xác nhận | Hoàn tác trong 5 giây; tự đóng khi hết hạn | F-06, NFR-02; D-05 |
| S58 | Hôm nay · Chưa lưu được | Hoàn nguyên tiến độ tạm và nói rõ lý do | S09 khi máy chủ từ chối | Thử lại; tiếp tục dùng Hôm nay | NFR-02, NFR-03 |
| S60 | Hồ sơ · Cần kiểm tra | Chỉ ra trường nhập ngoài khoảng hợp lệ | S05, S37 khi gửi | Sửa tại trường; tiêu điểm tới lỗi đầu tiên | F-01 |
| S61 | Chưa thể bắt đầu | Từ chối người dưới 16 tuổi mà không trách móc | S05 khi tuổi < 16 | Kiểm tra lại năm sinh S05; tìm hiểu S53 | R-01.3; D-06 |
| S62 | Lộ trình · Đã điều chỉnh an toàn | Cho biết mục tiêu đã được nâng lên mức sàn | S08 khi `safetyClamped` | Đến Hôm nay; chỉnh lại hồ sơ | §9.1, F-02 |
| S59 | Đổi món · Hết lượt | Giải thích giới hạn đổi món của bữa | S15 khi đã dùng 3/3 lượt | Ghi món ngoài thực đơn S16; xem tiện ích S46 | F-04; D-07 |
| S63 | Thoát buổi tập? | Tránh mất tiến trình do bấm nhầm | S19 (Thoát, Kết thúc, Back) | Tập tiếp; kết thúc và lưu → S20 hoặc S64 | F-05.6, R-05.1 |
| S64 | Kết quả · Buổi tập dở | Ghi nhận phần đã tập mà không tính hoàn thành | S63 khi thời gian tập < 50% | Về Hôm nay; tập tiếp S18 | R-05.1, F-07 |
| S65 | Lên cấp | Chúc mừng cấp mới và điểm tiện ích | Khi máy chủ xác nhận XP vượt ngưỡng | Xem tiện ích S46; để sau | F-07 |
| S66 | Cột mốc chuỗi | Trao huy hiệu 7/30/100 ngày | Sau ngày logic đạt mốc | Xem huy hiệu S24; tiếp tục | F-08; D-07 |
| S67 | Hành trình · Bắt đầu lại | Chuỗi về 0 nhưng giữ kỷ lục, không trách móc | S21 sau khi chuỗi đứt | Bắt đầu việc nhỏ S10; xem vé S34 | F-08, P2; D-04 |
| S69 | Mầm tiến hóa | Chúc mừng giai đoạn mới | Khi máy chủ xác nhận growth đạt 100 | Xem Mầm S22 | F-09; D-07 |
| S70 | Mầm · Đang mệt | Tâm trạng đáy, mời quay lại | S22, S09 khi bỏ lỡ STORY ≥ 3 ngày | Chọn một việc nhỏ S10 | F-09 |
| S71 | Xác nhận mua · Chưa đủ xu | Không cho mua khi thiếu xu, chỉ cách kiếm thêm | S40 | Xem nhiệm vụ S10; quay lại | F-10 |
| S72 | Đã mở khóa | Xác nhận giao dịch và cho dùng ngay | S40 sau khi máy chủ xác nhận | Dùng ngay → S24; về cửa hàng S23 | F-10, R-10.2 |
| S73 | Bảng xếp hạng · Chưa đủ điều kiện | Giải thích ngưỡng 3 thành viên hoạt động | S28 | Mời thêm bạn S54 | F-11; D-08 |
| S74 | Gửi lời nhắc · Chưa gửi được | Nêu lý do không gửi được | S29 | Để lúc khác | R-12.2–R-12.6 |
| S75 | Hộp thư trống | Trạng thái rỗng có lời giải thích | S30 | Cài đặt thông báo S36 | F-12 |
| S76 | Tổ đội đang lặng | Gợi ý khi nhóm không hoạt động 14 ngày | S27 | Chia sẻ mã S54; tìm nhóm S26 | §13 rủi ro 4 |
| S77 | Một khoảng nghỉ · Nhận vé | Xác nhận +15 XP và vé giữ nhịp của tuần (thẻ vé viền nét đứt 2 px `primary`) | S32 sau khi lưu, khi vé được cấp | Về Hôm nay; xem vé S34 | F-13; D-07 |
| S80 | Thông báo · Chưa cấp quyền | Quyền hệ thống đang tắt, hộp thư vẫn dùng được | S36 | Mở cài đặt máy | F-12 |
| S81 | Đổi hướng · Chưa đến lúc | Thời gian chờ 14 ngày giữa hai lần đổi hệ phái | S37 | Đã hiểu | R-01.1 |

Biến thể chữ thứ ba của S77: “Bạn đang giữ đủ 2 vé. Vé tuần này không được cấp thêm.”

Các lý do khác dùng cùng bố cục S74: “Thành viên này đã tắt nhắc nhở” (R-12.6), “Minh đã nhận một lời nhắc hôm nay” (R-12.3), “Bạn đã gửi đủ 3 lời nhắc hôm nay” (R-12.4).

## Các màn hoàn tất luồng bổ sung

| Mã | Màn hình | Điểm vào và thao tác | Đối chiếu |
|---|---|---|---|
| S49 | Những trang đã viết | S32 → danh sách nhật ký → S50; tạo trang mới trở về S32 | F-13 |
| S50 | Một trang của bạn | Đọc nội dung riêng tư, quay lại S49 | F-13, §10 |
| S51 | Lịch sử ghi nhận | S21/S47 → chọn ngày → xem các hành vi đã lưu | F-03, F-06 |
| S52 | Xác nhận xóa tài khoản | S44 → đọc hậu quả → giữ hoặc xác nhận xóa | §10 |
| S53 | Trợ giúp & thông tin | S35 → hướng dẫn, thông tin sức khỏe, điều khoản và phản hồi | §9, §10 |
| S54 | Quản lý tổ đội | S27 → chia sẻ mã, xem thành viên, yêu cầu rời nhóm | F-11 |
| S55 | Mật khẩu mới | Liên kết khôi phục sau S04 → xác nhận mật khẩu mới → S02 | Xác thực |
| S56 | Nguồn hỗ trợ | Biến thể từ S32/S33 khi có tín hiệu cần hỗ trợ → nguồn đã duyệt hoặc quay lại nhật ký | F-13, D-10 |
| S82 | Động tác mẫu | S18 (danh sách động tác) hoặc S19 ("Xem hướng dẫn") → xem động tác lặp, xem chậm, đọc 3 bước và lưu ý → quay lại | F-05; D-10 |
| S68 | Hành trình lớn lên | S22 → xem 5 giai đoạn và tiến độ tới giai đoạn kế | F-09; D-07 |
| S78 | Xem trước vé giữ nhịp | S34 → chọn ngày → xem trước và sau → dùng vé; S21 hiển thị ngày được giữ | F-08, F-13; D-04 |
| S79 | Hiển thị & chuyển động | S35 → chế độ chuyển động, ẩn số ngày chuỗi, chủ đề đang dùng | NFR-05; §13 rủi ro 5 |

S52 là frame giải thích xác nhận, khi triển khai có thể dùng dialog/sheet native tương đương. S56 là mô tả cách trình bày, chưa cung cấp số điện thoại hoặc dịch vụ chưa được xác minh. Giữ phản hồi nhật ký thông thường, không thay thế nó bằng cảnh báo. Luồng chuyển vai trò trưởng nhóm ở S54 là đề xuất cần chốt trước phát triển.

## Quy ước phản hồi khi triển khai

Ghi nhận phải phân biệt đang gửi, đã lưu, đang chờ mạng và bị từ chối. Khi máy chủ từ chối, hoàn nguyên số liệu tạm thời và giải thích bên cạnh tác vụ; không tiếp tục hiện phần thưởng thành công. Hoàn tác phải cập nhật cùng dữ liệu ngày, XP và xu, không chỉ bỏ dấu tick trên giao diện.

Thư viện rỗng khác lỗi tải: S48 hướng dẫn đổi bộ lọc; S39 cho thử lại. Hộp thư rỗng, kho đồ rỗng và bảng xếp hạng chưa đủ điều kiện dùng bố cục màn gốc với lời giải thích phù hợp. Dữ liệu cá nhân và nhật ký không xuất hiện trong màn tổ đội.

S20 cần phân biệt buổi tập hoàn thành với kết thúc sớm; phần thưởng và việc hoàn tất STORY lấy từ kết quả nghiệp vụ. S29 cần nhãn lý do khi không thể gửi, như thành viên tắt nhận lời nhắc hoặc đã hết lượt. S40 cần trạng thái không đủ xu, chưa đủ cấp, đã sở hữu và lỗi giao dịch. Các nhánh này là yêu cầu triển khai; bảng trạng thái không khẳng định mỗi nhánh đã có frame riêng.

S43 mô tả nhánh chặn mục tiêu; cảnh báo mục tiêu được điều chỉnh an toàn cũng cần hiển thị ngay tại S08. Lỗi từng trường, tuổi không hợp lệ và thay đổi hệ phái đang trong thời gian chờ cần thông báo tại nơi nhập. Nội dung ước tính sức khỏe không được trình bày như chẩn đoán.

## Giao diện hệ thống và phần chưa thể hiện đầy đủ

Các lớp sau thuộc hệ điều hành hoặc luồng tích hợp, không được coi là đã hoàn thành chỉ vì có điểm vào trên mockup:

- **Xác thực:** màn của nhà cung cấp OAuth, quay về app qua liên kết, phiên hết hạn và xác thực thất bại. S55 đã thiết kế bước đặt mật khẩu mới sau S04; việc kiểm chứng token và lỗi vẫn cần triển khai. Dùng giao diện bảo mật do nền tảng / nhà cung cấp quản lý khi thích hợp.
- **Quyền thông báo:** hộp thoại xin quyền native, trạng thái đã từ chối và liên kết đến cài đặt hệ thống. S36 là phần điều chỉnh trong app; hộp thư vẫn dùng được khi không có quyền push.
- **Bàn phím và nhập liệu:** bàn phím email, số và văn bản; cuộn tránh bàn phím, chuyển trường, vùng an toàn và đọc lỗi bằng trình đọc màn hình. Không vẽ bàn phím tùy biến để thay bàn phím hệ thống.
- **Xuất / xóa dữ liệu:** S44 là điểm vào, S52 đã có xác nhận và hậu quả. Cần triển khai xác thực lại nếu cần, trạng thái yêu cầu được nhận và lỗi; xuất dữ liệu cần tiến trình tạo tệp và bảng chia sẻ / lưu tệp native. Thiết kế không chứng minh chức năng xóa hoặc xuất hoạt động.
- **Focus Mode:** xác nhận khi Back / Thoát, quay lại từ nền, mất âm thanh hoặc gián đoạn hệ thống; thời gian thực tế không dựa vào số khung hình hoạt ảnh. Giảm chuyển động giữ nguyên hướng dẫn và bộ đếm.
- **Nhật ký:** S49/S50 đã thiết kế lịch sử và đọc lại; S56 thể hiện lối tiếp cận nguồn hỗ trợ. Nội dung hỗ trợ phải được duyệt theo thị trường trước phát hành; phản hồi thông thường vẫn là câu từ thư viện, không giả lập phân tích tâm lý bằng AI.

## Các quyết định sản phẩm còn mở

Luồng hình ảnh không tự chốt các điểm D trong tài liệu phạm vi mobile. Cần giải quyết D-04 trước khi lập trình tự dùng / dùng thủ công vé và cứu ngày đã đóng; D-05 trước ghi nhận offline và hoàn tác; D-06 trước xác thực tuổi và xử lý mục tiêu không hợp lệ; D-07 trước chốt chi phí perk, tăng trưởng linh vật và thưởng nhật ký; D-08 trước tính điểm tổ đội. D-10 chi phối nội dung sức khỏe và hỗ trợ khủng hoảng.

Hình minh họa, SVG, GIF và hiệu ứng là tài sản trình bày; chúng không thay thế nội dung hướng dẫn, nhãn trạng thái, kiểm thử tương tác hay xác nhận dữ liệu từ ứng dụng. Bản đồ này là cơ sở nối màn và kiểm tra độ phủ, không phải báo cáo nghiệm thu chức năng.
