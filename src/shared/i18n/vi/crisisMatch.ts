// Crisis matcher for the journal screen (S56). Pure: no I/O, no logging, no storage; the text and the
// result never leave the device (AR-20). The lists and the false-positive policy live in health.ts.
//
// The text is split into clauses on . , ; : ! ? … and line breaks, and each clause is matched on its own.
// A phrase split by punctuation ("tự... tử") therefore never matches. An entry matches on word boundaries
// inside a clause; a leading ^ pins it to the clause start and a trailing $ to the clause end.
import { normalizeVi } from '../../../../domain/language.ts';
import { CRISIS_KEYWORDS, CRISIS_PHRASES_EXACT } from './health';

// No \p{...} escapes and no lookbehind: explicit character classes only.
const CLAUSE_BREAK = /[.,;:!?…\r\n]+/;
const NOT_ASCII_WORD = /[^a-z0-9]+/g;
const NOT_VI_WORD =
  /[^a-z0-9àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+/g;

type Entry = { needle: string; start: boolean; end: boolean };

/** `^` and `$` are the only syntax; the needle is padded so that it matches whole words only. */
const parse = (entry: string): Entry => {
  const start = entry.startsWith('^');
  const end = entry.endsWith('$');
  return {
    needle: ` ${entry.slice(start ? 1 : 0, end ? -1 : undefined)} `,
    start,
    end,
  };
};

const TIER_A = CRISIS_KEYWORDS.map(parse);
const TIER_B = CRISIS_PHRASES_EXACT.map(parse);

/** `clause` is padded with one space on each side, punctuation and whitespace runs squashed. */
const hit = (clause: string, { needle, start, end }: Entry): boolean => {
  if (start && end) {
    return clause === needle;
  }
  if (start) {
    return clause.startsWith(needle);
  }
  if (end) {
    return clause.endsWith(needle);
  }
  return clause.includes(needle);
};

const spaced = (text: string, notWord: RegExp): string =>
  ` ${text.replace(notWord, ' ').trim()} `;

export function matchesCrisis(text: string): boolean {
  return text.split(CLAUSE_BREAK).some(clause => {
    const toneless = spaced(normalizeVi(clause), NOT_ASCII_WORD);
    if (TIER_A.some(entry => hit(toneless, entry))) {
      return true;
    }
    const exact = spaced(clause.normalize('NFC').toLowerCase(), NOT_VI_WORD);
    return TIER_B.some(entry => hit(exact, entry));
  });
}
