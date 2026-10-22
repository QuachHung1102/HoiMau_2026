// Settings, notifications, profile editing, display and help (Task 47: S35, S36 / S80, S37 / S81, S79, S53).
// Wording rules (spec 9.3, 9.4): no judgement of weight or body, no shaming of a broken streak, numbers are estimates.
// Every number in a sentence is passed in by the caller from the constant it belongs to (the help text: `helpContent.ts`).
import { grouped } from './onboarding';

// the reason a change was taken back (a snackbar, followed by `failureText(code)` of sync.ts)
export const notSaved = 'Chưa lưu được thay đổi này, nên mình đã để lại như cũ.';

// S35
export const title = 'Cài đặt';
export const subtitle = 'Điều chỉnh để ứng dụng hợp với bạn.';
export const rows = {
  profile: { title: 'Hồ sơ & mục tiêu', description: 'Cập nhật số đo hoặc hệ phái' },
  notifications: { title: 'Thông báo', description: 'Chọn điều bạn muốn nhận' },
  display: { title: 'Hiển thị & chuyển động' },
  privacy: { title: 'Quyền riêng tư', description: 'Xuất dữ liệu và xóa tài khoản' },
  help: { title: 'Giới thiệu & trợ giúp', description: 'An toàn sức khỏe, điều khoản' },
} as const;
export const sound = 'Âm thanh';
export const motionWords = { SYSTEM: 'Theo cài đặt hệ thống', REDUCED: 'Giảm chuyển động', FULL: 'Chuyển động đầy đủ' } as const;

// S36 / S80 (AR-23: nothing is sent outside the app, no permission is asked)
export const notificationsTitle = 'Thông báo';
export const notificationsSubtitle = 'Nhắc vừa đủ, vào lúc bạn muốn.';
export const noticeBody = 'Bản này chưa gửi thông báo ra ngoài ứng dụng. Lời nhắc vẫn nằm trong Hộp thư.';
export const openInbox = 'Mở Hộp thư';
export const nudgesLabel = 'Nhận lời nhắc từ tổ đội';
export const reminderLabel = 'Nhắc thói quen';
export const windowLabel = 'Khoảng giờ nhắc thói quen';
export const windowNeedsReminder = 'Bật "Nhắc thói quen" để chọn khoảng giờ.';
export const windows = { MORNING: 'Buổi sáng 07:00–09:00', NOON: 'Buổi trưa 11:30–13:30', EVENING: 'Buổi tối 18:00–20:00' } as const;
export const notificationsFooter = 'Lời nhắc từ tổ đội vẫn tuân theo giờ địa phương và giới hạn của người nhận.';

// S37
export const profileTitle = 'Hồ sơ & mục tiêu';
export const profileSubtitle = 'Cập nhật khi cơ thể hoặc nhịp sống thay đổi.';
export const activityLabel = 'Mức vận động';
export const profileNote = 'Số đo mới được lưu vào lịch sử. Đổi mục tiêu không xóa XP hoặc chuỗi đã có.';
export const saveProfile = 'Lưu hồ sơ';
export const profileLoadFailed = 'Chưa tải được hồ sơ của bạn. Bạn thử lại nhé.';
export const profileNotSaved = (reason: string) => `Chưa lưu được hồ sơ. ${reason} Những gì bạn vừa nhập vẫn còn ở đây.`;
export const profileSavedTitle = 'Đã lưu hồ sơ';
export const profileSavedSubtitle = 'Đây là mục tiêu ước tính theo hồ sơ hiện tại.';
export const done = 'Xong';
export const nothingToSave = 'Chưa có thay đổi nào để lưu.';
export const archetypeRowHint = (daysLeft: number | null) => (daysLeft === null ? 'Có thể đổi' : `Có thể đổi sau ${daysLeft} ngày`);

// the archetype sheet and S81
export const archetypeSheetTitle = 'Đổi hướng';
export const archetypeSheetIntro = 'Chọn hướng bạn muốn theo từ bây giờ. XP, cấp độ và chuỗi của bạn luôn được giữ.';
export const archetypeCurrent = 'Đang theo';
export const archetypeConfirm = 'Đổi hướng';
export const archetypeNotNow = 'Để lúc khác';
export const archetypeFailed = (reason: string) => `Chưa đổi được hướng. ${reason}`;
export const cooldownTitle = 'Chưa đến lúc đổi hướng';
export const cooldownBody = (when: string) => `Bạn có thể đổi hướng từ ${when}.`;
export const cooldownNote = (days: number) => `Mỗi lần đổi cách nhau ${days} ngày để lộ trình kịp phát huy tác dụng. XP, cấp độ và chuỗi của bạn luôn được giữ.`;
export const understood = 'Đã hiểu';
/** "14:05 ngày 21/10/2026" */
export const clockAndDate = (hour: number, minute: number, day: number, month: number, year: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ngày ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

// S79
export const displayTitle = 'Hiển thị & chuyển động';
export const motionHeading = 'Chuyển động';
export const motionOptions = [
  { value: 'SYSTEM', label: 'Theo hệ thống' },
  { value: 'REDUCED', label: 'Giảm' },
  { value: 'FULL', label: 'Đầy đủ' },
] as const;
export const motionNote = 'Khi giảm chuyển động, mọi thông tin vẫn hiện bằng chữ.';
export const streakHeading = 'Chuỗi ngày';
export const hideStreakLabel = 'Ẩn số ngày chuỗi';
export const hideStreakNote = 'Chuỗi vẫn được tính, chỉ ẩn con số trên Hôm nay.';
export const themeHeading = 'Chủ đề';
export const themeInUse = 'Đang dùng';
export const themeOpen = 'Xem các chủ đề của bạn';

// S53
export const helpTitle = 'Trợ giúp & thông tin';
export const helpSubtitle = 'Hiểu ứng dụng và tìm hỗ trợ.';
export const helpRows = {
  rhythm: { title: 'Cách giữ nhịp mỗi ngày', description: 'Nhiệm vụ, XP và chuỗi' },
  health: { title: 'Thông tin sức khỏe', description: 'Ước tính không thay thế tư vấn y tế' },
  terms: { title: 'Điều khoản sử dụng', description: 'Quyền và trách nhiệm' },
  privacy: { title: 'Chính sách riêng tư', description: 'Dữ liệu nào được lưu và chia sẻ' },
  feedback: { title: 'Gửi phản hồi', description: 'Báo lỗi hoặc góp ý cho ứng dụng' },
} as const;
export const feedbackVersion = (version: string) => `Phiên bản ứng dụng: ${version}`;
export const feedbackBody = 'Kênh nhận phản hồi sẽ do đơn vị phát hành thông báo. Hiện chưa có địa chỉ nào được duyệt để gửi, nên mình chưa đưa ra địa chỉ hay biểu mẫu nào.';

// "Cách giữ nhịp mỗi ngày": the sentences; every number comes from `helpContent.ts`.
export const rhythm = {
  introTitle: 'Một ngày của bạn',
  dayBoundary: (start: string, end: string, example: string) =>
    `Ngày của bạn bắt đầu lúc ${start} và kết thúc lúc ${end} sáng hôm sau, theo múi giờ trong hồ sơ. Một ghi nhận lúc ${example} vẫn tính cho ngày hôm trước.`,
  questsTitle: 'Nhiệm vụ và XP',
  storyLine: (name: string, xp: number, coin: number) => `${name}: +${xp} XP và +${coin} xu.`,
  storyRule: 'Làm xong mọi nhiệm vụ chính trong ngày thì chuỗi tăng thêm một ngày.',
  dailyLine: (name: string, xp: number, coin: number, target: number) => `${name}: mỗi lần ghi +${xp} XP và +${coin} xu, đủ ${target} lần là xong.`,
  hiddenLine: (xp: number, coin: number) => `Nhiệm vụ ẩn mở vào buổi tối: +${xp} XP và +${coin} xu.`,
  journalLine: (xp: number) => `Trang nhật ký đầu tiên của mỗi ngày: +${xp} XP.`,
  levelsTitle: 'Cấp độ',
  levelStep: (from: number, xp: number) => `Từ cấp ${from} lên cấp ${from + 1} cần ${grouped(xp)} XP.`,
  levelPoint: 'Mỗi lần lên cấp bạn nhận một điểm tiện ích, và điểm đã nhận không bị lấy lại.',
  titleRange: (from: number, to: number | null, name: string) => (to === null ? `Từ cấp ${from} trở lên: ${name}` : `Cấp ${from}–${to}: ${name}`),
  streakTitle: 'Chuỗi ngày',
  streakBreak: 'Một ngày chưa xong nhiệm vụ chính và chưa dùng vé thì chuỗi dừng lại; bạn bắt đầu lại từ hôm nay, không cần bù. Chuỗi dài nhất của bạn vẫn được giữ.',
  streakMilestone: (days: number, coins: number) => `Mốc ${days} ngày: một huy hiệu và +${coins} xu.`,
  ticketsTitle: 'Vé giữ nhịp',
  ticketsFrozen: 'Một ngày có vé không tăng chuỗi nhưng cũng không làm đứt chuỗi.',
  ticketsCap: (base: number, withPerk: number) => `Bạn giữ tối đa ${base} vé, hoặc ${withPerk} vé khi đã mở tiện ích tăng chỗ chứa vé.`,
  ticketsWindow: (deadline: string) => `Vé dùng được cho hôm nay, hoặc cho hôm qua cho đến ${deadline}.`,
} as const;

// S44: privacy, the copy of the data and the way to the deletion (Task 48)
export const privacyTitle = 'Dữ liệu & quyền riêng tư';
export const privacySubtitle = 'Bạn kiểm soát những gì mình chia sẻ.';
export const ownDataRow = { title: 'Dữ liệu riêng của bạn', description: 'Số đo, mục tiêu và nhật ký' } as const;
export const ownDataLines = [
  'Số đo, mục tiêu và nhật ký chỉ mình bạn xem được.',
  'Thành viên tổ đội chỉ thấy tên hiển thị, cấp độ và việc bạn đã hoàn thành.',
] as const;
export const exportRow = { title: 'Tải dữ liệu của tôi', description: 'Xuất bản sao dưới dạng JSON' } as const;
export const exporting = 'Đang chuẩn bị bản sao…';
export const exportedTitle = 'Đã tạo bản sao';
// The share box is opened by the system and nothing here can tell whether it came up, so the note names the way to ask again.
export const exportedNote = 'Bản sao có số đo và nhật ký của bạn, hãy chọn nơi lưu cẩn thận. Nếu hộp chia sẻ không hiện ra, bạn bấm lại "Tải dữ liệu của tôi".';
export const exportTooLarge = 'Bản sao quá lớn để chia sẻ trên máy này';
export const exportRateLimited = 'Bạn đã tải bản sao nhiều lần trong một giờ qua. Chờ một lúc rồi thử lại nhé, dữ liệu của bạn vẫn nguyên.';
export const exportShareFailed = 'Chưa mở được hộp chia sẻ. Bạn thử lại nhé.';
export const exportNotDone = (reason: string) => `Chưa tạo được bản sao. ${reason}`;
export const exportFileName = (date: string) => `hoi-mau-du-lieu-${date}.json`;
export const deleteCard = {
  title: 'Xóa tài khoản',
  body: 'Tài khoản sẽ bị vô hiệu hóa. Dữ liệu được xóa theo thời hạn trong chính sách riêng tư.',
  action: 'Xem & xác nhận xóa',
} as const;
export const readPolicy = 'Đọc chính sách riêng tư';

// S52: the account is deleted after the password is given
export const deleteTitle = 'Xóa tài khoản?';
export const deleteSubtitle = 'Hãy đọc kỹ trước khi xác nhận.';
export const deleteHeadline = 'Bạn sẽ không thể tiếp tục sử dụng tài khoản này.';
export const deleteConsequences = (purgeDays: number) =>
  [
    'Tài khoản ngừng hoạt động ngay lập tức.',
    `Toàn bộ dữ liệu của bạn được xóa sau ${purgeDays} ngày.`,
    'Nếu bạn đang là trưởng tổ đội, vai trò trưởng nhóm chuyển cho thành viên tham gia lâu nhất.',
    'Các ghi nhận đang chờ gửi trên máy này sẽ bị bỏ.',
    'Bạn không thể hoàn tác việc này trong ứng dụng.',
  ] as const;
export const deleteExportHint = 'Muốn giữ lại dữ liệu? Hãy tải bản sao ở màn hình Dữ liệu & quyền riêng tư trước.';
export const passwordLabel = 'Mật khẩu của bạn';
export const passwordHelper = 'Nhập mật khẩu để xác nhận. Nút xóa chỉ bật khi đã nhập.';
export const keepAccount = 'Giữ tài khoản';
export const deleteAction = 'Xóa tài khoản';
// 401 INVALID_CREDENTIALS is also what the sixth try within a quarter of an hour gets, so it never says the password is certainly wrong.
export const deleteRefused = 'Mật khẩu chưa đúng, hoặc bạn đã thử quá nhiều lần. Kiểm tra lại mật khẩu; nếu vẫn chưa được, chờ một lúc rồi thử lại. Tài khoản của bạn chưa bị xóa.';
export const deleteUnknown = 'Chưa nhận được trả lời nên chưa rõ yêu cầu xóa đã được xử lý chưa. Bạn bấm lại "Xóa tài khoản"; nếu tài khoản đã đóng, ứng dụng sẽ đưa bạn về màn hình chào.';
export const deleteNotDone = (reason: string) => `Chưa xóa được tài khoản. ${reason}`;
export const accountClosed = 'Tài khoản đã được đóng.';
