// Quests and the states of a recorded tick (Task 25: the water tracker on Hôm nay; Task 26 adds the board).

/** Titles by `QuestState.titleKey`. Only the quests a screen shows by name so far. */
export const questTitle: Partial<Record<string, string>> = {
  WORKOUT_MAIN: 'Vận động vừa sức',
  NUTRITION_TARGET: 'Ăn đủ cho mục tiêu',
};
export const reward = (xp: number) => `+${xp} XP`;
export const questDone = 'Đã xong';

// The water tracker.
export const waterTitle = 'Nước hôm nay';
export const recordWater = 'Ghi nhận nước';
export const waterCount = (count: number, target: number) => `${count} / ${target} phần`;
export const waterHint = 'Mỗi phần theo mục tiêu nước của bạn.';
/** Why the tracker and its button are off. */
export const waterFull = (target: number) => `Đã ghi đủ ${target} phần hôm nay.`;
// Shown after the count: "4 / 8 phần · đang lưu". "đã lưu" only after the server's answer.
export const saving = 'đang lưu';
export const saved = 'đã lưu';
export const withStatus = (text: string, status: string) => `${text} · ${status}`;
/** For the tracker's label. No number: how many records wait is said once, by the row above the app. */
export const waterWaiting = 'Có phần đang chờ gửi';
export const tapToRecord = 'Chạm để ghi thêm một phần.';

// After the server's answer (S57). Never a number of seconds here: the snackbar shows the time left itself.
export const recorded = (xp: number) => (xp > 0 ? `Đã ghi nhận · +${xp} XP` : 'Đã ghi nhận');
export const undo = 'Hoàn tác';
export const undone = 'Đã hoàn tác';
/** The undo was refused, or its time is over. */
export const undoUnavailable = 'Không hoàn tác được nữa, ghi nhận vẫn được giữ';
/** The undo did not reach the server and can still be tried again. */
export const undoOffline = 'Chưa hoàn tác được, ghi nhận vẫn được giữ';

/** S58, next to the tracker; `reason` is `failureText(code)` of vi/sync.ts. */
export const waterNotSaved = (reason: string) => `Chưa lưu được phần nước vừa ghi. ${reason}`;
