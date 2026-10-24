// Reading what image files say of themselves, apart from the writers under
// test: their format by signature, pixel size, and physical resolution in
// dots per inch (PNG's pHYs, JPEG's JFIF density, WebP's EXIF resolution).

export interface ImageFacts {
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  /** Dots per inch along x and y, or undefined when the file says none. */
  dpi: readonly [number, number] | undefined;
}

const text = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

export function imageFacts(bytes: Uint8Array): ImageFacts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (text(bytes, 1, 3) === "PNG") {
    let dpi: [number, number] | undefined;
    for (let at = 8; at < bytes.length; at += 12 + view.getUint32(at)) {
      if (text(bytes, at + 4, 4) === "pHYs" && bytes[at + 16] === 1)
        dpi = [view.getUint32(at + 8) * 0.0254, view.getUint32(at + 12) * 0.0254];
    }
    return { format: "png", width: view.getUint32(16), height: view.getUint32(20), dpi };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let dpi: [number, number] | undefined;
    let size: [number, number] = [0, 0];
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1]!;
      if (marker === 0xe0 && text(bytes, at + 4, 5) === "JFIF\0" && bytes[at + 11] === 1)
        dpi = [view.getUint16(at + 12), view.getUint16(at + 14)];
      // Start of frame (baseline or progressive): height, then width.
      if (marker === 0xc0 || marker === 0xc2)
        size = [view.getUint16(at + 7), view.getUint16(at + 5)];
      if (marker === 0xda) break;
      at += 2 + view.getUint16(at + 2);
    }
    return { format: "jpeg", width: size[0], height: size[1], dpi };
  }
  if (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 4) === "WEBP") {
    let dpi: [number, number] | undefined;
    let size: [number, number] = [0, 0];
    for (let at = 12; at + 8 <= bytes.length; ) {
      const type = text(bytes, at, 4);
      const length = view.getUint32(at + 4, true);
      const data = at + 8;
      const u24 = (i: number) => bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16);
      if (type === "VP8X") size = [u24(data + 4) + 1, u24(data + 7) + 1];
      else if (type === "VP8 " && !size[0])
        size = [view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff];
      else if (type === "VP8L" && !size[0]) {
        const bits = view.getUint32(data + 1, true);
        size = [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
      } else if (type === "EXIF") dpi = exifDpi(bytes.subarray(data, data + length));
      at = data + length + (length & 1);
    }
    return { format: "webp", width: size[0], height: size[1], dpi };
  }
  throw new Error("imageFacts: not a PNG, JPEG, or WebP file");
}

/** XResolution and YResolution of a TIFF header's first IFD, in inches. */
function exifDpi(tiff: Uint8Array): [number, number] | undefined {
  if (text(tiff, 0, 6) === "Exif\0\0") tiff = tiff.subarray(6);
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = text(tiff, 0, 2) === "II";
  const ifd = view.getUint32(4, little);
  const values = new Map<number, number>();
  for (let i = 0; i < view.getUint16(ifd, little); i++) {
    const at = ifd + 2 + i * 12;
    const tag = view.getUint16(at, little);
    const type = view.getUint16(at + 2, little);
    if (type === 5) {
      const offset = view.getUint32(at + 8, little);
      values.set(tag, view.getUint32(offset, little) / view.getUint32(offset + 4, little));
    } else if (type === 3) values.set(tag, view.getUint16(at + 8, little));
  }
  const x = values.get(0x011a);
  const y = values.get(0x011b);
  if (x === undefined || y === undefined || values.get(0x0128) !== 2) return undefined;
  return [x, y];
}
