// Compile-time tests: checked by `npm run typecheck`, never executed.
// Formats' forms on every option that takes a format, and field displays.
import { category, time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import {
  compileFields,
  type DisplayedField,
  displayOf,
  type FieldDisplays,
  fieldsOf,
} from "../../src/fields.ts";
import { bar } from "../../src/marks/bar.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { line } from "../../src/marks/line.ts";
import type { ChartSpec, FormatSpec, NumberFormatSpec } from "../../src/spec/spec.ts";

declare const element: HTMLElement;
const requests = table({
  time: time([0]),
  service: category(["auth"]),
  latency: [66_000],
  memory: [1_572_864],
});

// Every form, on axes, tick layers, colorbars, label parts, bar labels, tooltip fields, and gauges.
createChart(element, {
  y: { format: { binary: "B" }, tooltipFormat: { duration: "millisecond", maxUnits: 3 } },
  guides: [
    {
      type: "axis",
      scale: "y",
      format: { si: "B" },
      layers: [{ id: "minor", format: { si: "B", decimals: 2 } }],
    },
    { type: "colorbar", format: { number: ".3~s", suffix: " req/s" } },
  ],
  marks: [
    line(requests, {
      x: "time",
      y: "latency",
      labels: {
        at: "last",
        content: [{ series: true }, " ", { value: true, format: { duration: "millisecond" } }],
      },
      tooltip: { fields: [{ field: "memory", label: "Memory", format: { binary: "B" } }] },
    }),
    bar(requests, { x: "service", y: "memory", labels: { format: { si: "B" } } }),
  ],
});
createChart(element, {
  marks: [gauge(requests, { value: "latency", max: 120_000, format: { duration: "millisecond" } })],
});

// @ts-expect-error a duration's unit is one of DurationUnit's
export const shortUnit: FormatSpec = { duration: "ms" };
// @ts-expect-error a prefixed unit is text
export const siNumber: FormatSpec = { si: 1000 };
// @ts-expect-error gauges write numbers
gauge(requests, { value: "latency", format: { time: "%H:%M" } });
// Tooltip fields take their kind's formats.
line(requests, {
  x: "time",
  y: "latency",
  tooltip: {
    fields: [
      { field: "time", format: { time: "%H:%M" } },
      { field: "latency", format: { duration: "millisecond" } },
    ],
  },
});
line(requests, {
  x: "time",
  y: "latency",
  // @ts-expect-error a time field takes time formats
  tooltip: { fields: [{ field: "time", format: { duration: "millisecond" } }] },
});
line(requests, {
  x: "time",
  y: "latency",
  // @ts-expect-error a number field takes number formats
  tooltip: { fields: [{ field: "latency", format: { time: "%H:%M" } }] },
});
export const numbers: NumberFormatSpec[] = [
  { duration: "second", maxUnits: 3, decimals: 1 },
  { si: "W" },
  { binary: "B", decimals: 2 },
  { number: ",.0f", prefix: "$" },
  { style: "currency", currency: "EUR" },
];

// Field displays: a record, or rules matching names, expressions, kinds, and tables.
export const fields: FieldDisplays = [
  { match: { kind: "number" }, format: { number: ",.1f" }, missing: "–" },
  { match: { regex: "^bytes_" }, format: { binary: "B" } },
  { match: { table: requests, field: ["latency"] }, label: "Latency", min: 0, max: 120_000 },
  {
    match: "service",
    mappings: [
      { value: "auth", text: "Auth" },
      { regex: "^a(.*)", text: "$1" },
    ],
  },
  { match: "latency", format: false },
];
// @ts-expect-error match keys are field, regex, kind, and table
export const unknownKey: FieldDisplays = [{ match: { pattern: "^bytes_" } }];
// @ts-expect-error kinds are the ones displays write
export const unknownKind: FieldDisplays = [{ match: { kind: "geometry" } }];
export const twoWays: FieldDisplays = {
  // @ts-expect-error a mapping matches one way
  service: { mappings: [{ value: "a", regex: "b", text: "c" }] },
};
export const showsNothing: FieldDisplays = {
  // @ts-expect-error a mapping shows text, a color, or both
  service: { mappings: [{ value: "a" }] },
  // @ts-expect-error missing values show text, a color, or both
  p99: { missing: {} },
};
export const colorsOnly: FieldDisplays = {
  service: { mappings: [{ value: "a", color: "red" }], missing: { color: "gray" } },
};
// Charts take displays, and series' names and axis titles name fields by their labels.
createChart(element, {
  fields,
  x: { title: [{ label: "time" }] },
  y: { title: [{ label: "latency" }, " (p99)"] },
  marks: [
    line(requests, {
      x: "time",
      y: "latency",
      series: "service",
      label: [{ series: true }, " p99"],
    }),
    line(requests, { x: "time", y: "memory", label: [{ label: "memory" }, " used"] }),
  ],
});
// @ts-expect-error the table has no field "latncy"
line(requests, { x: "time", y: "latency", label: [{ label: "latncy" }] });
// @ts-expect-error a series' name reads no values
line(requests, { x: "time", y: "latency", label: [{ value: true }] });
export const spec: ChartSpec = {
  fields: { latency: { format: { duration: "millisecond" } } },
  y: { title: [{ label: "latency" }] },
  marks: [{ type: "line", data: "requests", x: "time", y: "latency", label: [{ series: true }] }],
};

// displayOf: typed by the table's field, or by a kind.
const latency: DisplayedField<"number"> = displayOf(fields, { table: requests, field: "latency" });
latency.text(66_000);
displayOf(fields, { table: requests, field: "service" }).text("auth");
displayOf(fields, { field: "size", kind: "number", table: "requests" }).text(1);
compileFields(fields).displayOf({ table: requests, field: "time" }).text(0);
// @ts-expect-error a category's value is text
displayOf(fields, { table: requests, field: "service" }).text(1);
// @ts-expect-error the table has no such field
displayOf(fields, { table: requests, field: "latencyy" });

// fieldsOf: each field takes what its kind writes.
fieldsOf(requests, {
  latency: { label: "Latency", format: { duration: "millisecond" }, min: 0 },
  time: { format: { time: "%Y-%m-%d %H:%M" } },
  service: { label: "Service", mappings: [{ value: "auth", text: "Auth" }] },
});
fieldsOf(requests, {
  // @ts-expect-error the table has no field "latncy"
  latncy: { label: "Latency" },
});
fieldsOf(requests, {
  // @ts-expect-error a time field takes time formats
  time: { format: { duration: "millisecond" } },
});
fieldsOf(requests, {
  // @ts-expect-error bounds are for number fields
  service: { min: 0 },
});
fieldsOf(requests, {
  // @ts-expect-error categories are mapped by value or regex
  service: { mappings: [{ between: [0, 1], text: "low" }] },
});
