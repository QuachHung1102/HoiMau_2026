// Onboarding (S05, S06, S07, S08, S60) and the Targets screen. The health explanations of S08 / S62 / S43 / S61
// are NOT here: they are the reviewed copy in health.ts and are never paraphrased.
// Wording rules (spec 9.3, 9.4): no judgement of weight or body, no label for a body, numbers are estimates.
// Voice: the app says "mình" to "bạn". Every limit in a sentence is passed in from LIMITS (domain/validation.ts).
import type { ActivityLevel, Archetype, Sex } from '../../../../domain/types.ts';

/** 1500 -> "1.500" (the same grouping as health.ts; Hermes may lack Intl locale data, so no toLocaleString). */
export const grouped = (n: number): string => {
  let rest = String(Math.round(n));
  let out = '';
  while (rest.length > 3) {
    out = `.${rest.slice(-3)}${out}`;
    rest = rest.slice(0, -3);
  }
  return rest + out;
};

export const stepOf = (name: string, index: number, total: number) => `${name} · Bước ${index} trong ${total}`;

// S05
export const profileTitle = 'Bắt đầu từ bạn';
export const profileStep = 'Hồ sơ';
export const birthYearLabel = 'Năm sinh';
export const heightLabel = 'Chiều cao · cm';
export const weightLabel = 'Cân nặng · kg';
export const sexLabel = 'Giới tính dùng trong công thức';
export const sexName: Record<Sex, string> = { MALE: 'Nam', FEMALE: 'Nữ' };
export const timezoneLabel = 'Múi giờ';
export const timezonesNotLoaded = 'Chưa tải được danh sách múi giờ. Bạn vẫn có thể tiếp tục với múi giờ đang hiện.';
export const privacyTitle = 'Số đo chỉ mình bạn thấy';
export const privacyBody = 'Tổ đội không xem được cân nặng hay mục tiêu năng lượng của bạn.';

// S60: what to fix, with the valid range in words.
export const birthYearRequired = 'Nhập năm sinh của bạn.';
export const birthYearFormat = 'Nhập năm sinh bằng số, đủ bốn chữ số.';
export const ageRange = (minAge: number, maxAge: number) =>
  `Hồi Máu tính mục tiêu cho người từ ${minAge} đến ${maxAge} tuổi. Bạn xem lại năm sinh nhé.`;
export const heightRequired = 'Nhập chiều cao của bạn.';
export const heightFormat = (min: number, max: number) => `Nhập chiều cao bằng số, trong khoảng ${min}–${max} cm.`;
export const heightRange = (min: number, max: number) => `Chiều cao cần trong khoảng ${min}–${max} cm.`;
export const weightRequired = 'Nhập cân nặng của bạn.';
export const weightFormat = (min: number, max: number) => `Nhập cân nặng bằng số, trong khoảng ${min}–${max} kg.`;
export const weightRange = (min: number, max: number) => `Cân nặng cần trong khoảng ${min}–${max} kg.`;
export const sexRequired = 'Chọn giới tính dùng trong công thức.';
export const timezoneInvalid = 'Chọn một múi giờ trong danh sách.';
export const activityRequired = 'Chọn mức vận động gần với bạn nhất.';
export const archetypeRequired = 'Chọn một mục tiêu để tiếp tục.';

// S61 (the explanation is healthVi.under16)
export const checkBirthYear = 'Kiểm tra lại năm sinh';
export const learnMore = 'Tìm hiểu thêm';

// S06
export const activityTitle = 'Nhịp sống của bạn';
export const activityStep = 'Vận động';
export const activityGroup = 'Mức vận động thường ngày';
export const activityLevels: Record<ActivityLevel, { label: string; description: string }> = {
  SEDENTARY: { label: 'Phần lớn ngồi làm việc', description: 'Ít vận động ngoài sinh hoạt' },
  LIGHT: { label: 'Vận động nhẹ', description: 'Đi bộ, tập nhẹ trong tuần' },
  MODERATE: { label: 'Vận động vừa', description: 'Tập đều và đi lại thường xuyên' },
  ACTIVE: { label: 'Vận động nhiều', description: 'Tập nặng hoặc làm việc thể lực' },
  VERY_ACTIVE: { label: 'Vận động rất nhiều', description: 'Cường độ cao hằng ngày' },
};
export const activityNext = 'Chọn mục tiêu';

// S07: a direction filters the meals and workouts that are suggested; it is not a character class.
export const archetypeTitle = 'Bạn muốn điều gì?';
export const archetypeStep = 'Mục tiêu';
export const archetypeGroup = 'Mục tiêu của bạn';
export const archetypes: Record<Archetype, { name: string; headline: string; focus: string }> = {
  TANKER: { name: 'Đỡ Đòn', headline: 'Khỏe hơn mỗi ngày', focus: 'ưu tiên tăng cơ và kháng lực' },
  ASSASSIN: { name: 'Sát Thủ', headline: 'Nhẹ nhàng, bền bỉ', focus: 'ưu tiên sức bền và giảm mỡ' },
  SUPPORTER: { name: 'Hỗ Trợ', headline: 'Cân bằng lại nhịp sống', focus: 'tư thế, giấc ngủ và giảm căng thẳng' },
};
export const archetypeLine = (archetype: Archetype) => `${archetypes[archetype].name} · ${archetypes[archetype].focus}`;
export const archetypeNote =
  'Mục tiêu bạn chọn quyết định bữa ăn và bài tập được gợi ý. Bạn có thể đổi mục tiêu sau; tiến trình đã có vẫn được giữ.';
export const archetypeNext = 'Xem lộ trình của tôi';

// S43 (the explanation is healthVi.blockedArchetype; `label` is one of its two directions)
export const chooseDirection = (label: string) => `Chọn hướng ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
export const reviewProfile = 'Kiểm tra lại hồ sơ';

// S08 / S62 and the Targets screen (the explanations are healthVi.safetyClamped, .macroAdjusted, .estimate, .disclaimer)
export const targetsTitle = 'Lộ trình dành cho bạn';
export const targetsSubtitle = 'Bắt đầu vừa sức, điều chỉnh khi cần.';
export const targetsDetailTitle = 'Mục tiêu cá nhân';
export const archetypeIntro: Record<Archetype, string> = {
  TANKER: 'Ưu tiên bữa ăn đủ chất và vận động kháng lực. Mục tiêu dựa trên hồ sơ của bạn.',
  ASSASSIN: 'Ưu tiên sức bền và vận động đều. Mục tiêu dựa trên hồ sơ của bạn.',
  SUPPORTER: 'Ưu tiên tư thế, giấc ngủ và thư giãn. Mục tiêu dựa trên hồ sơ của bạn.',
};
export const energyLabel = 'Năng lượng ước tính';
export const kcalPerDay = (kcal: number) => `${grouped(kcal)} kcal / ngày`;
export const calorieBand = (min: number, max: number) =>
  `Nhiệm vụ dinh dưỡng được tính khi bạn ghi nhận từ ${grouped(min)} đến ${grouped(max)} kcal.`;
export const waterLabel = 'Nước ước tính';
export const mlPerDay = (ml: number) => `${grouped(ml)} ml / ngày`;
export const macrosTitle = 'Phân bổ dinh dưỡng ước tính';
export const macros = (proteinG: number, fatG: number, carbsG: number) => `Đạm ${proteinG} g · Béo ${fatG} g · Carb ${carbsG} g`;
export const finish = 'Hoàn tất';
export const editProfile = 'Chỉnh lại hồ sơ';
