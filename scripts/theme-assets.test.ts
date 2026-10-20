import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeValidationError, validateTheme } from './validate-theme';

const realLocale = 'src/i18n/pt-PT.json';
const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the minimal theme in a temporary folder, ready to be broken one way at a time. */
function themeCopy() {
  const root = mkdtempSync(join(tmpdir(), 'family-quest-theme-'));
  created.push(root);
  const dir = join(root, 'minimal'); // the folder name must equal the theme id
  cpSync('src/themes/minimal', dir, { recursive: true });
  const creditsFile = join(dir, 'credits.json');
  const credits = () => JSON.parse(readFileSync(creditsFile, 'utf8')) as { assets: Array<Record<string, string>> };
  const credit = (file: string, extra: Record<string, string> = {}) => ({
    file,
    author: 'Test author',
    source: 'https://example.com/art',
    licence: 'CC0-1.0',
    ...extra,
  });
  return {
    dir,
    path: (file: string) => join(dir, file),
    /** Adds a file under the theme and, unless told otherwise, its credit. */
    add(file: string, bytes: Buffer | string, options: { credited?: boolean } = {}) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), bytes);
      if (options.credited !== false) {
        const current = credits();
        current.assets.push(credit(file));
        writeFileSync(creditsFile, JSON.stringify(current));
      }
    },
    edit(change: (credits: { assets: Array<Record<string, string>> }) => void) {
      const current = credits();
      change(current);
      writeFileSync(creditsFile, JSON.stringify(current));
    },
    editJson(file: string, change: (json: any) => void) {
      const json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      change(json);
      writeFileSync(join(dir, file), JSON.stringify(json));
    },
    validate: () => validateTheme({ themeDir: dir, localeFile: realLocale }),
  };
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

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 1 } } });
/** An SVG of about `kilobytes` KB, so size budgets can be tested without heavy images. */
const svgOf = (kilobytes: number) => `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(kilobytes * 1024)}--></svg>`;

describe('theme image files', () => {
  it('pass for a theme with its credits in order', async () => {
    const theme = themeCopy();
    theme.add('assets/places/board.webp', await picture(100, 100).webp().toBuffer());
    expect(() => theme.validate()).not.toThrow();
  });

  describe('1. credits', () => {
    it('fails for an image without an entry, naming the image', async () => {
      const theme = themeCopy();
      theme.add('assets/places/board.webp', await picture(10, 10).webp().toBuffer(), { credited: false });
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('assets/places/board.webp'));
      expect(error.message).toContain('has no entry');
    });

    it('fails for an entry that points to no file, naming credits.json and the entry', () => {
      const theme = themeCopy();
      theme.edit((c) => c.assets.push({ file: 'assets/ghost.webp', author: 'A', source: 'https://example.com', licence: 'CC0-1.0' }));
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('credits.json'));
      expect(error.jsonPath).toMatch(/^\/assets\/\d+\/file$/);
      expect(error.message).toContain('assets/ghost.webp');
    });

    it('fails for a file with two entries', () => {
      const theme = themeCopy();
      theme.edit((c) => c.assets.push({ ...c.assets[0]! }));
      expect(failure(theme.validate).message).toContain('more than one entry');
    });

    it('fails when credits.json is missing', () => {
      const theme = themeCopy();
      rmSync(theme.path('credits.json'));
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('credits.json'));
    });

    it('fails when an entry breaks the schema', () => {
      const theme = themeCopy();
      theme.edit((c) => delete c.assets[0]!.author);
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('credits.json'));
      expect(error.jsonPath).toBe('/assets/0/author');
    });
  });

  describe('2. licences', () => {
    it('fails for a licence that is not allowed, naming the entry', () => {
      const theme = themeCopy();
      theme.edit((c) => (c.assets[0]!.licence = 'CC-BY-4.0'));
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('credits.json'));
      expect(error.jsonPath).toBe('/assets/0/licence');
      expect(error.message).toContain('CC-BY-4.0');
    });
  });

  describe('3. budgets', () => {
    it('fails for art larger than 512 × 512, naming the file', async () => {
      const theme = themeCopy();
      theme.add('assets/places/board.webp', await picture(513, 100).webp().toBuffer());
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('assets/places/board.webp'));
      expect(error.message).toContain('513×100');
    });

    it('fails for art heavier than 80 KB, and for a collectible heavier than 60 KB', () => {
      const theme = themeCopy();
      theme.add('assets/places/heavy.svg', svgOf(81));
      expect(failure(theme.validate).file).toBe(theme.path('assets/places/heavy.svg'));

      const other = themeCopy();
      other.add('assets/collectibles/c.svg', svgOf(70));
      // The same 70 KB file is fine as unreferenced art (80 KB) but not as a collectible (60 KB).
      expect(() => other.validate()).not.toThrow();
      other.editJson('catalog.json', (catalog) => (catalog.slots[0].art = { image: 'assets/collectibles/c.svg' }));
      const error = failure(other.validate);
      expect(error.file).toBe(other.path('assets/collectibles/c.svg'));
      expect(error.message).toContain('collectible');
    });

    it('lets the map background be larger, up to 1080 × 1920 and 400 KB', async () => {
      const theme = themeCopy();
      theme.add('assets/map.webp', await picture(1080, 1920).webp().toBuffer());
      theme.editJson('theme.json', (json) => (json.map.background = { image: 'assets/map.webp' }));
      expect(() => theme.validate()).not.toThrow();

      const tooTall = themeCopy();
      tooTall.add('assets/map.webp', await picture(1080, 1921).webp().toBuffer());
      tooTall.editJson('theme.json', (json) => (json.map.background = { image: 'assets/map.webp' }));
      expect(failure(tooTall.validate).message).toContain('1080×1921');
    });

    it('fails when all the art of a theme is over 2.5 MB', () => {
      const theme = themeCopy();
      for (let i = 0; i < 34; i++) theme.add(`assets/places/p${i}.svg`, svgOf(78));
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('assets'));
      expect(error.message).toContain('budget of a theme');
    });
  });

  describe('4. metadata', () => {
    it.each(['webp', 'png'] as const)('fails for EXIF in a %s, naming the file', async (format) => {
      const theme = themeCopy();
      const file = format === 'webp' ? 'assets/places/board.webp' : 'assets/icons/extra.png';
      theme.add(file, await picture(10, 10).withExif({ IFD0: { Copyright: 'someone' } })[format]().toBuffer());
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path(file));
      expect(error.message).toContain('EXIF');
    });

    it('fails for XMP in a webp', async () => {
      const theme = themeCopy();
      theme.add('assets/places/board.webp', await picture(10, 10).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>').webp().toBuffer());
      expect(failure(theme.validate).message).toContain('XMP');
    });
  });

  describe('5. formats', () => {
    it('fails for a PNG outside assets/icons/', async () => {
      const theme = themeCopy();
      theme.add('assets/places/board.png', await picture(10, 10).png().toBuffer());
      const error = failure(theme.validate);
      expect(error.file).toBe(theme.path('assets/places/board.png'));
      expect(error.message).toContain('WebP');
    });

    it('fails for a JPEG', () => {
      const theme = themeCopy();
      theme.add('assets/places/board.jpg', Buffer.from('not really a picture'));
      expect(failure(theme.validate).message).toContain('.jpg');
    });

    it('allows SVG for vector art', () => {
      const theme = themeCopy();
      theme.add('assets/places/board.svg', svgOf(1));
      expect(() => theme.validate()).not.toThrow();
    });
  });
});
