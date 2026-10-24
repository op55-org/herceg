// Physical resolution in encoded images, which browsers' encoders leave out
// or set to a default: PNG's pHYs chunk, JPEG's JFIF density, and WebP's
// EXIF resolution. Each writer takes an encoder's bytes and returns them
// with the resolution set, other metadata the encoder wrote left in place,
// except the resolution an encoder already wrote, which is replaced.

import { crc32 } from "../render/png.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Bytes of `text`, which is ASCII. */
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function malformed(format: string): never {
  throw new Error(`renderToImage: the browser's ${format} encoder wrote a file this cannot read`);
}

/**
 * A PNG with a pHYs chunk saying `dpi` dots per inch (as pixels per meter,
 * which is how PNG says it), in place of any the encoder wrote.
 */
export function pngWithDensity(png: Uint8Array, dpi: number): Uint8Array {
  if (PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) malformed("PNG");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const perMeter = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const out = new DataView(chunk.buffer);
  out.setUint32(0, 9);
  chunk.set(ascii("pHYs"), 4);
  out.setUint32(8, perMeter);
  out.setUint32(12, perMeter);
  chunk[16] = 1; // the unit is the meter
  out.setUint32(17, crc32(chunk, 4, 17));
  // Chunks are copied as they are, pHYs going after IHDR (the first) and
  // any the encoder wrote dropped.
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let at = 8;
  while (at < png.length) {
    if (at + 12 > png.length) malformed("PNG");
    const end = at + 12 + view.getUint32(at);
    if (end > png.length) malformed("PNG");
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type !== "pHYs") parts.push(png.subarray(at, end));
    if (type === "IHDR") parts.push(chunk);
    at = end;
  }
  return concat(parts);
}

/**
 * A JPEG whose JFIF header says `dpi` dots per inch, which JFIF holds as a
 * whole number. Its JFIF header and any EXIF segment, where some encoders
 * write a resolution of their own that readers would prefer, are replaced
 * by one JFIF header.
 */
export function jpegWithDensity(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) malformed("JPEG");
  const density = Math.min(65535, Math.max(1, Math.round(dpi)));
  const jfif = new Uint8Array(18);
  jfif.set([0xff, 0xe0, 0, 16]);
  jfif.set(ascii("JFIF\0"), 4);
  // Version 1.2, density in dots per inch, no thumbnail.
  jfif.set([1, 2, 1, density >> 8, density & 255, density >> 8, density & 255, 0, 0], 9);
  const parts: Uint8Array[] = [jpeg.subarray(0, 2), jfif];
  let at = 2;
  // Segments up to the scan; after it, the entropy-coded data and the end.
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    const end = at + 2 + ((jpeg[at + 2]! << 8) | jpeg[at + 3]!);
    if (end > jpeg.length) malformed("JPEG");
    const marker = jpeg[at + 1];
    const header = String.fromCharCode(...jpeg.subarray(at + 4, at + 9));
    const ownDensity =
      (marker === 0xe0 && header === "JFIF\0") || (marker === 0xe1 && header === "Exif\0");
    if (!ownDensity) parts.push(jpeg.subarray(at, end));
    at = end;
  }
  if (jpeg[at] !== 0xff) malformed("JPEG");
  parts.push(jpeg.subarray(at));
  return concat(parts);
}

/**
 * A WebP with an EXIF chunk giving `dpi` as its resolution. A simple WebP
 * (one VP8 or VP8L chunk) becomes an extended one, which can carry
 * metadata, of `width` by `height` pixels. Few applications read a WebP's
 * resolution; its pixel dimensions are what they place it by.
 */
export function webpWithDensity(
  webp: Uint8Array,
  dpi: number,
  width: number,
  height: number,
): Uint8Array {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const fourcc = (at: number) => String.fromCharCode(...webp.subarray(at, at + 4));
  if (webp.length < 20 || fourcc(0) !== "RIFF" || fourcc(8) !== "WEBP") malformed("WebP");
  const chunks: Uint8Array[] = [];
  let extended: Uint8Array | undefined;
  let alpha = false;
  let at = 12;
  while (at + 8 <= webp.length) {
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size & 1);
    if (at + 8 + size > webp.length) malformed("WebP");
    const type = fourcc(at);
    const chunk = webp.subarray(at, Math.min(end, webp.length));
    if (type === "VP8X") extended = chunk.slice();
    else if (type !== "EXIF") chunks.push(chunk);
    // A lossless image says whether it uses alpha; a lossy one has an ALPH chunk.
    if (type === "VP8L" && size >= 5) alpha = ((webp[at + 12]! >> 4) & 1) === 1;
    if (type === "ALPH") alpha = true;
    at = end;
  }
  if (!extended) {
    extended = new Uint8Array(18);
    extended.set(ascii("VP8X"));
    extended[4] = 10;
    // The canvas's width and height less one, 24 bits each, little-endian.
    for (const [at, side] of [
      [12, width],
      [15, height],
    ] as const)
      extended.set([(side - 1) & 255, ((side - 1) >> 8) & 255, (side - 1) >> 16], at);
    if (alpha) extended[8]! |= 0x10;
  }
  extended[8]! |= 0x08; // EXIF metadata
  const exif = exifResolution(dpi);
  const exifChunk = new Uint8Array(8 + exif.length + (exif.length & 1));
  exifChunk.set(ascii("EXIF"));
  new DataView(exifChunk.buffer).setUint32(4, exif.length, true);
  exifChunk.set(exif, 8);
  const body = concat([ascii("WEBP"), extended, ...chunks, exifChunk]);
  const out = new Uint8Array(8 + body.length);
  out.set(ascii("RIFF"));
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

/** A little-endian TIFF header and one IFD: XResolution, YResolution, and inches. */
function exifResolution(dpi: number): Uint8Array {
  const bytes = new Uint8Array(66);
  const view = new DataView(bytes.buffer);
  bytes.set(ascii("II"));
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 3, true);
  const entry = (i: number, tag: number, type: number, value: number) => {
    const at = 10 + i * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, 1, true);
    view.setUint32(at + 8, value, true);
  };
  // Rationals (type 5) after the IFD, at 50 and 58; the unit (a short, type 3) is 2, inches.
  entry(0, 0x011a, 5, 50);
  entry(1, 0x011b, 5, 58);
  entry(2, 0x0128, 3, 2);
  for (const at of [50, 58]) {
    view.setUint32(at, Math.round(dpi * 100), true);
    view.setUint32(at + 4, 100, true);
  }
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
