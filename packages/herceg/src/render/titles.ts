// Native tooltips in static SVG: an invisible pointer target (a point's
// symbol, a bar's rectangle, a circle around an observation of a line)
// with a `<title>` for each bar, point, and observation a chart's
// tooltip inspects, with the text the tooltip shows for that row. The
// drawing stays as the SVG writer packs it; each geometry's targets follow
// its markup (a line's after its markers), in the order its items paint,
// so what paints over an item, later in it or in a later mark, takes the
// pointer as it does on screen. The scene is drawn here, its bars and
// points saying which row each item draws (their `rows`), without the DOM;
// only exports asking for titles load this module.

import { fieldReader } from "../dom/tooltip-content.ts";
import { escapeXml, n, SvgPath } from "../draw/markup.ts";
import { rectPath, traceSides } from "../draw/rect.ts";
import { SYMBOLS, symbolPath } from "../draw/symbols.ts";
import type { MeasureText } from "../layout/text.ts";
import { placeAt, rowOf, type Series, visibleRange } from "../marks/series.ts";
import type { AxisInspection } from "../model/inspect.ts";
import type { ChartModel } from "../model/model.ts";
import {
  clipOf,
  type Geometry,
  type PointGeometry,
  type Rect,
  type RectGeometry,
  type Scene,
  type SvgContext,
} from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { ThemeEnvironment } from "../theme.ts";

/** Targets written with titles by default, at most. */
const BUDGET = 5000;

/** Pixels around an observation of a line its target reaches. */
const TARGET = 5;

/**
 * A target's outline `width` pixels wide, painted invisibly: WebKit's
 * pointer reaches no further than a shape's fill unless it has a stroke,
 * whatever its pointer-events.
 */
const outline = (width: number) => ` stroke="#000" stroke-opacity="0" stroke-width="${width}"`;

/** Markup after a geometry's own: its titled targets (see `SvgContext.titles`). */
export type SvgTitles = NonNullable<SvgContext["titles"]>;

/**
 * The model's scene, drawn for titles, and the titles of its bars,
 * points, and lines as its tooltips read them: at most `budget` targets,
 * past which it refuses with a ChartError. Its scene reads `page` (a
 * mounted chart's) as the chart's do. Write the scene with
 * `renderSvg(scene, { titles })`.
 */
export function titlesOf(
  model: ChartModel,
  measure: MeasureText,
  { budget = BUDGET, page }: { budget?: number; page?: ThemeEnvironment } = {},
): { scene: Scene; titles: SvgTitles } {
  // Every mark is drawn as the chart draws it (highlighted, if it is),
  // its bars and points saying which row each draws, and inspected with
  // the fields its tooltip shows.
  const { fields } = model;
  model.fields = fields ?? fieldReader;
  let scene: Scene;
  try {
    scene = model.scene(measure, false, page);
  } finally {
    model.fields = fields;
  }
  const after = new Map<Geometry, string>();
  let count = 0;
  /** Counts `more` targets, refusing past the budget. */
  const counted = (more: number) => {
    count += more;
    if (count > budget)
      throw new ChartError({
        code: "unsupported",
        path: "tooltip",
        message: `chart tooltip: titles in SVG go on at most ${budget} bars, points, and observations of lines, and this chart draws more; draw fewer, or export without titles`,
      });
  };
  /** An invisible target, `element` with `attributes` (and `inside` it, its shapes), titled `title`. */
  const markup = (element: string, attributes: string, title: string, inside = "") =>
    `<${element}${attributes} fill="none" pointer-events="all"><title>${escapeXml(title)}</title>${inside}</${element}>`;
  const chart = { x: 0, y: 0, width: scene.width, height: scene.height };
  for (const panel of scene.panels) {
    const inspector = model.inspectorOf(panel.key);
    if (!inspector) continue;
    const owners = new Map<string, Owner>();
    for (const { mark, visible, frame } of inspector.marks) {
      const axis = mark.tooltip === "y" ? "y" : "x";
      const lit = mark.table && frame.highlighted?.(mark.table);
      for (const s of visible) owners.set(s.key, { s, axis, domain: frame[axis].domain, lit });
    }
    /** What the tooltip says of position `k` of `s`. */
    const titleAt = ({ s, axis }: Owner, k: number) =>
      inspector.inspectAt(axis, placeAt(s, axis, rowOf(s, k)), [s], undefined, s, k);
    // A geometry draws its series (its key's), or a part of it: highlighted
    // rows (its key, then "\u0001" and the part), bars of a look of their
    // own, a line's markers (its key, then "|" and the part).
    const ownerOf = ({ key }: Geometry) => {
      const whole = key.split("\u0001")[0]!;
      return owners.get(whole) ?? owners.get(whole.slice(0, whole.lastIndexOf("|")));
    };
    // Each series' last geometry, its highlighted rows' last apart (drawn
    // over the others), and the series drawn as lines, whose targets follow
    // them (after their markers).
    const lastOf = new Map<Owner, Geometry>();
    const lastLit = new Map<Owner, Geometry>();
    const lines = new Set<Owner>();
    // Bars and points, and the rows of each series they draw, which alone
    // are looked up in it: as many as there are targets.
    const titled: [PointGeometry | RectGeometry, Owner][] = [];
    const wanted = new Map<Owner, Set<number>>();
    for (const geometry of panel.marks) {
      const owner = ownerOf(geometry);
      if (!owner) continue;
      (geometry.key.includes(LIT) ? lastLit : lastOf).set(owner, geometry);
      if (geometry.kind === "line") lines.add(owner);
      if (geometry.kind !== "point" && geometry.kind !== "rect") continue;
      const items = geometry as PointGeometry | RectGeometry;
      if ((items as PointGeometry).cloud)
        throw new ChartError({
          code: "unsupported",
          path: "tooltip",
          message: `chart tooltip: a series of ${(items as PointGeometry).cloud!.end} points is drawn on the GPU, whose points have no titles in SVG; draw fewer, or export without titles`,
        });
      if (!items.rows) continue;
      counted(items.count);
      titled.push([items, owner]);
      const rows = wanted.get(owner) ?? new Set<number>();
      wanted.set(owner, rows);
      for (let i = 0; i < items.count; i++) rows.add(items.rows[i]!);
    }
    const positions = new Map(
      [...wanted].map(([owner, rows]) => [owner, positionsOf(owner.s, rows)]),
    );
    for (const [items, owner] of titled) {
      const positionOf = positions.get(owner)!;
      let out = "";
      for (const i of itemOrder(items)) {
        const [element, attributes, inside] = shapeOf(items, i);
        out += markup(
          element,
          attributes,
          titleOf(titleAt(owner, positionOf.get(items.rows![i]!)!)),
          inside,
        );
      }
      after.set(items, (after.get(items) ?? "") + out);
    }
    for (const owner of lines) {
      const last = lastOf.get(owner) ?? lastLit.get(owner)!;
      const lit = lastLit.get(owner) ?? last;
      // An observation each, where it is drawn (within what the line is cut
      // to, which cuts its targets too), as the keyboard reads it:
      // highlighted ones over the others, as they are drawn.
      const box = clipOf(last) === "plot" ? panel.plot : chart;
      const [start, end] = visibleRange(owner.s, owner.domain[0]!, owner.domain[1]!);
      const out = ["", ""];
      for (let k = start; k < end; k++) {
        const point = titleAt(owner, k);
        const at = point.points[0];
        if (!at || !inside(at.px, at.py, box)) continue;
        counted(1);
        out[owner.lit?.[rowOf(owner.s, k)] ?? 0] += markup(
          "circle",
          ` cx="${n(at.px)}" cy="${n(at.py)}" r="${TARGET}"`,
          titleOf(point),
        );
      }
      after.set(last, (after.get(last) ?? "") + out[0]);
      after.set(lit, (after.get(lit) ?? "") + out[1]);
    }
  }
  return { scene, titles: (mark) => after.get(mark) };
}

/**
 * A series a panel inspects, along which axis its tooltip reads it, what
 * the panel shows of that axis, and with a selection highlighted, which of
 * its table's rows it holds.
 */
interface Owner {
  readonly s: Series;
  readonly axis: "x" | "y";
  readonly domain: readonly number[];
  readonly lit: Uint8Array | undefined;
}

/** What the keys of geometries drawing highlighted rows hold (model/highlight.ts). */
const LIT = "\u0001on";

/** The position in `s` of each of table rows `wanted`, which a part of it drawn (a highlight's) names. */
function positionsOf(s: Series, wanted: ReadonlySet<number>): Map<number, number> {
  const at = new Map<number, number>();
  const { rows } = s;
  if (!rows) for (const row of wanted) at.set(row, row);
  else
    for (let k = 0; k < rows.length && at.size < wanted.size; k++)
      if (wanted.has(rows[k]!)) at.set(rows[k]!, k);
  return at;
}

/** What the tooltip says of an inspection, a line each: its heading, then each point and its fields. */
function titleOf(inspection: AxisInspection): string {
  return [
    inspection.label,
    ...inspection.points.map(
      ({ label, text, fields = [] }) =>
        `${label}: ${[text, ...fields.map((field) => `${field.label}: ${field.text}`)].join(", ")}`,
    ),
  ].join("\n");
}

/** Whether a pixel is in `box`, as observations drawn are. */
function inside(x: number, y: number, box: Rect): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/**
 * Point or bar `i`'s target as painted: its element, attributes, and
 * shapes inside: the point's symbol with its outline around it, joined round,
 * or the bar's fill (its rounded end too) and the sides its outline strokes.
 */
function shapeOf(
  mark: PointGeometry | RectGeometry,
  i: number,
): [element: string, attributes: string, inside: string] {
  if (mark.kind === "point") {
    const symbol = mark.symbols ? SYMBOLS[mark.symbols[i]!]! : mark.symbol;
    const r = mark.radii?.[i] ?? mark.radius;
    const d = symbolPath(symbol, mark.coords[i * 2]!, mark.coords[i * 2 + 1]!, r);
    // Rings join round (see draw/point.ts), so a corner reaches no farther than half their width.
    const ring = mark.ring
      ? `${outline(mark.ring.width)} stroke-linejoin="round"`
      : ' stroke-width="0"';
    return ["path", ` d="${d}"${ring}`, ""];
  }
  const one = <A extends { subarray(start: number, end: number): A }>(array: A) =>
    array.subarray(i, i + 1);
  const { edge, rounded } = mark;
  const sides = edge?.sides;
  const bar: RectGeometry = {
    ...mark,
    rects: mark.rects.subarray(i * 4, i * 4 + 4),
    count: 1,
    rounded: rounded && { ...rounded, ends: one(rounded.ends) },
  };
  const fill = rectPath(bar);
  if (!edge) return ["path", ` d="${fill}" stroke-width="0"`, ""];
  if (sides === undefined) return ["path", ` d="${fill}"${outline(edge.width)}`, ""];
  const stroked = new SvgPath();
  traceSides(stroked, bar, typeof sides === "number" ? sides : one(sides));
  return [
    "g",
    ' stroke-width="0"',
    `<path d="${fill}"/><path d="${stroked.d}"${outline(edge.width)}/>`,
  ];
}

/**
 * The order items paint in: opaque points of several colors color by
 * color (see draw/point.ts), everything else as listed.
 */
function itemOrder(mark: PointGeometry | RectGeometry): number[] {
  const order = Array.from({ length: mark.count }, (_, i) => i);
  if (mark.kind !== "point" || !mark.opaque || mark.ring || !mark.colors) return order;
  const { index } = mark.colors;
  return order.sort((a, b) => index[a]! - index[b]! || a - b);
}
