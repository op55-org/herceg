// The TypeScript forms of marks' encoding options: the portable types of
// spec/encoding.ts with field names checked against the table's schema and
// expressions built with `col`. Types only; the feature compiler reads the
// specs these become (see model/features.ts).

import type { Expr } from "../data/expr.ts";
import type { Expression } from "../data/expression.ts";
import type {
  CategoryField,
  NumberField,
  NumericField,
  PositionField,
  Schema,
} from "../data/table.ts";
import type {
  BarLabelPlaceSpec,
  CalendarBreak,
  IdentityScaleSpec,
  LabelAt,
  LabelLayoutSpec,
  LabelPlaceSpec,
  MarkerStyle,
  PartStyle,
  SeriesStyle,
  SymbolName,
} from "../spec/encoding.ts";
import type { FormatSpec } from "../spec/guides.ts";
import type { Frame } from "../spec/place.ts";
import type { Dash } from "../spec/spec.ts";
import type { TextStyle } from "../spec/style.ts";

/**
 * The option of marks whose items are rows (lines' and points'
 * observations, bars, annotations' rows): the field whose value names
 * each row's item, so that what addresses items (selections, a pinned
 * tooltip, transitions) follows the same item across appends, drops,
 * `reset`, and a table replaced by another. Without it, an item is its
 * row (its identity in its table), and a bar is named by its position.
 * Rows sharing a value are one item; a missing value names the row by its
 * identity. It neither splits series nor colors.
 */
export interface ItemKeyed<S extends Schema> {
  /** A category, number, or time field. */
  itemKey?: CategoryField<S> | NumericField<S>;
}

/** An expression: one built with `col`, or its JSON form. */
export type Condition = Expr<"boolean"> | Expression;

/** A CSS color: hex, `rgb()`, `hsl()`, a variable, or a name. */
export type CssColor =
  | `#${string}`
  | `rgb${string}`
  | `hsl${string}`
  | `var(${string})`
  | "transparent"
  | "currentColor"
  | NamedColor;

/**
 * A channel: a category field's values through a scale (`scale` names one of
 * the chart's `scales`; colors take "color" by default), a number or time
 * field's values through a channel scale of the chart's (one with a
 * `range`: widths, opacities, sizes, or colors), a field's values as they
 * are (`scale: { type: "identity" }`, or the name of an identity scale of
 * the chart's: colors, shapes, and dashes from category fields, sizes,
 * widths, and opacities from number fields), the series' names through a
 * scale (`{ series: true, scale }`, which joins marks' series by name: a
 * line and its band), a constant, or a condition on each row.
 */
export type Channel<V, S extends Schema> =
  | { field: CategoryField<S>; scale?: string }
  | { field: NumericField<S>; scale: string }
  | {
      field: V extends number ? NumberField<S> : CategoryField<S>;
      scale: IdentityScaleSpec;
    }
  | { series: true; scale: string }
  | { value: V }
  | { condition: { when: Condition; then: V; otherwise: V } };

/** A channel of each row's own look: any but the series' names (see `Channel`). */
export type RowChannel<V, S extends Schema> = Exclude<Channel<V, S>, { series: true }>;

/** A number or time field through the channel's own mapping: a color ramp, sizes by area, opacities. */
export interface MappedField<S extends Schema> {
  field: NumericField<S>;
  scale?: never;
}

/**
 * A place along an axis for each row (see `RowCoordinate`): a field `F`
 * (any position field, or a number or time one for values) on the axis'
 * scale or on a position scale of the chart's `scales` (`scale`), a share
 * of the plot read from a number field (`{ fraction: { field } }`), or
 * pixels from its edge (`{ px: { field } }`), each moved `offset` pixels.
 */
export type FieldCoordinate<S extends Schema, F extends string = PositionField<S>> =
  | { field: F; scale?: string; offset?: number }
  | { fraction: { field: NumberField<S> }; frame?: Frame; offset?: number }
  | { px: { field: NumberField<S> }; frame?: Frame; offset?: number };

/** A part of a label's text, reading fields `F` (see `LabelPart`). */
export type LabelPartOf<F extends string> =
  | string
  | { field: F; format?: FormatSpec; style?: PartStyle; series?: never; value?: never }
  | { series: true; style?: PartStyle; field?: never; value?: never; format?: never }
  | { value: true; format?: FormatSpec; style?: PartStyle; field?: never; series?: never };

/** Labels following each series of a line (see `SeriesLabelsSpec`). */
export interface SeriesLabels<S extends Schema> extends Omit<LabelLayoutSpec, "overlapGroup"> {
  at: LabelAt;
  content?: readonly LabelPartOf<keyof S & string>[];
  place?: LabelPlaceSpec;
  style?: TextStyle;
}

/** Labels following each series of an area: along `edge` for a band's (see `AreaLabelsSpec`). */
export interface AreaLabels<S extends Schema> extends SeriesLabels<S> {
  edge?: "y1" | "y2" | "x1" | "x2";
}

/** A mark's channels (each mark takes those it draws). */
export interface Encodings<S extends Schema> {
  color?: Channel<string, S>;
  fill?: Channel<string, S>;
  stroke?: Channel<string, S>;
  dash?: Channel<Dash, S>;
  symbol?: Channel<SymbolName, S>;
  strokeWidth?: Channel<number, S>;
  size?: Channel<number, S>;
  opacity?: Channel<number, S>;
}

/** Looks by value: by a field's value, or without `field`, by series (see `StyleMapSpec`). */
export interface StyleMap<S extends Schema> {
  field?: CategoryField<S>;
  map: Readonly<Record<string, SeriesStyle>>;
}

/** How a mark's parts look, and looks mapped by value (see `MarkStyleSpec`). */
export interface MarkStyle<S extends Schema> {
  by?: StyleMap<S>;
  marker?: MarkerStyle;
}

/** Which observations a line or area connects (see `ContinuitySpec`). */
export interface Continuity<S extends Schema> {
  defined?: Condition;
  maxGap?: number | { milliseconds: number };
  breakBy?: CalendarBreak | { field: CategoryField<S> };
}

/** A bar's value label (see `BarLabelsSpec`). */
export type BarLabels<S extends Schema> = (
  | { field?: CategoryField<S> | string; format?: FormatSpec; content?: never }
  | { content: readonly LabelPartOf<keyof S & string>[]; field?: never; format?: never }
) & {
  style?: TextStyle;
  minLength?: number;
  place?: BarLabelPlaceSpec;
  overlap?: "show" | "hide";
};

/** CSS's named colors. */
export type NamedColor =
  | "aliceblue"
  | "antiquewhite"
  | "aqua"
  | "aquamarine"
  | "azure"
  | "beige"
  | "bisque"
  | "black"
  | "blanchedalmond"
  | "blue"
  | "blueviolet"
  | "brown"
  | "burlywood"
  | "cadetblue"
  | "chartreuse"
  | "chocolate"
  | "coral"
  | "cornflowerblue"
  | "cornsilk"
  | "crimson"
  | "cyan"
  | "darkblue"
  | "darkcyan"
  | "darkgoldenrod"
  | "darkgray"
  | "darkgreen"
  | "darkgrey"
  | "darkkhaki"
  | "darkmagenta"
  | "darkolivegreen"
  | "darkorange"
  | "darkorchid"
  | "darkred"
  | "darksalmon"
  | "darkseagreen"
  | "darkslateblue"
  | "darkslategray"
  | "darkslategrey"
  | "darkturquoise"
  | "darkviolet"
  | "deeppink"
  | "deepskyblue"
  | "dimgray"
  | "dimgrey"
  | "dodgerblue"
  | "firebrick"
  | "floralwhite"
  | "forestgreen"
  | "fuchsia"
  | "gainsboro"
  | "ghostwhite"
  | "gold"
  | "goldenrod"
  | "gray"
  | "green"
  | "greenyellow"
  | "grey"
  | "honeydew"
  | "hotpink"
  | "indianred"
  | "indigo"
  | "ivory"
  | "khaki"
  | "lavender"
  | "lavenderblush"
  | "lawngreen"
  | "lemonchiffon"
  | "lightblue"
  | "lightcoral"
  | "lightcyan"
  | "lightgoldenrodyellow"
  | "lightgray"
  | "lightgreen"
  | "lightgrey"
  | "lightpink"
  | "lightsalmon"
  | "lightseagreen"
  | "lightskyblue"
  | "lightslategray"
  | "lightslategrey"
  | "lightsteelblue"
  | "lightyellow"
  | "lime"
  | "limegreen"
  | "linen"
  | "magenta"
  | "maroon"
  | "mediumaquamarine"
  | "mediumblue"
  | "mediumorchid"
  | "mediumpurple"
  | "mediumseagreen"
  | "mediumslateblue"
  | "mediumspringgreen"
  | "mediumturquoise"
  | "mediumvioletred"
  | "midnightblue"
  | "mintcream"
  | "mistyrose"
  | "moccasin"
  | "navajowhite"
  | "navy"
  | "oldlace"
  | "olive"
  | "olivedrab"
  | "orange"
  | "orangered"
  | "orchid"
  | "palegoldenrod"
  | "palegreen"
  | "paleturquoise"
  | "palevioletred"
  | "papayawhip"
  | "peachpuff"
  | "peru"
  | "pink"
  | "plum"
  | "powderblue"
  | "purple"
  | "rebeccapurple"
  | "red"
  | "rosybrown"
  | "royalblue"
  | "saddlebrown"
  | "salmon"
  | "sandybrown"
  | "seagreen"
  | "seashell"
  | "sienna"
  | "silver"
  | "skyblue"
  | "slateblue"
  | "slategray"
  | "slategrey"
  | "snow"
  | "springgreen"
  | "steelblue"
  | "tan"
  | "teal"
  | "thistle"
  | "tomato"
  | "turquoise"
  | "violet"
  | "wheat"
  | "white"
  | "whitesmoke"
  | "yellow"
  | "yellowgreen";
