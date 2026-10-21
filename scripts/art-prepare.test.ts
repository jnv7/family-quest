import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtPrepareError, prepareArt, prepareImage } from './art-prepare';
import { readImageInfo } from './image-info';
import { BUDGETS } from './theme-assets';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'family-quest-art-'));
  created.push(dir);
  return dir;
};

const withMetadata = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 80, b: 20, alpha: 1 } } })
    .withExif({ IFD0: { Copyright: 'someone' } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')
    .png()
    .toBuffer();

describe('prepareImage', () => {
  it('strips EXIF and XMP', async () => {
    const source = await withMetadata(64, 64);
    expect(readImageInfo(source).metadata).not.toEqual([]);
    const output = await prepareImage(source, 'art');
    expect(readImageInfo(output)).toMatchObject({ format: 'webp', width: 64, height: 64, metadata: [] });
  });

  it.each([
    ['art', 512],
    ['collectible', 512],
  ] as const)('shrinks %s art to fit inside %i pixels, keeping the proportions, and never enlarges', async (kind, limit) => {
    const big = await prepareImage(await withMetadata(1024, 512), kind);
    expect(readImageInfo(big)).toMatchObject({ width: limit, height: limit / 2 });
    const small = await prepareImage(await withMetadata(100, 50), kind);
    expect(readImageInfo(small)).toMatchObject({ width: 100, height: 50 });
  });

  it('fits the map in 1080 × 1920', async () => {
    const output = await prepareImage(await withMetadata(2160, 3840), 'map');
    expect(readImageInfo(output)).toMatchObject({ width: 1080, height: 1920 });
  });

  it('lowers the quality to fit the weight budget, or refuses with a clear message', async () => {
    // Noise does not compress: it cannot fit 60 KB at 512 × 512, at any quality.
    const noise = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 80 } } }).png().toBuffer();
    await expect(prepareImage(noise, 'collectible')).rejects.toThrow(ArtPrepareError);
  });
});

describe('prepareArt', () => {
  async function artFolder(mapping: unknown) {
    const folder = scratch();
    mkdirSync(join(folder, 'sources'));
    writeFileSync(join(folder, 'sources', 'one.png'), await withMetadata(300, 300));
    writeFileSync(join(folder, 'art.json'), JSON.stringify(mapping));
    return folder;
  }

  it('writes the mapped files under the theme, with no metadata', async () => {
    const folder = await artFolder({ theme: 'demo', items: [{ source: 'sources/one.png', target: 'assets/places/board.webp', kind: 'art' }] });
    const themes = scratch();
    const results = await prepareArt(folder, themes);
    const target = join(themes, 'demo', 'assets', 'places', 'board.webp');
    expect(results).toEqual([{ target, bytes: readFileSync(target).length }]);
    expect(readImageInfo(readFileSync(target))).toMatchObject({ format: 'webp', width: 300, height: 300, metadata: [] });
  });

  it.each([
    ['a target outside assets/', { source: 'sources/one.png', target: 'theme.json', kind: 'art' }, 'under assets/'],
    ['a target that climbs out', { source: 'sources/one.png', target: 'assets/../x.webp', kind: 'art' }, 'under assets/'],
    ['a source outside the folder', { source: '../one.png', target: 'assets/a.webp', kind: 'art' }, 'inside the art folder'],
    ['an unknown kind', { source: 'sources/one.png', target: 'assets/a.webp', kind: 'poster' }, '"kind"'],
  ])('refuses %s and writes nothing', async (_label, item, reason) => {
    const folder = await artFolder({ theme: 'demo', items: [item] });
    const themes = scratch();
    await expect(prepareArt(folder, themes)).rejects.toThrow(reason);
    expect(existsSync(join(themes, 'demo'))).toBe(false);
  });

  it('names a source it cannot read', async () => {
    const folder = await artFolder({ theme: 'demo', items: [{ source: 'sources/missing.png', target: 'assets/a.webp', kind: 'art' }] });
    await expect(prepareArt(folder, scratch())).rejects.toThrow('missing.png');
  });
});
