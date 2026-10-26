// Offline state and the pending-action queue (S38).
import { errorText, unknownError } from './common';

// The banner. "đã lưu trên máy" is never shortened to "đã lưu": only the server's answer makes a record saved.
export const offlineTitle = 'Bạn đang ngoại tuyến';
export const waitingOnDevice = (count: number) => `${count} ghi nhận đang chờ gửi — đã lưu trên máy`;
export const synced = 'Đã đồng bộ';
export { retry } from './common';

// What a write screen shows when a record could not even be kept on this device.
export const queueFull = 'Hàng chờ đã đầy, cần kết nối mạng để ghi tiếp';
export const notKeptOnDevice = 'Máy chưa giữ được ghi nhận này. Bạn thử lại nhé.';

// A record the server refused.
export const rejectedTitle = 'Ghi nhận không được tính';
export const dayClosed = 'Ngày đó đã khép lại nên ghi nhận này không được tính. Bạn không làm gì sai cả.';
export const rejectedGeneric = 'Hệ thống không nhận ghi nhận này nên nó không được tính.';
export const understood = 'Đã hiểu';

// Why, per refusal code of the four queueable routes. Codes that only a programming error can cause get the generic line.
const refusalReason: Partial<Record<string, string>> = {
  OCCURRED_AT_INVALID: 'Ngày giờ trên máy đang lệch so với hệ thống. Bạn kiểm tra ngày giờ của máy nhé.',
  QUEST_ALREADY_COMPLETE: 'Nhiệm vụ này đã hoàn thành từ trước.',
  QUEST_NOT_FOUND: 'Nhiệm vụ này không còn trong ngày của bạn.',
  MEAL_ALREADY_LOGGED: 'Bữa này đã được ghi từ trước.',
  BEDTIME_TOO_EARLY: 'Lúc đó còn sớm để ghi giờ đi ngủ.',
  PLAN_NOT_FOUND: 'Thực đơn của ngày đó chưa sẵn sàng.',
  ONBOARDING_REQUIRED: 'Bạn cần hoàn tất hồ sơ trước khi ghi nhận.',
};

const recordKind: [RegExp, string][] = [
  [new RegExp('^/day/quests/'), 'Ghi nhận: nhiệm vụ trong ngày'],
  [new RegExp('^/day/bedtime$'), 'Ghi nhận: giờ đi ngủ'],
  [new RegExp('^/nutrition/log$'), 'Ghi nhận: bữa ăn'],
  [new RegExp('^/workout/complete$'), 'Ghi nhận: buổi tập'],
];
/** Which record a refusal is about, from its path. */
export const recordLabel = (path: string) => recordKind.find(([pattern]) => pattern.test(path))?.[1];

const shared: Partial<Record<string, string>> = errorText;
/** The notice for a refused record. */
export const rejectionText = (code: string) => (code === 'DAY_CLOSED' ? dayClosed : [rejectedGeneric, refusalReason[code] ?? shared[code]].filter(Boolean).join(' '));
/** The reason next to the control when `useQueuedWrite().send` answers `failed`. */
export const failureText = (code: string) =>
  code === 'QUEUE_FULL' ? queueFull : code === 'STORAGE_FAILED' ? notKeptOnDevice : code === 'DAY_CLOSED' ? dayClosed : refusalReason[code] ?? shared[code] ?? unknownError;

// The stored queue could not be read.
export const corruptTitle = 'Có ghi nhận chờ gửi bị lỗi';
export const corruptBody = 'Một số ghi nhận đang chờ gửi trên máy không đọc được nên không gửi đi được. Ghi nhận mới vẫn được lưu và gửi như thường.';

// Signing out while records are still waiting.
export const signOutPendingTitle = (count: number) => `Còn ${count} ghi nhận chưa gửi`;
export const signOutPendingBody = 'Các ghi nhận này mới chỉ lưu trên máy. Nếu đăng xuất bây giờ, chúng sẽ bị bỏ và không được tính.';
// The stored queue could not be read at that moment: no number can be named.
export const signOutUnreadTitle = 'Có thể còn ghi nhận chưa gửi';
export const signOutUnreadBody = 'Máy chưa đọc được các ghi nhận đang chờ gửi. Nếu đăng xuất bây giờ, những ghi nhận chưa gửi trên máy này sẽ bị bỏ và không được tính.';
export const stay = 'Ở lại';
export const signOutAndDiscard = 'Đăng xuất và bỏ các ghi nhận này';
