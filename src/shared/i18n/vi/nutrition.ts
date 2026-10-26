// Manual calories (S16). Neutral about food and amounts: no judgement, no "over" and no "under".
import { LIMITS } from '../../../../domain/validation.ts';
import type { IngredientTag, MealSlot, STYLE_TAGS } from '../../../../domain/types.ts';
import { formatNumber } from './pet';

export const manualTitle = 'Ghi bữa ăn';
export const manualSubtitle = 'Ăn khác thực đơn? Bạn vẫn ghi lại được.';
export const kcalLabel = 'Số kcal';
export const kcalPlaceholder = 'Nhập số trên nhãn hoặc ước tính';
export const labelLabel = 'Tên món';
export const labelHelper = 'Không bắt buộc';
export const labelPlaceholder = 'Ví dụ: bún gà';
export const reassurance = 'Đây là ghi nhận để hiểu thói quen, không phải bài kiểm tra ăn uống.';
/** Said before saving: a logged meal stays. */
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

// ---- Meal plan (S13), meal detail (S14), swap (S15, S59). Neutral about food and amounts. ----
export const slotName: Record<MealSlot, string> = { BREAKFAST: 'Bữa sáng', LUNCH: 'Bữa trưa', DINNER: 'Bữa tối', SNACK: 'Bữa phụ' };
// Tables, not string methods: the copy scan of recording.test.ts calls every function with plain numbers.
const slotLower: Record<MealSlot, string> = { BREAKFAST: 'bữa sáng', LUNCH: 'bữa trưa', DINNER: 'bữa tối', SNACK: 'bữa phụ' };

// S13.
export const planTitle = 'Thực đơn hôm nay';
export const planSubtitle = 'Bạn có thể đổi từng món theo sở thích.';
export const planCardTitle = 'Ăn đủ để có năng lượng';
export const planCardBody = 'Chọn món phù hợp với bạn. Món ngoài thực đơn vẫn có thể ghi lại.';
export const eaten = (kcal: number, target: number) => `Đã ăn ${formatNumber(kcal)} / ${formatNumber(target)} kcal`;
export const windowLine = (min: number, max: number) => `Việc chính hoàn thành khi tổng cả ngày trong ${formatNumber(min)}–${formatNumber(max)} kcal`;
export const slotLogged = 'đã ghi';
export const slotWaiting = 'đang chờ gửi';
/** The second line of a slot row. */
export const slotLine = (name: string, kcal: number, status: 'logged' | 'waiting' | 'open') =>
  status === 'open' ? `${name} · gợi ý khoảng ${formatNumber(kcal)} kcal` : `${name} · ${formatNumber(kcal)} kcal · ${status === 'logged' ? slotLogged : slotWaiting}`;
export const slotNoMeal = 'Chưa có gợi ý cho bữa này';
export const macroWarning = 'Món gần nhất hiện có, lệch so với mục tiêu của bữa';

// S14.
export const detailKicker = (slot: MealSlot, isLogged: boolean) => `${slotName[slot]} · ${isLogged ? slotLogged : 'gợi ý từ thư viện'}`;
export const nutritionHeading = 'Dinh dưỡng mỗi phần';
export const kcalValue = (kcal: number) => `${formatNumber(kcal)} kcal`;
export const protein = (grams: number) => `Đạm ${formatNumber(grams)} g`;
export const carbs = (grams: number) => `Carb ${formatNumber(grams)} g`;
export const fat = (grams: number) => `Béo ${formatNumber(grams)} g`;
export const estimateNote = 'Số liệu ước tính, không phải số đo chính xác.';
export const ingredientsTitle = 'Thành phần & dị ứng';
export const ingredientsHint = 'Kiểm tra nguyên liệu trước khi chọn';
export const ingredientsCaveat = 'Nhãn chỉ giúp nhận biết nhanh. Nếu bạn dị ứng, hãy tự kiểm tra nguyên liệu.';
export const logMeal = 'Ghi nhận món này';
/** Said before saving: a logged meal stays. */
export const mealCannotRemove = 'Bữa đã ghi không xóa được, nên bạn xem lại món trước khi ghi nhận nhé.';
export const swapOther = 'Đổi món khác';
export const loggedTitle = 'Đã ghi';
export const loggedBody = 'Món này đã nằm trong tổng hôm nay.';
export const noMealTitle = 'Chưa có món cho bữa này';
export const noMealBody = 'Các món phù hợp đang bị loại trừ. Bạn có thể xem gợi ý khác hoặc ghi món ngoài thực đơn.';
export const seeSuggestions = 'Xem gợi ý khác';

// Tags in words. `tagLabel` names what can be avoided (S15 sheet); `tagWords` says what a meal is or contains.
export const tagLabel: Record<IngredientTag, string> = {
  'co:thit-do': 'Thịt đỏ',
  'co:gia-cam': 'Gia cầm',
  'co:hai-san': 'Hải sản',
  'co:trung': 'Trứng',
  'co:sua': 'Sữa',
  'co:dau-phong': 'Đậu phộng',
  'co:gluten': 'Gluten',
  'co:dau-nanh': 'Đậu nành',
};
export const styleWord: Record<(typeof STYLE_TAGS)[number], string> = { chay: 'chay', 'khong-thit': 'không thịt', 'it-nau': 'ít nấu', 'ngoai-hang': 'dễ mua ngoài' };
/** What a meal contains, as a word. */
export const containsWord: Record<IngredientTag, string> = {
  'co:thit-do': 'có thịt đỏ',
  'co:gia-cam': 'có gia cầm',
  'co:hai-san': 'có hải sản',
  'co:trung': 'có trứng',
  'co:sua': 'có sữa',
  'co:dau-phong': 'có đậu phộng',
  'co:gluten': 'có gluten',
  'co:dau-nanh': 'có đậu nành',
};

// S15.
export const swapTitle = (slot: MealSlot) => `Đổi món ${slotLower[slot]}`;
export const swapSubtitle = 'Chọn một gợi ý khác phù hợp với bạn.';
export const swapsLeft = (count: number, slot: MealSlot) => `Còn ${count} lượt đổi cho ${slotLower[slot]} hôm nay`;
export const excludeLabel = 'Loại trừ nguyên liệu';
export const excludeField = 'Chọn thực phẩm cần tránh';
/** `labels`: the labels of the tags, joined with ", ". */
export const excludeFieldWith = (labels: string) => `Đang tránh: ${labels}`;
export const excludeSheetTitle = 'Nguyên liệu cần tránh';
export const excludeNote = 'Áp dụng cho các gợi ý mới. Món đã có trong thực đơn hôm nay giữ nguyên.';
export const excludeSave = 'Lưu';
export const excludeNotSaved = (reason: string) => `Chưa lưu được nguyên liệu cần tránh. ${reason}`;
export const excludeUnknown = 'Chưa tải được nguyên liệu đang tránh.';
export const pickHint = 'Chọn món thay thế để xem thay đổi năng lượng trước khi xác nhận.';
export const candidatesGroup = 'Gợi ý thay thế';
export const chooseMeal = 'Chọn món này';
/** "ít hơn 30 kcal". The delta is rounded for display; it comes unrounded from the server. */
export const deltaText = (delta: number) => {
  const rounded = Math.round(Math.abs(delta));
  return rounded === 0 ? 'bằng món hiện tại' : `${delta < 0 ? 'ít' : 'nhiều'} hơn ${formatNumber(rounded)} kcal`;
};
/** "790 kcal · ít hơn 30 kcal · không thịt"; `tagText` is `tagWords(tags)` joined with " · " (may be empty). */
export const candidateLine = (kcal: number, delta: number, tagText: string) => [`${formatNumber(kcal)} kcal`, deltaText(delta), tagText].filter(Boolean).join(' · ');
export const candidatesChanged = 'Gợi ý vừa thay đổi. Bạn chọn lại từ danh sách mới nhé.';
export const swapNotDone = (reason: string) => `Chưa đổi được món. ${reason} Món cũ vẫn được giữ.`;
export const noCandidateTitle = 'Chưa có món phù hợp hơn';
export const noCandidateBody = 'Hiện chưa có món nào khác hợp với bữa này.';
export const noCandidateExcluded = 'Hiện chưa có món nào khác hợp với bữa này. Bạn có thể thử bỏ bớt nguyên liệu loại trừ.';
export const loosen = 'Bỏ bớt nguyên liệu loại trừ';

// S59.
export const usedLine = (used: number, allowed: number, slot: MealSlot) => `Đã dùng ${used}/${allowed} lượt đổi cho ${slotLower[slot]}`;
export const usedAll = (slot: MealSlot) => `Đã dùng hết lượt đổi cho ${slotLower[slot]}`;
export const limitNote = (slot: MealSlot) => `${slotName[slot]} đã đổi đủ lượt hôm nay. Ngày mai thực đơn sẽ có gợi ý mới.`;
/** The slot was logged meanwhile: this is not the limit. */
export const slotLoggedNote = (slot: MealSlot) => `${slotName[slot]} đã được ghi nên không đổi món được nữa.`;
export const logOutside = 'Ghi món ngoài thực đơn';
export const seePerks = 'Xem tiện ích';
export const perksHint = 'Tiện ích cấp độ';
/** A read of the plan or the candidates met the turn of the logical date (once retried already). */
export const dayTurned = 'Ngày mới vừa bắt đầu nên thực đơn đang được làm mới. Bạn thử lại nhé.';
