// Brushing: dragging across the plot selects a range along x or y, a
// rectangle, or a freehand region (a lasso), drawn in the pointer overlay
// in the theme's `brush` paint. The selection is kept in data values, so it
// stays on its data as the chart zooms, pans, or resizes. On a category axis
// the values are whole category indices, and the selection covers their
// slots.

import type { PositionScale } from "../scale/scale.ts";
import type { Rect } from "../scene/scene.ts";
import type { BrushOptions, BrushSpec } from "../spec/spec.ts";
import { dashPattern } from "../style/dash.ts";
import type { Theme } from "../theme.ts";
import type { BrushSelection, normalize } from "./brushed.ts";

/** A plotting area the brush draws in: its plot and scales. */
export interface BrushPanel {
  plot: Rect;
  /** With insets over the panel, the parts of its plot they leave visible. */
  visible?: readonly Rect[] | undefined;
  x: PositionScale;
  y: PositionScale;
}

/**
 * Pixels a drag moves before it selects (brushed.ts); not imported, which
 * would split brushed.ts out of the chart's bundle into a chunk of its own.
 */
const DRAG_THRESHOLD = 3;

/** Most points a lasso keeps; longer drags keep every other one, then every fourth... */
const LASSO_POINTS = 400;

const SVG = "http://www.w3.org/2000/svg";

/**
 * The ends of a brush a drag moves: each range's low (`x0`, `y0`) and high
 * (`x1`, `y1`) end; all of them to move it whole.
 */
export interface Handle {
  readonly x0: boolean;
  readonly x1: boolean;
  readonly y0: boolean;
  readonly y1: boolean;
}

/** Pixels from a brush's edge within which a press resizes it rather than moves it. */
const EDGE = 5;

export class Brush {
  /** Holds an outline per panel, each clipped to its plot. */
  readonly element: SVGGElement;
  #mode: BrushSpec = "x";
  /** A drag in progress: its pixel points in the panel it started in. */
  #drag: { points: [number, number][]; panel: BrushPanel } | null = null;
  /**
   * A move or resize in progress: the selection it started from, the ends
   * it moves, where it started and where the pointer is, in the panel it
   * started in.
   */
  #edit: {
    from: BrushSelection;
    handle: Handle;
    start: [number, number];
    at: [number, number];
    panel: BrushPanel;
  } | null = null;
  #outlines: { path: SVGPathElement; clip: SVGClipPathElement }[] = [];
  #shown = false;
  /** Prefix of the clip paths' ids, unique in the page. */
  readonly #id: string;
  /** How a selection's ends sit on a panel's scales (brushed.ts), handed in for the same reason. */
  readonly #normalize: typeof normalize;

  constructor(element: SVGGElement, id: string, ends: typeof normalize) {
    this.element = element;
    this.#id = id;
    this.#normalize = ends;
  }

  /** Whether a drag draws, moves, or resizes the brush. */
  /** The brush's shape. */
  get mode(): BrushSpec {
    return this.#mode;
  }

  /** Takes `interaction.brush` as given, a shape alone or with its settings: "x" by default. */
  set mode(brush: BrushSpec | BrushOptions | undefined) {
    this.#mode = (typeof brush === "object" ? brush.shape : brush) ?? "x";
  }

  get dragging(): boolean {
    return this.#drag !== null || this.#edit !== null;
  }

  /** Starts a drag at a pixel of a panel, kept inside its plot. */
  start(px: number, py: number, panel: BrushPanel): void {
    this.#drag = { points: [clamp(px, py, panel.plot)], panel };
  }

  /**
   * What a press at a pixel of `panel` would move of `selection`: the ends
   * within a few pixels of it, or inside it, every end; undefined off it,
   * and for lassos, which are neither moved nor resized.
   */
  handleAt(
    px: number,
    py: number,
    selection: BrushSelection,
    panel: BrushPanel,
  ): Handle | undefined {
    if (selection.lasso) return undefined;
    const [x0, x1, y0, y1] = pixelEnds(selection, panel, true) as [number, number, number, number];
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (px < left - EDGE || px > right + EDGE || py < top - EDGE || py > bottom + EDGE)
      return undefined;
    const near = (end: number, at: number, ranged: unknown) =>
      !!ranged && Math.abs(end - at) <= EDGE;
    const handle = {
      x0: near(x0, px, selection.x),
      x1: near(x1, px, selection.x),
      y0: near(y0, py, selection.y),
      y1: near(y1, py, selection.y),
    };
    const resizes = handle.x0 || handle.x1 || handle.y0 || handle.y1;
    if (resizes) return handle;
    const inside = px >= left && px <= right && py >= top && py <= bottom;
    return inside ? { x0: true, x1: true, y0: true, y1: true } : undefined;
  }

  /** Starts moving the ends `handle` names of `from` at a pixel of `panel`. */
  edit(handle: Handle, from: BrushSelection, px: number, py: number, panel: BrushPanel): void {
    this.#edit = { from, handle, start: [px, py], at: [px, py], panel };
  }

  move(px: number, py: number): void {
    if (this.#edit) {
      this.#edit.at = [px, py];
      return;
    }
    const drag = this.#drag;
    if (!drag) return;
    const point = clamp(px, py, drag.panel.plot);
    // Ranges and rectangles need only their two corners; lassos their path.
    if (this.mode !== "lasso") {
      drag.points[1] = point;
      return;
    }
    const [lx, ly] = drag.points[drag.points.length - 1]!;
    if (Math.hypot(point[0] - lx, point[1] - ly) < 2) return;
    if (drag.points.length >= LASSO_POINTS) drag.points = drag.points.filter((_, i) => i % 2 === 0);
    drag.points.push(point);
  }

  /** What the gesture in progress would select if it ended now; null for none. */
  current(): BrushSelection | null {
    const edit = this.#edit;
    if (edit) {
      const [dx, dy] = [edit.at[0] - edit.start[0], edit.at[1] - edit.start[1]];
      const { handle, from, panel } = edit;
      return this.#ranged(from, panel, pixelEnds(from, panel, false), [
        handle.x0 ? dx : 0,
        handle.x1 ? dx : 0,
        handle.y0 ? dy : 0,
        handle.y1 ? dy : 0,
      ]);
    }
    const drag = this.#drag;
    return drag && selectionOf(drag.points, drag.panel, this.mode, this.#normalize);
  }

  /** Ends the gesture: what it selected, or null when it was too small to mean anything. */
  end(): BrushSelection | null {
    const selected = this.current();
    this.#drag = this.#edit = null;
    return selected;
  }

  cancel(): void {
    this.#drag = this.#edit = null;
  }

  /**
   * `selection` resized about a pixel of `panel` by `factor` (above 1
   * larger), within the plot; the selection as it was where it would be
   * smaller than a few pixels.
   */
  resized(
    selection: BrushSelection,
    panel: BrushPanel,
    px: number,
    py: number,
    factor: number,
  ): BrushSelection {
    const ends = pixelEnds(selection, panel, false);
    const at = [px, px, py, py];
    return this.#ranged(
      selection,
      panel,
      ends,
      ends.map((end, i) => (end - at[i]!) * (factor - 1)),
    );
  }

  /**
   * `from` with its pixel `ends` (low and high x, low and high y) moved by
   * `shift`, kept within the plot: an end moved alone stops at it, ends
   * moved together keep their distance. A range resized to less than a
   * few pixels wide stays as it was; one moved whole keeps its width (a
   * category's, whose ends are one center, none).
   */
  #ranged(
    from: BrushSelection,
    panel: BrushPanel,
    ends: readonly number[],
    shift: readonly number[],
  ): BrushSelection {
    const { plot } = panel;
    const along = (axis: "x" | "y", i: number) => {
      const range = from[axis];
      if (!range) return null;
      const [lo, hi] =
        axis === "x" ? [plot.x, plot.x + plot.width] : [plot.y, plot.y + plot.height];
      let [a, b] = [ends[i]! + shift[i]!, ends[i + 1]! + shift[i + 1]!];
      const whole = shift[i] === shift[i + 1];
      // Moved whole, it keeps its width inside the plot.
      if (whole && shift[i] !== 0) {
        const over = Math.max(a, b) - hi;
        const under = lo - Math.min(a, b);
        const by = over > 0 ? -over : under > 0 ? under : 0;
        [a, b] = [a + by, b + by];
      }
      [a, b] = [Math.min(hi, Math.max(lo, a)), Math.min(hi, Math.max(lo, b))];
      if (!whole && Math.abs(a - b) < DRAG_THRESHOLD) return range;
      const scale = panel[axis];
      return this.#normalize(scale, scale.invert(a), scale.invert(b));
    };
    return { ...from, x: along("x", 0), y: along("y", 2) };
  }

  /** Draws the drag in progress, or else `selected`, in every panel (they share scales). */
  draw(panels: readonly BrushPanel[], theme: Theme, selected: BrushSelection | null): void {
    const drag = this.#drag;
    const selection = drag
      ? selectionOf(drag.points, drag.panel, this.mode, this.#normalize, true)
      : this.#edit
        ? this.current()
        : selected;
    if (!selection) {
      // Most frames have no brush: leave the hidden outlines alone.
      if (this.#shown)
        for (const { path } of this.#outlines) path.setAttribute("visibility", "hidden");
      this.#shown = false;
      return;
    }
    this.#shown = true;
    const document = this.element.ownerDocument;
    // The theme's brush, the muted color at 0.18 by default; a lasso's
    // outline in its fill's color unless it gives a stroke.
    const { fill = theme.muted, fillOpacity = 0.18, stroke, opacity = 1 } = theme.roles.brush;
    const { strokeWidth = 1, dash, strokeOpacity } = theme.roles.brush;
    const outline =
      stroke ??
      (!selection.lasso ? "none" : fill === "none" || fill === "transparent" ? theme.muted : fill);
    const pattern = dashPattern(dash, strokeWidth);
    while (this.#outlines.length < panels.length) {
      const id = `${this.#id}-${this.#outlines.length}`;
      const clip = document.createElementNS(SVG, "clipPath");
      clip.setAttribute("id", id);
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("clip-path", `url(#${id})`);
      this.element.append(clip, path);
      this.#outlines.push({ path, clip });
    }
    this.#outlines.forEach(({ path, clip }, i) => {
      const panel = panels[i];
      const d = panel ? outlineOf(selection, panel, !drag) : "";
      if (!panel || !d) {
        path.setAttribute("visibility", "hidden");
        return;
      }
      // Cut to the plot, or the parts of it insets over it leave visible.
      const rects = [...(panel.visible ?? [panel.plot])];
      while (clip.childElementCount > rects.length) clip.lastElementChild!.remove();
      while (clip.childElementCount < rects.length)
        clip.append(document.createElementNS(SVG, "rect"));
      rects.forEach((rect, k) => {
        const node = clip.children[k]!;
        node.setAttribute("x", String(rect.x));
        node.setAttribute("y", String(rect.y));
        node.setAttribute("width", String(rect.width));
        node.setAttribute("height", String(rect.height));
      });
      path.setAttribute("d", d);
      path.setAttribute("fill", fill);
      path.setAttribute("fill-opacity", String(fillOpacity * opacity));
      path.setAttribute("stroke", outline);
      path.setAttribute(
        "stroke-opacity",
        String((strokeOpacity ?? (stroke === undefined ? 0.6 : 1)) * opacity),
      );
      path.setAttribute("stroke-width", String(strokeWidth));
      if (pattern?.length) path.setAttribute("stroke-dasharray", pattern.join(" "));
      else path.removeAttribute("stroke-dasharray");
      path.setAttribute("visibility", "visible");
    });
  }
}

/**
 * What pixel points select in a panel, its ends placed by `normalize`.
 * Ranges need a drag of a few pixels along their axis, rectangles and
 * lassos a few pixels each way (a flat one would select nothing, or zoom
 * to nothing); `partial` keeps smaller ones, for drawing a drag as it starts.
 */
function selectionOf(
  points: readonly [number, number][],
  panel: BrushPanel,
  mode: BrushSpec,
  normalize: (scale: PositionScale, a: number, b: number) => readonly [number, number],
  partial = false,
): BrushSelection | null {
  const { x, y } = panel;
  const [first] = points;
  const last = points[points.length - 1]!;
  if (!first) return null;
  const big = (a: number, b: number) => partial || Math.abs(a - b) >= DRAG_THRESHOLD;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const along = {
    x: () => normalize(x, x.invert(Math.min(...xs)), x.invert(Math.max(...xs))),
    y: () => normalize(y, y.invert(Math.min(...ys)), y.invert(Math.max(...ys))),
  };
  if (mode === "x")
    return big(first[0], last[0]) ? { kind: "brush", x: along.x(), y: null, lasso: null } : null;
  if (mode === "y")
    return big(first[1], last[1]) ? { kind: "brush", x: null, y: along.y(), lasso: null } : null;
  if (!big(Math.min(...xs), Math.max(...xs)) || !big(Math.min(...ys), Math.max(...ys))) return null;
  if (mode === "xy") return { kind: "brush", x: along.x(), y: along.y(), lasso: null };
  if (points.length < 3 && !partial) return null;
  return {
    kind: "brush",
    x: along.x(),
    y: along.y(),
    lasso: points.map(([px, py]) => [x.invert(px), y.invert(py)] as const),
  };
}

/**
 * SVG path data of a selection in a panel. Ranges and rectangles end at the
 * plot ("" when outside it); a lasso keeps its shape, for the clip to cut.
 */
function outlineOf(selection: BrushSelection, panel: BrushPanel, settled: boolean): string {
  const { plot, x, y } = panel;
  if (selection.lasso) {
    return `${selection.lasso
      .map(([vx, vy], i) => `${i === 0 ? "M" : "L"}${x.map(vx).toFixed(1)} ${y.map(vy).toFixed(1)}`)
      .join("")}Z`;
  }
  // A settled selection on a category axis covers its categories' slots.
  const span = (
    scale: PositionScale,
    range: readonly [number, number] | null,
    lo: number,
    hi: number,
  ) => {
    if (!range) return [lo, hi] as const;
    const half = settled && scale.type === "band" ? Math.abs(scale.map(1) - scale.map(0)) / 2 : 0;
    const ends = [scale.map(range[0]), scale.map(range[1])];
    return [
      Math.max(lo, Math.min(...ends) - half),
      Math.min(hi, Math.max(...ends) + half),
    ] as const;
  };
  const [x0, x1] = span(x, selection.x, plot.x, plot.x + plot.width);
  const [y0, y1] = span(y, selection.y, plot.y, plot.y + plot.height);
  if (!(x1 > x0 && y1 > y0)) return "";
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`;
}

/**
 * The pixels of a selection's ranges' ends in a panel, low then high
 * value of x, then of y: the plot's edges along an axis it has no range
 * on, and with `slots`, a category axis' ends half a step past its bands'
 * centers, as the outline draws them.
 */
function pixelEnds(selection: BrushSelection, panel: BrushPanel, slots: boolean): number[] {
  const { plot } = panel;
  const ends = (axis: "x" | "y", lo: number, hi: number) => {
    const range = selection[axis];
    if (!range) return [lo, hi];
    const scale = panel[axis];
    const [a, b] = [scale.map(range[0]), scale.map(range[1])];
    const half = slots && scale.type === "band" ? Math.abs(scale.map(1) - scale.map(0)) / 2 : 0;
    // Each end half a step farther from the other.
    return a <= b ? [a - half, b + half] : [a + half, b - half];
  };
  return [...ends("x", plot.x, plot.x + plot.width), ...ends("y", plot.y + plot.height, plot.y)];
}

function clamp(px: number, py: number, plot: Rect): [number, number] {
  return [
    Math.min(plot.x + plot.width, Math.max(plot.x, px)),
    Math.min(plot.y + plot.height, Math.max(plot.y, py)),
  ];
}
