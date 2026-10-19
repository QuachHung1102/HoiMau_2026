// The guild: the tab (S25 empty, S27 members, S76 quiet), joining (S26), creating (S42) and managing it (S54) (Task 42).
import type { NudgeBlockReason } from '../../../../domain/contract/social.ts';
import { GUILD_MAX_MEMBERS } from '../../../../domain/guild.ts';
import { LIMITS } from '../../../../domain/validation.ts';

export const dot = ' · ';

// The tab, loading and failing
export const tabTitle = 'Tổ đội';
export const loadFailed = 'Chưa tải được tổ đội. Bạn thử lại nhé.';

// S25
export const emptySubtitle = 'Cùng nhau giữ nhịp, không so sánh cơ thể.';
export const emptyTitle = 'Đi cùng người quen';
export const emptyBody = 'Tạo một nhóm nhỏ hoặc tham gia bằng mã mời từ bạn bè.';
export const joinWithCode = 'Tham gia bằng mã mời';
export const createGuild = 'Tạo tổ đội';
export const emptyFooter = 'Chỉ tiến độ thói quen được chia sẻ. Số đo và nhật ký luôn riêng tư.';

// S27
export const guildSubtitle = 'Tổ đội của bạn';
export const headerTitle = 'Có bạn, dễ bắt đầu hơn.';
export const headerBody = 'Cùng hoàn thành việc chính hôm nay.';
export const weekLine = (percent: number) => `Tuần này: ${percent}% việc chính hoàn thành`;
export const membersLabel = 'Thành viên của tổ đội';
export const seeLeaderboard = 'Xem bảng xếp hạng';
export const inviteAndManage = 'Mời bạn & quản lý nhóm';

// A member row
export const youSuffix = 'bạn';
export const nameLine = (name: string, isMe: boolean) => (isMe ? `${name}${dot}${youSuffix}` : name);
export const levelLine = (level: number, done: number, counted: number) => `Cấp ${level}${dot}${done}/${counted} ngày`;
export const doneToday = 'đã xong hôm nay';
export const canNudge = 'có thể nhắc';
/** Why a member cannot be nudged right now, said where it is (the row), never as a tap that does nothing. */
export const notNudgeable: Record<NudgeBlockReason | 'NOT_IN_GUILD' | 'NUDGE_NOT_SAME_GUILD', string> = {
  NUDGE_RECEIVER_MUTED: 'Đã tắt nhận nhắc nhở',
  NUDGE_NOT_NEEDED: 'Đã xong việc chính hôm nay, không cần nhắc',
  NUDGE_OUTSIDE_WINDOW: 'Chỉ nhắc được từ 12:00 đến 20:00 theo giờ của bạn ấy',
  NUDGE_RECEIVER_LIMIT: 'Hôm nay bạn ấy đã được nhắc rồi',
  NUDGE_SENDER_LIMIT: 'Hôm nay bạn đã nhắc đủ số lần rồi',
  NOT_IN_GUILD: 'Chưa nhắc được lúc này',
  NUDGE_NOT_SAME_GUILD: 'Chưa nhắc được lúc này',
};

// S76: a calm hint, no blame
export const quietTitle = 'Tổ đội đang lặng';
export const quietBody = (days: number) => `Tổ đội đã yên ắng ${days} ngày. Rủ mọi người quay lại hoặc tìm một nhóm mới.`;
export const shareCode = 'Chia sẻ mã mời';
export const findOtherGuild = 'Tìm nhóm khác';

// S26
export const joinTitle = 'Tham gia tổ đội';
export const joinSubtitle = 'Bạn có mã từ bạn bè?';
export const codeLabel = 'Mã mời';
export const codeLength = 8;
export const joinCardLine = 'Cùng giữ những thói quen nhỏ mỗi ngày.';
export const joinAction = 'Kiểm tra & tham gia';
export const joinFooter = 'Bạn chỉ thuộc một tổ đội tại một thời điểm.';
export const inviteCodeInvalid = 'Mã này chưa đúng, bạn kiểm tra lại nhé';
export const guildFull = `Tổ đội này đã đủ ${GUILD_MAX_MEMBERS} thành viên`;
export const alreadyInGuild = 'Bạn đang ở trong một tổ đội rồi. Muốn đổi nhóm thì rời nhóm hiện tại trước nhé.';

// S42
export const createTitle = 'Tạo tổ đội';
export const createSubtitle = 'Một nhóm nhỏ, cùng một nhịp tốt hơn.';
export const nameLabel = 'Tên tổ đội';
export const nameHelper = `Từ ${LIMITS.guildName.min} đến ${LIMITS.guildName.max} ký tự`;
export const mottoLabel = 'Khẩu hiệu (không bắt buộc)';
export const mottoHelper = `Tối đa ${LIMITS.guildMotto.max} ký tự`;
export const createNote = 'Sau khi tạo nhóm, bạn nhận mã mời để chia sẻ. Mã không công khai số đo hoặc nhật ký.';
export const createAction = 'Tạo nhóm & lấy mã mời';
export const haveCode = 'Tôi có mã mời rồi';
export const nameLength = `Tên tổ đội cần từ ${LIMITS.guildName.min} đến ${LIMITS.guildName.max} ký tự`;
export const nameFormat = 'Tên tổ đội cần có chữ hoặc số và không có ký tự ẩn';
export const mottoTooLong = `Khẩu hiệu tối đa ${LIMITS.guildMotto.max} ký tự`;
export const mottoFormat = 'Khẩu hiệu không được có ký tự ẩn';
export const nameTaken = 'Tên này đã có tổ đội dùng rồi, bạn chọn tên khác nhé';
export const nameNotAllowed = 'Tên hoặc khẩu hiệu này chưa phù hợp. Bạn chọn cách nói khác nhé.';

// S54
export const manageTitle = 'Quản lý tổ đội';
export const inviteCodeLabel = 'Mã mời của nhóm';
export const invitation = (guildName: string, code: string) => `Mình mời bạn vào tổ đội "${guildName}" trên Hồi Máu. Mã mời: ${code}`;
export const shareFailed = 'Chưa mở được bảng chia sẻ. Bạn thử lại nhé.';
export const membersTitle = 'Thành viên';
export const membersHint = 'Xem vai trò trong nhóm';
export const roleLabel = { LEADER: 'Trưởng nhóm', MEMBER: 'Thành viên' } as const;
export const transferAction = 'Chuyển vai trò trưởng nhóm';
export const transferTo = (name: string) => `${transferAction} cho ${name}`;
export const transferTitle = 'Chuyển vai trò trưởng nhóm?';
export const transferBody = (name: string) => `${name} sẽ là trưởng nhóm, còn bạn trở thành thành viên. Bạn có thể rời tổ đội sau khi chuyển.`;
export const transferConfirm = 'Chuyển vai trò';
export const transferCancel = 'Chưa chuyển';
export const transferred = (name: string) => `${name} đã là trưởng nhóm.`;
export const notLeaderAny = 'Bạn không còn là trưởng nhóm nên chưa chuyển được.';
export const transferTargetGone = 'Người này không còn trong tổ đội nên chưa chuyển được.';
export const nudgeSettingsTitle = 'Nhắc nhở trong nhóm';
export const nudgeSettingsHint = 'Tùy chọn nhận lời nhắc';
export const leaveTitle = 'Rời tổ đội';
export const leaveBody = 'Bạn vẫn giữ tiến trình cá nhân.';
export const leaderMustTransfer = 'Bạn đang là trưởng nhóm và còn thành viên khác. Hãy chuyển vai trò trưởng nhóm cho một người rồi mới rời được.';
export const leaveAction = 'Xem xác nhận rời nhóm';
export const leaveDialogTitle = 'Rời tổ đội?';
export const leaveDialogBody = (guildName: string) => `Bạn sẽ rời tổ đội "${guildName}". Tiến trình cá nhân của bạn (cấp, xu, chuỗi ngày) vẫn được giữ.`;
export const leaveAloneNote = 'Bạn là người duy nhất trong tổ đội nên tổ đội và mã mời sẽ được xóa.';
export const leaveConfirm = 'Rời tổ đội';
export const leaveCancel = 'Ở lại';
export const notInGuild = 'Bạn không còn trong tổ đội này.';
export const noGuildTitle = 'Bạn chưa có tổ đội';
export const noGuildBody = 'Tạo một nhóm hoặc tham gia bằng mã mời từ bạn bè.';
export const backToGuild = 'Về tab Tổ đội';
