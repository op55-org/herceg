// Tree items' labels written by `content`, in a style, or turned along a
// radius (marks/tree-labels.ts says which a mark asks for): each part
// written (a field of the path naming the item or its ancestor at that
// level, a field of the one row the item stands for, the item's value, each
// number in its part's format), set in its look as a block, and lowered to
// text items. Loaded with the feature compiler, which hands it to the tree
// marks that ask (`TreeTextUser`), so plain names cost charts nothing. It
// imports nothing of the chart's at run time: a module both imported would
// move to a chunk of its own (see model/guides.ts, `GUIDE_KIT`).

import type { Table } from "../../data/table.ts";
import { intlOptions, numberPattern } from "../../format/patterns.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { TextItem } from "../../scene/scene.ts";
import type { FormatSpec, PartStyle } from "../../spec/spec.ts";
import type { ResolvedHalo, TextPaint } from "../../style/style.ts";
import type { LayoutFrame } from "../layout-mark.ts";
import type { TreeView } from "../tree-data.ts";
import { type PartText, partText } from "./part-text.ts";

/** A label's parts as written for one item, each in its style. */
export type WrittenParts = readonly { text: string; style: PartStyle | undefined }[];

/**
 * Writes a label's parts for node `node` of `view`, valued `value`,
 * numbers for `locale`; `row` gives the one row the node stands for.
 */
export type ContentWriter = (
  view: TreeView,
  node: number,
  value: number,
  row: () => number | undefined,
  locale: string | undefined,
) => WrittenParts;

/** What tree marks draw their labels of parts and styles with. */
export interface TreeText {
  /**
   * Writes `content` (checked by the mark for its parts' kinds and fields)
   * for items of a tree of `table` named by `path`, or by `node`'s fields;
   * `at` names it in errors, which its formats' patterns throw now.
   */
  writer(
    content: readonly unknown[],
    table: Table,
    path: readonly string[] | undefined,
    node: { node: string; parent: string } | undefined,
    at: string,
  ): ContentWriter;
  /** `parts` set as a block in `paint`, each part in its style (colors read as the frame reads them). */
  block(parts: WrittenParts, paint: TextPaint, frame: LayoutFrame): PartText;
  /**
   * The text items drawing `block` in `paint` with its middle at (`x`,
   * `y`), its lines aligned as `anchor` says, turned `angle` degrees
   * clockwise about that point, over `halo`.
   */
  items(
    block: PartText,
    x: number,
    y: number,
    angle: number,
    paint: TextPaint,
    anchor: "start" | "middle",
    halo: ResolvedHalo | undefined,
  ): TextItem[];
}

/** A mark that draws its labels with `TreeText` once the feature compiler hands it over. */
export interface TreeTextUser {
  useTreeText(text: TreeText): void;
}

export function treeText(kit: FeatureKit): TreeText {
  return {
    writer: (content, table, path, node, at) => writer(kit, content, table, path, node, at),
    block: (parts, paint, frame) =>
      partText(
        kit,
        parts.map(({ text, style }, i) => ({
          text,
          style: style && frame.read(style, `labels.content[${i}].style`),
        })),
        paint,
        frame.measure,
      ),
    items(block, x, y, angle, paint, anchor, halo) {
      const items = block.items(block.box(x, y, "middle", paint), anchor, paint, halo);
      if (!angle) return items;
      const turn = (angle * Math.PI) / 180;
      const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
      // Each item turns about its own point, moved where the block's turn takes it.
      return items.map((item) => {
        const [dx, dy] = [item.x - x, item.y - y];
        const [px, py] = [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
        const box = item.box && {
          ...item.box,
          x: item.box.x + px - item.x,
          y: item.box.y + py - item.y,
        };
        return { ...item, x: px, y: py, angle, ...(box && { box }) };
      });
    },
  };
}

/**
 * A field's value on one line, as plain names are (`oneLineText` in
 * layout/text.ts, not imported for the reason above): only literal text
 * breaks a label's lines, so treemaps can size parents' strips from it.
 */
const oneLine = (text: string) => (text.includes("\n") ? text.replaceAll("\n", " ") : text);

/** One part's writer (see `ContentWriter`). */
type PartWriter = (
  view: TreeView,
  node: number,
  value: number,
  row: () => number | undefined,
  locale: string | undefined,
) => string;

function writer(
  kit: FeatureKit,
  content: readonly unknown[],
  table: Table,
  path: readonly string[] | undefined,
  tree: { node: string; parent: string } | undefined,
  at: string,
): ContentWriter {
  // Numbers written as a part's format says, for the frame's locale; patterns checked now.
  const number = (format: FormatSpec | undefined, where: string) => {
    const spec = format as { number?: string } | undefined;
    const make = (locale: string | undefined) =>
      spec?.number !== undefined
        ? numberPattern(kit, spec as { number: string }, locale, `${where}.format`)
        : spec
          ? kit.numberFormatter(
              intlOptions(spec as Intl.NumberFormatOptions, `${where}.format`),
              locale,
            )
          : (v: number) => kit.formatNumber(v, locale);
    let made = { locale: undefined as string | undefined, write: make(undefined) };
    return (value: number, locale: string | undefined) => {
      if (made.locale !== locale) made = { locale, write: make(locale) };
      return made.write(value);
    };
  };
  const styles: (PartStyle | undefined)[] = [];
  const writers = content.map((part, i): PartWriter => {
    if (typeof part === "string") return () => part;
    const where = `${at}[${i}]`;
    const spec = part as { field?: string; value?: true; format?: FormatSpec; style?: PartStyle };
    styles[i] = spec.style;
    if (spec.value) {
      const write = number(spec.format, where);
      return (_view, _node, value, _row, locale) =>
        Number.isFinite(value) ? write(value, locale) : "";
    }
    const field = spec.field!;
    const level = path?.indexOf(field) ?? -1;
    if (level >= 0)
      return (view, node) => {
        // The item's own name at its level, an ancestor's below it, nothing above.
        const depth = view.prefix.length + view.tree.depth[node]!;
        if (depth <= level) return "";
        if (level < view.prefix.length) return oneLine(view.prefix[level]!);
        let at = node;
        while (view.prefix.length + view.tree.depth[at]! > level + 1) at = view.tree.parent[at]!;
        return oneLine(view.tree.names[at]!);
      };
    // A drilled view's root keeps its name; the whole tree's has none.
    if (field === tree?.node) return (view, node) => oneLine(view.tree.names[node]!);
    if (field === tree?.parent)
      return (view, node) => {
        const parent = view.tree.parent[node]!;
        if (parent >= 0) return oneLine(view.tree.names[parent]!);
        // A drilled view's root: its parent is the step before it on the path.
        return view.prefix.length > 1 ? oneLine(view.prefix.at(-2)!) : "";
      };
    const write = table.kind(field) === "number" ? number(spec.format, where) : undefined;
    return (_view, _node, _value, row, locale) => {
      const at = row();
      const read = at === undefined ? null : table.value(field as never, at);
      return read === null
        ? ""
        : typeof read === "number"
          ? write!(read, locale)
          : oneLine(String(read));
    };
  });
  return (view, node, value, row, locale) =>
    writers.map((write, i) => ({ text: write(view, node, value, row, locale), style: styles[i] }));
}
