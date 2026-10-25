import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtPrepareError, prepareArt, prepareIcon, prepareImage } from './art-prepare';
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

describe('prepareIcon', () => {
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#e63946"/></svg>');

  it('makes an opaque square PNG of the exact size, with no metadata', async () => {
    for (const size of [180, 192, 512]) {
      const png = await prepareIcon(SVG, { size, background: '#14324a' });
      const meta = await sharp(png).metadata();
      expect(meta).toMatchObject({ format: 'png', width: size, height: size });
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      if (info.channels === 4) for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
    }
  });

  it('keeps the picture inside the safe zone: the corners stay the background', async () => {
    const png = await prepareIcon(SVG, { size: 512, background: '#14324a', safe: 0.8 });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(pixel(0, 0)).toEqual([0x14, 0x32, 0x4a]);
    expect(pixel(511, 511)).toEqual([0x14, 0x32, 0x4a]);
    expect(pixel(256, 256)).toEqual([0xe6, 0x39, 0x46]); // the picture, in the middle
    // the circle's edge sits at 80% of the side, so just outside it is still background
    expect(pixel(256, 46)).toEqual([0x14, 0x32, 0x4a]);
  });

  it('refuses a size, a colour or a share that makes no sense', async () => {
    await expect(prepareIcon(SVG, { size: 4, background: '#14324a' })).rejects.toThrow(ArtPrepareError);
    await expect(prepareIcon(SVG, { size: 192, background: 'blue' })).rejects.toThrow(ArtPrepareError);
    await expect(prepareIcon(SVG, { size: 192, background: '#14324a', safe: 1.5 })).rejects.toThrow(ArtPrepareError);
  });
});

describe('prepareArt with icons', () => {
  it('writes an icon item as a PNG under assets/icons/, and refuses one without a size', async () => {
    const folder = scratch();
    writeFileSync(join(folder, 'face.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>');
    writeFileSync(join(folder, 'art.json'), JSON.stringify({ theme: 'demo', items: [{ source: 'face.svg', target: 'assets/icons/icon-192.png', kind: 'icon', size: 192, background: '#123456' }] }));
    const themes = scratch();
    const [result] = await prepareArt(folder, themes);
    expect(readFileSync(result!.target).subarray(1, 4).toString()).toBe('PNG');

    writeFileSync(join(folder, 'art.json'), JSON.stringify({ theme: 'demo', items: [{ source: 'face.svg', target: 'assets/icons/icon-192.png', kind: 'icon' }] }));
    await expect(prepareArt(folder, themes)).rejects.toThrow('needs "size" and "background"');
    writeFileSync(join(folder, 'art.json'), JSON.stringify({ theme: 'demo', items: [{ source: 'face.svg', target: 'assets/map.png', kind: 'icon', size: 192, background: '#123456' }] }));
    await expect(prepareArt(folder, themes)).rejects.toThrow('.png path under assets/icons/');
  });
});
