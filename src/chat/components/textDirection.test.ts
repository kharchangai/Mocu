import { describe, expect, it } from 'vitest';
import { getTextDirection } from './textDirection';

describe('getTextDirection', () => {
  it('uses the surrounding RTL prose instead of a Windows file path', () => {
    expect(getTextDirection('افتح الملف `C:\\workspace\\src\\main.ts` من فضلك')).toBe('rtl');
  });

  it('uses the surrounding RTL prose instead of a Unix file path', () => {
    expect(getTextDirection('اقرأ الملف `/home/user/project/src/main.ts` من فضلك')).toBe('rtl');
  });

  it('ignores inline code identifiers before RTL prose in assistant responses', () => {
    expect(getTextDirection('`regex_search.ts` هذا النص باللغة العربية')).toBe('rtl');
  });

  it('does not let a selected @file mention change RTL direction', () => {
    expect(getTextDirection('اقرأ الملف @src/main.ts من فضلك')).toBe('rtl');
    expect(getTextDirection('اقرأ الملف @"src/my file.ts" من فضلك')).toBe('rtl');
  });

  it('uses the dominant RTL script when an answer starts with a short English phrase', () => {
    expect(
      getTextDirection(
        'Pi Agent يساعدك في كتابة الإضافات وإعدادها بسهولة، كما يمكنك استخدام Chrome Manifest V3.',
      ),
    ).toBe('rtl');
  });

  it('keeps mostly English prose LTR when it contains a short RTL phrase', () => {
    expect(getTextDirection('This is an English response with مرحبا included.')).toBe('ltr');
  });

  it('keeps Latin prose left-to-right when it includes a file path', () => {
    expect(getTextDirection('Read `C:\\workspace\\src\\main.ts` please')).toBe('ltr');
  });
});
