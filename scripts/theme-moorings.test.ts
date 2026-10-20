import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeValidationError, validateTheme } from './validate-theme';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the minimal theme, edited with `change` (a function over its parsed `theme.json`). */
function themeWith(change: (theme: any) => void) {
  const root = mkdtempSync(join(tmpdir(), 'family-quest-moorings-'));
  created.push(root);
  const dir = join(root, 'minimal');
  cpSync('src/themes/minimal', dir, { recursive: true });
  const file = join(dir, 'theme.json');
  const theme = JSON.parse(readFileSync(file, 'utf8'));
  change(theme);
  writeFileSync(file, JSON.stringify(theme));
  return { file, validate: () => validateTheme({ themeDir: dir, localeFile: 'src/i18n/pt-PT.json' }) };
}

function failure(run: () => void): ThemeValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeValidationError);
    return error as ThemeValidationError;
  }
  throw new Error('Expected validation to fail');
}

const spot = (x: number, y = 80) => ({ x, y, width: 8, height: 6 });
const moorings = (spots = [spot(10), spot(20)], symbolAt = { x: 50, y: 40, size: 30 }) => ({ child: { spots, symbolAt } });

describe('moorings in a theme', () => {
  it('pass with valid spots', () => {
    expect(() => themeWith((t) => (t.map.moorings = moorings())).validate()).not.toThrow();
  });

  it('fail for a spot outside the map, naming the file and the spot', () => {
    const theme = themeWith((t) => (t.map.moorings = moorings([spot(10), spot(95)])));
    const error = failure(theme.validate);
    expect(error.file).toBe(theme.file);
    expect(error.jsonPath).toBe('/map/moorings/child/spots/1');
    expect(error.message).toContain('outside the map');
  });

  it('fail for a spot that does not fit below the map', () => {
    const theme = themeWith((t) => (t.map.moorings = moorings([spot(10, 97)])));
    expect(failure(theme.validate).jsonPath).toBe('/map/moorings/child/spots/0');
  });

  it('fail for overlapping spots of the same kind', () => {
    const theme = themeWith((t) => (t.map.moorings = moorings([spot(10), spot(14)])));
    const error = failure(theme.validate);
    expect(error.file).toBe(theme.file);
    expect(error.jsonPath).toBe('/map/moorings/child/spots/1');
    expect(error.message).toContain('overlaps spot 0');
  });

  it('allow spots that only touch', () => {
    expect(() => themeWith((t) => (t.map.moorings = moorings([spot(10), spot(18)]))).validate()).not.toThrow();
  });

  it('fail for a symbol that does not fit inside its spot', () => {
    const theme = themeWith((t) => (t.map.moorings = moorings([spot(10)], { x: 90, y: 40, size: 30 })));
    const error = failure(theme.validate);
    expect(error.file).toBe(theme.file);
    expect(error.jsonPath).toBe('/map/moorings/child/symbolAt');
  });

  it('fail for a symbol too tall for its spot, which depends on the proportions of the map', () => {
    // A spot that is wide and short: a symbol of 40% of its width is taller than the spot.
    const theme = themeWith((t) => (t.map.moorings = moorings([{ x: 10, y: 80, width: 20, height: 3 }], { x: 50, y: 50, size: 40 })));
    expect(failure(theme.validate).jsonPath).toBe('/map/moorings/child/symbolAt');
  });
});

describe('profile symbols in a theme', () => {
  it('fail for a duplicate, naming the file and the path', () => {
    const theme = themeWith((t) => (t.profileSymbols[3] = t.profileSymbols[0]));
    const error = failure(theme.validate);
    expect(error.file).toBe(theme.file);
    expect(error.jsonPath).toBe('/profileSymbols');
    expect(error.message).toContain('duplicate');
  });

  it('fail for fewer than 12', () => {
    const theme = themeWith((t) => (t.profileSymbols = t.profileSymbols.slice(0, 11)));
    expect(failure(theme.validate).jsonPath).toBe('/profileSymbols');
  });

  it.each([['a letter', 'x'], ['two emoji', '🐬🦀'], ['plain text', 'ok']])('fail for %s instead of one emoji', (_label, symbol) => {
    const theme = themeWith((t) => (t.profileSymbols[2] = symbol));
    const error = failure(theme.validate);
    expect(error.jsonPath).toBe('/profileSymbols/2');
    expect(error.message).toContain('single emoji');
  });

  it('accept emoji made of several code points', () => {
    expect(() => themeWith((t) => (t.profileSymbols[0] = '🏴‍☠️')).validate()).not.toThrow();
  });
});
