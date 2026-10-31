// Compile-time checks, run by `npm run typecheck`: each component takes
// what the engine's function for it takes, by TypeScript's own identity
// (packages/herceg/test/helpers/props.ts): a mark component its mark
// function's options and table, over a table of each kind of field and the
// constants' and tables' forms of annotations; layout components their
// helpers' options; <Legend> a legend's; <Chart> `ChartOptions`' options
// as props (each may be left unset) and each event's payload.
// scripts/check-contracts.mjs requires a check of every component the
// package exports.

import type {
  area,
  bar,
  boxen,
  boxplot,
  ChartError,
  ChartEvents,
  ChartListener,
  ChartOptions,
  CustomDataOptions,
  CustomOptions,
  candlestick,
  contour,
  dendrogram,
  errorbar,
  funnel,
  gauge,
  geopoint,
  geoshape,
  graph,
  Hydration,
  heatmap,
  histogram,
  LegendGuideOptions,
  line,
  line3d,
  pie,
  point,
  point3d,
  RegionDataOptions,
  RegionOptions,
  RuleDataOptions,
  RuleOptions,
  radar,
  rug,
  sankey,
  sunburst,
  surface,
  Table,
  TextDataOptions,
  TextOptions,
  treemap,
  violin,
} from "herceg";
import type { GridOptions, InsetOptions, PanelDefinition, Tracks } from "herceg/layout";
import type { MarkProps, Mixed, Takes, Unset } from "../../herceg/test/helpers/props.ts";
import type { Legend } from "../src/guides.ts";
import type {
  Area,
  Bar,
  Boxen,
  BoxPlot,
  Candlestick,
  Chart,
  Contour,
  Custom,
  Dendrogram,
  ErrorBar,
  Funnel,
  Gauge,
  GeoPoint,
  GeoShape,
  Graph,
  Heatmap,
  Histogram,
  Line,
  Line3D,
  Pie,
  Point,
  Point3D,
  Radar,
  Region,
  Rug,
  Rule,
  Sankey,
  Sunburst,
  Surface,
  Text,
  Treemap,
  Violin,
} from "../src/index.ts";
import type { Cell, Columns, Grid, Inset, Panel, Rows } from "../src/layout.ts";

/** A component's props. */
type PropsOf<C> = C extends (props: infer P) => unknown ? P : never;
type Table_ = Table<Mixed>;

true satisfies Takes<PropsOf<typeof Area<Mixed>>, MarkProps<typeof area<Mixed>>>;
true satisfies Takes<PropsOf<typeof Bar<Mixed>>, MarkProps<typeof bar<Mixed>>>;
true satisfies Takes<PropsOf<typeof Boxen<Mixed>>, MarkProps<typeof boxen<Mixed>>>;
true satisfies Takes<PropsOf<typeof BoxPlot<Mixed>>, MarkProps<typeof boxplot<Mixed>>>;
true satisfies Takes<PropsOf<typeof Candlestick<Mixed>>, MarkProps<typeof candlestick<Mixed>>>;
true satisfies Takes<PropsOf<typeof Contour<Mixed>>, MarkProps<typeof contour<Mixed>>>;
true satisfies Takes<PropsOf<typeof Custom<undefined>>, CustomOptions & { data?: undefined }>;
// Annotations and Custom infer their table from `data`, which their type leaves optional.
true satisfies Takes<PropsOf<typeof Custom<Table_>>, CustomDataOptions<Mixed> & { data?: Table_ }>;
true satisfies Takes<PropsOf<typeof Dendrogram<Mixed>>, MarkProps<typeof dendrogram<Mixed>>>;
true satisfies Takes<PropsOf<typeof ErrorBar<Mixed>>, MarkProps<typeof errorbar<Mixed>>>;
true satisfies Takes<PropsOf<typeof Funnel<Mixed>>, MarkProps<typeof funnel<Mixed>>>;
true satisfies Takes<PropsOf<typeof Gauge<Mixed>>, MarkProps<typeof gauge<Mixed>>>;
true satisfies Takes<PropsOf<typeof GeoPoint<Mixed>>, MarkProps<typeof geopoint<Mixed>>>;
true satisfies Takes<PropsOf<typeof GeoShape<Mixed>>, MarkProps<typeof geoshape<Mixed>>>;
true satisfies Takes<PropsOf<typeof Graph<Mixed, Mixed>>, MarkProps<typeof graph<Mixed, Mixed>>>;
true satisfies Takes<PropsOf<typeof Heatmap<Mixed>>, MarkProps<typeof heatmap<Mixed>>>;
true satisfies Takes<PropsOf<typeof Histogram<Mixed>>, MarkProps<typeof histogram<Mixed>>>;
true satisfies Takes<PropsOf<typeof Line<Mixed>>, MarkProps<typeof line<Mixed>>>;
true satisfies Takes<PropsOf<typeof Line3D<Mixed>>, MarkProps<typeof line3d<Mixed>>>;
true satisfies Takes<PropsOf<typeof Pie<Mixed>>, MarkProps<typeof pie<Mixed>>>;
true satisfies Takes<PropsOf<typeof Point<Mixed>>, MarkProps<typeof point<Mixed>>>;
true satisfies Takes<PropsOf<typeof Point3D<Mixed>>, MarkProps<typeof point3d<Mixed>>>;
true satisfies Takes<PropsOf<typeof Radar<Mixed>>, MarkProps<typeof radar<Mixed>>>;
true satisfies Takes<PropsOf<typeof Region<undefined>>, RegionOptions & { data?: undefined }>;
true satisfies Takes<PropsOf<typeof Region<Table_>>, RegionDataOptions<Mixed> & { data?: Table_ }>;
true satisfies Takes<PropsOf<typeof Rug<Mixed>>, MarkProps<typeof rug<Mixed>>>;
true satisfies Takes<PropsOf<typeof Rule<undefined>>, RuleOptions & { data?: undefined }>;
true satisfies Takes<PropsOf<typeof Rule<Table_>>, RuleDataOptions<Mixed> & { data?: Table_ }>;
true satisfies Takes<PropsOf<typeof Sankey<Mixed>>, MarkProps<typeof sankey<Mixed>>>;
true satisfies Takes<PropsOf<typeof Sunburst<Mixed>>, MarkProps<typeof sunburst<Mixed>>>;
true satisfies Takes<PropsOf<typeof Surface<Mixed>>, MarkProps<typeof surface<Mixed>>>;
true satisfies Takes<PropsOf<typeof Text<undefined>>, TextOptions & { data?: undefined }>;
true satisfies Takes<PropsOf<typeof Text<Table_>>, TextDataOptions<Mixed> & { data?: Table_ }>;
true satisfies Takes<PropsOf<typeof Treemap<Mixed>>, MarkProps<typeof treemap<Mixed>>>;
true satisfies Takes<PropsOf<typeof Violin<Mixed>>, MarkProps<typeof violin<Mixed>>>;

true satisfies Takes<PropsOf<typeof Columns>, GridOptions & { weights?: Tracks | undefined }>;
true satisfies Takes<PropsOf<typeof Rows>, GridOptions & { weights?: Tracks | undefined }>;
true satisfies Takes<
  PropsOf<typeof Grid>,
  GridOptions & { rows?: Tracks | undefined; columns?: Tracks | undefined }
>;
true satisfies Takes<
  PropsOf<typeof Cell>,
  { row: number; column: number; rowSpan?: number | undefined; columnSpan?: number | undefined }
>;
true satisfies Takes<PropsOf<typeof Panel>, PanelDefinition>;
true satisfies Takes<
  PropsOf<typeof Inset>,
  PanelDefinition & Omit<InsetOptions, "panel" | "insets">
>;
true satisfies Takes<PropsOf<typeof Legend>, Omit<LegendGuideOptions, "type">>;

/**
 * <Chart>'s options as props (the tooltip's content of your own is a slot),
 * each of which may be left unset, its marks and hydration,
 * and its events' listeners. Their names are the API audit's (`chart vue`
 * and `events vue` in test/contracts/api.json).
 */
type Props = InstanceType<typeof Chart>["$props"];
type Options = Omit<ChartOptions, "marks" | "renderTooltip" | "onError">;
// Vue's emits make listeners returning any; input listeners are props, so
// that the chart knows whether it is listened to.
type Listener<E> = (_: E) => ReturnType<NonNullable<Props["onRender"]>>;
type Input = "hover" | "click" | "contextMenu";
type Listeners = {
  [E in Exclude<keyof ChartEvents, "error" | Input> as `on${Capitalize<E>}`]?: Listener<
    ChartEvents[E]
  >;
} & {
  onError?: Listener<ChartError>;
  onHover?: ChartListener<"hover">;
  onClick?: ChartListener<"click">;
  onContextMenu?: ChartListener<"contextMenu">;
};
/** Options whose props default to undefined, so that a bare `<Chart legend>` is true and an absent one unset. */
type Defaulted = "legend" | "inspection" | "tooltip" | "animation";
// Vue's instances' props are read only, but for those with a default.
true satisfies Takes<
  Pick<Props, keyof Options | "marks" | "initial" | keyof Listeners>,
  Readonly<
    Unset<Omit<Options, Defaulted> & Pick<ChartOptions, "marks"> & { initial: Hydration }> &
      Listeners
  > &
    Unset<Pick<Options, Defaulted>>
>;
