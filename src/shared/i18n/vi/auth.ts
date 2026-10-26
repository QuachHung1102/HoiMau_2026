// Welcome (S01), the start-up gate (S39) and signing out; the sign-in, sign-up and recovery forms.
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

// Sign in, sign up and password recovery. The server's `error.message` is never shown.
export const emailLabel = 'Email';
export const emailPlaceholder = 'ban@example.com';
export const passwordLabel = 'Mật khẩu';
export const newPasswordLabel = 'Mật khẩu mới';
export const repeatPasswordLabel = 'Nhập lại mật khẩu';
export const repeatPasswordPlaceholder = 'Nhập lại để xác nhận';
export const displayNameLabel = 'Tên hiển thị';
export const displayNamePlaceholder = 'Bạn muốn được gọi là gì?';
export const passwordHelper = (min: number) => `Ít nhất ${min} ký tự`;
export const codeLabel = (digits: number) => `Mã ${digits} chữ số`;

// S02
export const signInTitle = 'Chào bạn trở lại';
export const signInSubtitle = 'Đăng nhập để tiếp tục hành trình.';
export const signInAction = 'Đăng nhập';
export const forgotLink = 'Quên mật khẩu?';
export const noAccountLink = 'Chưa có tài khoản? Tạo tài khoản';
export const accountProtected = 'Thông tin tài khoản được bảo vệ.';

// S03
export const signUpTitle = 'Tạo tài khoản';
export const signUpSubtitle = 'Một nơi riêng cho hành trình của bạn.';
export const signUpAction = 'Tạo tài khoản';
export const haveAccountLink = 'Đã có tài khoản? Đăng nhập';
export const termsLabel = 'Tôi đồng ý điều khoản';
export const termsLink = 'Đọc điều khoản và chính sách riêng tư';

// S04
export const forgotTitle = 'Lấy lại mật khẩu';
export const forgotSubtitle = 'Mình sẽ gửi mã đến email của bạn.';
export const forgotAction = 'Gửi mã';
/** The one answer to every accepted request, for any email (S04 and the resend on S55). */
export const forgotSent = 'Nếu email đã đăng ký, bạn sẽ nhận được mã trong ít phút.';
export const forgotSentTitle = 'Kiểm tra hộp thư';
export const forgotSentHint = 'Bạn có thể quay lại để sửa địa chỉ.';
export const haveCodeAction = 'Nhập mã';

// S55
export const newPasswordTitle = 'Đặt mật khẩu mới';
/** Shows where the code went, so a typo made on S04 is visible. */
export const newPasswordSubtitle = (email: string) => `Nhập mã đã gửi đến ${email}.`;
export const newPasswordAction = 'Lưu mật khẩu mới';
export const newPasswordSaved = 'Mật khẩu đã được đổi. Bạn đăng nhập lại nhé.';
export const resendHint = 'Nếu mã đã hết hạn, hãy gửi lại mã.';
export const resendAction = 'Gửi lại mã';
/** The server sends at most this many codes per hour; a new code voids the old one. */
export const resendLimitPerHour = 3;
export const resendNote = `Mã mới sẽ thay mã cũ. Bạn có thể gửi lại tối đa ${resendLimitPerHour} lần mỗi giờ.`;
export const codePlaceholder = (digits: number) => '•'.repeat(digits);
export const accountCreatedNotSignedIn = 'Tài khoản đã được tạo nhưng chưa đăng nhập được. Bạn thử đăng nhập bằng email vừa dùng nhé.';

// Client-side validation: what the person can fix, never what the server knows about an account.
export const emailRequired = 'Bạn nhập email nhé.';
export const emailInvalid = 'Email chưa đúng định dạng, ví dụ ban@example.com.';
export const passwordRequired = 'Bạn nhập mật khẩu nhé.';
export const passwordTooShort = (min: number) => `Mật khẩu cần ít nhất ${min} ký tự.`;
export const passwordTooLong = (max: number) => `Mật khẩu tối đa ${max} ký tự.`;
export const repeatRequired = 'Bạn nhập lại mật khẩu để xác nhận.';
export const repeatMismatch = 'Hai mật khẩu chưa giống nhau.';
export const displayNameRequired = 'Bạn nhập tên hiển thị nhé.';
export const displayNameInvalid = (max: number) => `Tên hiển thị tối đa ${max} ký tự và không có ký tự ẩn.`;
export const termsRequired = 'Bạn cần đồng ý điều khoản để tạo tài khoản.';
export const codeInvalid = (digits: number) => `Mã gồm ${digits} chữ số.`;

// Server answers (error codes of the auth routes).
export const invalidCredentials = 'Email hoặc mật khẩu chưa đúng.';
export const registrationUnavailable = 'Không thể tạo tài khoản với email này. Bạn thử đăng nhập hoặc lấy lại mật khẩu nhé.';
export const resetCodeInvalid = 'Mã chưa đúng hoặc đã hết hạn. Bạn có thể gửi lại mã.';
export const nameNotAllowed = 'Tên này chưa phù hợp, bạn chọn tên khác nhé.';
export const passwordPlaceholder = 'Tạo mật khẩu';
