// Physical resolution written into encoded images (image/metadata.ts), read
// back by an independent reader (helpers/image.ts). Browsers' own encoders
// are tested in test/browser/image.test.ts.
import { describe, expect, it } from "vitest";
import { jpegWithDensity, pngWithDensity, webpWithDensity } from "../../src/image/metadata.ts";
import { encodePng } from "../../src/render/png.ts";
import { imageFacts } from "../helpers/image.ts";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

/** A segment of a JPEG: marker, then length (with itself) and data. */
const segment = (marker: number, data: number[]) => [
  0xff,
  marker,
  (data.length + 2) >> 8,
  (data.length + 2) & 255,
  ...data,
];

/** A JPEG's structure up to and past its scan, with `extra` segments after SOI. */
function jpeg(...extra: number[][]): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    ...extra,
    segment(0xdb, Array(65).fill(1)),
    // Baseline frame: 8 bits, 3 by 2 pixels, one component.
    segment(0xc0, [8, 0, 2, 0, 3, 1, 1, 0x11, 0]),
    segment(0xda, [1, 1, 0, 0, 63, 0]),
    [0x12, 0x34, 0xff, 0xd9],
  );
}

const jfif = (units: number, density: number) =>
  segment(0xe0, [...bytes("JFIF\0"), 1, 1, units, 0, density, 0, density, 0, 0]);

/** A RIFF WebP of `chunks`, each [fourcc, data]. */
function webp(...chunks: [string, number[]][]): Uint8Array {
  const body = chunks.flatMap(([type, data]) => [
    ...bytes(type),
    ...[0, 8, 16, 24].map((shift) => (data.length >> shift) & 255),
    ...data,
    ...(data.length & 1 ? [0] : []),
  ]);
  const size = body.length + 4;
  return bytes("RIFF", [size & 255, (size >> 8) & 255, size >> 16, 0], "WEBP", body);
}

/** VP8L data of a `width` by `height` image, with `alpha` said, and some pixels. */
const lossless = (width: number, height: number, alpha: boolean) => {
  const bits = (width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28);
  return [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, bits >>> 24, 7, 7, 7];
};

describe("resolution metadata", () => {
  it("writes PNG's pHYs after IHDR, replacing one the encoder wrote", () => {
    const png = encodePng(3, 2, new Uint8Array(24));
    const dense = pngWithDensity(png, 150);
    expect(imageFacts(dense)).toEqual({
      format: "png",
      width: 3,
      height: 2,
      dpi: [expect.closeTo(150, 1), expect.closeTo(150, 1)],
    });
    // pHYs is the second chunk, and one only, after writing twice.
    const twice = pngWithDensity(dense, 300);
    const types: string[] = [];
    const view = new DataView(twice.buffer);
    for (let at = 8; at < twice.length; at += 12 + view.getUint32(at))
      types.push(String.fromCharCode(...twice.subarray(at + 4, at + 8)));
    expect(types).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    expect(imageFacts(twice).dpi?.[0]).toBeCloseTo(300, 1);
  });

  it("writes one JFIF header in dots per inch, dropping the encoder's and EXIF", () => {
    for (const input of [
      jpeg(),
      jpeg(jfif(0, 1)),
      jpeg(segment(0xe1, [...bytes("Exif\0\0"), 1, 2]), jfif(1, 72)),
    ]) {
      const out = jpegWithDensity(input, 150);
      expect(imageFacts(out)).toEqual({ format: "jpeg", width: 3, height: 2, dpi: [150, 150] });
      const text = String.fromCharCode(...out);
      expect(text.split("JFIF").length).toBe(2);
      expect(text).not.toContain("Exif");
      // The scan and what follows it are the encoder's.
      expect(out.subarray(-4)).toEqual(Uint8Array.from([0x12, 0x34, 0xff, 0xd9]));
    }
    // JFIF holds whole dots per inch.
    expect(imageFacts(jpegWithDensity(jpeg(), 96.4)).dpi).toEqual([96, 96]);
  });

  it("makes a simple WebP extended to carry its resolution in EXIF", () => {
    const simple = webp(["VP8L", lossless(5, 4, true)]);
    const out = webpWithDensity(simple, 150, 5, 4);
    expect(imageFacts(out)).toEqual({ format: "webp", width: 5, height: 4, dpi: [150, 150] });
    const text = String.fromCharCode(...out);
    expect(text.indexOf("VP8X")).toBe(12);
    // The flags say EXIF and the alpha the lossless image uses.
    expect(out[20]).toBe(0x18);
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    // An extended WebP keeps its other chunks and gets one EXIF.
    const again = webpWithDensity(out, 300, 5, 4);
    expect(imageFacts(again).dpi).toEqual([300, 300]);
    expect(String.fromCharCode(...again).split("EXIF").length).toBe(2);
    const opaque = webpWithDensity(webp(["VP8L", lossless(5, 4, false)]), 96, 5, 4);
    expect(opaque[20]).toBe(0x08);
  });

  it("refuses what is not the format it says", () => {
    expect(() => pngWithDensity(new Uint8Array(20), 96)).toThrow(/PNG encoder/);
    expect(() => jpegWithDensity(new Uint8Array(20), 96)).toThrow(/JPEG encoder/);
    expect(() => webpWithDensity(new Uint8Array(20), 96, 1, 1)).toThrow(/WebP encoder/);
  });
});
