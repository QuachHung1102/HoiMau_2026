// The journal and the freeze tickets (Task 45): S32, S33, S77, S56 (the words of the support block are health.ts's),
// S49, S50, S34, S78. Nothing here reads the person's mood into their words: no analysis, no advice.
import { LIMITS } from '../../../../domain/validation.ts';

export const MAX_CHARS = LIMITS.journalBody.max;

// S32
export const writeTitle = 'Góc giải tỏa';
export const writeSubtitle = 'Không cần viết hay. Chỉ cần là bạn.';
export const fieldLabel = 'Điều bạn muốn viết';
export const fieldPlaceholder = 'Hôm nay có điều gì khiến bạn bận lòng?';
export const privateTitle = 'Chỉ mình bạn đọc được';
export const privateBody = 'Không chia sẻ vào tổ đội';
export const counter = (count: number) => `${count} / ${MAX_CHARS}`;
export const save = 'Lưu điều mình vừa viết';
export const pastPages = 'Những trang đã viết';
export const needText = 'Viết vài dòng rồi lưu nhé.';
export const tooLong = `Trang này dài hơn ${MAX_CHARS} ký tự. Bạn rút bớt một chút nhé.`;
/** What stands under the field after a failed save: the reason, and that the words are still there. */
export const saveFailed = (reason: string) => `${reason} Điều bạn viết vẫn còn ở đây.`;

// S33 / S77
export const feedbackTitle = 'Một khoảng nghỉ';
export const feedbackSubtitle = 'Bạn không phải làm tốt mọi ngày.';
export const savedLine = 'Đã lưu';
export const thanks = 'Cảm ơn bạn đã dành một khoảng riêng để lắng nghe mình.';
export const xpChip = (xp: number) => `+${xp} XP`;
export const ticketGranted = '+1 vé giữ nhịp của tuần';
export const ticketHave = (available: number, cap: number) => `Đang có ${available} / ${cap} vé`;
export const seeTicket = 'Xem vé';
export const seeTicketHint = 'Vé hiện có và điều kiện sử dụng';
export const ticketAtCap = (cap: number) => `Bạn đang giữ đủ ${cap} vé. Vé tuần này không được cấp thêm.`;
export const toToday = 'Về Hôm nay';

// S56
export const sourcesCall = (number: string, label: string) => `Gọi ${number} · ${label}`;
export const callFailed = 'Chưa mở được ứng dụng gọi điện. Bạn có thể bấm số trên bàn phím điện thoại.';

// S49
export const listTitle = 'Những trang đã viết';
export const listSubtitle = 'Khoảng riêng chỉ dành cho bạn.';
export const rowHint = 'chạm để đọc';
export const newPage = 'Viết trang mới';
export const listFooter = 'Nội dung không hiển thị trong thông báo hoặc tổ đội.';
export const emptyTitle = 'Chưa có trang nào';
export const emptyBody = 'Trang đầu tiên của bạn sẽ nằm ở đây, chỉ mình bạn đọc được.';
export const listFailed = 'Chưa tải được những trang đã viết. Bạn thử lại nhé.';
export const moreFailed = 'Chưa tải thêm được. Bạn thử lại nhé.';

// S50
export const entryTitle = 'Một trang của bạn';
export const lockTitle = 'Chỉ bạn xem được';
export const lockBody = 'Nhật ký không được chia sẻ';
export const backToList = 'Về những trang đã viết';
export const entryFailed = 'Chưa mở được trang này. Bạn thử lại nhé.';
export const entryGone = 'Trang này không còn ở đây nữa.';
export const entryGoneBody = 'Bạn có thể quay lại những trang đã viết.';

// days
export const todayWord = 'Hôm nay';
export const yesterdayWord = 'Hôm qua';
const weekdays = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'] as const;
/** `weekday`: 0 = Monday. */
export const dateWords = (weekday: number, day: number, month: number) => `${weekdays[weekday]}, ${day}/${month}`;

// S34
export const ticketsTitle = 'Vé giữ nhịp';
export const ticketsSubtitle = 'Giữ lại chuỗi khi bạn cần nghỉ.';
export const ticketsCardTitle = 'Một ngày nhẹ hơn';
export const ticketsCardBody = 'Vé giữ chuỗi, không tăng chuỗi. Số vé khả dụng lấy từ tài khoản của bạn.';
export const ticketsHave = (available: number, cap: number) => `Bạn đang có ${available} vé · tối đa ${cap}`;
export const earnTitle = 'Cách có vé';
export const earnBody = 'Mỗi tuần, trang nhật ký đầu tiên của bạn được tặng một vé giữ nhịp. Tuần bắt đầu từ thứ Hai.';
export const dateField = 'Ngày sử dụng';
export const datePlaceholder = 'Chọn ngày đủ điều kiện';
export const leftToUse = (hours: number) => (hours < 1 ? 'còn dưới 1 giờ để dùng' : `còn ${hours} giờ để dùng`);
export const yesterdayOption = (hours: number) => `${yesterdayWord} · ${leftToUse(hours)}`;
export const usedOption = (label: string) => `${label} · Đã dùng vé`;
export const yesterdayFirst = 'Hôm qua sắp khép lại nên mình chọn sẵn ngày này.';
export const previewAction = 'Xem trước việc dùng vé';
export const ticketsFooter = 'Trước khi dùng, bạn sẽ được xem ngày áp dụng và ảnh hưởng đến chuỗi.';
export const loadFailed = 'Chưa tải được vé của bạn. Bạn thử lại nhé.';
export const usedTitle = 'Đã dùng vé';
export const usedBody = (date: string) => `${date} được giữ chuỗi.`;

// why a ticket cannot be used for a date (the server's codes, in the order the server checks them)
export const reason: Record<string, string> = {
  TICKET_DATE_NOT_ELIGIBLE: 'Ngày này không còn trong thời gian dùng vé.',
  TICKET_ALREADY_USED_FOR_DATE: 'Ngày này đã dùng vé rồi.',
  NO_TICKET: 'Bạn chưa có vé để dùng.',
  TICKET_NOT_NEEDED: 'Ngày này chưa cần vé: chuỗi của bạn không bị đe dọa. Vé vẫn còn nguyên.',
};

// S78
export const previewTitle = (target: 'TODAY' | 'YESTERDAY') => (target === 'TODAY' ? 'Dùng vé cho hôm nay?' : 'Dùng vé cho hôm qua?');
/** The date left the list (its time to use a ticket passed): the title no longer says which day it is. */
export const previewTitleGone = 'Dùng vé cho ngày này?';
/** The hours left are told for yesterday only: today's ticket is good until 15:00 the next day, which is not "today closes in H hours". */
export const previewDate = (date: string, hours: number | null) => (hours === null ? date : `${date} · ${leftToUse(hours)}`);
export const without = (streak: number) => `Nếu không dùng: chuỗi về ${streak}`;
export const withTicket = (streak: number) => `Nếu dùng: giữ chuỗi ${streak} ngày`;
export const afterUse = (left: number) => `Vé giữ chuỗi, không tăng chuỗi. Sau khi dùng, bạn còn ${left} vé.`;
export const useTicket = 'Dùng vé cho ngày này';
export const later = 'Để sau';
