// Summary of the terms and the privacy rules in plain language (S03 terms sheet; Task 47 reuses it in the settings).
// NOT reviewed by a lawyer, and the health wording is NOT reviewed by a health professional (rulings R-D10).
// Every sentence must be true of the product as specified (docs/product spec §9.2, §10 and the API contract):
// do not add a promise (a certification, "absolute" security, a third party that does not exist) that is not written there.
// Voice: formal text with "Hồi Máu" as the subject, never "chúng tôi".
export const legalVi = {
  title: 'Tóm tắt điều khoản và quyền riêng tư',
  intro: 'Đây là bản tóm tắt bằng lời đơn giản các điều khoản sử dụng và quy tắc riêng tư của Hồi Máu, không phải văn bản pháp lý đầy đủ.',
  sections: [
    {
      heading: 'Ai có thể dùng Hồi Máu',
      body: 'Hồi Máu dành cho người từ 16 tuổi trở lên.',
    },
    {
      heading: 'Không phải tư vấn y tế',
      body: 'Hồi Máu đưa ra ước tính dựa trên các công thức phổ biến. Đó không phải tư vấn y tế cá nhân hóa và không thay thế ý kiến của bác sĩ hay chuyên gia dinh dưỡng.',
    },
    {
      heading: 'Hồi Máu lưu gì',
      body: 'Email và tên hiển thị của tài khoản, mật khẩu (chỉ lưu dưới dạng đã băm một chiều), số đo cơ thể bạn nhập, nhật ký hằng ngày về những việc bạn ghi nhận, các bài viết nhật ký của bạn, việc bạn tham gia tổ đội và những món bạn mua bằng xu trong ứng dụng.',
    },
    {
      heading: 'Bài viết nhật ký',
      body: 'Nội dung bài viết nhật ký được mã hóa trước khi lưu và chỉ tài khoản của bạn truy cập được.',
    },
    {
      heading: 'Điều thành viên tổ đội thấy',
      body: 'Thành viên trong tổ đội thấy tên hiển thị, cấp độ, vai trò trong tổ đội, số ngày bạn đã hoàn thành trong tuần và việc nhiệm vụ chính hôm nay của bạn đã xong hay chưa. Họ không bao giờ thấy số đo cơ thể, cân nặng, lượng calo hay nhật ký của bạn.',
    },
    {
      heading: 'Dữ liệu của bạn',
      body: 'Hồi Máu không bán dữ liệu của bạn. Số đo cơ thể và bài viết nhật ký không được chia sẻ cho bất kỳ bên thứ ba nào. Email của bạn chỉ dùng để đăng nhập và gửi mã đặt lại mật khẩu.',
    },
    {
      heading: 'Quyền của bạn',
      body: 'Bạn có thể tải về toàn bộ dữ liệu của mình bất cứ lúc nào. Sau khi bạn yêu cầu xóa tài khoản, dữ liệu sẽ bị xóa vĩnh viễn trong vòng 30 ngày; bạn có thể tải dữ liệu về trước đó.',
    },
  ],
} as const;
