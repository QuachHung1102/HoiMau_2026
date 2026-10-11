// Welcome (S01), the start-up gate (S39) and signing out (Task 17). Task 18 adds the auth forms.
// The "session expired" notice is `errorText.SESSION_INVALID` in common.ts.
export const productName = 'Hồi Máu';
export const tagline = 'Mỗi ngày, một chút tốt hơn.';
export const welcomeHeadline = ['Thói quen nhỏ.', 'Hành trình của riêng bạn.'] as const;
export const welcomeBody = 'Ghi lại việc bạn đã làm, nuôi dưỡng Mầm và cùng bạn bè giữ nhịp mỗi ngày.';
/** The primary action of S01; it opens the sign-up screen. */
export const welcomeStart = 'Bắt đầu hành trình';
export const haveAccount = 'Tôi đã có tài khoản';
export const signOut = 'Đăng xuất';

export const loadingTitle = 'Đang lấy hành trình';
export const loadingSubtitle = 'Dữ liệu của bạn đang được tải.';
/** The start-up load failed for lack of a connection (NETWORK / TIMEOUT); other codes use common `errorText`. */
export const loadFailedOffline = 'Kiểm tra kết nối rồi thử lại. Những ghi nhận đã lưu vẫn còn.';
