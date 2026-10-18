import { describe, expect, it } from 'vitest';
import { ThemeValidationError, validateTheme } from './validate-theme';

const fixtures = 'scripts/fixtures/validate-theme';
const realLocale = 'src/i18n/pt-PT.json';

function failure(options: Parameters<typeof validateTheme>[0]): ThemeValidationError {
  try {
    validateTheme(options);
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeValidationError);
    return error as ThemeValidationError;
  }
  throw new Error('Expected validateTheme to fail');
}

describe('validateTheme', () => {
  it('passes on the minimal theme', () => {
    expect(() => validateTheme({ themeDir: 'src/themes/minimal', localeFile: realLocale })).not.toThrow();
  });

  const themeCases: Array<[string, string, string, string, string]> = [
    ['1. a theme file breaking its schema', 'schema-invalid/themes/minimal', 'theme.json', '/roles/vault/gender', 'required'],
    ['2. a theme id different from its folder', 'id-mismatch/themes/other', 'theme.json', '/id', 'folder name'],
    ['3. a tier with too few slots', 'slots-too-few/themes/minimal', 'catalog.json', '/slots', 'tier "low"'],
    ['3. a duplicate slot id', 'slots-duplicate/themes/minimal', 'catalog.json', '/slots/1/slot', 'duplicate'],
    ['4. a missing art file', 'art-missing/themes/minimal', 'theme.json', '/places/board/art/image', 'assets/missing.png'],
  ];
  it.each(themeCases)('fails on %s', (_label, dir, file, jsonPath, reason) => {
    const error = failure({ themeDir: `${fixtures}/${dir}`, localeFile: realLocale });
    expect(error.file).toBe(`${fixtures}/${dir}/${file}`);
    expect(error.jsonPath).toBe(jsonPath);
    expect(error.message).toContain(`${fixtures}/${dir}/${file}: ${jsonPath}:`);
    expect(error.message).toContain(reason);
  });

  const localeCases: Array<[string, string, string]> = [
    ['an unknown role', 'placeholder-unknown-role', 'Unknown role "dragon"'],
    ['an unknown form', 'placeholder-unknown-form', 'Unknown form "whenever"'],
    ['unbalanced braces', 'placeholder-unbalanced', 'Unbalanced braces'],
  ];
  it.each(localeCases)('5. fails on %s in a message', (_label, dir, reason) => {
    const localeFile = `${fixtures}/${dir}/locale.json`;
    const error = failure({ themeDir: 'src/themes/minimal', localeFile });
    expect(error.file).toBe(localeFile);
    expect(error.jsonPath).toBe('/messages/app.name');
    expect(error.message).toContain(reason);
  });
});
