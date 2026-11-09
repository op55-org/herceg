import { pathOf } from "../data/hierarchy.ts";
import type { CategoryField, NumberField, Schema, Table } from "../data/table.ts";
import {
  ArcPath,
  inSector,
  sectorInfo,
  sectorPaints,
  sectorShareRadius,
  traceSector,
} from "../draw/arc.ts";
import { labelsDrawing, textDrawing } from "../draw/labels.ts";
import { INNER_CUT, OUTER_CUT, type RingGeometry, ringDrawing } from "../draw/rings.ts";
import type { ItemText } from "../fields/chart.ts";
import { formatNumber, numberFormatter } from "../format/format.ts";
import { layoutPartition } from "../layout/partition.ts";
import { labelFor, oneLineText, textItem } from "../layout/text.ts";
import { ItemViews } from "../model/item-views.ts";
import type { ProvenanceGroup } from "../model/items.ts";
import type { LegendEntry } from "../model/legend.ts";
import { contrastingText } from "../scale/color.ts";
import type {
  Geometry,
  LabelsGeometry,
  SectorLabel,
  SunburstKit,
  TextGeometry,
  TextItem,
} from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { Frozen, InteractionSpec, SunburstSpec } from "../spec/spec.ts";
import type { TextStyle } from "../spec/style.ts";
import { surface } from "../theme.ts";
import type { LabelPartOf } from "./encoding.ts";
import type { PartText } from "./features/part-text.ts";
import type { TreeText } from "./features/tree-text.ts";
import {
  type ItemInfo,
  type ItemSources,
  type LayoutControls,
  type LayoutFrame,
  type LayoutItem,
  type LayoutMark,
  type LayoutResult,
  secondOf,
} from "./layout-mark.ts";
import { definedFields } from "./line.ts";
import { type ChartMark, DIM, frozen, type MARK } from "./mark.ts";
import { checkTooltip, type MarkTooltip } from "./tooltip-fields.ts";
import { count, drillControls, TreeData, type TreeView, where } from "./tree-data.ts";
import { TreeLabels } from "./tree-labels.ts";
import {
  checkTreeLevels,
  checkTreePaint,
  type MeasureDomain,
  measureDomain,
  TreePaint,
  type TreePaintOptions,
} from "./tree-paint.ts";

/**
 * A sunburst's names (see `SunburstLabelsSpec`): across each sector, or
 * along its radius, upright (`rotation: "radial"`), saying `content` in
 * `style`.
 */
export interface SunburstLabels<S extends Schema> {
  rotation?: "horizontal" | "radial";
  /**
   * Degrees: every sector at least this wide is named, whole, whether its
   * name fits or not (it may run past its sector), and no narrower one is.
   * Without it, names show where they fit.
   */
  minAngle?: number;
  content?: readonly Exclude<LabelPartOf<keyof S & string>, { series: true } | { label: string }>[];
  style?: TextStyle;
}

export type SunburstOptions<S extends Schema> = (
  | {
      /** Category fields from the outermost group in; a row ends at its first missing one. */
      path: readonly CategoryField<S>[];
      node?: never;
      parent?: never;
    }
  | {
      /** Category field naming each row's node; rows without a parent are top-level. */
      node: CategoryField<S>;
      parent: CategoryField<S>;
      path?: never;
    }
) &
  TreePaintOptions<CategoryField<S>> & {
    /** Number field summed over each node's rows; without it, rows count. */
    value?: NumberField<S>;
    /** Names inside the sectors that have room for them (see `minAngle`); true by default. */
    labels?: boolean | SunburstLabels<S>;
    /** The center kept empty of rings, as a fraction of the sunburst's radius; 0.18 by default. */
    innerRadius?: number;
    /**
     * A drilled sunburst's root painted in its center (true, the default);
     * `false` leaves it empty, and a click there still goes up a level.
     */
    center?: boolean;
    /** Pixels between neighboring sectors and between rings; 2 by default. */
    gap?: number | { angular?: number; radial?: number };
    /** Fields of the row an item is, which tooltips show besides its value where it is one row. */
    tooltip?: MarkTooltip<S>;
    id?: string;
    /** With the chart's `panels`, the id of the panel the sunburst has to itself. */
    panel?: string;
  };

/** Sectors start at the top and go clockwise. */
const START = -Math.PI / 2;
const TAU = 2 * Math.PI;
/** Space between neighboring sectors and rings, in pixels, unless `gap` says. */
const GAP = 2;
/** Where a label's box is checked: its corners and the middles of its edges. */
const BOX_POINTS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
] as const;
/** The empty center, as a fraction of the radius, unless `innerRadius` says. */
const HOLE = 0.18;
/** How opaque a drilled sunburst's root, in its center, is by default. */
const CENTER_OPACITY = 0.3;
/** The narrowest a name may be cut to, in pixels, besides its ellipsis. */
const LEAST_NAME = 12;

/** What value transitions draw and pick a sunburst's frames with (scene.ts SunburstKit). */
const KIT: SunburstKit = {
  rings: ringDrawing,
  labels: labelsDrawing,
  whole: INNER_CUT | OUTER_CUT,
  ArcPath,
  traceSector,
  inSector,
  sectorInfo,
};

export class SunburstMark implements LayoutMark {
  declare readonly [MARK]: true;
  readonly layout = true;
  readonly publishes = true;
  readonly views = ItemViews;
  readonly spec: Frozen<SunburstSpec>;
  readonly table: Table;
  readonly measure: string;
  readonly measureField: string | undefined;
  readonly identity: ItemSources | undefined;
  /** Clicks and Enter drill into nodes with `interaction.zoom`, and charts select their rows. */
  readonly interactions = ["zoom"] as const;
  readonly selects = true;
  readonly #data: TreeData;
  readonly #paint: TreePaint;
  readonly #labels: TreeLabels;
  /** Labels of parts, in styles, or turned need the feature compiler, which hands them its code. */
  readonly featured: boolean;
  /** Pixels between neighboring sectors, and between rings. */
  readonly #gap: { angular: number; radial: number };

  constructor(input: SunburstSpec, table: Table) {
    this.spec = frozen(input);
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.#data = new TreeData(table, spec, "sunburst");
    checkTooltip(table, spec.tooltip, "sunburst");
    checkTreePaint(spec, "sunburst");
    checkTreeLevels(spec, "sunburst");
    const fail = (path: string, message: string) =>
      new ChartError({ code: "invalid-option", path, message: `sunburst ${path}: ${message}` });
    const inner = spec.innerRadius;
    if (inner !== undefined && !(typeof inner === "number" && inner >= 0 && inner < 1))
      throw fail(
        "innerRadius",
        `expected at least 0 and below 1; received ${JSON.stringify(inner)}`,
      );
    if (spec.center !== undefined && typeof spec.center !== "boolean")
      throw fail("center", `expected true or false; received ${JSON.stringify(spec.center)}`);
    const pixels = (value: unknown, path: string) => {
      if (value !== undefined && !(typeof value === "number" && value >= 0 && value < Infinity))
        throw fail(
          path,
          `expected a number of pixels, at least 0; received ${JSON.stringify(value)}`,
        );
      return value as number | undefined;
    };
    const { gap } = spec;
    if (typeof gap === "object" && gap !== null) {
      for (const key of Object.keys(gap))
        if (key !== "angular" && key !== "radial")
          throw fail(`gap.${key}`, `gaps are angular or radial; drop ${key}`);
      this.#gap = {
        angular: pixels(gap.angular, "gap.angular") ?? GAP,
        radial: pixels(gap.radial, "gap.radial") ?? GAP,
      };
    } else {
      const both = pixels(gap, "gap") ?? GAP;
      this.#gap = { angular: both, radial: both };
    }
    this.#paint = new TreePaint(spec);
    const { encoding } = this.#data;
    this.#labels = new TreeLabels(
      spec.labels,
      table,
      "path" in encoding ? encoding.path : undefined,
      "path" in encoding ? undefined : { node: encoding.id, parent: encoding.parent },
      "sunburst",
    );
    this.featured = this.#labels.featured;
    this.table = table;
    this.measure = spec.value ?? "Count";
    this.measureField = spec.value;
    // Items stand for their color field's values, as series of that field do.
    this.identity = { field: this.#data.colorField, read: secondOf };
  }

  /** What the node keyed `key` groups by: each level's field at its name (see `TreeData.groupsOf`). */
  groupsOf(key: string): readonly ProvenanceGroup[] | undefined {
    return this.#data.groupsOf(key);
  }

  /** Takes the feature compiler's code for its labels (see marks/features/tree-text.ts). */
  useTreeText(text: TreeText): void {
    this.#labels.use(text);
  }

  legend(id: string | number, color: (key: string) => string): LegendEntry[] {
    return this.#data.legend(id, color);
  }

  controls(interaction: InteractionSpec | undefined): LayoutControls | undefined {
    return drillControls(interaction);
  }

  draw(frame: LayoutFrame): LayoutResult {
    const { theme, locale } = frame;
    const data = this.#data;
    // A facet panel draws the part of the tree its rows give a value; a
    // chart drilled into a node, the subtree under it, the node in the middle.
    const root = frame.root?.length ? data.rootOf(frame.id, frame.root) : 0;
    const view = root > 0 ? data.drilled(root, frame.rows) : data.view(frame.rows);
    const { tree, group } = view;
    // Names, totals, and fields' labels as the chart's field displays write them, where it has any.
    const fieldText = frame.features?.fields?.items(this.table);
    const written = fieldText?.tree(view, data.encoding) ?? view;
    const amount =
      fieldText?.amount(this.spec.value) ?? ((sum: number) => formatNumber(sum, locale));
    // Breadcrumbs take a strip above the tree in charts that drill.
    const crumbed = this.spec.breadcrumbs ?? (frame.drillable || root > 0);
    const path = crumbed ? data.breadcrumbs(frame.id, view, frame) : undefined;
    const bounds = path
      ? {
          ...frame.bounds,
          y: frame.bounds.y + path.height,
          height: frame.bounds.height - path.height,
        }
      : frame.bounds;
    const shown = data.shown(frame.id, view, frame.hidden);
    const selected = frame.selected?.(this.table);
    const counts =
      selected && data.selectedOf(view, selected, data.hiddenGroups(frame.id, frame.hidden), shown);
    const spans = new Float64Array(tree.size * 2);
    layoutPartition(tree, shown, data.byValue, spans);

    const { angular, radial } = this.#gap;
    const r = Math.max(0, Math.min(bounds.width, bounds.height) / 2 - 2);
    const hole = r * (this.spec.innerRadius ?? HOLE);
    // Rings as wide as `levels` of them fill the radius, drawn or not, so
    // drilling keeps their width; every level fills it by default.
    const levels = Math.min(tree.height, this.spec.levels ?? tree.height);
    const rings = this.spec.levels ?? tree.height;
    const ring = rings > 0 ? (r - hole) / rings : 0;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const radii = (node: number) => {
      const r0 = hole + ring * (tree.depth[node]! - 1);
      // Rings are a gap apart too.
      return [r0 + radial / 2, r0 + ring - radial / 2] as const;
    };
    const angles = (node: number) =>
      [START + spans[node * 2]! * TAU, START + spans[node * 2 + 1]! * TAU] as const;
    const paints = (node: number) => {
      if (tree.depth[node]! > levels) return false;
      const [r0, r1] = radii(node);
      const [a0, a1] = angles(node);
      return sectorPaints(r0, r1, a0, a1, angular);
    };
    // Each ring's sectors that show, in clockwise order.
    const byDepth: number[][] = Array.from({ length: levels + 1 }, () => []);
    for (let at = 1; at < tree.size; at++) {
      const node = tree.order[at]!;
      if (shown[node]! > 0 && paints(node)) byDepth[tree.depth[node]!]!.push(node);
    }
    for (const nodes of byDepth) nodes.sort((a, b) => spans[a * 2]! - spans[b * 2]!);

    // Each item's paint: its color group's color, the default or measured opacity, its look.
    const colors: (string | undefined)[] = [];
    const colorOf = (node: number): string | undefined => {
      const g = group[node]!;
      if (g < 0) return undefined;
      colors[g] ??= frame.color(data.groupKey(frame.id, data.groups()[g]!));
      return colors[g];
    };
    const context = this.#paint.context(this.#domain(frame, root), frame.paint, "sunburst");
    const paintOf = (node: number, fallback: number) =>
      this.#paint.of(tree, view.values, shown, node, colorOf(node), fallback, context);
    // A drilled sunburst's root fills its middle, a faint disc of its color.
    // A facet panel with nothing under the root draws none, nor does a root
    // above the level `color` names, which is not filled.
    const center = paintOf(0, CENTER_OPACITY);
    const centered =
      root > 0 &&
      this.spec.center !== false &&
      hole > radial &&
      view.values[0]! > 0 &&
      center.fill !== undefined;
    const centerColor = center.fill ?? theme.muted;
    const fills: (string | undefined)[] = [];
    const opacities = new Float64Array(tree.size);
    for (let depth = 1; depth <= levels; depth++)
      for (const node of byDepth[depth]!) {
        const { fill, opacity } = paintOf(node, Math.max(0.45, 1 - 0.2 * (depth - 1)));
        fills[node] = fill;
        opacities[node] = opacity;
      }

    const geometry: Geometry[] = [...(path?.geometry ?? [])];
    // Sectors by ring and look, each batch with its colors; the dimmed first.
    interface Batch {
      arcs: number[];
      colors: string[];
      /** Each color's place in `colors`. */
      colorAt: Map<string, number>;
      index: number[];
      cuts: number[];
      rims: number[];
      order: readonly number[];
      opacity: number;
      name: string;
      dim: boolean;
    }
    const batches = new Map<string, Batch>();
    const add = (
      depth: number,
      fill: string,
      opacity: number,
      dim: boolean,
      arc: readonly number[],
      cut: number,
      rim: number,
    ) => {
      const drawnAt = opacity * (dim ? DIM : 1);
      const key = `${depth}\u0000${dim}\u0000${drawnAt}`;
      let batch = batches.get(key);
      if (!batch) {
        const name = `sunburst-${depth === 0 ? "root" : depth}`;
        batch = {
          arcs: [],
          colors: [],
          colorAt: new Map(),
          index: [],
          cuts: [],
          rims: [],
          order: [depth, dim ? 0 : 1, batches.size],
          opacity: drawnAt,
          name,
          dim,
        };
        batches.set(key, batch);
      }
      let color = batch.colorAt.get(fill);
      if (color === undefined) {
        color = batch.colors.push(fill) - 1;
        batch.colorAt.set(fill, color);
      }
      batch.arcs.push(...arc);
      batch.index.push(color);
      batch.cuts.push(cut);
      batch.rims.push(rim);
    };
    if (centered) {
      // With a selection highlighted, the root's selected share is drawn out
      // from its middle, as its nodes' are from their inner edges.
      const outer = hole - radial / 2;
      const middle = counts ? sectorShareRadius(0, outer, TAU, 0, data.shareOf(counts, 0)) : outer;
      const disc = [cx, cy, 0, outer, START, START + TAU];
      if (middle < outer)
        add(
          0,
          centerColor,
          center.opacity,
          true,
          [cx, cy, middle, outer, START, START + TAU],
          OUTER_CUT,
          outer,
        );
      if (middle > 0)
        add(
          0,
          centerColor,
          center.opacity,
          false,
          middle < outer ? [cx, cy, 0, middle, START, START + TAU] : disc,
          middle < outer ? 0 : OUTER_CUT,
          outer,
        );
    }
    // With a selection highlighted, a node's selected share is drawn out from
    // its ring's inner edge, covering that share of its sector, the rest dimmed.
    for (let depth = 1; depth <= levels; depth++) {
      for (const node of byDepth[depth]!) {
        const fill = fills[node];
        if (fill === undefined) continue;
        const [r0, r1] = radii(node);
        const [a0, a1] = angles(node);
        const opacity = opacities[node]!;
        const whole = INNER_CUT | OUTER_CUT;
        if (!counts) {
          add(depth, fill, opacity, false, [cx, cy, r0, r1, a0, a1], whole, r1);
          continue;
        }
        const part = data.shareOf(counts, node);
        const middle = sectorShareRadius(r0, r1, a1 - a0, angular, part);
        if (part < 1)
          add(
            depth,
            fill,
            opacity,
            true,
            [cx, cy, part > 0 ? middle : r0, r1, a0, a1],
            part > 0 ? OUTER_CUT : whole,
            r1,
          );
        if (counts.hits[node]! > 0)
          add(
            depth,
            fill,
            opacity,
            false,
            [cx, cy, r0, part < 1 ? middle : r1, a0, a1],
            part < 1 ? INNER_CUT : whole,
            r1,
          );
      }
    }
    const ordered = [...batches.values()].sort((a, b) => {
      for (let i = 0; i < a.order.length; i++)
        if (a.order[i] !== b.order[i]) return a.order[i]! - b.order[i]!;
      return 0;
    });
    const named = new Map<string, number>();
    for (const batch of ordered) {
      // Batches of one ring in looks of their own are numbered.
      const n = named.get(`${batch.name}${batch.dim}`) ?? 0;
      named.set(`${batch.name}${batch.dim}`, n + 1);
      geometry.push({
        kind: "arc",
        draw: ringDrawing,
        key: `${batch.name}${n > 0 ? `-${n}` : ""}${batch.dim ? "-dimmed" : ""}`,
        arcs: Float32Array.from(batch.arcs),
        count: batch.index.length,
        colors: batch.colors,
        colorIndex: Uint32Array.from(batch.index),
        fillOpacity: batch.opacity,
        gap: angular,
        // The parts keep their node's sides, its gap resolved at its rim.
        rims: counts && Float32Array.from(batch.rims),
        cuts: Uint8Array.from(batch.cuts),
        ringGap: radial,
      } as RingGeometry);
    }

    // Charts that animate changed values learn each sector's label, to move it.
    const labeled = frame.keyed ? new Map<number, SectorLabel>() : undefined;
    if (this.#labels.on)
      geometry.push(
        ...this.#drawLabels(
          byDepth,
          view,
          shown,
          radii,
          angles,
          fills,
          opacities,
          frame,
          {
            cx,
            cy,
            hole,
            centered,
            centerColor,
            centerOpacity: center.opacity,
          },
          labeled,
        ),
      );

    const percent = numberFormatter({ style: "percent", maximumFractionDigits: 1 }, locale);
    const total = shown[0]!;
    const rootKey = root > 0 ? data.keyOf(frame.id, view, 0) : undefined;
    // The middle's parent is the root's own, in the whole tree, read as drawn.
    const above = data.parentKey(frame.id, view);
    const pathText = (node: number) =>
      [...written.prefix, ...pathOf(written.tree, node)].join(" / ");
    const itemOf = (node: number): LayoutItem => {
      const outline = new ArcPath();
      // Its path as the fields' displays write it (`written`); keys read `view`.
      const label = pathText(node);
      const key = data.keyOf(frame.id, view, node);
      const names = [...view.prefix, ...pathOf(tree, node)];
      if (node === 0) {
        // The root in the middle: its total, the whole of what is shown.
        const outer = hole - radial / 2;
        traceSector(outline, cx, cy, 0, outer, START, START + TAU, 0);
        const text = `${amount(total)}${data.selectedText(counts, 0, locale, fieldText)}`;
        return {
          key,
          label,
          names,
          color: centerColor,
          value: total,
          text,
          px: cx,
          py: cy,
          outline: outline.d,
        };
      }
      const [r0, r1] = radii(node);
      const [a0, a1] = angles(node);
      traceSector(outline, cx, cy, r0, r1, a0, a1, angular);
      const mid = (a0 + a1) / 2;
      return {
        key,
        label,
        names,
        color: fills[node] ?? colorOf(node) ?? theme.muted,
        value: shown[node]!,
        text: `${amount(shown[node]!)} (${percent(shown[node]! / total)}${where(written)})${data.selectedText(counts, node, locale, fieldText)}`,
        px: cx + ((r0 + r1) / 2) * Math.cos(mid),
        py: cy + ((r0 + r1) / 2) * Math.sin(mid),
        outline: outline.d,
      };
    };
    // An item's geometry: its ring's radii before gaps, angles from 12 o'clock.
    const infoOf = (node: number): ItemInfo => {
      const names = [...view.prefix, ...pathOf(tree, node)];
      const r0 = node === 0 ? 0 : hole + ring * (tree.depth[node]! - 1);
      const r1 = node === 0 ? hole : r0 + ring;
      const [a0, a1] = node === 0 ? [START, START + TAU] : angles(node);
      const parent = tree.parent[node]!;
      return {
        key: data.keyOf(frame.id, view, node),
        names,
        label: pathText(node),
        value: shown[node]!,
        ...sectorInfo(cx, cy, r0, r1, a0, a1),
        depth: tree.depth[node]!,
        parent: node === 0 ? above : parent > 0 ? data.keyOf(frame.id, view, parent) : rootKey,
      };
    };
    const navigation = data.navigation(frame.id, view, shown, paints, itemOf);
    // A drilled sunburst's root is read first.
    const first = centered ? 1 : 0;
    const centerKey = centered ? rootKey : undefined;
    let infos: ItemInfo[] | undefined;
    const drawer = labeled && geometry.find((mark): mark is RingGeometry => mark.kind === "arc");
    if (drawer) {
      // Charts that animate changed values learn every sector, which value
      // transitions make of its node (the middle's paint at node 0).
      fills[0] = centerColor;
      opacities[0] = center.opacity;
      drawer.sectors = {
        sectors: {
          nodes: [...(centered ? [0] : []), ...byDepth.slice(1).flat()],
          spans,
          depth: tree.depth,
          parent: tree.parent,
          fills,
          opacities,
          labels: labeled!,
          above,
          key: (node) => data.keyOf(frame.id, view, node),
          info: infoOf,
          item: itemOf,
        },
        root: rootKey,
        cx,
        cy,
        radius: r,
        hole,
        ring,
        crumbs: path?.geometry ?? [],
        id: JSON.stringify(frame.id),
        gap: angular,
        ringGap: radial,
        kit: KIT,
      };
    }
    return {
      geometry,
      // The center, when painted, then each drawn sector, in reading order.
      items() {
        infos ??= [
          ...(centered ? [infoOf(0)] : []),
          ...Array.from({ length: navigation.count }, (_, i) => infoOf(navigation.node(i))),
        ];
        return infos;
      },
      itemAt(px, py) {
        const distance = Math.hypot(px - cx, py - cy);
        if (centered && distance < hole) return itemOf(0);
        if (!(distance >= hole && distance <= r) || ring <= 0) return undefined;
        const depth = Math.floor((distance - hole) / ring) + 1;
        if (depth > levels) return undefined;
        let fraction = (Math.atan2(py - cy, px - cx) - START) / TAU;
        fraction -= Math.floor(fraction);
        // The last sector of the ring starting at or before the angle.
        const nodes = byDepth[depth]!;
        let lo = 0;
        let hi = nodes.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (spans[nodes[mid]! * 2]! <= fraction) lo = mid + 1;
          else hi = mid;
        }
        const node = nodes[lo - 1];
        if (node === undefined) return undefined;
        const [r0, r1] = radii(node);
        const [a0, a1] = angles(node);
        return inSector(px, py, cx, cy, r0, r1, a0, a1, angular) ? itemOf(node) : undefined;
      },
      // Not spread: that would read `count` and order every node now.
      get count() {
        return navigation.count + first;
      },
      item: (index) => (index < first ? itemOf(0) : navigation.item(index - first)),
      indexOf: (key) => {
        if (key === centerKey) return 0;
        const at = navigation.indexOf(key);
        return at < 0 ? -1 : at + first;
      },
      summary: () => this.#summary(written, shown, percent, amount, fieldText),
      rowsOf: (key, of) => (of === this.table ? data.rowsOf(frame.id, view, key) : undefined),
      // In the panel's whole tree: a sector leaving a drill's frames holds its rows too.
      holdsRows: (key, of) =>
        of === this.table && data.nodeOf(frame.id, data.view(frame.rows), key) >= 0,
      soleRow: (key, of) => (of === this.table ? data.soleRow(frame.id, view, key) : undefined),
      // An empty center goes up a level when clicked, though it is no item.
      drill: data.drill(
        frame,
        root,
        view,
        path?.crumbs ?? [],
        root > 0 && !centered ? (x, y) => Math.hypot(x - cx, y - cy) < hole : undefined,
      ),
    };
  }

  /** What measures read across the sunburst (see `measureDomain`): the drilled tree's, alike in every facet panel. */
  #domain(frame: LayoutFrame, root: number): MeasureDomain {
    if (!this.#paint.measured) return { value: 0, depth: 0 };
    const view = root > 0 ? this.#data.drilled(root) : this.#data.view();
    const shown = this.#data.shown(frame.id, view, frame.hidden);
    return measureDomain(view, shown, this.spec.levels ?? Number.POSITIVE_INFINITY);
  }

  /**
   * Names inside sectors with room for them, across each sector or along
   * its radius, upright, written as the labels ask, in black or white by
   * contrast with their sector; a drilled root's in the center.
   */
  #drawLabels(
    byDepth: readonly number[][],
    view: TreeView,
    shown: Float64Array,
    radii: (node: number) => readonly [number, number],
    angles: (node: number) => readonly [number, number],
    fills: readonly (string | undefined)[],
    opacities: Float64Array,
    frame: LayoutFrame,
    middle: {
      cx: number;
      cy: number;
      hole: number;
      centered: boolean;
      centerColor: string;
      centerOpacity: number;
    },
    labeled?: Map<number, SectorLabel>,
  ): Geometry[] {
    const { theme, measure, locale } = frame;
    const labels = this.#labels;
    const { angular } = this.#gap;
    const { cx, cy, hole } = middle;
    const font = `${theme.fontSize}px ${theme.font}`;
    const lineHeight = Math.round(theme.fontSize * 1.25);
    const backdrop = frame.surface ?? surface(theme);
    const radial = labels.rotation === "radial";
    const plain = new Map<string, { coords: number[]; labels: string[] }>();
    const items: TextItem[] = [];
    // An unfilled sector shows the plot behind it.
    const inkOf = (fill: string | undefined, opacity: number) =>
      contrastingText(fill ?? backdrop, fill === undefined ? 1 : opacity, backdrop) || theme.text;
    // Fields' values, the value, and names as the chart's field displays
    // write them, where it has any; parts and rows read `view` itself.
    const fieldText = frame.features?.fields?.items(this.table);
    const written = fieldText?.tree(view, this.#data.encoding) ?? view;
    const write = (node: number) =>
      labels.parts(
        view,
        node,
        shown[node]!,
        () => this.#data.soleRowOf(view, node),
        locale,
        fieldText,
        fieldText?.amount(this.spec.value),
        written.tree.names,
      );
    // A node's label for value transitions: its items at its middle, as drawn.
    const keep = (
      node: number,
      made: readonly TextItem[],
      x: number,
      y: number,
      angle: number,
      turns = false,
    ) => labeled?.set(node, { items: made, x, y, angle, turns });
    const plainAt = (text: string, x: number, y: number, ink: string) =>
      textItem(
        text,
        { x, y, anchor: "middle", baseline: "middle", angle: 0 },
        labels.paint(frame, ink),
        backdrop,
      );
    if (middle.centered) {
      // The root's name across the center, its corners inside the disc.
      const disc = hole - this.#gap.radial / 2 - 2;
      const across = (height: number) => 2 * Math.sqrt(Math.max(0, disc ** 2 - (height / 2) ** 2));
      const ink = inkOf(middle.centerColor, middle.centerOpacity);
      if (!labels.styled) {
        const room = across(lineHeight);
        const name = room >= 8 && labelFor(written.prefix.at(-1) ?? "", room, measure, font);
        if (name) {
          plain.set(ink, { coords: [cx, cy], labels: [name] });
          if (labeled) keep(0, [plainAt(name, cx, cy, ink)], cx, cy, 0);
        }
      } else {
        const parts = write(0);
        const paint = parts && labels.paint(frame, ink);
        if (parts && paint) {
          const [padX, padY] = labels.padding(paint);
          const whole = labels.block(parts, paint, frame);
          const block = whole.fit(across(whole.lines.height + padY) - padX);
          if (block) {
            const made = labels.items(block, cx, cy, 0, paint, frame);
            items.push(...made);
            keep(0, made, cx, cy, 0);
          }
        }
      }
    }
    // The thinnest line radial names may have, for sectors too thin for any.
    const thinnest = radial ? labels.paint(frame, theme.text).lineHeight / 2 : 0;
    // With `minAngle`, sectors at least that wide (before gaps) are named
    // whole, past their edges if need be, and no others are.
    const least = labels.minAngle;
    for (const nodes of byDepth) {
      for (const node of nodes) {
        const fill = fills[node];
        const [r0, r1] = radii(node);
        const [a0, a1] = angles(node);
        const sweep = a1 - a0;
        const byAngle = least !== undefined;
        if (byAngle && sweep < least - 1e-12) continue;
        const mid = (a0 + a1) / 2;
        const center = (r0 + r1) / 2;
        const [x, y] = [cx + center * Math.cos(mid), cy + center * Math.sin(mid)];
        const ink = inkOf(fill, opacities[node]!);
        if (radial) {
          // Along the radius, turned upright on the left half; its outer
          // corners inside the ring's outer edge, and no thicker than the
          // sector at its inner end.
          const outer = 2 * r1 * Math.sin(Math.min(sweep, Math.PI) / 2) - angular;
          if (!byAngle && (outer < thinnest || r1 - r0 < 8)) continue;
          const parts = write(node);
          if (!parts) continue;
          const paint = labels.paint(frame, ink);
          const [padX, padY] = labels.padding(paint);
          const whole = labels.block(parts, paint, frame);
          let block: PartText | undefined = whole;
          if (!byAngle) {
            const half = (whole.lines.height + padY) / 2;
            const reach = Math.sqrt(Math.max(0, (r1 - 2) ** 2 - half ** 2));
            block = whole.fit(2 * Math.min(reach - center, center - r0 - 2) - padX);
            if (!block) continue;
            const inner = Math.max(r0, center - (block.lines.width + padX) / 2);
            const thick = 2 * inner * Math.sin(Math.min(sweep, Math.PI) / 2) - angular;
            if (block.lines.height + padY > thick) continue;
          }
          const turn = (mid * 180) / Math.PI;
          const angle = Math.cos(mid) < 0 ? turn + 180 : turn;
          const made = labels.items(block, x, y, angle, paint, frame);
          items.push(...made);
          keep(node, made, x, y, mid, true);
          continue;
        }
        // Across the sector, centered: the longest that keeps its box (corners
        // and edge middles) inside it, as painted.
        const fits = (width: number, height: number) => {
          const [w, h] = [width / 2 + 2, height / 2];
          for (const [dx, dy] of BOX_POINTS) {
            if (!inSector(x + dx * w, y + dy * h, cx, cy, r0, r1, a0, a1, angular)) return false;
          }
          return true;
        };
        if (!labels.styled) {
          const name = oneLineText(written.tree.names[node]!);
          let text = byAngle ? name : "";
          // No name keeps a box narrower than nothing inside: not measured.
          if (!byAngle && fits(0, lineHeight)) {
            // The whole name first, then shorter and shorter cuts of it.
            const width = measure(name, font);
            if (fits(width, lineHeight)) text = name;
            for (let room = width * 0.8; !text && room >= LEAST_NAME; room *= 0.8) {
              const candidate = labelFor(name, room, measure, font);
              if (!candidate) break;
              if (fits(measure(candidate, font), lineHeight)) text = candidate;
            }
          }
          if (!text) continue;
          let batch = plain.get(ink);
          if (!batch) {
            batch = { coords: [], labels: [] };
            plain.set(ink, batch);
          }
          batch.coords.push(x, y);
          batch.labels.push(text);
          if (labeled) keep(node, [plainAt(text, x, y, ink)], x, y, mid);
          continue;
        }
        const parts = write(node);
        if (!parts) continue;
        const paint = labels.paint(frame, ink);
        const whole = labels.block(parts, paint, frame);
        // As painted, with its background's padding. Cuts keep the block's
        // height: none fits where nothing that tall does.
        const [padX, padY] = labels.padding(paint);
        const tall = whole.lines.height + padY;
        let block = byAngle ? whole : undefined;
        if (!byAngle && fits(padX, tall)) {
          if (fits(whole.lines.width + padX, tall)) block = whole;
          for (let room = whole.lines.width * 0.8; !block && room >= LEAST_NAME; room *= 0.8) {
            const cut = whole.fit(room);
            if (!cut) break;
            if (fits(cut.lines.width + padX, tall)) block = cut;
          }
        }
        if (block) {
          const made = labels.items(block, x, y, 0, paint, frame);
          items.push(...made);
          keep(node, made, x, y, mid);
        }
      }
    }
    const geometry: Geometry[] = [...plain].map(
      ([fill, { coords, labels: texts }]) =>
        ({
          kind: "text",
          draw: textDrawing,
          key: `${JSON.stringify(frame.id)}-sunburst-labels-${fill}`,
          fill,
          anchor: "middle",
          halo: undefined,
          coords: Float32Array.from(coords),
          labels: texts,
          count: texts.length,
        }) as TextGeometry,
    );
    if (items.length > 0)
      geometry.push({
        kind: "labels",
        draw: labelsDrawing,
        key: `${JSON.stringify(frame.id)}-sunburst-names`,
        items,
      } as LabelsGeometry);
    return geometry;
  }

  #summary(
    view: TreeView,
    shown: Float64Array,
    percent: (value: number) => string,
    amount: (value: number) => string,
    text: ItemText | undefined,
  ): string {
    const { tree } = view;
    const label = (field: string) => text?.label(field) ?? field;
    const fields = this.spec.path?.map(label).join(" / ") ?? label(this.spec.node!);
    const what = `${this.spec.value ? `${label(this.spec.value)} by ${fields}` : fields}${where(view)}`;
    const total = shown[0]!;
    if (!(total > 0)) return `Sunburst of ${what}, with nothing to show.`;
    // The branches drawn: shown, and with rows (in a facet panel, its own).
    const visible = this.#data.largest(view.tops, shown);
    const largest = visible
      .slice(0, 3)
      .map(({ node }) => `${tree.names[node]} ${percent(shown[node]! / total)}`);
    return `Sunburst of ${what}: ${count(this.#data.leaves(tree, shown), "leaf", "leaves")} in ${count(visible.length, "group", "groups")} totaling ${amount(total)}. Largest: ${largest.join(", ")}.`;
  }
}

/**
 * A sunburst of a tree described by `path` (category fields, outermost
 * first) or by `node` and `parent` fields, each node's angle its share of
 * the sum of `value` (or of the rows) under its parent.
 *
 * ```ts
 * sunburst(sales, { path: ["region", "country"], value: "revenue" })
 * ```
 */
export function sunburst<S extends Schema>(
  table: Table<S>,
  options: SunburstOptions<S>,
): ChartMark<Frozen<SunburstSpec>> {
  const { path } = options;
  // Every option is kept, so the mark refuses a tree named both ways.
  const spec = {
    type: "sunburst",
    ...definedFields(options, [
      "node",
      "parent",
      "value",
      "labels",
      "levels",
      "innerRadius",
      "center",
      "gap",
      "sort",
      "breadcrumbs",
      "color",
      "leaf",
      "branch",
      "fillOpacity",
      "tooltip",
      "id",
      "panel",
    ]),
    ...(path !== undefined && { path: [...path] }),
  } as unknown as SunburstSpec;
  if (table.name !== undefined) spec.data = table.name;
  return new SunburstMark(spec, table as unknown as Table);
}
