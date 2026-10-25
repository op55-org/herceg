// Proofs of the matrix's PDF export (test/contracts/), one per row: the
// document passes qpdf's check, MuPDF draws its page with the mark's
// colors at every place inside its plots the mark draws at, and its marks'
// text in its boxes (drawn.ts); and its text, as MuPDF reads it, is the
// text the SVG export writes, the marks' in their boxes. SVG and PNG are
// proved in the browser (test/browser/contracts/export.test.ts), which
// draws them.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { renderToPDF } from "../../src/pdf.ts";
import { measurePdfText } from "../../src/render/pdf-fonts.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { contractTest } from "../helpers/contracts.ts";
import { expectDrawn, textBoxesIn } from "./drawn.ts";
import { build, cellsOf, configOf, expectRefused, markOf, type Region } from "./matrix.ts";

const directory = mkdtempSync(join(tmpdir(), "herceg-contracts-"));

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeEntities = (text: string) =>
  text.replace(/&(\w+|#x?[\da-f]+);/gi, (_, name: string) =>
    name.startsWith("#")
      ? String.fromCodePoint(Number(name.startsWith("#x") ? `0x${name.slice(2)}` : name.slice(1)))
      : ENTITIES[name]!,
  );

/** MuPDF's lines of text on a PDF's page (text reaching past it too), with their boxes in CSS pixels. */
function pdfLines(file: string): { text: string; box: Region }[] {
  const xml = execFileSync("mutool", [
    "draw",
    "-q",
    "-F",
    "stext",
    "-O",
    "clip=no",
    "-o",
    "-",
    file,
  ]).toString();
  const scale = 600 / Number(/<page [^>]*width="([\d.]+)"/.exec(xml)![1]);
  return [...xml.matchAll(/<line bbox="([^"]+)"[^>]*text="([^"]*)"/g)].map(([, bbox, text]) => {
    const [x0, y0, x1, y1] = bbox!.split(" ").map((v) => Number(v) * scale);
    return {
      text: decodeEntities(text!),
      box: { x: x0!, y: y0!, width: x1! - x0!, height: y1! - y0! },
    };
  });
}

/** The texts of an SVG document's text elements, in order. */
const svgTexts = (svg: string) =>
  [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(([, inner]) => decodeEntities(inner!.replace(/<[^>]*>/g, "")).trim())
    .filter(Boolean);

/** The RGB pixels of a PPM (P6) image. */
function readPpm(bytes: Buffer): { width: number; height: number; pixels: Uint8Array } {
  const header = bytes
    .subarray(0, 64)
    .toString("latin1")
    .match(/^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!header) throw new Error("mutool wrote no PPM image");
  const [whole, width, height] = header;
  return { width: Number(width), height: Number(height), pixels: bytes.subarray(whole!.length) };
}

describe("export.pdf", () => {
  for (const cell of cellsOf("export.pdf"))
    contractTest(`${cell.row}.export.pdf`, () => {
      const spec = { marks: [markOf(cell.row)] };
      const options = { ...configOf(spec), width: 600, height: 400 };
      if (cell.state === "refused") return expectRefused(() => renderToPDF(options), cell);
      if (cell.state !== "works") throw new Error(`export.pdf is never ${cell.state}`);
      const file = join(directory, `${cell.row}.pdf`);
      writeFileSync(file, renderToPDF(options));
      // qpdf exits with an error for a malformed document.
      execFileSync("qpdf", ["--check", file], { stdio: "pipe" });
      const image = join(directory, `${cell.row}.ppm`);
      execFileSync("mutool", ["draw", "-q", "-r", "288", "-F", "ppm", "-o", image, file], {
        stdio: "pipe",
      });
      const { width, pixels } = readPpm(readFileSync(image));
      // Laid out as the PDF is, with its fonts' widths.
      const { scene } = build(spec, measurePdfText);
      expectDrawn(scene, pixels, { width, scale: width / 600, channels: 3 }, measurePdfText);
      // The text the SVG export of that layout writes, which MuPDF reads in its lines.
      const lines = pdfLines(file);
      const unread = lines.map(({ text }) => text.trim());
      const missing = svgTexts(renderToSVG(options, { measureText: measurePdfText })).filter(
        (text) => {
          const at = unread.findIndex((line) => line.includes(text));
          if (at >= 0) unread[at] = unread[at]!.replace(text, "");
          return at < 0;
        },
      );
      expect(missing, "texts the PDF leaves out").toEqual([]);
      // The marks' text, each where its box is.
      const boxes = textBoxesIn(scene, measurePdfText);
      const near = (a: Region, b: Region) =>
        a.x < b.x + b.width + 4 &&
        b.x < a.x + a.width + 4 &&
        a.y < b.y + b.height + 4 &&
        b.y < a.y + a.height + 4;
      const misplaced = boxes.filter(
        (box) =>
          !lines.some(
            (line) => line.text.includes(box.text.split("\n")[0]!.trim()) && near(line.box, box),
          ),
      );
      expect(
        misplaced.map(({ key, text }) => `${key} "${text}"`),
        "texts away from their places",
      ).toEqual([]);
    });
});
