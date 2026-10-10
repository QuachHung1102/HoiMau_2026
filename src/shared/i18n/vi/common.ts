// Shared strings. Append only; feature strings live in their own file.
export const retry = 'Thử lại';
export const back = 'Quay lại';
export const saving = 'Đang lưu';
export const saved = 'Đã lưu';
export const queued = 'Đang chờ gửi';
export const notSaved = 'Chưa lưu được';
export const close = 'Đóng';
export const next = 'Tiếp tục';
export const on = 'Đang bật';
export const off = 'Đang tắt';

export const unknownError = 'Có lỗi xảy ra. Bạn thử lại nhé.';
export const errorText = {
  NETWORK: 'Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.',
  TIMEOUT: 'Kết nối hơi chậm. Bạn thử lại nhé.',
  RATE_LIMITED: 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.',
  SESSION_INVALID: 'Phiên đăng nhập đã hết hạn',
  INTERNAL: 'Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.',
} as const;
