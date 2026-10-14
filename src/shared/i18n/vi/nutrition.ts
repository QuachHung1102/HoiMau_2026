// Manual calories (S16, Task 26). Neutral about food and amounts: no judgement, no "over" and no "under".
import { LIMITS } from '../../../../domain/validation.ts';
import { formatNumber } from './pet';

export const manualTitle = 'Ghi bữa ăn';
export const manualSubtitle = 'Ăn khác thực đơn? Bạn vẫn ghi lại được.';
export const kcalLabel = 'Số kcal';
export const kcalPlaceholder = 'Nhập số trên nhãn hoặc ước tính';
export const labelLabel = 'Tên món';
export const labelHelper = 'Không bắt buộc';
export const labelPlaceholder = 'Ví dụ: bún gà';
export const reassurance = 'Đây là ghi nhận để hiểu thói quen, không phải bài kiểm tra ăn uống.';
/** Said before saving: a logged meal stays (AR-12). */
export const cannotRemove = 'Bữa đã ghi không xóa được, nên bạn xem lại số kcal trước khi lưu nhé.';
export const saveAction = 'Ghi món đã ăn';

export const todayTotal = 'Hôm nay';

// Field errors (the limits are the domain's).
export const kcalRequired = 'Nhập số kcal của món này';
export const kcalFormat = 'Chỉ nhập chữ số, ví dụ 450';
export const kcalRange = `Số kcal từ ${formatNumber(LIMITS.manualKcal.min)} đến ${formatNumber(LIMITS.manualKcal.max)}`;
export const labelTooLong = `Tên món tối đa ${LIMITS.mealLabel.max} ký tự`;

// After the server's answer.
export const logged = (total: number) => `Đã ghi. Tổng hôm nay: ${formatNumber(total)} kcal`;
export const questReward = (xp: number) => `+${xp} XP · Bữa ăn theo mục tiêu đã xong`;
/** Beside the button when the record could not be made; `reason` is `failureText(code)`. */
export const notSaved = (reason: string) => `Chưa ghi được bữa ăn. ${reason}`;
/** Queued: kept on this device, no reward. */
export const waitingTitle = 'Đang chờ gửi';
export const waitingBody = 'Bữa ăn đã lưu trên máy và sẽ được gửi khi có mạng. Tổng hôm nay cập nhật sau đó.';
export const done = 'Xong';
/** The day total could not be read; the form still works. */
export const totalUnknown = 'Chưa tải được tổng hôm nay.';
