import type { NudgeTemplateSeed } from './types.ts';

// Fixed templates only (F-12): a nudge never carries free text.
export const NUDGE_TEMPLATES: NudgeTemplateSeed[] = [
  { code: 'MOVE_TOGETHER', text: 'Mình cùng vận động nhé?' },
  { code: 'WATER_BREAK', text: 'Nghỉ một chút, uống nước nào.' },
  { code: 'HOW_ARE_YOU', text: 'Hôm nay bạn thế nào?' },
  { code: 'SMALL_STEP', text: 'Một việc nhỏ thôi cũng được.' },
  { code: 'WITH_YOU', text: 'Mình ở đây cùng bạn.' },
];
