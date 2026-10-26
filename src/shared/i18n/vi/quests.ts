// Quests and the states of a recorded tick (the water tracker on Hôm nay, then the quest board).

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
/** The undo was refused because the coins of that record have been spent (a purchase in between); nothing to retry. */
export const undoCoinsSpent = 'Không hoàn tác được vì xu của ghi nhận này đã được dùng. Ghi nhận vẫn được giữ.';
/** The undo did not reach the server and can still be tried again. */
export const undoOffline = 'Chưa hoàn tác được, ghi nhận vẫn được giữ';

/** S58, next to the tracker; `reason` is `failureText(code)` of vi/sync.ts. */
export const waterNotSaved = (reason: string) => `Chưa lưu được phần nước vừa ghi. ${reason}`;

// Quest board (S10). Titles are keyed by quest code; Hôm nay (above) names the two main tasks differently, as the frames do.
export const boardTitle = 'Nhiệm vụ hôm nay';
export const boardSubtitle = 'Ghi điều bạn đã làm, từng chút một.';
export const storySection = 'Giữ nhịp hôm nay';
export const habitsSection = 'Thói quen nhỏ';
export const boardQuestTitle: Partial<Record<string, string>> = {
  WORKOUT_MAIN: 'Buổi tập chính',
  NUTRITION_TARGET: 'Bữa ăn theo mục tiêu',
  WATER_8: 'Uống nước',
  STAND_UP: 'Đứng dậy một chút',
  BEDTIME_BEFORE_23: 'Khép lại hôm nay trước 23:00',
};
export const hiddenLockedTitle = 'Nhiệm vụ ẩn';
export const hiddenLockedHint = 'Mở vào buổi tối';
export const boardFooter = 'Ngày của bạn khép lại theo múi giờ hồ sơ. Không cần thức chờ để giữ chuỗi.';
export const boardKcal = (eaten: string, target: string, min: string, max: string) => `${eaten} / ${target} kcal · hoàn thành khi trong ${min}–${max} kcal`;
export const perPart = (xp: number) => `+${xp} XP mỗi phần`;
export const perTime = (xp: number) => `+${xp} XP mỗi lần`;
export const standUpCount = (count: number, target: number) => `${count} / ${target} lần`;
export const nextReminder = (minutes: number) => `Lần nhắc tới sau ${minutes} phút`;
export const tapToRecordTime = 'Chạm để ghi thêm một lần.';
export const standUpFull = (target: number) => `Đã ghi đủ ${target} lần hôm nay.`;
/** S58 pattern for the board's second tick; `reason` is `failureText(code)`. */
export const standUpNotSaved = (reason: string) => `Chưa lưu được lần đứng dậy vừa ghi. ${reason}`;

// The stand-up prompt (a snackbar while the app is open; never an OS notification).
export const standUpPrompt = 'Đến lúc đứng dậy vươn vai một chút';
export const standUpAction = 'Mình vừa đứng dậy';

// End of day (S45).
export const eodTitle = 'Khép lại hôm nay';
export const eodSubtitle = 'Bạn đã dành sự chú ý cho bản thân.';
export const eodHeadline = 'Đến lúc nghỉ một chút.';
export const eodBody = 'Ghi lại ý định nghỉ ngơi. Bạn vẫn có thể quay lại ứng dụng sau đó.';
/** What the mark means; nothing is watched and nothing is checked afterwards. */
export const eodMeaning = 'Đây chỉ là lời nhắc nhẹ cho chính bạn, không ai theo dõi giờ bạn ngủ. Dùng điện thoại sau khi ghi cũng không sao.';
export const eodHidden = (xp: number) => `Nhiệm vụ ẩn: trước 23:00 · +${xp} XP`;
export const eodAction = 'Ghi nhận kết thúc ngày';
/** Why the button is off while the hidden quest is locked. */
export const eodLocked = 'Mở từ 18:00';
export const eodGoodNight = 'Chúc bạn nghỉ ngon';
export const eodReward = (xp: number) => `+${xp} XP · Nhiệm vụ ẩn đã xong`;
export const eodNoReward = 'Đã ghi lại. Nhiệm vụ ẩn dành cho những hôm khép lại trước 23:00.';
export const eodAlready = 'Hôm nay bạn đã ghi ý định nghỉ ngơi rồi. Không cần làm gì thêm.';
export const eodWaiting = 'Giờ nghỉ đã lưu trên máy và sẽ được gửi khi có mạng.';
export const eodNotSaved = (reason: string) => `Chưa ghi được giờ nghỉ. ${reason}`;
export const backToToday = 'Quay lại Hôm nay';
