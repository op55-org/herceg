// Where a scene's marks show in a picture of it: the places each mark draws
// at, with the colors one of which shows there, so that a picture missing a
// series, a group, or an item, or drawing one elsewhere, tells; and the
// boxes its marks' text is drawn in. The export proofs read them in the
// pictures PDF, SVG, and PNG exports draw.
//
// Pictures are read at three pixels per CSS pixel, where a stroke a CSS
// pixel wide covers two pixels whole across, and a color shows only as a
// block of 2 by 2 pixels of it (within a few levels): an antialiased edge,
// a pixel across, would pass for a translucent fill of its color.
//
// Colors tell marks apart, so a mark drawn over another of its own color
// (a radar's points on its line, an error bar's caps on its bar) tells only
// where it shows alone.

import { expect } from "vitest";
import { ruleLabel } from "../../src/draw/rule.ts";
import type { MeasureText } from "../../src/layout/text.ts";
import type {
  ArcGeometry,
  FaceGeometry,
  Geometry,
  LabelsGeometry,
  PathShape,
  PolygonGeometry,
  RasterGeometry,
  RectGeometry,
  RuleGeometry,
  Scene,
  SegmentGeometry,
  ShapesGeometry,
  TextGeometry,
  TextShape,
} from "../../src/scene/scene.ts";
import { cssFont } from "../../src/style/style.ts";
import {
  anchorsOf,
  drawsNothing,
  grey,
  paintsAt,
  pathPoints,
  type Region,
  rgbOf,
} from "./matrix.ts";

type RGB = [number, number, number];

/** A color and its opacity. */
type Paint = [rgb: RGB, opacity: number];

/**
 * A place a mark draws at, in CSS pixels: around a point, or anywhere in a
 * rectangle (`width` by `height` from it) but its holes, where rectangles
 * drawn later cover it; and the colors (as a white page shows them) one of
 * which shows there.
 */
export interface Anchor {
  key: string;
  kind: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  holes?: Region[];
  colors: string[];
}

interface Place {
  x: number;
  y: number;
  /** A rectangle's size, and whether it hides what it is drawn over. */
  width?: number;
  height?: number;
  opaque?: boolean;
  paints: Paint[];
}

/** Within a few levels in every channel. */
const LEVELS = 10;

const near = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= LEVELS);

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** `rgb` at `opacity` over `under` (a color as the page shows it). */
const over = (rgb: RGB, opacity: number, under: RGB) =>
  rgb.map((v, i) => v * opacity + under[i]! * (1 - opacity)) as RGB;

const WHITE: RGB = [255, 255, 255];

/** Paints as `paintsAt` gives them, without greys (axes, text, and grid lines are grey). */
function colored(paints: readonly (readonly [paint: string, opacity: number])[]): Paint[] {
  const kept: Paint[] = [];
  for (const [paint, opacity] of paints) {
    const rgb = rgbOf(paint);
    if (rgb && !grey(rgb) && !kept.some(([k, o]) => o === opacity && near(k, rgb)))
      kept.push([rgb, opacity]);
  }
  return kept;
}

const pointsOf = (values: readonly number[], paints: Paint[]): Place[] =>
  Array.from({ length: values.length / 2 }, (_, i) => ({
    x: values[2 * i]!,
    y: values[2 * i + 1]!,
    paints,
  }));

/** The middles between points of a path that follow each other, where the path runs. */
function middlesOf(points: readonly number[]): number[] {
  const middles: number[] = [];
  for (let i = 2; i + 1 < points.length; i += 2) {
    const [x0, y0, x1, y1] = [points[i - 2]!, points[i - 1]!, points[i]!, points[i + 1]!];
    if (Math.hypot(x1 - x0, y1 - y0) >= 2) middles.push((x0 + x1) / 2, (y0 + y1) / 2);
  }
  return middles;
}

/** Rectangles, anywhere they show: a group's tile shows around its children. */
function rectPlaces(g: RectGeometry): Place[] {
  const paints = colored(paintsAt(g));
  const opaque = g.fillOpacity * (g.draw.opacity ?? 1) >= 1 && rgbOf(g.fill) !== undefined;
  const places: Place[] = [];
  for (let i = 0; i < g.count; i++) {
    const [x, y, width, height] = g.rects.subarray(4 * i, 4 * i + 4);
    if (width! >= 1 && height! >= 1)
      places.push({ x: x!, y: y!, width: width!, height: height!, opaque, paints });
  }
  return places;
}

/**
 * Segments' middles and quarters, not their ends, which marks drawn over
 * them may hide (a network's nodes); a segment of no length draws nothing.
 */
function segmentPlaces(g: SegmentGeometry): Place[] {
  const paints = colored(paintsAt(g));
  const places: Place[] = [];
  for (let i = 0; i < g.count; i++) {
    const [x1, y1, x2, y2] = g.coords.subarray(4 * i, 4 * i + 4);
    if (Math.hypot(x2! - x1!, y2! - y1!) < 1) continue;
    for (const t of [0.25, 0.5, 0.75])
      places.push({ x: x1! + t * (x2! - x1!), y: y1! + t * (y2! - y1!), paints });
  }
  return places;
}

/**
 * Each sector's middle and, where it is wide enough, points near its four
 * corners, in its own color: those tell where it is drawn.
 */
function arcPlaces(g: ArcGeometry): Place[] {
  const opacity = g.fillOpacity * (g.draw.opacity ?? 1);
  const places: Place[] = [];
  for (let i = 0; i < g.count; i++) {
    const [cx, cy, inner, outer, start, end] = g.arcs.subarray(6 * i, 6 * i + 6);
    const at = (r: number, angle: number) => ({
      x: cx! + r * Math.cos(angle),
      y: cy! + r * Math.sin(angle),
      paints,
    });
    const r = (inner! + outer!) / 2;
    // Sectors too thin to hold a pixel of their own color show their neighbors'.
    if (outer! - inner! < 4 || (end! - start!) * r < 4) continue;
    const paints = colored([[g.colors[g.colorIndex[i]!]!, opacity]]);
    places.push(at(r, (start! + end!) / 2));
    // In from the sector's sides by its gap and as far again as a place is searched around.
    const inset = g.gap + 4;
    const [near, far] = [Math.max(inner! + inset, 2 * inset), outer! - inset];
    if (far - near < inset || (end! - start!) * near < 3 * inset) continue;
    for (const radius of [near, far])
      places.push(at(radius, start! + inset / radius), at(radius, end! - inset / radius));
  }
  return places;
}

/** Each shape's points, in its own color: its fill shows on their inner side. */
function polygonPlaces(g: PolygonGeometry): Place[] {
  const opacity = g.fillOpacity * (g.draw.opacity ?? 1);
  const all = anchorsOf(g);
  const places: Place[] = [];
  let at = 0;
  g.shapes.forEach(({ coords }, i) => {
    const paints = colored([[g.colors[g.colorIndex[i]!]!, opacity]]);
    places.push(...pointsOf(all.slice(at, at + coords.length), paints));
    at += coords.length;
  });
  return places;
}

/** Each cell, as a rectangle of its color; empty cells draw nothing. */
function rasterPlaces(g: RasterGeometry): Place[] {
  const [w, h] = [g.width / g.columns, g.height / g.rows];
  const places: Place[] = [];
  for (let row = 0; row < g.rows; row++)
    for (let column = 0; column < g.columns; column++) {
      const i = 4 * (row * g.columns + column);
      const rgb: RGB = [g.pixels[i]!, g.pixels[i + 1]!, g.pixels[i + 2]!];
      const alpha = g.pixels[i + 3]! / 255;
      if (alpha > 0 && !grey(rgb))
        places.push({
          x: g.x + column * w,
          y: g.y + row * h,
          width: w,
          height: h,
          opaque: alpha === 1,
          paints: [[rgb, alpha]],
        });
    }
  return places;
}

/** Path shapes' middles (a custom mark's circle's center), in their colors. */
function shapePlaces(g: ShapesGeometry): Place[] {
  const opacity = g.draw.opacity ?? 1;
  return g.shapes.flatMap((shape): Place[] => {
    if (!("d" in shape)) return [];
    const { fill, stroke, opacity: own } = shape as PathShape;
    const paints = colored([
      [fill, own * opacity],
      ...(stroke ? [[stroke, own * opacity] as const] : []),
    ]);
    // Not its corners, which marks drawn over them may hide (a radar's points).
    return pathPoints(shape.d).flatMap((points) => {
      const middles = middlesOf(points);
      return pointsOf(middles.length > 0 ? middles : points, paints);
    });
  });
}

/** Whether face `f` covers (x, y): a disc around it, or a polygon (even-odd) holding it. */
function covers(faces: FaceGeometry, f: number, x: number, y: number): boolean {
  const { vertices: v, corners, starts } = faces;
  const [start, end] = [starts[f]!, starts[f + 1]!];
  if (end - start === 1) {
    const at = corners[start]!;
    const r = faces.styles[faces.style[f]!]!.radius;
    return Math.hypot(v[2 * at]! - x, v[2 * at + 1]! - y) < r;
  }
  if (end - start < 3) return false;
  let inside = false;
  for (let k = start, j = end - 1; k < end; j = k++) {
    const [a, b] = [corners[k]!, corners[j]!];
    const [ax, ay, bx, by] = [v[2 * a]!, v[2 * a + 1]!, v[2 * b]!, v[2 * b + 1]!];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/**
 * Each face's middle, in the color of the last face drawn over it there
 * (faces are drawn back to front, so those in front hide those behind),
 * where that face is opaque; a segment's, in its stroke.
 */
function facePlaces(g: FaceGeometry): Place[] {
  const faces = g.batches ? g.batches.faces() : g;
  const { vertices: v, corners, starts, styles, style } = faces;
  const places: Place[] = [];
  for (let f = 0; f < faces.count; f++) {
    const [start, end] = [starts[f]!, starts[f + 1]!];
    let [x, y] = [0, 0];
    for (let k = start; k < end; k++) {
      x += v[2 * corners[k]!]! / (end - start);
      y += v[2 * corners[k]! + 1]! / (end - start);
    }
    let top = f;
    for (let other = faces.count - 1; other > f; other--)
      if (covers(faces, other, x, y)) {
        top = other;
        break;
      }
    const face = styles[style[top]!]!;
    if (face.opacity < 1) continue;
    if (top === f && end - start === 2) {
      if (face.stroke) places.push({ x, y, paints: colored([[face.stroke, 1]]) });
    } else if (top !== f || covers(faces, f, x, y))
      places.push({ x, y, paints: colored([[face.fill, 1]]) });
  }
  return places;
}

function placesOf(g: Geometry): Place[] {
  switch (g.kind) {
    // Text shows as glyphs of a font, not at its place: the proofs compare texts apart.
    case "text":
    case "labels":
      return [];
    case "rect":
      return rectPlaces(g as RectGeometry);
    case "segments":
      return segmentPlaces(g as SegmentGeometry);
    case "arc":
      return arcPlaces(g as ArcGeometry);
    case "polygons":
      return polygonPlaces(g as PolygonGeometry);
    case "raster":
      return rasterPlaces(g as RasterGeometry);
    case "shapes":
      return shapePlaces(g as ShapesGeometry);
    case "faces":
      return facePlaces(g as FaceGeometry);
    case "line":
      return pointsOf([...anchorsOf(g), ...middlesOf(anchorsOf(g))], colored(paintsAt(g)));
    default: {
      const at = anchorsOf(g);
      // A rule's middle, which neither of its ends at the plot's edges may be inside.
      if (g.kind === "rule") at.push((at[0]! + at[2]!) / 2, (at[1]! + at[3]!) / 2);
      return pointsOf(at, colored(paintsAt(g)));
    }
  }
}

/**
 * Boxes inside a rectangle's corners, 4 CSS pixels square and a pixel in
 * from its edges (where outlines and antialiasing are), which tell where it
 * is drawn; the whole of a rectangle too small for them.
 */
function cornersOf({ x, y, width, height }: Region): Region[] {
  if (width < 10 || height < 10) return [{ x, y, width, height }];
  const [right, bottom] = [x + width - 5, y + height - 5];
  return [
    [x + 1, y + 1],
    [right, y + 1],
    [x + 1, bottom],
    [right, bottom],
  ].map(([left, top]) => ({ x: left!, y: top!, width: 4, height: 4 }));
}

const inside = (outer: Region, x: number, y: number, width: number, height: number) =>
  x >= outer.x &&
  y >= outer.y &&
  x + width <= outer.x + outer.width &&
  y + height <= outer.y + outer.height;

const overlap = (a: Region, b: Region) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The places a scene's marks draw at inside their panels' plots (what a
 * plot clips at its edges may not show), in colors that tell them from the
 * chart's furniture: none for marks drawn in greys, or only text.
 *
 * Where marks overlap, one shows through another drawn translucent over
 * it, so a place's colors are also its own under each translucent paint
 * drawn after it, and its translucent paints over each paint drawn before
 * it (its own mark's, either way); but not a blend that is another mark's own color (a translucent box
 * over its outline), which would take that mark's pixels for its own.
 */
export function anchorsIn(scene: Scene): Anchor[] {
  const anchors: Anchor[] = [];
  for (const { plot, marks } of scene.panels) {
    const drawn = marks.filter((g) => !drawsNothing(g));
    const places = drawn.map(placesOf);
    // Each mark's paints, once each (its places share them).
    const paints = places.map((each) => [
      ...new Map(
        each.flatMap((place) => place.paints).map((paint) => [`${paint}`, paint]),
      ).values(),
    ]);
    const plain = paints.map((each) => each.map(([rgb, opacity]) => over(rgb, opacity, WHITE)));
    const rects = places.flatMap((each) => each.filter((place) => place.width !== undefined));
    const opaque = rects.filter((place) => place.opaque);
    drawn.forEach((g, i) => {
      const others = plain.filter((_, j) => j !== i).flat();
      for (const place of places[i]!) {
        const { x, y, width = 0, height = 0 } = place;
        // A stroke along the plot's edge shows half its width.
        const edge = place.width === undefined ? 1 : 0;
        const [left, top] = [Math.max(x, plot.x + edge), Math.max(y, plot.y + edge)];
        const right = Math.min(x + width, plot.x + plot.width - edge);
        const bottom = Math.min(y + height, plot.y + plot.height - edge);
        if (place.paints.length === 0 || left > right || top > bottom) continue;
        const own = place.paints.map(([rgb, opacity]) => over(rgb, opacity, WHITE));
        const colors = [...own];
        const blend = (rgb: RGB) => {
          if (own.some((o) => near(o, rgb)) || !others.some((o) => near(o, rgb))) colors.push(rgb);
        };
        for (const [rgb, opacity] of place.paints)
          paints.forEach((each, j) => {
            for (const [other, translucent] of each) {
              // A mark's own paints (a radar's fills) overlap each other either way.
              if (j >= i && translucent < 1)
                blend(over(other, translucent, over(rgb, opacity, WHITE)));
              if (j <= i && opacity < 1) blend(over(rgb, opacity, over(other, translucent, WHITE)));
            }
          });
        const anchor = { key: g.key, kind: g.kind, colors: [...new Set(colors.map(hex))] };
        if (place.width === undefined) {
          anchors.push({ ...anchor, x: left, y: top });
          continue;
        }
        // The opaque rectangles drawn after this one over it, which hide it there.
        const later = opaque.filter((r) => rects.indexOf(r) > rects.indexOf(place)) as Region[];
        for (const corner of cornersOf({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        })) {
          const holes = later.filter((r) => overlap(r, corner));
          if (!holes.some((hole) => inside(hole, corner.x, corner.y, corner.width, corner.height)))
            anchors.push({ ...anchor, ...corner, holes });
        }
      }
    });
  }
  return anchors;
}

/**
 * The anchors a picture does not show: no block of 2 by 2 pixels within
 * `radius` CSS pixels of the point, or in the rectangle out of its holes
 * (grown by a CSS pixel, where edges blend), is within a few levels of one
 * of their colors; a rectangle its holes leave no block of is not missed.
 * The
 * picture is `width` pixels wide, `scale` pixels per CSS pixel, `channels`
 * bytes per pixel.
 */
export function missedAnchors(
  anchors: readonly Anchor[],
  pixels: Uint8Array | Uint8ClampedArray,
  picture: { width: number; scale: number; channels: number; radius?: number },
): Anchor[] {
  const { width, scale, channels, radius = 3 } = picture;
  const height = Math.floor(pixels.length / channels / width);
  return anchors.filter((anchor) => {
    const wanted = anchor.colors.map((color) => rgbOf(color)!);
    const holes = (anchor.holes ?? []).map(({ x, y, width, height }) => ({
      x: x - 1,
      y: y - 1,
      width: width + 2,
      height: height + 2,
    }));
    const [from, to] =
      anchor.width === undefined
        ? [
            [anchor.x - radius, anchor.y - radius],
            [anchor.x + radius, anchor.y + radius],
          ]
        : [
            [anchor.x, anchor.y],
            [anchor.x + anchor.width, anchor.y + anchor.height!],
          ];
    const [left, top] = [
      Math.max(0, Math.floor(from[0]! * scale)),
      Math.max(0, Math.floor(from[1]! * scale)),
    ];
    const right = Math.min(width - 1, Math.ceil(to[0]! * scale));
    const bottom = Math.min(height - 1, Math.ceil(to[1]! * scale));
    const nearAt = (at: number, [red, green, blue]: RGB) =>
      Math.abs(pixels[at]! - red) <= LEVELS &&
      Math.abs(pixels[at + 1]! - green) <= LEVELS &&
      Math.abs(pixels[at + 2]! - blue) <= LEVELS;
    const [step, row] = [channels, width * channels];
    let seen = false;
    for (let py = top; py < bottom; py++)
      for (let px = left; px < right; px++) {
        const block = { x: px / scale, y: py / scale, width: 2 / scale, height: 2 / scale };
        if (holes.length > 0 && holes.some((hole) => overlap(hole, block))) continue;
        seen = true;
        const at = (py * width + px) * channels;
        for (const color of wanted)
          if (
            nearAt(at, color) &&
            nearAt(at + step, color) &&
            nearAt(at + row, color) &&
            nearAt(at + row + step, color)
          )
            return false;
      }
    return seen;
  });
}

/** A text a scene's mark draws, its color, and the box it is drawn in (CSS pixels). */
export interface TextBox extends Region {
  key: string;
  text: string;
  color: string;
}

/** How a text is set: at its anchor's point, on the line it stands on (as a canvas aligns text). */
interface TextPlacing {
  anchor: "start" | "middle" | "end";
  baseline: "middle" | "hanging" | "alphabetic";
  font: string;
  size: number;
  lineHeight: number;
  color: string;
}

/**
 * The boxes the text of a scene's marks is drawn in: text marks' labels,
 * labels in styles of their own (not turned), rules' labels, and custom
 * marks' text, each as wide as `measure` makes its longest line, as tall as
 * its lines, placed by its anchor and baseline.
 */
export function textBoxesIn(scene: Scene, measure: MeasureText): TextBox[] {
  const boxes: TextBox[] = [];
  const add = (g: Geometry, text: string, at: [number, number], how: TextPlacing) => {
    if (!text.trim()) return;
    const { anchor, baseline, font, size, lineHeight, color } = how;
    const lines = text.split("\n");
    const width = Math.max(...lines.map((line) => measure(line, font)));
    const height = (lines.length - 1) * lineHeight + size;
    const x = anchor === "start" ? at[0] : anchor === "middle" ? at[0] - width / 2 : at[0] - width;
    const top = { middle: at[1] - size / 2, hanging: at[1], alphabetic: at[1] - 0.8 * size };
    boxes.push({ key: g.key, text, color, x, y: top[baseline], width, height });
  };
  const { font, fontSize, style, muted } = scene.theme;
  const base = { font: cssFont(font, fontSize), size: fontSize, lineHeight: style.text.lineHeight };
  for (const g of scene.panels.flatMap((panel) => panel.marks)) {
    if (g.kind === "text") {
      const { coords, labels, count, anchor, fill } = g as TextGeometry;
      for (let i = 0; i < count; i++) {
        // Lines centered on the label's point, as draw/labels.ts sets them.
        const first =
          coords[2 * i + 1]! - ((labels[i]!.split("\n").length - 1) * base.lineHeight) / 2;
        add(g, labels[i]!, [coords[2 * i]!, first], {
          ...base,
          anchor,
          baseline: "middle",
          color: fill,
        });
      }
    } else if (g.kind === "labels") {
      for (const item of (g as LabelsGeometry).items) {
        if (item.angle !== 0) continue;
        const { size, lineHeight, css, color } = item.paint;
        const { anchor, baseline } = item;
        add(g, item.text, [item.x, item.y], {
          font: css,
          size,
          lineHeight,
          anchor,
          baseline,
          color,
        });
      }
    } else if (g.kind === "rule" && (g as RuleGeometry).label) {
      // On its alphabetic baseline, as draw/rule.ts sets it.
      const { x, y, anchor } = ruleLabel(g as RuleGeometry, fontSize);
      const label = (g as RuleGeometry).label!;
      add(g, label, [x, y], { ...base, anchor, baseline: "alphabetic", color: muted });
    } else if (g.kind === "shapes") {
      const shapes = g as ShapesGeometry;
      const own = { font: shapes.font, size: shapes.fontSize, lineHeight: shapes.fontSize };
      for (const shape of shapes.shapes)
        if ("text" in shape) {
          const { text, x, y, anchor, fill } = shape as TextShape;
          add(g, text, [x, y], { ...own, anchor, baseline: "middle", color: fill });
        }
    }
  }
  return boxes;
}

/**
 * How many pixels of a box of a picture (`width` pixels wide, `scale` per
 * CSS pixel, `channels` bytes per pixel) are within a few levels of the
 * box's color: its glyphs' strokes, whatever they are drawn over.
 */
export function inkOf(
  box: TextBox,
  pixels: Uint8Array | Uint8ClampedArray,
  { width, scale, channels }: { width: number; scale: number; channels: number },
): number {
  const height = Math.floor(pixels.length / channels / width);
  const color = rgbOf(box.color) ?? [0, 0, 0];
  const [left, top] = [
    Math.max(0, Math.floor(box.x * scale)),
    Math.max(0, Math.floor(box.y * scale)),
  ];
  const right = Math.min(width, Math.ceil((box.x + box.width) * scale));
  const bottom = Math.min(height, Math.ceil((box.y + box.height) * scale));
  let inColor = 0;
  for (let py = top; py < bottom; py++)
    for (let px = left; px < right; px++) {
      const at = (py * width + px) * channels;
      if ([0, 1, 2].every((c) => Math.abs(pixels[at + c]! - color[c]!) <= 32)) inColor++;
    }
  return inColor;
}

/**
 * Expects a picture of a scene (`width` pixels wide, `scale` per CSS pixel,
 * `channels` bytes per pixel) to show every place its marks draw at in one
 * of their colors (`missedAnchors`), and their text in its boxes, in its
 * color: a few pixels of it per character (a glyph's strokes are pixels
 * across); text left out, or drawn elsewhere, tells. Its marks draw some
 * of either, as `measure` measures text.
 */
export function expectDrawn(
  scene: Scene,
  pixels: Uint8Array | Uint8ClampedArray,
  picture: { width: number; scale: number; channels: number },
  measure: MeasureText,
): void {
  const anchors = anchorsIn(scene);
  const boxes = textBoxesIn(scene, measure);
  const marks = scene.panels.flatMap((panel) => panel.marks).filter((g) => !drawsNothing(g));
  if (marks.every((g) => g.kind === "text" || g.kind === "labels"))
    expect(boxes.length, "texts the marks draw").toBeGreaterThan(0);
  else expect(anchors.length, "places the marks draw at in their colors").toBeGreaterThan(0);
  const at = ({ key, kind, x, y, width, height, colors }: Anchor) =>
    `${key} (${kind}) at ${x.toFixed(1)}, ${y.toFixed(1)}${
      width === undefined ? "" : ` (${width.toFixed(1)} by ${height!.toFixed(1)})`
    } in ${colors.slice(0, 3).join(" or ")}`;
  const missed = missedAnchors(anchors, pixels, picture);
  expect(missed.slice(0, 8).map(at), `${missed.length} of ${anchors.length} places`).toEqual([]);
  const scale = picture.scale;
  const missing = boxes
    .filter((box) => inkOf(box, pixels, picture) < 2 * box.text.replace(/\s/g, "").length * scale)
    .map(({ key, text, color }) => `${key} "${text}" in ${color}`);
  expect(missing, `texts not drawn in their places, of ${boxes.length}`).toEqual([]);
}
