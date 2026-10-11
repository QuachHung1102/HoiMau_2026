// Crisis matcher for the journal screen (S56). Pure: no I/O, no logging, no storage; the text and the
// result never leave the device (AR-20). The lists and the false-positive policy live in health.ts.
import { normalizeVi } from '../../../../domain/language.ts';
import { CRISIS_KEYWORDS, CRISIS_PHRASES_EXACT } from './health';

// No \p{...} escapes and no lookbehind: explicit character classes only.
const NOT_ASCII_WORD = /[^a-z0-9]+/g;
const NOT_VI_WORD =
  /[^a-z0-9àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+/g;

/** Punctuation and whitespace runs become one space; padded so a phrase matches on word boundaries. */
const spaced = (text: string, notWord: RegExp): string =>
  ` ${text.replace(notWord, ' ').trim()} `;

// Everyday phrases that contain a crisis phrase: removed before matching.
const EVERYDAY_A = [' cat tay ao '];
const EVERYDAY_B = [' tự tử tế '];

const without = (haystack: string, everyday: string[]): string =>
  everyday.reduce((text, phrase) => text.split(phrase).join(' '), haystack);

export function matchesCrisis(text: string): boolean {
  const toneless = without(
    spaced(normalizeVi(text), NOT_ASCII_WORD),
    EVERYDAY_A,
  );
  if (CRISIS_KEYWORDS.some(keyword => toneless.includes(` ${keyword} `))) {
    return true;
  }
  const exact = without(
    spaced(text.normalize('NFC').toLowerCase(), NOT_VI_WORD),
    EVERYDAY_B,
  );
  return CRISIS_PHRASES_EXACT.some(phrase => exact.includes(` ${phrase} `));
}
