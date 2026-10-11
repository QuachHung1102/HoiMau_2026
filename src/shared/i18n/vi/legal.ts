// Terms and privacy summary in plain language (S03 terms sheet; Task 47 reuses it in the settings).
// NOT reviewed by a lawyer, and the health wording is NOT reviewed by a health professional (rulings R-D10).
// It says only what the product does according to docs/product (spec §9.2, §10) and docs/superpowers/rulings.md;
// do not add a promise (a certification, a retention period, "absolute" security) that is not written there.
export const legalVi = {
  title: 'Điều khoản và quyền riêng tư',
  intro: 'Đây là bản tóm tắt bằng lời đơn giản về cách Hồi Máu dùng dữ liệu của bạn.',
  sections: [
    {
      heading: 'Chúng tôi lưu gì',
      body: 'Email, tên hiển thị, mật khẩu (chỉ lưu dưới dạng đã băm một chiều), số đo cơ thể bạn nhập khi bắt đầu, những việc bạn ghi nhận mỗi ngày và nhật ký của bạn.',
    },
    {
      heading: 'Nhật ký của bạn',
      body: 'Nội dung nhật ký được mã hóa trên máy chủ và chỉ bạn đọc được.',
    },
    {
      heading: 'Số đo và calo',
      body: 'Chiều cao, cân nặng, tuổi, giới tính và lượng calo không bao giờ hiện cho thành viên trong tổ đội. Họ chỉ thấy tên hiển thị, cấp độ và tỉ lệ hoàn thành.',
    },
    {
      heading: 'Quyền của bạn',
      body: 'Bạn có thể tải về dữ liệu của mình và xóa tài khoản bất cứ lúc nào.',
    },
    {
      heading: 'Bên thứ ba',
      body: 'Chúng tôi không bán dữ liệu của bạn và không chia sẻ cho bên thứ ba.',
    },
    {
      heading: 'Không phải tư vấn y tế',
      body: 'Hồi Máu đưa ra ước tính dựa trên các công thức phổ biến. Đó không phải tư vấn y tế cá nhân hóa và không thay thế ý kiến của bác sĩ hay chuyên gia dinh dưỡng.',
    },
  ],
} as const;
