import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageError, readImageInfo } from './image-info';

const base = () => sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 10, b: 10, alpha: 0.5 } } });

describe('readImageInfo', () => {
  it.each(['webp', 'png'] as const)('reads the size of a %s', async (format) => {
    const info = readImageInfo(await base()[format]().toBuffer());
    expect(info).toEqual({ format, width: 40, height: 30, metadata: [] });
  });

  it.each(['webp', 'png'] as const)('finds EXIF in a %s', async (format) => {
    const bytes = await base().withExif({ IFD0: { Copyright: 'someone' } })[format]().toBuffer();
    expect(readImageInfo(bytes).metadata).toContain('EXIF');
  });

  it('finds XMP in a webp', async () => {
    const bytes = await base().withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>').webp().toBuffer();
    expect(readImageInfo(bytes).metadata).toContain('XMP');
  });

  it('finds XMP in a png iTXt chunk, and ignores other iTXt chunks', async () => {
    const png = await base().png().toBuffer();
    const chunk = (keyword: string) => {
      const data = Buffer.concat([Buffer.from(keyword), Buffer.alloc(5), Buffer.from('<x:xmpmeta/>')]);
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write('iTXt', 4, 'latin1');
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
      return Buffer.concat([head, data, crc]);
    };
    const withChunk = (keyword: string) => Buffer.concat([png.subarray(0, 33), chunk(keyword), png.subarray(33)]);
    expect(readImageInfo(withChunk('XML:com.adobe.xmp')).metadata).toEqual(['XMP']);
    expect(readImageInfo(withChunk('Comment')).metadata).toEqual([]);
  });

  it('reads the size of a lossless webp', async () => {
    const info = readImageInfo(await base().webp({ lossless: true }).toBuffer());
    expect([info.width, info.height]).toEqual([40, 30]);
  });

  it('refuses a file that is not a PNG or WebP', () => {
    expect(() => readImageInfo(Buffer.from('GIF89a......'))).toThrow(ImageError);
  });
});
