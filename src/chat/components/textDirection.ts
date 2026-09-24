const RTL_CHARACTER_PATTERN = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const STRONG_CHARACTER_PATTERN = /[A-Za-z\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

/*
 * Code fragments (including selected paths and identifiers) should not
 * determine the direction of surrounding prose. This matters when an RTL
 * answer starts with an inline filename or code symbol.
 */
export function getTextDirection(text: string): 'rtl' | 'ltr' {
  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/(^|[\s([{])@(?:"[^"]*"|[^\s]+)/g, '$1 ')
    .replace(/`[^`]+`/g, ' ');
  let rtlCharacterCount = 0;
  let ltrCharacterCount = 0;

  for (const character of prose) {
    if (RTL_CHARACTER_PATTERN.test(character)) {
      rtlCharacterCount += 1;
    } else if (/[A-Za-z]/.test(character)) {
      ltrCharacterCount += 1;
    }
  }

  // Prefer the dominant script so a short English product name at the start
  // of an otherwise RTL response does not force the whole message to LTR.
  if (rtlCharacterCount !== ltrCharacterCount) {
    return rtlCharacterCount > ltrCharacterCount ? 'rtl' : 'ltr';
  }

  // For short or evenly mixed strings, keep the Unicode first-strong behavior.
  const firstStrongCharacter = prose.match(STRONG_CHARACTER_PATTERN)?.[0];
  return firstStrongCharacter && RTL_CHARACTER_PATTERN.test(firstStrongCharacter)
    ? 'rtl'
    : 'ltr';
}
