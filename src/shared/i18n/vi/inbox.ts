// The inbox: S30 with items, S75 empty (Task 43). Notification kinds are the server's; one that this app does not know
// gets the generic words, never a blank row.
export const title = 'Hộp thư';
export const subtitle = 'Lời nhắc và những cột mốc của bạn.';
export const markAllRead = 'Đánh dấu đã đọc';
export const settings = 'Cài đặt thông báo';
export const unread = 'chưa đọc';
export const loadFailed = 'Chưa tải được hộp thư. Bạn thử lại nhé.';
export const moreFailed = 'Chưa tải thêm được thư. Bạn thử lại nhé.';
export const markFailed = 'Chưa đánh dấu đã đọc được. Bạn thử lại nhé.';
export const emptyTitle = 'Chưa có thư mới';
export const emptyBody = 'Lời nhắc từ tổ đội và cột mốc của bạn sẽ xuất hiện ở đây.';

export const nudgeTitle = (name: string) => `${name} đã nhắc bạn`;
export const nudgeSomeone = 'Một thành viên đã nhắc bạn';
export const quoted = (text: string) => `“${text}”`;
export const milestoneTitle = 'Một cột mốc mới';
export const milestoneBody = 'Xem huy hiệu trong hành trình';
export const petTitle = 'Mầm đang đợi bạn';
export const petBody = 'Bắt đầu lại từ một việc nhỏ';
export const weeklyTitle = 'Kết quả tuần của tổ đội';
export const weeklyBody = (rank: number, coins: number) => (coins > 0 ? `Hạng ${rank} · +${coins} xu` : `Hạng ${rank}`);
export const reminderTitle = 'Một việc nhỏ cho hôm nay';
export const reminderBody = 'Mở Hôm nay để chọn một việc';
export const unknownTitle = 'Thông báo mới';
export const unknownBody = 'Nội dung này chưa hiển thị được ở phiên bản hiện tại.';
