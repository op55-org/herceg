// The capability matrix's declarations (test/contracts/ at the repository
// root) and its rows' charts, as the proofs read them: a proof takes a
// row's declared cell of its capability to choose what to assert, and
// asserts it with expectations of its own (see docs/contributing.md,
// "Contracts").

import { expect } from "vitest";
import capabilities from "../../../../test/contracts/capabilities.json";
import rows from "../../../../test/contracts/fixtures/rows.json";
import marks from "../../../../test/contracts/marks.json";
import type { SelectionStore } from "../../src/data/selection.ts";
import type { Schema, Table } from "../../src/data/table.ts";
import { estimateText, type MeasureText } from "../../src/layout/text.ts";
import { type CustomDataOptions, custom } from "../../src/marks/custom.ts";
import type { ChartMark } from "../../src/marks/mark.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { Geometry, Panel, Scene } from "../../src/scene/scene.ts";
import { ChartError } from "../../src/spec/errors.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec, MarkSpec } from "../../src/spec/spec.ts";

export interface Refusal {
  error: { code: string; path?: string; message: string };
  alternative: { text: string; proofs: string[] };
}

/** A row's cell of one capability: what it declares, which selects what its proof asserts. */
export type Cell =
  | { row: string; state: "works" }
  | ({ row: string; state: "refused" } & Refusal)
  | { row: string; state: "na"; reason: string };

interface Row {
  works?: string[];
  /** Declared to work, with no test proving it yet: no proof runs it. */
  unproved?: string[];
  refused?: Record<string, Refusal>;
  na?: Record<string, string>;
}

/**
 * Each mark row's cell of `capability`, but its unproved ones. A capability
 * nothing declares is an error, so that a misspelled one cannot prove nothing.
 */
export function cellsOf(capability: string): Cell[] {
  if (!(capability in capabilities.capabilities))
    throw new Error(`cellsOf: no capability "${capability}" in capabilities.json`);
  const cells = Object.entries(marks.rows as Record<string, Row>).flatMap(
    ([row, cells]): Cell[] => {
      if (cells.works?.includes(capability)) return [{ row, state: "works" }];
      const refused = cells.refused?.[capability];
      if (refused) return [{ row, state: "refused", ...refused }];
      const reason = cells.na?.[capability];
      return reason === undefined ? [] : [{ row, state: "na", reason }];
    },
  );
  if (cells.length === 0) throw new Error(`cellsOf: no row declares "${capability}"`);
  return cells;
}

/** The fixture's tables, by name, as a spec's `data`. */
export const tables = Object.fromEntries(
  Object.entries(rows.tables).map(([name, columns]) => [name, { columns }]),
) as ChartSpec["data"];

/** A column of the fixture cut to the rows `keep` marks. */
function cutColumn(column: unknown, keep: boolean[]): unknown {
  if (Array.isArray(column)) return column.filter((_, i) => keep[i]);
  const spec = column as { type: string; values?: unknown[]; codes?: number[] };
  // A geometry column keeps its shapes, and names the rows' among them.
  if (spec.type === "geometry")
    return { ...spec, codes: keep.flatMap((kept, i) => (kept ? [spec.codes?.[i] ?? i] : [])) };
  return { ...spec, values: spec.values!.filter((_, i) => keep[i]) };
}

/** The fixture's tables, each cut to the rows of `group`. */
export function groupTables(group: string): ChartSpec["data"] {
  return Object.fromEntries(
    Object.entries(rows.tables).map(([name, columns]: [string, Record<string, unknown>]) => {
      // A table without groups (a network's nodes) is not split.
      if (!columns.group) return [name, { columns }];
      const keep = (columns.group as string[]).map((value) => value === group);
      const cut = Object.fromEntries(
        Object.entries(columns).map(([field, column]) => [field, cutColumn(column, keep)]),
      );
      return [name, { columns: cut }];
    }),
  ) as ChartSpec["data"];
}

/** Rows the spec cannot write, made by their mark functions over a table of the spec's data. */
/** The labels of the series custom marks were last given to draw. */
export const customDrew = new Set<string>();

/** The radius of the circles custom marks draw. */
const CUSTOM_RADIUS = 3;

/**
 * How far past its plot, in CSS pixels, a row's places reach: custom
 * circles' outlines reach their radius past the points at its edges.
 */
export const REACH: Record<string, number> = { custom: CUSTOM_RADIUS };

/**
 * Options of the rows the spec cannot write, by row: custom marks draw a
 * circle per point of each series, each its row's item (noting the series
 * in `customDrew`).
 */
export const MADE_OPTIONS: Record<string, CustomDataOptions<Schema>> = {
  custom: {
    x: "x",
    y: "y",
    series: "kind",
    draw({ series, x, y, circle, item }) {
      customDrew.clear();
      for (const s of series) customDrew.add(s.label);
      for (const s of series)
        for (let i = 0; i < s.length; i++) {
          const row = s.rowAt(i);
          item(s, row, () => circle(x(s.x[row]!), y(s.y[row]!), CUSTOM_RADIUS, { fill: s.color }));
        }
    },
  } as CustomDataOptions<Schema>,
};

const MADE: Record<string, (data: Table, options: object) => ChartMark> = {
  custom: (data, options) =>
    custom(
      data as Table<Schema>,
      { ...MADE_OPTIONS.custom!, ...options } as CustomDataOptions<Schema>,
    ),
};

/**
 * Row `row`'s mark, reading its table, with `options` over its own: its
 * spec, or for a row the spec cannot write (custom), a stand-in `build`
 * makes with its mark function.
 */
export function markOf(row: string, options: object = {}): MarkSpec {
  const { table, mark } = fixtureOf(row);
  if (row in MADE) return { type: row, data: table, ...options } as unknown as MarkSpec;
  return { ...mark, data: table, ...options } as MarkSpec;
}

interface Fixture {
  table: string;
  mark?: object;
  constant?: boolean;
  categories?: string[];
  entry?: string;
  colorbar?: { options: object; domain?: number[] };
  toggle?: object;
  hiddenStay?: boolean;
  /** How the row's rows are selected (selection.test.ts reads it). */
  selection?: object;
  /** How the row reads (reading.test.ts reads it). */
  reading?: object;
}

/**
 * A table's defaults for selecting and reading its rows (rows.json's
 * `selections`), or for what moves them (`lifecycle`).
 */
export function defaultsOf(
  table: string,
  section: "selections" | "lifecycle" = "selections",
): Record<string, unknown> {
  return (rows[section] as unknown as Record<string, Record<string, unknown>>)[table] ?? {};
}

/** Row `row`'s entry in rows.json; an error when it has none. */
export function fixtureOf(row: string): Fixture {
  const fixture = (rows.rows as unknown as Record<string, Fixture>)[row];
  if (!fixture) throw new Error(`no fixture of row "${row}" in rows.json`);
  return fixture;
}

/** Whether row `row`'s mark reads no rows: an annotation at given values. */
export function isConstant(row: string): boolean {
  return fixtureOf(row).constant === true;
}

/** A line of the samples table, drawn beside a row's mark. */
export function neighbor(options: object = {}): MarkSpec {
  return { type: "line", data: "samples", x: "x", y: "y", ...options } as MarkSpec;
}

type Spec = Omit<ChartSpec, "data"> & { data?: ChartSpec["data"] };

/**
 * The chart options a spec makes, its stand-ins made by their mark
 * functions in their places, and the tables and selection stores it loaded.
 */
export function loadedOf(spec: Spec): {
  config: ChartConfig;
  tables: ReadonlyMap<string, Table>;
  stores: ReadonlyMap<string, SelectionStore>;
} {
  const data = spec.data ?? tables;
  const made = spec.marks.map((mark) => (mark.type in MADE ? mark : undefined));
  const loaded = loadSpec({
    ...spec,
    data,
    marks: spec.marks.filter((_, i) => !made[i]),
  } as ChartSpec);
  const { config } = loaded;
  const marks = [...config.marks];
  const all = made.map((stand) => {
    if (!stand) return marks.shift()!;
    const { type, data: name, ...options } = stand as { type: string; data: string };
    // The table the spec loaded, which its selection stores select rows of.
    return MADE[type]!(loaded.tables.get(name)!, options);
  });
  return {
    config: { locale: "en-US", timeZone: "UTC", ...config, marks: all },
    tables: loaded.tables,
    stores: loaded.stores,
  };
}

/**
 * Row `row`'s chart as a portable spec, its tables written in: what
 * Python's surfaces send. Undefined for a row the spec cannot write (custom).
 */
export function specOf(row: string): ChartSpec | undefined {
  if (row in MADE) return undefined;
  return { data: tables, marks: [markOf(row)], locale: "en-US", timeZone: "UTC" } as ChartSpec;
}

/** The chart options a spec makes (see `loadedOf`). */
export function configOf(spec: Spec): ChartConfig {
  return loadedOf(spec).config;
}

/**
 * The chart a spec makes, sized 600 by 400 and drawn once, with the
 * compilers a live chart loads when its options need them, its text
 * measured by `measure` (as an export measures it: PDF's fonts' widths).
 */
export function build(
  spec: Spec,
  measure: MeasureText = estimateText,
): { model: ChartModel; scene: Scene } {
  const model = new ChartModel(configOf(spec), undefined, ...staticCompilers());
  model.setSize(600, 400, 1);
  return { model, scene: model.scene(measure) };
}

/**
 * What a panel's geometry draws, apart from where and in which colors:
 * each geometry's key (its mark's index and series), kind, and how many
 * points, items, or labels it has. Placing a mark moves and scales it, and
 * its colors follow the chart's other marks; this stays.
 */
export interface Signed {
  key: string;
  kind: string;
  size: number;
  count?: number;
  /** A raster's cells drawn (its others are empty). */
  filled?: number;
  label?: string;
  labels?: string[];
}

export function signature(geometry: readonly Geometry[]): Signed[] {
  return geometry.map((g) => {
    const drawn = g as Geometry & {
      count?: number;
      label?: string;
      labels?: string[];
      pixels?: Uint8ClampedArray;
    };
    let filled: number | undefined;
    if (g.kind === "raster" && drawn.pixels) {
      filled = 0;
      for (let i = 3; i < drawn.pixels.length; i += 4) if (drawn.pixels[i]! > 0) filled++;
    }
    return {
      key: g.key,
      kind: g.kind,
      size: g.draw.size(g),
      ...(drawn.count !== undefined && { count: drawn.count }),
      ...(filled !== undefined && { filled }),
      ...(drawn.label !== undefined && { label: drawn.label }),
      ...(drawn.labels !== undefined && { labels: drawn.labels }),
    };
  });
}

/**
 * Where geometry draws: x, y pairs in CSS pixels from the chart's top left
 * (lines' and areas' points, rules' ends, rectangles' and rasters'
 * corners, points', texts', and segments' coordinates, labels', sectors'
 * centers, polygons' points as drawn, custom paths' points and texts', 3D
 * faces' vertices); none for the other kinds.
 */
export function anchorsOf(g: Geometry): number[] {
  const drawn = g as Geometry & Record<string, unknown>;
  const pairs = (coords: ArrayLike<number>, count: number) => Array.from(coords).slice(0, count);
  const polyline = (line: unknown) => {
    const { coords, count } = line as { coords: Float32Array; count: number };
    return pairs(coords, 2 * count);
  };
  const quads = (values: Float32Array, count: number) =>
    Array.from({ length: count }, (_, i) => values.subarray(4 * i, 4 * i + 4)).flatMap(
      ([x, y, width, height]) => [x!, y!, x! + width!, y! + height!],
    );
  const count = drawn.count as number;
  switch (g.kind) {
    case "line":
      return polyline(drawn.path);
    case "area":
      return [...polyline(drawn.upper), ...(drawn.lower ? polyline(drawn.lower) : [])];
    case "rule":
      return [drawn.x1, drawn.y1, drawn.x2, drawn.y2] as number[];
    case "text":
    case "point":
      return pairs(drawn.coords as Float32Array, 2 * count);
    case "segments":
      return pairs(drawn.coords as Float32Array, 4 * count);
    case "rect":
      return quads(drawn.rects as Float32Array, count);
    case "raster": {
      const { x, y, width, height } = drawn as unknown as Record<string, number>;
      return [x!, y!, x! + width!, y! + height!];
    }
    case "labels":
      return (drawn.items as { x: number; y: number }[]).flatMap(({ x, y }) => [x, y]);
    case "arc":
      return Array.from({ length: count }, (_, i) => i * 6).flatMap((at) => [
        (drawn.arcs as Float32Array)[at]!,
        (drawn.arcs as Float32Array)[at + 1]!,
      ]);
    case "shapes":
      // Paths through the points their data runs through; text at its point.
      return (drawn.shapes as ({ d: string } | { x: number; y: number })[]).flatMap((shape) =>
        "d" in shape ? pathPoints(shape.d).flat() : [shape.x, shape.y],
      );
    case "faces": {
      // The vertices faces' corners name, face after face (the buffer holds more).
      const faces = ((drawn.batches as { faces(): Geometry } | undefined)?.faces() ??
        g) as unknown as {
        vertices: Float32Array;
        corners: Uint32Array;
        starts: Uint32Array;
        count: number;
      };
      return Array.from(faces.corners.subarray(0, faces.starts[faces.count]!)).flatMap((v) => [
        faces.vertices[2 * v]!,
        faces.vertices[2 * v + 1]!,
      ]);
    }
    case "polygons": {
      // Drawn through the transform where it has one (a map's view).
      const { k, x, y } = (drawn.transform as { k: number; x: number; y: number }) ?? {
        k: 1,
        x: 0,
        y: 0,
      };
      return (drawn.shapes as { coords: Float32Array }[]).flatMap(({ coords }) =>
        Array.from(coords, (v, i) => (i % 2 ? y : x) + k * v),
      );
    }
    default:
      return [];
  }
}

/** How many numbers each command of SVG path data takes, and which of them end it. */
const PATH_COMMANDS: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
};

/** The points path data runs through: each command's end, subpath after subpath. */
export function pathPoints(d: string): number[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const paths: number[][] = [];
  let [x, y, startX, startY] = [0, 0, 0, 0];
  let command = "";
  for (let i = 0; i < tokens.length; ) {
    if (/[a-zA-Z]/.test(tokens[i]!)) command = tokens[i++]!;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === "Z") {
      [x, y] = [startX, startY];
      paths.at(-1)?.push(x, y);
      continue;
    }
    const size = PATH_COMMANDS[upper];
    if (size === undefined) throw new Error(`path data: no command ${command} in "${d}"`);
    const args = tokens.slice(i, i + size).map(Number);
    i += size;
    if (upper === "H") x = (relative ? x : 0) + args[0]!;
    else if (upper === "V") y = (relative ? y : 0) + args[0]!;
    else [x, y] = [(relative ? x : 0) + args.at(-2)!, (relative ? y : 0) + args.at(-1)!];
    if (upper === "M") {
      paths.push([]);
      [startX, startY] = [x, y];
      // Pairs after a move are lines.
      command = relative ? "l" : "L";
    }
    paths.at(-1)?.push(x, y);
  }
  return paths;
}

/**
 * What a panel draws and where: each geometry's signature, with its
 * anchors from the panel's plot's top left, so that a mark drawn in two
 * panels of one size draws alike in both (`expectPlacedAlike`).
 */
export function placedIn(panel: Panel): (Signed & { at: number[] })[] {
  const { x, y } = panel.plot;
  return signature(panel.marks).map((signed, i) => ({
    ...signed,
    at: anchorsOf(panel.marks[i]!).map((v, k) => (k % 2 ? v - y : v - x)),
  }));
}

/**
 * Expects every place a panel draws at to be in its plot, a pixel's
 * rounding apart, or as far past it as the row's places reach (`REACH`).
 */
export function expectInside(panel: Panel, row: string): void {
  const { width, height } = panel.plot;
  const reach = 1 + (REACH[row] ?? 0);
  const at = placedIn(panel).flatMap(({ at }) => at);
  expect(at.length, "places in the panel").toBeGreaterThan(0);
  const outside: string[] = [];
  for (let k = 0; k < at.length; k += 2) {
    const [x, y] = [at[k]!, at[k + 1]!];
    if (!(x >= -reach && x <= width + reach && y >= -reach && y <= height + reach))
      outside.push(`${x.toFixed(1)}, ${y.toFixed(1)}`);
  }
  expect(outside, `places outside the plot (${width} x ${height})`).toEqual([]);
}

/** Expects two panels' drawings alike: the same signatures, at places a twentieth of a pixel apart at most. */
export function expectPlacedAlike(
  drawn: ReturnType<typeof placedIn>,
  expected: ReturnType<typeof placedIn>,
): void {
  const what = (placed: typeof drawn) => placed.map(({ at, ...signed }) => signed);
  expect(what(drawn)).toEqual(what(expected));
  drawn.forEach(({ key, at }, i) => {
    const there = expected[i]!.at;
    expect(at.length, `${key}: places`).toBe(there.length);
    const apart = Math.max(0, ...at.map((v, k) => Math.abs(v - there[k]!)));
    expect(apart, `${key}: pixels apart`).toBeLessThan(0.05);
  });
}

/** Whether geometry draws nothing: a hidden mark's, kept for its place. */
export function drawsNothing(g: Geometry): boolean {
  // A rule draws its one line without points or items to count.
  return g.kind !== "rule" && g.draw.size(g) === 0 && !(g as { count?: number }).count;
}

/**
 * The colors geometry paints with and their opacity: strokes and fills,
 * palettes of items (slices, regions, points) as far as items use them,
 * shapes', and 3D faces'. Geometry that draws nothing (a hidden mark's)
 * paints nothing.
 */
export function paintsAt(g: Geometry): [paint: string, opacity: number][] {
  if (drawsNothing(g)) return [];
  const drawn = g as Geometry & {
    count?: number;
    stroke?: string | null;
    fill?: string;
    opacity?: number;
    fillOpacity?: number;
    colors?: readonly string[] | { palette: readonly string[] };
    colorIndex?: ArrayLike<number>;
    shapes?: readonly { fill?: string; stroke?: string; opacity?: number }[];
    styles?: readonly { fill: string; opacity?: number }[];
    style?: ArrayLike<number>;
  };
  // A drawing of geometry dimmed or clipped (a highlight's) draws at a fraction of its opacity.
  const opacity = (drawn.opacity ?? 1) * (g.draw.opacity ?? 1);
  const filled = (drawn.fillOpacity ?? 1) * opacity;
  const paints: [string, number][] = [];
  if (typeof drawn.stroke === "string") paints.push([drawn.stroke, opacity]);
  if (typeof drawn.fill === "string") paints.push([drawn.fill, filled]);
  const colors = Array.isArray(drawn.colors)
    ? drawn.colors
    : (drawn.colors as { palette?: string[] })?.palette;
  const used =
    colors && drawn.colorIndex ? Array.from(drawn.colorIndex, (i) => colors[i]!) : colors;
  for (const color of used ?? []) paints.push([color, filled]);
  for (const shape of drawn.shapes ?? []) {
    const at = (shape.opacity ?? 1) * opacity;
    if (typeof shape.fill === "string" && shape.fill !== "none") paints.push([shape.fill, at]);
    if (typeof shape.stroke === "string") paints.push([shape.stroke, at]);
  }
  const { styles, style } = drawn;
  const faces =
    styles && style && drawn.count !== undefined
      ? Array.from(style)
          .slice(0, drawn.count)
          .map((i) => styles[i]!)
      : (styles ?? []);
  for (const face of faces) paints.push([face.fill, face.opacity ?? 1]);
  return paints;
}

/** The colors geometry paints with (see `paintsAt`). */
export function paintsOf(geometry: readonly Geometry[]): Set<string> {
  return new Set(geometry.flatMap((g) => paintsAt(g).map(([paint]) => paint)));
}

/** The panel of `key` in a scene; an error when it has none. */
export function panelOf(scene: Scene, key: string) {
  const panel = scene.panels.find((p) => p.key === key);
  if (!panel) throw new Error(`no panel "${key}"; the scene has ${scene.panels.map((p) => p.key)}`);
  return panel;
}

/**
 * Expects `make` to fail as a refusal declares: a ChartError of its code,
 * path, and message, not an error some other code throws on the way.
 */
export function expectRefused(make: () => unknown, { error }: Refusal): void {
  let thrown: unknown;
  try {
    make();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, "the request is refused").toBeDefined();
  expect(thrown, `a ChartError, not ${String(thrown)}`).toBeInstanceOf(ChartError);
  const { code, path, message } = thrown as ChartError;
  expect({ code, path, message }).toEqual({ path: undefined, ...error });
}

export const rgbOf = (hex: string): [number, number, number] | undefined => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
};

/** A color drawn at `opacity` over white, as a page shows it. */
export function overWhite(rgb: [number, number, number], opacity: number): string {
  return `#${rgb
    .map((v) =>
      Math.round(v * opacity + 255 * (1 - opacity))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * The colors a scene's marks paint that tell them from a chart's furniture,
 * as they show over a white page: their paints at their opacity and
 * rasters' cell colors, without greys (axes, text, and grid lines are grey).
 * With `dim`, only those no paint comes near drawn at `dim` times its
 * opacity, which tell a mark drawn so from one drawn as it is.
 */
export function markColors(scene: Scene, dim?: number): string[] {
  const colors = new Set<string>();
  const dimmed: string[] = [];
  for (const g of scene.panels.flatMap((p) => p.marks)) {
    const pixels = (g as { pixels?: Uint8ClampedArray }).pixels;
    const paints: [[number, number, number], number][] = [];
    if (g.kind === "raster" && pixels) {
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i + 3] === 255) paints.push([[pixels[i]!, pixels[i + 1]!, pixels[i + 2]!], 1]);
    } else
      for (const [paint, opacity] of paintsAt(g)) {
        const rgb = rgbOf(paint);
        if (rgb) paints.push([rgb, opacity]);
      }
    for (const [rgb, opacity] of paints) {
      if (grey(rgb)) continue;
      colors.add(overWhite(rgb, opacity));
      if (dim !== undefined) dimmed.push(overWhite(rgb, opacity * dim));
    }
  }
  if (dim === undefined) return [...colors];
  return [...colors].filter((color) => !dimmed.some((other) => near(color, other)));
}

/** Whether two colors are within a few levels of each other, as `nearColor` counts them. */
function near(a: string, b: string): boolean {
  const [x, y] = [rgbOf(a)!, rgbOf(b)!];
  return x.every((v, i) => Math.abs(v - y[i]!) <= 24);
}

export const grey = (rgb: readonly number[]) => Math.max(...rgb) - Math.min(...rgb) <= 40;

/** How many pixels of `pixels` (`channels` bytes each, RGB first) are within a few levels of `color`. */
export function nearColor(
  pixels: Uint8Array | Uint8ClampedArray,
  channels: number,
  color: string,
): number {
  const [r, g, b] = rgbOf(color)!;
  let count = 0;
  for (let i = 0; i + 2 < pixels.length; i += channels)
    if (
      Math.abs(pixels[i]! - r) <= 24 &&
      Math.abs(pixels[i + 1]! - g) <= 24 &&
      Math.abs(pixels[i + 2]! - b) <= 24
    )
      count++;
  return count;
}

/** A rectangle in CSS pixels from the top left of a chart. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest region holding every one of `regions` (a chart's plots). */
export function regionOf(regions: readonly Region[]): Region {
  const x = Math.min(...regions.map((r) => r.x));
  const y = Math.min(...regions.map((r) => r.y));
  const right = Math.max(...regions.map((r) => r.x + r.width));
  const bottom = Math.max(...regions.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * An image's pixels (`channels` bytes each), `width` pixels wide at `scale`
 * pixels per CSS pixel, apart: those inside `region` grown by `margin` CSS
 * pixels, and the others.
 */
export function splitPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  scale: number,
  region: Region,
  margin = 0,
  channels = 4,
): { inside: Uint8ClampedArray; outside: Uint8ClampedArray } {
  const [left, top] = [(region.x - margin) * scale, (region.y - margin) * scale];
  const [right, bottom] = [
    (region.x + region.width + margin) * scale,
    (region.y + region.height + margin) * scale,
  ];
  const inside: number[] = [];
  const outside: number[] = [];
  for (let i = 0; i + channels <= pixels.length; i += channels) {
    const [x, y] = [(i / channels) % width, Math.floor(i / channels / width)];
    const to = x >= left && x < right && y >= top && y < bottom ? inside : outside;
    for (let c = 0; c < channels; c++) to.push(pixels[i + c]!);
  }
  return { inside: Uint8ClampedArray.from(inside), outside: Uint8ClampedArray.from(outside) };
}
