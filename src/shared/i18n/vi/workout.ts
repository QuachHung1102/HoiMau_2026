// The plan tab (S12), the workout catalog (S17, S48) and detail (S18), the focus session (S19, S41, S63) and its
// result (S20, S64). Neutral about how much was done: a short session is a session.
import type { WorkoutDetail } from '../../../../domain/contract/content.ts';
import type { Modality, SpaceRequirement } from '../../../../domain/types.ts';
import { formatNumber } from './pet';

type Phase = WorkoutDetail['steps'][number]['phase'];

// ---- S12, the plan tab ----
export const planSubtitle = 'Ăn đủ, vận động vừa sức, nghỉ ngơi đều.';
export const planTodayTitle = 'Hôm nay của bạn';
export const planWorkoutNotStarted = 'Buổi tập chính: chưa bắt đầu';
export const planWorkoutDone = 'Buổi tập chính: đã hoàn thành';
export const planKcalStatus = (line: string) => `Bữa ăn: ${line}`;
export const planWorkoutWaiting = 'Có buổi tập đã lưu trên máy, đang chờ gửi';
export const planMeal = 'Thực đơn hôm nay';
export const planMealHint = 'Gợi ý phù hợp mục tiêu của bạn';
export const planWorkout = 'Chọn buổi tập';
export const planWorkoutHint = 'Chọn thời lượng, không gian, dụng cụ';
export const planTargets = 'Mục tiêu của bạn';
export const planTargetsHint = 'Năng lượng, nước và phân bổ ước tính';
export const planFooter = 'Một ngày không như kế hoạch cũng không xóa đi những gì bạn đã làm.';

// ---- S17, the catalog ----
export const catalogTitle = 'Chọn buổi tập';
export const catalogSubtitle = 'Một buổi phù hợp với thời gian bạn có.';
export const durationGroup = 'Thời lượng';
export const minutes = (count: number) => `${count} phút`;
export const spaceGroup = 'Không gian';
export const spaceText: Record<SpaceRequirement, string> = { DESK_SIDE: 'Cạnh bàn', ROOM: 'Trong phòng', GYM: 'Phòng gym', OUTDOOR: 'Ngoài trời' };
export const equipmentGroup = 'Dụng cụ bạn đang có';
export const noEquipment = 'Không cần';
/** By equipment code of the content (`tham`, `ta-tay`, `day-khang-luc`). */
export const equipmentText: Partial<Record<string, string>> = { tham: 'Thảm', 'ta-tay': 'Tạ tay', 'day-khang-luc': 'Dây kháng lực' };
export const modalityText: Record<Modality, string> = {
  RESISTANCE: 'Vận động kháng lực',
  CARDIO: 'Vận động tim mạch',
  HIIT: 'Vận động ngắt quãng',
  MOBILITY: 'Giãn cơ và linh hoạt',
  BREATHING: 'Hít thở và thả lỏng',
};
export const fitsArchetype = (name: string) => `Hợp với ${name}`;
export const suggested = (modality: string) => `${modality} · gợi ý cho bạn`;
export const seeGuide = 'Xem hướng dẫn';
/** "Vận động tim mạch · khoảng 80 kcal (ước tính)" */
export const dotted = (...parts: string[]) => parts.join(' · ');
// S48: nothing matches. Not an error, and not the same as a list that could not be loaded.
export const emptyTitle = 'Chưa có bài phù hợp';
export const emptyBody = 'Bạn có thể chọn thời lượng khác, hoặc bỏ bớt yêu cầu về dụng cụ và không gian.';
export const clearFilters = 'Xóa bớt bộ lọc';

// ---- S18, one workout ----
export const noEquipmentNeeded = 'Không dụng cụ';
/** "15 phút · Trong phòng · Không dụng cụ" */
export const meta = (minuteCount: number, space: string, equipment: string) => `${minutes(minuteCount)} · ${space} · ${equipment}`;
export const kcalEstimate = (kcal: number) => `khoảng ${formatNumber(kcal)} kcal (ước tính)`;
/** "3 hiệp · 6 động tác · khoảng 70 kcal (ước tính)": the energy is always named as an estimate. */
export const summary = (sets: number, moves: number, kcal: number) => `${sets} hiệp · ${moves} động tác · ${kcalEstimate(kcal)}`;
export const firstMove = 'Động tác đầu tiên';
export const demoCaption = (moves: number) => `Xem động tác mẫu · ${moves} động tác · không có âm thanh`;
/** The play affordance on the demo of the first move. */
export const watchDemo = (move: string) => `Xem động tác mẫu: ${move}`;
export const phasesTitle = 'Đi theo nhịp của bạn';
export const phaseTitle: Record<Phase, string> = { WARMUP: 'Khởi động', MAIN: 'Phần tập chính', COOLDOWN: 'Thả lỏng' };
export const phaseHint: Record<Phase, string> = { WARMUP: 'Chuyển động chậm, có kiểm soát', MAIN: 'Theo hướng dẫn từng động tác', COOLDOWN: 'Kết thúc nhẹ nhàng' };
export const movesTitle = 'Các động tác';
export const phaseShort: Record<Phase, string> = { WARMUP: 'Khởi động', MAIN: 'Phần chính', COOLDOWN: 'Thả lỏng' };
/** "Phần chính · 12 lần" */
export const moveLine = (phase: string, reps: string) => `${phase} · ${reps}`;
export const start = 'Bắt đầu tập';
export const changeWorkout = 'Đổi buổi tập';

// ---- S19 / S41, the session ----
export const focusTitle = 'Đang tập';
export const focusSubtitle = (name: string) => `${name} · đang diễn ra`;
export const pausedTitle = 'Đang tạm dừng';
export const pausedSubtitle = (name: string) => `${name} · nghỉ một chút cũng được`;
export const pausedNote = 'Thời gian tạm dừng không tính vào buổi tập.';
export const closeSession = 'Thoát buổi tập';
export const howTo = 'Cách thực hiện';
export const setAndMove = (set: number, sets: number, move: number, moves: number) => `Hiệp ${set} / ${sets} · Động tác ${move} / ${moves}`;
const two = (n: number) => String(n).padStart(2, '0');
/** 522 -> "08:42" */
export const clock = (seconds: number) => `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`;
export const remaining = 'còn lại';
/** What a screen reader hears for the ring. */
export const ringLabel = (time: string) => `Thời gian còn lại ${time}`;
export const moveRemaining = (time: string) => `Động tác này còn ${time}`;
export const pause = 'Tạm dừng';
export const resume = 'Tập tiếp';
export const sound = 'Âm thanh';
export const soundUnavailable = 'Bản này chưa có âm thanh';
export const breathe = 'Hít thở đều. Bạn không cần cố theo nhịp của ai khác.';
export const endSession = 'Kết thúc buổi tập';

// ---- S82, one move's demo ----
export const demoPause = 'Tạm dừng';
export const demoPlay = 'Phát tiếp';
export const slowMotion = 'Xem chậm 0,5×';
export const noSound = 'Không có âm thanh';
export const stepsTitle = 'Cách làm';
export const cautionTitle = 'Lưu ý';
export const backToSession = 'Quay lại buổi tập';
export const moveMissing = 'Không tìm thấy động tác này trong buổi tập.';
/** `focus-breathe` (Thở 4-4): the phases of its guide, one 8-second cycle. */
export const fourFourBreath = [
  { label: 'Hít vào 4 giây', ms: 4000 },
  { label: 'Thở ra 4 giây', ms: 4000 },
] as const;

// ---- S63, leaving ----
export const exitTitle = 'Thoát buổi tập?';
export const exitBody = (done: string, total: string) => `Bạn đã tập ${done} trên ${total}. Phần đã tập vẫn được lưu.`;
export const exitNote = 'Dưới một nửa thời lượng sẽ được ghi là buổi tập dở, vẫn nhận XP theo phần đã tập.';
export const endAndSave = 'Kết thúc và lưu';

// ---- what became of the record ----
export const savingTitle = 'Đang lưu buổi tập';
export const recorded = (done: string, total: string) => `Đã ghi ${done} trên ${total}`;
export const trained = (done: string, total: string) => `Bạn đã tập ${done} trên ${total}.`;
// On this device only: no reward is named until the server has it.
export const queuedTitle = 'Buổi tập đã lưu trên máy, đang chờ gửi';
export const queuedBody = 'Phần thưởng được tính khi hệ thống nhận được buổi tập này. Bạn không cần làm gì thêm.';
// It has left the device since (delivered, or answered by the system): the day says what became of it.
export const sentTitle = 'Buổi tập không còn chờ trên máy';
export const sentBody = 'Mở Hôm nay để xem kết quả.';
export const notSavedTitle = 'Chưa lưu được buổi tập';
// Leaving a session that is not saved anywhere: asked first.
export const unsavedTitle = 'Buổi tập chưa được lưu';
export const unsavedBody = (done: string) => `Nếu thoát bây giờ, ${done} bạn vừa tập sẽ không được ghi lại.`;
// Sent later by the queue and refused by the system: it is kept nowhere any more.
export const refusedTitle = 'Buổi tập không được tính';
export const leaveUnsaved = 'Thoát, không lưu';
export const toToday = 'Về Hôm nay';

// ---- S20, at least half of the duration ----
export const completedTitle = 'Bạn đã dành thời gian cho mình';
export const completedSubtitle = 'Buổi tập đã được ghi nhận.';
export const completedHeadline = 'Một bước nữa trên hành trình';
export const timeTrained = 'đã tập';
export const coinReward = (coin: number) => `+${formatNumber(coin)} xu`;
export const questCompleted = 'Việc chính: Buổi tập chính đã hoàn thành';
export const backToWorkout = 'Quay lại bài tập';

// ---- S64, under half ----
export const partialTitle = 'Bạn đã bắt đầu, vậy là tốt rồi';
export const partialXp = (xp: number) => `+${xp} XP theo phần đã tập`;
export const partialNote = 'Buổi này chưa tính hoàn thành việc chính hôm nay. Bạn có thể tập tiếp khi sẵn sàng.';
// The quest was completed by an earlier session of the day: this one does not change that.
export const partialQuestDone = 'Việc chính hôm nay đã xong từ buổi tập trước.';
export const continueWorkout = 'Tập tiếp';
