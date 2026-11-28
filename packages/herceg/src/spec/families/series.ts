// Series and annotations, the marks most charts draw: lines, areas, bars,
// points, rugs, error bars, candlesticks, rules, regions, and text. Every
// loader has them; herceg/web loads them with itself (web/families.ts).

import type { Table } from "../../data/table.ts";
import { readsTable } from "../../marks/annotation.ts";
import { AreaMark } from "../../marks/area.ts";
import { BarMark } from "../../marks/bar.ts";
import { CandlestickMark } from "../../marks/candlestick.ts";
import { ErrorBarMark } from "../../marks/errorbar.ts";
import { FollowingTextMark } from "../../marks/following.ts";
import { LineMark } from "../../marks/line.ts";
import { PointMark } from "../../marks/point.ts";
import { RegionMark } from "../../marks/region.ts";
import { RugMark } from "../../marks/rug.ts";
import { RuleMark } from "../../marks/rule.ts";
import { itemPlaces, TextMark } from "../../marks/text.ts";
import { type AllMarks, withScheme } from "../load-with.ts";
import type { AnnotationPosition, LabelSpec, ThresholdPlace } from "../spec.ts";

/** An annotation's table: the one its `data` names, where a position, its text, or an encoding reads a field. */
function annotationTable(
  spec: { label?: string | LabelSpec; encode?: object },
  positions: readonly (AnnotationPosition | ThresholdPlace | undefined)[],
  table: () => Table,
): Table | undefined {
  return readsTable(positions, spec.label, spec.encode) ? table() : undefined;
}

export const SERIES: Pick<
  AllMarks,
  | "line"
  | "area"
  | "bar"
  | "point"
  | "rug"
  | "errorbar"
  | "candlestick"
  | "rule"
  | "region"
  | "text"
> = {
  line: (spec, table, view) => new LineMark(spec, table(), view),
  area: (spec, table, view) => new AreaMark(spec, table(), view),
  bar: (spec, table, view) => new BarMark(spec, table(), view),
  point: (spec, table, view) => new PointMark(withScheme(spec), table(), view),
  rug: (spec, table, view) => new RugMark(spec, table(), view),
  errorbar: (spec, table, view) => new ErrorBarMark(spec, table(), view),
  candlestick: (spec, table, view) => new CandlestickMark(spec, table(), view),
  rule: (spec, table) =>
    new RuleMark(spec, annotationTable(spec, [spec.x, spec.y, ...(spec.span ?? [])], table)),
  region: (spec, table) =>
    new RegionMark(spec, annotationTable(spec, [spec.x1, spec.x2, spec.y1, spec.y2], table)),
  text: (spec, table) => {
    const { from } = spec;
    if (from && !("item" in from)) return new FollowingTextMark(spec);
    const places = from ? itemPlaces(from) : spec.at ? [spec.at.x, spec.at.y] : [spec.x, spec.y];
    return new TextMark(spec, annotationTable(spec, places, table));
  },
};
