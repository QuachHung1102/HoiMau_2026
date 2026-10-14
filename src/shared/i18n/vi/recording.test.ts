import { findBannedTerms } from '../../../../domain/language.ts';
import * as nutrition from './nutrition';
import * as quests from './quests';
import * as workout from './workout';

// Every string of the quest board, the end of the day and the manual calories (spec 9.4): functions are called with
// ordinary arguments, tables are flattened. Neutral about food and amounts; an intention to rest, not surveillance.
const SAMPLES = [1, 8, 30, 450, 2380, 5000];
function texts(module: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (typeof value === 'function') {
      for (const sample of SAMPLES) {
        for (const result of [value(sample), value(sample, sample), value(String(sample), String(sample), String(sample), String(sample)), value('lý do')]) add(result);
      }
    } else if (Array.isArray(value)) value.forEach(add);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(add);
  };
  Object.values(module).forEach(add);
  return out;
}

const all = [...texts(quests), ...texts(nutrition), ...texts(workout)];

test('the strings were collected (the scan below is not vacuous)', () => {
  expect(all.length).toBeGreaterThan(80);
  expect(all).toContain('Chúc bạn nghỉ ngon');
  expect(all).toContain('Buổi này chưa tính hoàn thành việc chính hôm nay. Bạn có thể tập tiếp khi sẵn sàng.');
  expect(texts(workout).length).toBeGreaterThan(80);
  expect(all).toContain('Bữa đã ghi không xóa được, nên bạn xem lại số kcal trước khi lưu nhé.');
});

test('none of them uses a term spec 9.4 bans', () => {
  expect(all.flatMap(text => findBannedTerms(text).map(term => `${term}: ${text}`))).toEqual([]);
});

test('none of them judges an amount of food, or the person, or the night', () => {
  // words of judgement, not of information, compared as whole words with their tone marks ("đủ" is not "dư")
  const judging = new Set(['vượt', 'quá', 'thừa', 'dư', 'kém', 'lười', 'tồi', 'xấu', 'hư']);
  const words = (text: string) => text.toLowerCase().normalize('NFC').split(/[^\p{L}]+/u);
  expect(all.filter(text => words(text).some(word => judging.has(word)))).toEqual([]);
  // the check itself sees them
  expect(words('Bạn đã vượt mức, quá nhiều')).toEqual(expect.arrayContaining(['vượt', 'quá']));
});

test('the sentences the brief fixes are there, word for word', () => {
  expect(quests.eodLocked).toBe('Mở từ 18:00');
  expect(quests.eodGoodNight).toBe('Chúc bạn nghỉ ngon');
  expect(quests.eodNoReward).toBe('Đã ghi lại. Nhiệm vụ ẩn dành cho những hôm khép lại trước 23:00.');
  expect(quests.standUpPrompt).toBe('Đến lúc đứng dậy vươn vai một chút');
  expect(quests.standUpAction).toBe('Mình vừa đứng dậy');
  expect(quests.nextReminder(42)).toBe('Lần nhắc tới sau 42 phút');
  expect(quests.boardFooter).toBe('Ngày của bạn khép lại theo múi giờ hồ sơ. Không cần thức chờ để giữ chuỗi.');
  expect(nutrition.questReward(50)).toBe('+50 XP · Bữa ăn theo mục tiêu đã xong');
  expect(nutrition.kcalRange).toBe('Số kcal từ 1 đến 5.000');
});

test('the sentences the workout brief fixes are there, word for word', () => {
  expect(workout.spaceText).toEqual({ DESK_SIDE: 'Cạnh bàn', ROOM: 'Trong phòng', GYM: 'Phòng gym', OUTDOOR: 'Ngoài trời' });
  expect([workout.noEquipment, workout.equipmentText.tham, workout.equipmentText['ta-tay'], workout.equipmentText['day-khang-luc']]).toEqual(['Không cần', 'Thảm', 'Tạ tay', 'Dây kháng lực']);
  expect([5, 15, 30, 45].map(workout.minutes)).toEqual(['5 phút', '15 phút', '30 phút', '45 phút']);
  expect(workout.fitsArchetype('Đỡ Đòn')).toBe('Hợp với Đỡ Đòn');
  expect(workout.emptyTitle).toBe('Chưa có bài phù hợp');
  expect(workout.clearFilters).toBe('Xóa bớt bộ lọc');
  expect(workout.meta(15, workout.spaceText.ROOM, workout.noEquipmentNeeded)).toBe('15 phút · Trong phòng · Không dụng cụ');
  // energy is never stated as a fact
  expect(workout.summary(3, 6, 70)).toBe('3 hiệp · 6 động tác · khoảng 70 kcal (ước tính)');
  expect(workout.start).toBe('Bắt đầu tập');
  expect(workout.changeWorkout).toBe('Đổi buổi tập');
  expect(workout.setAndMove(2, 3, 4, 6)).toBe('Hiệp 2 / 3 · Động tác 4 / 6');
  expect(`${workout.clock(522)} ${workout.remaining}`).toBe('08:42 còn lại');
  expect(workout.clock(0)).toBe('00:00');
  expect(workout.clock(2700)).toBe('45:00');
  expect([workout.pause, workout.resume, workout.endSession]).toEqual(['Tạm dừng', 'Tập tiếp', 'Kết thúc buổi tập']);
  expect(workout.soundUnavailable).toBe('Bản này chưa có âm thanh');
  expect(workout.pausedTitle).toBe('Đang tạm dừng');
  expect([workout.exitTitle, workout.endAndSave]).toEqual(['Thoát buổi tập?', 'Kết thúc và lưu']);
  expect(workout.completedTitle).toBe('Bạn đã dành thời gian cho mình');
  expect(workout.partialNote).toContain('chưa tính hoàn thành việc chính');
  expect(workout.queuedTitle).toBe('Buổi tập đã lưu trên máy, đang chờ gửi');
  expect([workout.planMeal, workout.planWorkout, workout.planTargets]).toEqual(['Thực đơn hôm nay', 'Chọn buổi tập', 'Mục tiêu của bạn']);
});
