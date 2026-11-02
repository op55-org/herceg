// Names of tree items (treemaps and sunbursts): which labels a mark's
// `labels` asks for (`at`, `parents`, `rotation`, `content`, `style`),
// checked when the mark is made. Labels written by `content`, in a style,
// or turned along a radius are drawn with the feature compiler's code
// (marks/features/tree-text.ts), which charts load before drawing them;
// plain names need none of it.

import type { Table } from "../data/table.ts";
import { labelHalo } from "../draw/label-halo.ts";
import { oneLineText } from "../layout/text.ts";
import type { TextItem } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { PartStyle, TextStyle } from "../spec/spec.ts";
import { type TextPaint, textPaint } from "../style/style.ts";
import type { PartText } from "./features/part-text.ts";
import type { ContentWriter, TreeText, WrittenParts } from "./features/tree-text.ts";
import type { LayoutFrame } from "./layout-mark.ts";
import type { TreeView } from "./tree-data.ts";

/** What a tree's spec says of its labels. */
type LabelsOption =
  | boolean
  | {
      readonly at?: string;
      readonly parents?: boolean;
      readonly rotation?: string;
      readonly content?: readonly unknown[];
      readonly style?: TextStyle;
    }
  | undefined;

/** What each mark's labels take besides `content` and `style`. */
const TAKES = { treemap: ["at", "parents"], sunburst: ["rotation"] } as const;

/** The parts of a label's block, which its parts' styles leave to it. */
const BLOCK = ["halo", "background", "padding", "align", "verticalAlign", "lineHeight", "font"];

/**
 * Format options that write times: a pattern, a fiscal year, or what
 * `Intl.DateTimeFormat` reads and `Intl.NumberFormat` does not. Tree
 * labels write numbers only.
 */
const TIME_FORMAT = [
  "time",
  "fiscal",
  "calendar",
  "timeZone",
  "formatMatcher",
  "dateStyle",
  "timeStyle",
  "era",
  "year",
  "month",
  "day",
  "weekday",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
  "hour12",
  "hourCycle",
];

/** A tree's labels as its `labels` option asks: whether it draws any, where, and what each says. */
export class TreeLabels {
  readonly on: boolean;
  readonly at: "top-left" | "center";
  readonly parents: boolean;
  readonly rotation: "horizontal" | "radial";
  readonly style: TextStyle | undefined;
  /** Whether they need the feature compiler's code: written by content, in a style, or turned. */
  readonly featured: boolean;
  readonly #content: readonly unknown[] | undefined;
  readonly #tree: Parameters<TreeText["writer"]>;
  #text: TreeText | undefined;
  #write: ContentWriter | undefined;

  constructor(
    option: LabelsOption,
    table: Table,
    path: readonly string[] | undefined,
    node: { node: string; parent: string } | undefined,
    role: "treemap" | "sunburst",
  ) {
    const fail = (
      at: string,
      message: string,
      code: "invalid-option" | "unknown-field" = "invalid-option",
    ) => new ChartError({ code, path: at, message: `${role} ${at}: ${message}` });
    const spec = typeof option === "object" && option !== null ? option : {};
    if (
      option !== undefined &&
      typeof option !== "boolean" &&
      (typeof option !== "object" || option === null || Array.isArray(option))
    )
      throw fail(
        "labels",
        `expected true, false, or an object; received ${JSON.stringify(option)}`,
      );
    for (const key of Object.keys(spec)) {
      if (key === "overlap")
        throw fail("labels overlap", "names show where they fit; drop overlap");
      if (key !== "content" && key !== "style" && !(TAKES[role] as readonly string[]).includes(key))
        throw fail(
          `labels ${key}`,
          `${role} labels take ${[...TAKES[role], "content", "style"].join(", ")}; drop ${key}`,
        );
    }
    if (spec.at !== undefined && spec.at !== "top-left" && spec.at !== "center")
      throw fail(
        "labels at",
        `expected "top-left" or "center"; received ${JSON.stringify(spec.at)}`,
      );
    if (spec.parents !== undefined && typeof spec.parents !== "boolean")
      throw fail(
        "labels parents",
        `expected true or false; received ${JSON.stringify(spec.parents)}`,
      );
    if (spec.rotation !== undefined && spec.rotation !== "horizontal" && spec.rotation !== "radial")
      throw fail(
        "labels rotation",
        `expected "horizontal" or "radial"; received ${JSON.stringify(spec.rotation)}`,
      );
    const { content } = spec;
    if (content !== undefined) {
      if (!Array.isArray(content) || content.length === 0)
        throw fail(
          "labels.content",
          `expected a list of parts, such as [{ field: "name" }]; received ${JSON.stringify(content)}`,
        );
      content.forEach((part, i) => {
        const at = `labels.content[${i}]`;
        if (typeof part === "string") return;
        const kinds =
          typeof part === "object" && part !== null
            ? ["field", "series", "value"].filter((key) => key in part)
            : [];
        if (kinds.length !== 1) throw fail(at, "expected text, { field }, or { value: true }");
        const { field, series, style, format } = part as {
          field?: unknown;
          series?: unknown;
          style?: object;
          format?: object;
        };
        if (series !== undefined)
          throw fail(
            at,
            "names a series, and tree items are none; give text, a field, or the value",
          );
        for (const key of BLOCK)
          if (style && key in style)
            throw fail(`${at}.style`, `${key} is the label's; give it in labels.style`);
        if (format && TIME_FORMAT.some((key) => key in format))
          throw fail(
            `${at}.format`,
            'tree labels write numbers, which time formats do not; give a number format, such as { number: ",.0f" }',
          );
        if (field === undefined || path?.includes(field as string)) return;
        if (field === node?.node || field === node?.parent) return;
        if (!table.has(field as string))
          throw fail(
            `${at}.field`,
            `no field "${field}"; the table has ${table
              .fields()
              .map((name) => `"${name}"`)
              .join(", ")}`,
            "unknown-field",
          );
        if (table.kind(field as string) === "time")
          throw fail(
            `${at}.field`,
            `"${field}" holds times, which tree labels do not write; give a category or number field`,
          );
      });
    }
    this.on = option !== false;
    this.at = spec.at === "center" ? "center" : "top-left";
    this.parents = spec.parents ?? true;
    this.rotation = spec.rotation === "radial" ? "radial" : "horizontal";
    this.style = spec.style;
    this.featured =
      this.on && (content !== undefined || spec.style !== undefined || this.rotation === "radial");
    this.#content = content;
    this.#tree = [content ?? [], table, path, node, `${role} labels.content`];
  }

  /** Takes the feature compiler's code for labels of parts and styles; their formats are checked now. */
  use(text: TreeText): void {
    if (this.#text === text) return;
    this.#write = this.#content ? text.writer(...this.#tree) : undefined;
    this.#text = text;
  }

  /**
   * Whether labels are drawn as text items (written by content, in a style,
   * or turned) with the compiler's code; without it, as plain names.
   */
  get styled(): boolean {
    return this.featured && this.#text !== undefined;
  }

  /**
   * What node `node` of `view` says, valued `value`, its parts in their
   * styles, numbers written for `locale` (`row` gives the one row it stands
   * for, if any); undefined where it writes nothing.
   */
  parts(
    view: TreeView,
    node: number,
    value: number,
    row: () => number | undefined,
    locale: string | undefined,
  ): WrittenParts | undefined {
    const parts = this.#write
      ? this.#write(view, node, value, row, locale)
      : [{ text: oneLineText(view.tree.names[node]!), style: undefined }];
    return parts.some(({ text }) => text.trim()) ? parts : undefined;
  }

  /** The labels' paint on an item whose text would be `ink`: the theme's text in it, the style over it. */
  paint(frame: LayoutFrame, ink: string): TextPaint {
    const style = this.style && frame.read(this.style, "labels.style");
    const paint = textPaint([frame.theme.roles.text, { color: ink }, style, { halo: false }]);
    return { ...paint, lineRatio: style?.lineHeight ?? frame.theme.roles.text.lineHeight };
  }

  /**
   * How tall a label's block is at most on `frame`, as painted: each line
   * as its content's literal text breaks it, as tall as its largest part,
   * and its background's padding.
   */
  height(frame: LayoutFrame): number {
    const paint = this.paint(frame, frame.theme.text);
    const ratio = paint.lineRatio ?? 1.25;
    let total = 0;
    let line = paint.lineHeight;
    for (const [i, part] of (this.#content ?? []).entries()) {
      if (typeof part === "string") {
        for (let breaks = part.split("\n").length - 1; breaks > 0; breaks--) {
          total += line;
          line = paint.lineHeight;
        }
        continue;
      }
      const style = (part as { style?: PartStyle }).style;
      const size = style && frame.read(style, `labels.content[${i}].style`).fontSize;
      if (typeof size === "number") line = Math.max(line, Math.round(size * ratio));
    }
    return total + line + this.padding(paint)[1];
  }

  /** The room `paint`'s background box adds around its text: across, and down. */
  padding(paint: TextPaint): readonly [number, number] {
    const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
    return [left + right, top + bottom];
  }

  /** `parts` set as a block in `paint` (see `TreeText.block`); only while `styled`. */
  block(parts: WrittenParts, paint: TextPaint, frame: LayoutFrame): PartText {
    return this.#text!.block(parts, paint, frame);
  }

  /** The text items drawing `block` (see `TreeText.items`), over the style's halo; only while `styled`. */
  items(
    block: PartText,
    x: number,
    y: number,
    angle: number,
    paint: TextPaint,
    frame: LayoutFrame,
    anchor: "start" | "middle" = "middle",
  ): TextItem[] {
    const halo = this.style?.halo === undefined ? undefined : labelHalo(this.style.halo, frame);
    return this.#text!.items(block, x, y, angle, paint, anchor, halo);
  }
}
