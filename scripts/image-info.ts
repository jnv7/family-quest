/**
 * Reads the size and the metadata chunks of a PNG or WebP file straight from its bytes, so
 * `validate-theme` needs no image library (it runs with plain Node, like the other checks).
 */

export interface ImageInfo {
  format: 'png' | 'webp';
  width: number;
  height: number;
  /** Metadata found in the file: `EXIF` and `XMP` (SPEC.md §8: none may be left in the art). */
  metadata: Array<'EXIF' | 'XMP'>;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const XMP_KEYWORD = 'XML:com.adobe.xmp';

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

export function readImageInfo(bytes: Buffer): ImageInfo {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return readPng(bytes);
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return readWebp(bytes);
  throw new ImageError('is not a PNG or WebP image');
}

function readPng(bytes: Buffer): ImageInfo {
  let width = 0;
  let height = 0;
  const metadata: ImageInfo['metadata'] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'eXIf') {
      metadata.push('EXIF');
    } else if (type === 'iTXt' && data.toString('latin1', 0, XMP_KEYWORD.length) === XMP_KEYWORD) {
      metadata.push('XMP');
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0) throw new ImageError('has no PNG header');
  return { format: 'png', width, height, metadata };
}

function readWebp(bytes: Buffer): ImageInfo {
  let width = 0;
  let height = 0;
  const metadata: ImageInfo['metadata'] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('latin1', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'VP8X') {
      width = 1 + data.readUIntLE(4, 3);
      height = 1 + data.readUIntLE(7, 3);
    } else if (type === 'VP8 ' && width === 0) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && width === 0) {
      const bits = data.readUInt32LE(1);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >> 14) & 0x3fff);
    } else if (type === 'EXIF') {
      metadata.push('EXIF');
    } else if (type === 'XMP ') {
      metadata.push('XMP');
    }
    offset += 8 + length + (length % 2);
  }
  if (width === 0 || height === 0) throw new ImageError('has no WebP header');
  return { format: 'webp', width, height, metadata };
}
