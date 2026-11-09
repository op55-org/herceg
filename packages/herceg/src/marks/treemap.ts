import { pathOf } from "../data/hierarchy.ts";
import type { CategoryField, NumberField, Schema, Table } from "../data/table.ts";
import { labelsDrawing, textDrawing } from "../draw/labels.ts";
import { n } from "../draw/markup.ts";
import { SPLIT_LEFT, SPLIT_RIGHT, type TileGeometry, tileDrawing } from "../draw/tiles.ts";
import type { ItemText } from "../fields/chart.ts";
import { formatNumber, numberFormatter } from "../format/format.ts";
import { labelFor } from "../layout/text.ts";
import { CUT_LEFT, CUT_RIGHT, layoutTreemap } from "../layout/treemap.ts";
import { ItemViews } from "../model/item-views.ts";
import type { ProvenanceGroup } from "../model/items.ts";
import type { LegendEntry } from "../model/legend.ts";
import { contrastingText, overColor } from "../scale/color.ts";
import type { Geometry, LabelsGeometry, TextGeometry, TextItem } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { Frozen, InteractionSpec, TreemapSpec } from "../spec/spec.ts";
import type { TextStyle } from "../spec/style.ts";
import { surface } from "../theme.ts";
import type { LabelPartOf } from "./encoding.ts";
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
import { refuseValues } from "./still.ts";
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
 * A treemap's names (see `TreemapLabelsSpec`): in each rectangle's top-left
 * corner or center, saying `content` in `style`; `parents: false` names
 * only rectangles drawn without others inside them.
 */
export interface TreemapLabels<S extends Schema> {
  at?: "top-left" | "center";
  parents?: boolean;
  content?: readonly Exclude<LabelPartOf<keyof S & string>, { series: true } | { label: string }>[];
  style?: TextStyle;
}

export type TreemapOptions<S extends Schema> = (
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
    /** Names inside the rectangles that have room for them; true by default. */
    labels?: boolean | TreemapLabels<S>;
    /**
     * How children fill their parent: in rows kept close to square
     * ("squarify", the default), or sliced along x, their children along
     * y, and so on ("slice-dice": a Marimekko's columns and cells).
     */
    tile?: "squarify" | "slice-dice";
    /** Pixels between siblings; 2 by default. */
    gap?: number;
    /** Fields of the row an item is, which tooltips show besides its value where it is one row. */
    tooltip?: MarkTooltip<S>;
    id?: string;
    /** With the chart's `panels`, the id of the panel the treemap has to itself. */
    panel?: string;
  };

/** Space between neighboring rectangles, in pixels, unless `gap` says. */
const GAP = 2;
/** Inset of labels from their rectangle's corner. */
const INSET = 4;
/** How opaque rectangles drawn with others inside them are, by default. */
const CONTAINER_OPACITY = 0.22;

export class TreemapMark implements LayoutMark {
  declare readonly [MARK]: true;
  readonly layout = true;
  readonly publishes = true;
  readonly views = ItemViews;
  readonly spec: Frozen<TreemapSpec>;
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

  constructor(input: TreemapSpec, table: Table) {
    this.spec = frozen(input);
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.#data = new TreeData(table, spec, "treemap");
    checkTooltip(table, spec.tooltip, "treemap");
    checkTreePaint(spec, "treemap");
    checkTreeLevels(spec, "treemap");
    const fail = (path: string, message: string) =>
      new ChartError({ code: "invalid-option", path, message: `treemap ${path}: ${message}` });
    if (spec.tile !== undefined && spec.tile !== "squarify" && spec.tile !== "slice-dice")
      throw fail(
        "tile",
        `expected "squarify" or "slice-dice"; received ${JSON.stringify(spec.tile)}`,
      );
    if (
      spec.gap !== undefined &&
      !(typeof spec.gap === "number" && spec.gap >= 0 && spec.gap < Infinity)
    )
      throw fail(
        "gap",
        `expected a number of pixels, at least 0; received ${JSON.stringify(spec.gap)}`,
      );
    this.#paint = new TreePaint(spec);
    const { encoding } = this.#data;
    this.#labels = new TreeLabels(
      spec.labels,
      table,
      "path" in encoding ? encoding.path : undefined,
      "path" in encoding ? undefined : { node: encoding.id, parent: encoding.parent },
      "treemap",
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
    refuseValues(frame.keyed, this.spec.type);
    const { theme, hidden, locale } = frame;
    const data = this.#data;
    const labels = this.#labels;
    // A facet panel draws the part of the tree its rows give a value; a
    // chart drilled into a node, the subtree under it.
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
    // Hidden colors take no room.
    const shown = data.shown(frame.id, view, hidden);
    const levels = this.spec.levels ?? Number.POSITIVE_INFINITY;

    const font = `${theme.fontSize}px ${theme.font}`;
    const lineHeight = Math.round(theme.fontSize * 1.25);
    // Parents keep a strip along their top for their names where children are drawn in them.
    const header =
      labels.on && labels.parents && Math.min(tree.height, levels) > 1
        ? (labels.styled ? labels.height(frame) : lineHeight) + 2
        : 0;
    const gap = this.spec.gap ?? GAP;
    const boxes = new Float64Array(tree.size * 4);
    const cuts = new Uint8Array(tree.size);
    const middles = new Float64Array(tree.size * 4);
    layoutTreemap(
      tree,
      shown,
      bounds,
      {
        inner: gap,
        outer: 0,
        top: header,
        tile: this.spec.tile,
        byValue: data.byValue,
        levels: this.spec.levels,
      },
      boxes,
      cuts,
      middles,
    );

    const drawn: number[] = [];
    // Rectangles drawn with others inside them.
    const container = new Uint8Array(tree.size);
    for (let at = 1; at < tree.size; at++) {
      const node = tree.order[at]!;
      if (!(boxes[node * 4 + 2]! > 0 && boxes[node * 4 + 3]! > 0)) continue;
      drawn.push(node);
      container[tree.parent[node]!] = 1;
    }
    // Each item's paint: its color group's color, the default or measured opacity, its look.
    const colors: (string | undefined)[] = [];
    const colorOf = (node: number): string | undefined => {
      const g = group[node]!;
      if (g < 0) return undefined;
      colors[g] ??= frame.color(data.groupKey(frame.id, data.groups()[g]!));
      return colors[g];
    };
    const context = this.#paint.context(this.#domain(frame, root, levels), frame.paint, "treemap");
    const fills: (string | undefined)[] = [];
    const opacities = new Float64Array(tree.size);
    for (const node of drawn) {
      const { fill, opacity } = this.#paint.of(
        tree,
        view.values,
        shown,
        node,
        colorOf(node),
        container[node] ? CONTAINER_OPACITY : 1,
        context,
      );
      fills[node] = fill;
      opacities[node] = opacity;
    }

    // With a selection highlighted, a rectangle without others inside its
    // selected share fills it from its left edge, the rest of it dimmed;
    // others none of whose rows it holds are dimmed.
    const selected = frame.selected?.(this.table);
    const counts =
      selected && data.selectedOf(view, selected, data.hiddenGroups(frame.id, hidden), shown);
    const share = (node: number) => (counts && !container[node] ? data.shareOf(counts, node) : 1);
    // Parents first, so their children are drawn over them; then by color
    // group (the legend's order), the dimmed before the lit, and by look.
    interface Batch {
      nodes: number[];
      parts: number[];
      order: readonly number[];
      fill: string;
      opacity: number;
      name: string;
      dim: boolean;
    }
    const batches = new Map<string, Batch>();
    // Siblings come one after another and mostly share a batch: the last
    // one is checked before a key is made.
    let last: Batch | undefined;
    let lastKey = { depth: -1, container: 0, dim: false };
    const add = (node: number, part: number, dim: boolean) => {
      const fill = fills[node];
      if (fill === undefined) return;
      const opacity = opacities[node]! * (dim ? DIM : 1);
      const depth = tree.depth[node]!;
      let batch =
        last &&
        lastKey.depth === depth &&
        lastKey.container === container[node] &&
        lastKey.dim === dim &&
        last.fill === fill &&
        last.opacity === opacity
          ? last
          : undefined;
      const role = container[node] ? "groups" : "leaves";
      const key = batch ? "" : `${depth}\u0000${role}\u0000${dim}\u0000${fill}\u0000${opacity}`;
      batch ??= batches.get(key);
      if (!batch) {
        const name = `treemap-${role}-${depth}`;
        batch = {
          nodes: [],
          parts: [],
          order: [depth, group[node]!, dim ? 0 : 1, batches.size],
          fill,
          opacity,
          name,
          dim,
        };
        batches.set(key, batch);
      }
      last = batch;
      lastKey = { depth, container: container[node]!, dim };
      batch.nodes.push(node);
      batch.parts.push(part);
    };
    // Parts: 0 the whole, 1 the selected share from the left, 2 the rest.
    for (const node of drawn) {
      if (!counts) add(node, 0, false);
      else if (container[node]) add(node, 0, counts.hits[node] === 0);
      else {
        const part = share(node);
        if (part < 1) add(node, part > 0 ? 2 : 0, true);
        if (part > 0) add(node, part < 1 ? 1 : 0, false);
      }
    }
    const geometry: Geometry[] = [...(path?.geometry ?? [])];
    const ordered = [...batches.values()].sort((a, b) => {
      for (let i = 0; i < a.order.length; i++)
        if (a.order[i] !== b.order[i]) return a.order[i]! - b.order[i]!;
      return 0;
    });
    const named = new Map<string, number>();
    for (const { nodes, parts, fill, opacity, name, dim } of ordered) {
      const rects = new Float32Array(nodes.length * 4);
      const sides = new Uint8Array(nodes.length);
      const splits = parts.some((part) => part > 0) ? new Float64Array(nodes.length) : undefined;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        const at = node * 4;
        let x = boxes[at]!;
        let w = boxes[at + 2]!;
        let cut = cuts[node]!;
        // A part's side at the split is no gap: it meets the other part
        // there, one number for both, which the canvas rounds once.
        if (parts[i]) {
          const right = x + w;
          const split = x + w * share(node);
          splits![i] = split;
          if (parts[i] === 1) {
            w = split - x;
            cut = (cut & ~CUT_RIGHT) | SPLIT_RIGHT;
          } else {
            x = split;
            w = right - split;
            cut = (cut & ~CUT_LEFT) | SPLIT_LEFT;
          }
        }
        rects[i * 4] = x;
        rects[i * 4 + 1] = boxes[at + 1]!;
        rects[i * 4 + 2] = w;
        rects[i * 4 + 3] = boxes[at + 3]!;
        sides[i] = cut;
      }
      // Batches of one depth and role in looks of their own are numbered.
      const n = named.get(`${name}${dim}`) ?? 0;
      named.set(`${name}${dim}`, n + 1);
      geometry.push({
        kind: "rect",
        draw: tileDrawing,
        key: `${name}${n > 0 ? `-${n}` : ""}${dim ? "-dimmed" : ""}`,
        fill,
        fillOpacity: opacity,
        rects,
        count: nodes.length,
        cuts: sides,
        middles,
        nodes: Uint32Array.from(nodes),
        gap,
        splits,
      } as TileGeometry);
    }
    if (labels.on)
      geometry.push(
        ...this.#drawLabels(
          drawn,
          boxes,
          view,
          shown,
          container,
          fills,
          opacities,
          header,
          frame,
          font,
          lineHeight,
        ),
      );

    const percent = numberFormatter({ style: "percent", maximumFractionDigits: 1 }, locale);
    const total = shown[0]!;
    const rootKey = root > 0 ? data.keyOf(frame.id, view, 0) : undefined;
    // A node's path, as the fields' displays write it (`written`); keys read `view`.
    const pathText = (node: number) =>
      [...written.prefix, ...pathOf(written.tree, node)].join(" / ");
    const itemOf = (node: number): LayoutItem => {
      const [x, y, w, h] = boxes.subarray(node * 4, node * 4 + 4) as unknown as number[];
      return {
        key: data.keyOf(frame.id, view, node),
        label: pathText(node),
        names: [...view.prefix, ...pathOf(tree, node)],
        color: fills[node] ?? colorOf(node) ?? theme.muted,
        value: shown[node]!,
        text: `${amount(shown[node]!)} (${percent(shown[node]! / total)}${where(written)})${data.selectedText(counts, node, locale, fieldText)}`,
        px: x! + w! / 2,
        py: y! + h! / 2,
        outline: `M${n(x!)} ${n(y!)}h${n(w!)}v${n(h!)}h${n(-w!)}Z`,
      };
    };
    const inside = (node: number, px: number, py: number) => {
      const i = node * 4;
      return (
        px >= boxes[i]! &&
        px < boxes[i]! + boxes[i + 2]! &&
        py >= boxes[i + 1]! &&
        py < boxes[i + 1]! + boxes[i + 3]!
      );
    };
    const navigation = data.navigation(
      frame.id,
      view,
      shown,
      (node) => boxes[node * 4 + 2]! > 0 && boxes[node * 4 + 3]! > 0,
      itemOf,
    );
    let infos: ItemInfo[] | undefined;
    return {
      geometry,
      // Each drawn rectangle as drawn (gaps taken), in reading order.
      items() {
        infos ??= Array.from({ length: navigation.count }, (_, i) => {
          const node = navigation.node(i);
          const names = [...view.prefix, ...pathOf(tree, node)];
          const parent = tree.parent[node]!;
          const [x, y, width, height] = boxes.subarray(node * 4, node * 4 + 4);
          return {
            key: data.keyOf(frame.id, view, node),
            names,
            label: pathText(node),
            value: shown[node]!,
            box: { x: x!, y: y!, width: width!, height: height! },
            depth: tree.depth[node]!,
            parent: parent > 0 ? data.keyOf(frame.id, view, parent) : rootKey,
          };
        });
        return infos;
      },
      itemAt(px, py) {
        // Down from the root to the deepest node under the point.
        let node = 0;
        for (;;) {
          let next = -1;
          for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
            const child = tree.children[c]!;
            if (shown[child]! > 0 && boxes[child * 4 + 2]! > 0 && inside(child, px, py))
              next = child;
          }
          if (next < 0) break;
          node = next;
        }
        return node === 0 ? undefined : itemOf(node);
      },
      // Not spread: that would read `count` and order every node now.
      get count() {
        return navigation.count;
      },
      item: navigation.item,
      indexOf: navigation.indexOf,
      summary: () => this.#summary(written, shown, percent, amount, fieldText),
      rowsOf: (key, of) => (of === this.table ? data.rowsOf(frame.id, view, key) : undefined),
      holdsRows: (key, of) => of === this.table && data.nodeOf(frame.id, view, key) >= 0,
      soleRow: (key, of) => (of === this.table ? data.soleRow(frame.id, view, key) : undefined),
      drill: data.drill(frame, root, view, path?.crumbs ?? []),
    };
  }

  /** What measures read across the treemap (see `measureDomain`): the drilled tree's, alike in every facet panel. */
  #domain(frame: LayoutFrame, root: number, levels: number): MeasureDomain {
    if (!this.#paint.measured) return { value: 0, depth: 0 };
    const view = root > 0 ? this.#data.drilled(root) : this.#data.view();
    const shown = this.#data.shown(frame.id, view, frame.hidden);
    return measureDomain(view, shown, levels);
  }

  /**
   * Names inside rectangles with room: those without others inside them at
   * their corner or center, the others in their top strip, written as the
   * labels ask, in black or white by contrast with what they are on.
   */
  #drawLabels(
    drawn: readonly number[],
    boxes: Float64Array,
    view: TreeView,
    shown: Float64Array,
    container: Uint8Array,
    fills: readonly (string | undefined)[],
    opacities: Float64Array,
    header: number,
    frame: LayoutFrame,
    font: string,
    lineHeight: number,
  ): Geometry[] {
    const { theme, measure, locale } = frame;
    const labels = this.#labels;
    const { tree } = view;
    // Fields' values, the value, and names as the chart's field displays
    // write them, where it has any; parts and rows read `view` itself.
    const fieldText = frame.features?.fields?.items(this.table);
    const { names } = (fieldText?.tree(view, this.#data.encoding) ?? view).tree;
    const backdrop = frame.surface ?? surface(theme);
    const centered = labels.at === "center";
    const plain = new Map<string, { coords: number[]; labels: string[] }>();
    const items: TextItem[] = [];
    // What each rectangle is seen against: the backdrop with the rectangles
    // it is drawn over, each at its opacity. `seen[n]` is what n shows its
    // children, found once: up to the nearest parent found before, then down.
    const seen: (string | undefined)[] = [];
    const behindOf = (node: number): string => {
      const chain: number[] = [];
      let at = tree.parent[node]!;
      while (at > 0 && seen[at] === undefined) {
        chain.push(at);
        at = tree.parent[at]!;
      }
      let color = at > 0 ? seen[at]! : backdrop;
      for (let k = chain.length - 1; k >= 0; k--) {
        const parent = chain[k]!;
        const fill = fills[parent];
        color = (fill !== undefined && overColor(fill, opacities[parent]!, color)) || color;
        seen[parent] = color;
      }
      return color;
    };
    // Black or white by contrast with the fill under the name, seen over what
    // is behind it; siblings mostly share all three.
    let last = { fill: undefined as string | undefined, opacity: Number.NaN, behind: "", ink: "" };
    const inkOf = (node: number) => {
      const fill = fills[node];
      const opacity = opacities[node]!;
      const behind = behindOf(node);
      // An unfilled item shows what is behind it.
      if (fill !== last.fill || opacity !== last.opacity || behind !== last.behind)
        last = {
          fill,
          opacity,
          behind,
          ink:
            contrastingText(fill ?? behind, fill === undefined ? 1 : opacity, behind) || theme.text,
        };
      return last.ink;
    };
    for (const node of drawn) {
      const parent = container[node] === 1;
      if (parent && !header) continue;
      const at = node * 4;
      const x = boxes[at]!;
      const y = boxes[at + 1]!;
      const w = boxes[at + 2]!;
      const h = boxes[at + 3]!;
      // Where the name goes: a parent's strip, or the whole rectangle.
      const width = w - 2 * INSET;
      const height = parent ? header : h;
      if (!(width >= 8)) continue;
      const left = x + INSET;
      if (!labels.styled) {
        if (height < lineHeight + 2) continue;
        const text = labelFor(names[node]!, width, measure, font);
        if (!text) continue;
        const anchor = centered ? "middle" : "start";
        const key = `${anchor}\u0000${inkOf(node)}`;
        let batch = plain.get(key);
        if (!batch) {
          batch = { coords: [], labels: [] };
          plain.set(key, batch);
        }
        batch.coords.push(
          centered ? x + w / 2 : left,
          centered && !parent ? y + h / 2 : y + lineHeight / 2 + 2,
        );
        batch.labels.push(text);
        continue;
      }
      const parts = labels.parts(
        view,
        node,
        shown[node]!,
        () => this.#data.soleRowOf(view, node),
        locale,
        fieldText,
        fieldText?.amount(this.spec.value),
        names,
      );
      if (!parts) continue;
      const paint = labels.paint(frame, inkOf(node));
      // The block as painted, with its background's padding, inside the room.
      const [padX, padY] = labels.padding(paint);
      const block = labels.block(parts, paint, frame).fit(width - padX);
      if (!block || block.lines.height + padY + 2 > height) continue;
      const middle = centered && !parent ? y + h / 2 : y + 2 + (block.lines.height + padY) / 2;
      const center = centered ? x + w / 2 : left + (block.lines.width + padX) / 2;
      items.push(
        ...labels.items(block, center, middle, 0, paint, frame, centered ? "middle" : "start"),
      );
    }
    const geometry: Geometry[] = [...plain].map(([key, { coords, labels: texts }], i) => {
      const [anchor, fill] = key.split("\u0000") as ["start" | "middle", string];
      return {
        kind: "text",
        draw: textDrawing,
        key: `${JSON.stringify(frame.id)}-treemap-labels-${i}`,
        fill,
        anchor,
        halo: undefined,
        coords: Float32Array.from(coords),
        labels: texts,
        count: texts.length,
      } as TextGeometry;
    });
    if (items.length > 0)
      geometry.push({
        kind: "labels",
        draw: labelsDrawing,
        key: `${JSON.stringify(frame.id)}-treemap-names`,
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
    if (!(total > 0)) return `Treemap of ${what}, with nothing to show.`;
    const leaves = this.#data.leaves(tree, shown);
    // The branches drawn: shown, and with rows (in a facet panel, its own).
    const visible = this.#data.largest(view.tops, shown);
    const largest = visible
      .slice(0, 3)
      .map(({ node }) => `${tree.names[node]} ${percent(shown[node]! / total)}`);
    return `Treemap of ${what}: ${count(leaves, "leaf", "leaves")} in ${count(visible.length, "group", "groups")} totaling ${amount(total)}. Largest: ${largest.join(", ")}.`;
  }
}

/**
 * A treemap of a tree described by `path` (category fields, outermost
 * first) or by `id` and `parent` fields, its leaves sized by the sum of
 * `value` over their rows, or their count.
 *
 * ```ts
 * treemap(sales, { path: ["region", "country"], value: "revenue" })
 * ```
 */
export function treemap<S extends Schema>(
  table: Table<S>,
  options: TreemapOptions<S>,
): ChartMark<Frozen<TreemapSpec>> {
  const { path } = options;
  // Every option is kept, so the mark refuses a tree named both ways.
  const spec = {
    type: "treemap",
    ...definedFields(options, [
      "node",
      "parent",
      "value",
      "labels",
      "tile",
      "sort",
      "gap",
      "levels",
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
  } as unknown as TreemapSpec;
  if (table.name !== undefined) spec.data = table.name;
  return new TreemapMark(spec, table as unknown as Table);
}
