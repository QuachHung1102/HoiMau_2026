import { CRISIS_KEYWORDS, CRISIS_PHRASES_EXACT } from '../../shared/i18n/vi/health';
import { matchesCrisis } from '../../shared/i18n/vi/crisisMatch';

// The matcher itself and its curated examples are in shared/i18n/vi/crisisMatch.test.ts. These cover the lists as a whole:
// every phrase of them is reachable from a real sentence, and ordinary sad writing stays quiet.
const bare = (entry: string) => entry.replace(/^\^/, '').replace(/\$$/, '');
const KEYWORDS = [...CRISIS_KEYWORDS, ...CRISIS_PHRASES_EXACT];

describe('every phrase of the lists', () => {
  test.each(KEYWORDS)('%j matches when it is a clause of a sentence written with diacritics', entry => {
    expect(matchesCrisis(`Hôm nay mình đã nghĩ rất nhiều về điều này. ${bare(entry)}. Rồi mình đi ngủ.`)).toBe(true);
  });

  test.each(KEYWORDS.filter(entry => !entry.startsWith('^') && !entry.endsWith('$')))('%j matches in the middle of a clause too', entry => {
    expect(matchesCrisis(`Tối nay mình ngồi một mình và cảm thấy ${bare(entry)} mà không biết nói với ai`)).toBe(true);
  });
});

describe('ordinary sad or tired writing is not a crisis', () => {
  test.each([
    'Hôm nay mình buồn và mệt, thấy cô đơn một chút.',
    'Mình bị điểm kém nên chán nản cả buổi chiều.',
    'Công việc căng thẳng quá, mình khóc một lúc rồi thấy nhẹ hơn.',
    'Mệt muốn chết quá, mai mình đi ngủ sớm.',
    'Mình nhớ nhà và nhớ bạn bè cũ.',
    '',
    '   ',
  ])('%j', text => {
    expect(matchesCrisis(text)).toBe(false);
  });
});
