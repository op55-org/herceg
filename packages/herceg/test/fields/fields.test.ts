// Field display in herceg/fields: rules matching fields by name, regular
// expression, kind, and table, merged setting by setting; displays writing
// values in one order (missing, mappings, format); and the checks.
import { describe, expect, it } from "vitest";
import { mean } from "../../src/data/aggregations.ts";
import { category, time } from "../../src/data/column.ts";
import { derive } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { columnDisplay } from "../../src/fields/grid.ts";
import { compileFields, displayOf, type FieldDisplays, fieldsOf } from "../../src/fields.ts";

const hosts = table(
  {
    time: time([Date.UTC(2026, 0, 1, 12)]),
    host: category(["db-1"]),
    status: category(["503"]),
    bytes_in: [1_572_864],
    bytes_out: [3_221_225_472],
    bytes_quota: [1_000_000],
    cpu: [42.5],
  },
  { name: "hosts" },
);
const label = (fields: FieldDisplays, field: string, of: object = hosts) =>
  displayOf(fields, { table: of as typeof hosts, field: field as "cpu" }).label;
const text = (fields: FieldDisplays, field: string, value: number | string | null) =>
  displayOf(fields, { table: hosts, field: field as "cpu" }, { locale: "en-US" }).text(
    value as never,
  );

describe("rules", () => {
  const rules: FieldDisplays = [
    { match: { kind: "number" }, format: { number: ",.1f" }, missing: "n/a" },
    { match: { regex: "^bytes_" }, format: { binary: "B" } },
    { match: "bytes_out", label: "Sent" },
    { match: "bytes_quota", format: false },
  ];

  it("apply in order, a later rule's settings over an earlier one's, setting by setting", () => {
    expect(text(rules, "bytes_in", 1_572_864)).toBe("1.5 MiB");
    expect(label(rules, "bytes_out")).toBe("Sent");
    // The regex rule's format, and the kind rule's missing text, are kept.
    expect(text(rules, "bytes_out", 3_221_225_472)).toBe("3 GiB");
    expect(text(rules, "bytes_out", Number.NaN)).toBe("n/a");
    expect(text(rules, "cpu", 42.5)).toBe("42.5");
  });

  it("reset a setting with false, as if no earlier rule had given it", () => {
    expect(text(rules, "bytes_quota", 1_000_000)).toBe("1,000,000");
    expect(label([{ label: "Every" }, { match: "cpu", label: false }], "cpu")).toBe("cpu");
  });

  it("read a record as a rule per field", () => {
    expect(label({ cpu: { label: "CPU" } }, "cpu")).toBe("CPU");
    expect(label({ cpu: { label: "CPU" } }, "host")).toBe("host");
  });

  it("match by every key given: names, a regular expression, kinds, and tables", () => {
    expect(label([{ match: { field: ["cpu", "host"] }, label: "X" }], "host")).toBe("X");
    expect(label([{ match: { regex: "^bytes_", kind: "time" }, label: "X" }], "bytes_in")).toBe(
      "bytes_in",
    );
    expect(label([{ match: { kind: ["time", "category"] }, label: "X" }], "time")).toBe("X");
    expect(label([{ match: { kind: ["time", "category"] }, label: "X" }], "cpu")).toBe("cpu");
    // Unanchored, as JavaScript's regular expressions are.
    expect(label([{ match: { regex: "out" }, label: "X" }], "bytes_out")).toBe("X");
    expect(label([{ label: "Every" }], "cpu")).toBe("Every");
  });

  it("match a table, its row views, and tables derived from it that pass the field unchanged", () => {
    const rule: FieldDisplays = [{ match: { table: hosts }, label: "Of hosts" }];
    const filtered = derive(hosts).filter(col("cpu").gt(0)).table();
    const calculated = derive(filtered).calculate("cpu", col("cpu").mul(2)).table();
    const grouped = derive(hosts)
      .aggregate({ by: ["host"], ops: { cpu: mean("cpu") } })
      .table();
    expect(label(rule, "cpu")).toBe("Of hosts");
    expect(label(rule, "cpu", rowView(hosts))).toBe("Of hosts");
    expect(label(rule, "cpu", filtered)).toBe("Of hosts");
    // Through an intermediate table, not past a field calculated under the source's name.
    expect(label(rule, "host", calculated)).toBe("Of hosts");
    expect(label(rule, "cpu", calculated)).toBe("cpu");
    // An aggregate passes its `by` fields, not its outputs.
    expect(label(rule, "host", grouped)).toBe("Of hosts");
    expect(label(rule, "cpu", grouped)).toBe("cpu");
  });

  it("match a derived table and what derives from it, not its source or siblings", () => {
    const filtered = derive(hosts).filter(col("cpu").gt(0)).table();
    const sibling = derive(hosts).filter(col("cpu").lt(100)).table();
    const after = derive(filtered).sort("cpu").table();
    const rule: FieldDisplays = [{ match: { table: rowView(filtered) }, label: "Filtered" }];
    expect(label(rule, "cpu", after)).toBe("Filtered");
    expect(label(rule, "cpu", filtered)).toBe("Filtered");
    expect(label(rule, "cpu")).toBe("cpu");
    expect(label(rule, "cpu", sibling)).toBe("cpu");
  });

  it("match a table by name, along the tables a field comes from, and fields given by name", () => {
    const derived = derive(hosts).filter(col("cpu").gt(0)).table({ name: "busy" });
    const rule: FieldDisplays = [{ match: { table: "hosts", field: "cpu" }, label: "CPU" }];
    expect(label(rule, "cpu", derived)).toBe("CPU");
    expect(displayOf(rule, { field: "cpu", kind: "number", table: "hosts" }).label).toBe("CPU");
    expect(displayOf(rule, { field: "cpu", kind: "number", table: "other" }).label).toBe("cpu");
    expect(displayOf(rule, { field: "cpu", kind: "number" }).label).toBe("cpu");
    // A rule naming a table object matches a field given with that table's name.
    expect(
      displayOf([{ match: { table: hosts }, label: "H" }], {
        field: "cpu",
        kind: "number",
        table: "hosts",
      }).label,
    ).toBe("H");
  });

  it("leave names and tables that match nothing unused", () => {
    const other = table({ cpu: [1] });
    expect(
      label([{ match: "nothing", format: { si: "B" } }, { match: { table: other } }], "cpu"),
    ).toBe("cpu");
  });

  it("refuse what a named field's kind cannot take, and skip it for broad rules", () => {
    expect(() => text({ host: { format: { number: ".2f" } } }, "host", "db-1")).toThrow(
      'displayOf fields.host.format: "host" holds categories; formats are for numbers and times; drop format',
    );
    expect(() => text([{ match: { field: "time" }, min: 0 }], "time", 0)).toThrow(
      'displayOf fields[0].min: "time" holds times; bounds are for numbers; drop min',
    );
    expect(() => text({ time: { format: { duration: "second" } } }, "time", 0)).toThrow(
      'displayOf fields.time.format: "time" holds times; give { time } or Intl date options',
    );
    expect(() => text({ cpu: { format: { time: "%H" } } }, "cpu", 0)).toThrow(
      'displayOf fields.cpu.format: "cpu" holds numbers; give a number format',
    );
    // A rule matching every field gives each what its kind takes.
    expect(text([{ format: { si: "B" }, missing: "?" }], "host", null)).toBe("?");
    expect(text([{ format: { si: "B" } }], "host", "db-1")).toBe("db-1");
    expect(text([{ format: { si: "B" } }], "bytes_in", 1500)).toBe("1.5 kB");
  });

  it("refuse settings none of a rule's kinds take", () => {
    expect(() =>
      text([{ match: { kind: "time" }, format: { duration: "second" } }], "cpu", 1),
    ).toThrow(
      'displayOf fields[0].format: this rule matches kind "time"; give { time } or Intl date options',
    );
    expect(() => text([{ match: { kind: ["time", "category"] }, min: 0 }], "cpu", 1)).toThrow(
      'displayOf fields[0].min: this rule matches kind "time" or "category"; bounds are for numbers; drop min',
    );
  });

  it("check settings that clash once merged, naming the rules that gave them", () => {
    expect(() => label([{ match: "cpu", min: 100 }, { label: "x" }, { max: 0 }], "cpu")).toThrow(
      "displayOf fields.cpu: min 100 (fields[0]) is not below max 0 (fields[2]); give min below max",
    );
    expect(
      label(
        [
          { match: "cpu", min: 100 },
          { match: "cpu", min: false, max: 0 },
        ],
        "cpu",
      ),
    ).toBe("cpu");
  });
});

describe("displays", () => {
  const status: FieldDisplays = {
    status: {
      label: "Status",
      mappings: [
        { value: "200", text: "OK" },
        { regex: "^5(\\d)(\\d)$", text: "Server error $1$2" },
        { value: "503", text: "Unreachable" },
      ],
      missing: "unknown",
    },
    cpu: {
      format: { number: ".0f", suffix: "%" },
      mappings: [
        { between: [90, null], text: "Hot" },
        { between: [null, 10], text: "Idle" },
        { value: 50, text: "Half" },
      ],
    },
  };

  it("write a missing value as missing, then the first mapping that matches, then the format", () => {
    expect(text(status, "status", null)).toBe("unknown");
    expect(text(status, "status", "200")).toBe("OK");
    // The regular expression comes first, and writes its groups.
    expect(text(status, "status", "503")).toBe("Server error 03");
    expect(text(status, "status", "404")).toBe("404");
    expect(text(status, "cpu", Number.NaN)).toBe("–");
    expect(text(status, "cpu", 50)).toBe("Half");
    expect(text(status, "cpu", 42)).toBe("42%");
  });

  it("include both ends of a range, and leave null ends open", () => {
    expect(text(status, "cpu", 90)).toBe("Hot");
    expect(text(status, "cpu", 1e9)).toBe("Hot");
    expect(text(status, "cpu", 10)).toBe("Idle");
    expect(text(status, "cpu", -5)).toBe("Idle");
    expect(text(status, "cpu", 10.5)).toBe("11%");
  });

  it("map times by value and range, in epoch milliseconds", () => {
    const at = Date.UTC(2026, 0, 1, 12);
    const fields: FieldDisplays = {
      time: {
        mappings: [
          { value: at, text: "Launch" },
          { between: [at, null], text: "After" },
        ],
      },
    };
    const display = displayOf(
      fields,
      { table: hosts, field: "time" },
      { timeZone: "UTC", locale: "en-US" },
    );
    expect(display.text(at)).toBe("Launch");
    expect(display.text(at + 1)).toBe("After");
    expect(display.text(at - 60_000)).toBe("Jan 1, 2026, 11:59 AM");
    expect(display.text(Number.POSITIVE_INFINITY)).toBe("–");
  });

  it("give the label, description, and bounds, and write times in the zone given", () => {
    const display = displayOf(
      {
        cpu: { label: "CPU", description: "Busy share.", min: 0, max: 100 },
        time: { format: { time: "%H:%M" } },
      },
      { table: hosts, field: "cpu" },
    );
    expect([display.label, display.description, display.min, display.max]).toEqual([
      "CPU",
      "Busy share.",
      0,
      100,
    ]);
    expect(display.kind).toBe("number");
    const at = Date.UTC(2026, 0, 1, 12);
    const zoned = (timeZone: string) =>
      displayOf(
        { time: { format: { time: "%H:%M" } } },
        { table: hosts, field: "time" },
        { timeZone },
      ).text(at);
    expect(zoned("UTC")).toBe("12:00");
    expect(zoned("Asia/Tokyo")).toBe("21:00");
  });

  it("write with a surface's own format, keeping the field's mappings and missing text", () => {
    const display = displayOf(
      status,
      { table: hosts, field: "cpu" },
      { format: { number: ".1f" } },
    );
    expect(display.text(42)).toBe("42.0");
    expect(display.text(95)).toBe("Hot");
    expect(() =>
      displayOf(status, { table: hosts, field: "cpu" }, { format: { time: "%H" } }),
    ).toThrow('displayOf settings.format: "cpu" holds numbers; give a number format');
  });

  it("write missing values as the surface says where the field's displays do not", () => {
    const missing = (fields: FieldDisplays) =>
      displayOf(fields, { table: hosts, field: "cpu" }, { missing: "" }).text(Number.NaN);
    expect(missing({})).toBe("");
    expect(missing({ cpu: { missing: "–" } })).toBe("–");
    expect(missing([{ missing: "n/a" }, { match: "cpu", missing: false }])).toBe("");
  });

  it("write values computed from the field's in its format and missing text, without mappings", () => {
    const display = displayOf(status, { table: hosts, field: "cpu" });
    // A mean of 50 is not the value 50 the mapping names.
    expect(display.format(50)).toBe("50%");
    expect(display.text(50)).toBe("Half");
    expect(display.format(Number.NaN)).toBe("–");
    expect(displayOf(status, { table: hosts, field: "status" }).format("200")).toBe("200");
  });

  it("take a surface's default format of the kind it writes, under the field's", () => {
    const at = Date.UTC(2026, 0, 1, 12, 30, 15);
    const shown = (fields: FieldDisplays, field: "time" | "cpu", value: number) =>
      displayOf(
        fields,
        { table: hosts, field },
        { timeZone: "UTC", locale: "en-US", defaultFormat: { timeStyle: "medium" } },
      ).text(value);
    expect(shown({}, "time", at)).toBe("12:30:15 PM");
    expect(shown({ time: { format: { time: "%H:%M" } } }, "time", at)).toBe("12:30");
    // Numbers keep theirs: the default writes times.
    expect(shown({}, "cpu", 42.5)).toBe("42.5");
    expect(() =>
      displayOf({}, { table: hosts, field: "cpu" }, { defaultFormat: { number: "q" } }),
    ).toThrow(/^displayOf settings.defaultFormat/);
  });

  it("write a grid column's cells, each category's text once per dictionary entry as it grows", () => {
    const streamed = table({ status: category(["200", "503", null]), ms: [1, 2, 3] });
    const compiled = compileFields(status);
    const shown = columnDisplay(compiled, { field: "status" }, "category", streamed, {});
    const rows = () =>
      Array.from({ length: streamed.length }, (_, row) => shown.text(streamed, row));
    // Missing values are a grid's: empty where the field gives no text.
    expect(rows()).toEqual(["OK", "Server error 03", "unknown"]);
    streamed.append({ status: ["404", "200"], ms: [4, 5] });
    expect(rows()).toEqual(["OK", "Server error 03", "unknown", "404", "OK"]);
    // Numbers through the format and mappings.
    const cpu = columnDisplay(compiled, { field: "cpu", title: "CPU" }, "number", undefined, {});
    expect([cpu.title, cpu.text(table({ cpu: [95, 42] }), 1)]).toEqual(["CPU", "42%"]);
  });

  it("are resolved from rules compiled once", () => {
    const compiled = compileFields([{ match: { kind: "number" }, format: { si: "B" } }]);
    expect(compiled.displayOf({ field: "size", kind: "number" }).text(1500)).toBe("1.5 kB");
    expect(compiled.displayOf({ table: hosts, field: "host" }).text("db-1")).toBe("db-1");
    expect(() => compileFields([{ match: { regex: "(" } }])).toThrow(
      'compileFields fields[0].match.regex: "(" is not a regular expression',
    );
  });
});

describe("checks", () => {
  const refused = (fields: unknown, message: string | RegExp) =>
    expect(() => displayOf(fields as FieldDisplays, { field: "cpu", kind: "number" })).toThrow(
      message,
    );

  it("refuse malformed rules whatever fields they match", () => {
    refused(
      [{ match: { pattern: "x" } }],
      "displayOf fields[0].match.pattern: unknown setting; use field, regex, kind, table",
    );
    refused(
      [{ match: {} }],
      "displayOf fields[0].match: {} matches every field; drop match for that",
    );
    refused(
      [{ match: { kind: "geometry" } }],
      'displayOf fields[0].match.kind: expected "number", "time", or "category"; received "geometry"',
    );
    refused(
      [{ match: { regex: "^bytes_(" } }],
      /^displayOf fields\[0\]\.match\.regex: "\^bytes_\(" is not a regular expression \(.+\); give a JavaScript one$/,
    );
    refused(
      [{ colour: "red" }],
      /^displayOf fields\[0\]\.colour: unknown setting; use match, label/,
    );
    refused({ x: { label: 3 } }, "displayOf fields.x.label: expected text; received 3");
    refused(
      { "p.99": { min: "0" } },
      'displayOf fields["p.99"].min: expected a number; received "0"',
    );
    refused(
      { x: { min: 5, max: 5 } },
      "displayOf fields.x.min: 5 is not below max 5; give min below max",
    );
    refused(
      { x: { format: { duration: "ms" } } },
      /^displayOf fields\.x\.format\.duration: expected one of/,
    );
    refused({ x: { format: { maximumFractionDigits: 200 } } }, /^displayOf fields\.x\.format: /);
    refused(
      "x",
      'displayOf fields: expected displays by field name, or a list of rules; received "x"',
    );
  });

  it("refuse mappings matching two ways or none, without text, or with ranges that cross", () => {
    const mappings = (list: unknown) => ({ x: { mappings: list } });
    refused(
      mappings([{ value: 1, between: [0, 1], text: "a" }]),
      "displayOf fields.x.mappings[0]: a mapping matches by value, between, or regex; give one",
    );
    refused(
      mappings([{ text: "a" }]),
      "displayOf fields.x.mappings[0]: a mapping matches by value, between, or regex; give one",
    );
    refused(mappings([{ value: 1 }]), "displayOf fields.x.mappings[0]: give text, color, or both");
    refused(
      mappings([{ value: 1, color: 2 }]),
      "displayOf fields.x.mappings[0].color: expected a color; received 2",
    );
    refused(
      mappings([{ between: [0.9, 0.5], text: "a" }]),
      "displayOf fields.x.mappings[0].between: 0.9 is above 0.5; give from, then to",
    );
    refused(
      mappings([{ between: [0], text: "a" }]),
      "displayOf fields.x.mappings[0].between: expected [from, to], null for an open end; received [0]",
    );
    refused(
      mappings([{ value: 1, text: "a", icon: "warning" }]),
      /^displayOf fields\.x\.mappings\[0\]\.icon: unknown setting/,
    );
  });

  it("refuse mappings a named field's kind cannot take", () => {
    expect(() =>
      text({ status: { mappings: [{ between: [0, 1], text: "a" }] } }, "status", "1"),
    ).toThrow(
      'displayOf fields.status.mappings[0].between: "status" holds categories; map them by value or regex',
    );
    expect(() => text({ cpu: { mappings: [{ regex: "1", text: "a" }] } }, "cpu", 1)).toThrow(
      'displayOf fields.cpu.mappings[0].regex: "cpu" holds numbers; map them by value or between',
    );
    expect(() =>
      text({ status: { mappings: [{ value: 200, text: "a" }] } }, "status", "200"),
    ).toThrow(
      'displayOf fields.status.mappings[0].value: "status" holds categories; expected text; received 200',
    );
  });

  it("check links' shape", () => {
    expect(() =>
      text({ cpu: { link: { url: ["https://x/", { value: true }] } } }, "cpu", 1),
    ).not.toThrow();
    refused(
      { x: { link: { url: [{ value: false }] } } },
      "displayOf fields.x.link.url[0].value: expected true; received false",
    );
    refused(
      { x: { link: { url: [{ field: 12 }] } } },
      "displayOf fields.x.link.url[0].field: expected a field's name; received 12",
    );
    refused(
      { x: { link: { url: [{ field: "cpu", value: true }] } } },
      "displayOf fields.x.link.url[0]: a part is text, { field }, or { value: true }; give one",
    );
    refused(
      { x: { link: { href: "a" } } },
      "displayOf fields.x.link.href: unknown setting; use url, text",
    );
  });

  it("refuse format settings that no form or Intl reads, which writers would pass over", () => {
    refused(
      { cpu: { format: { si: "B", maximumFractionDigits: 0 } } },
      "displayOf fields.cpu.format.maximumFractionDigits: not a setting of { si }; drop it",
    );
    refused(
      { cpu: { format: { duration: "second", maxUnit: 2 } } },
      "displayOf fields.cpu.format.maxUnit: not a setting of { duration }; drop it",
    );
    refused(
      { cpu: { format: { maximumFractionDigts: 1 } } },
      "displayOf fields.cpu.format.maximumFractionDigts: not an Intl format option",
    );
    refused(
      { cpu: { format: { duration: "second", maxUnits: null } } },
      "displayOf fields.cpu.format.maxUnits: expected a whole number of units from 1 to 7; received null",
    );
    // A form's key given undefined is not given.
    expect(text({ cpu: { format: { duration: undefined, si: "B" } as never } }, "cpu", 1500)).toBe(
      "1.5 kB",
    );
  });

  it("take Intl options for the kinds whose formatters take every option given", () => {
    const at = Date.UTC(2026, 0, 1, 12);
    const utc = (fields: FieldDisplays, field: "time" | "cpu", value: number) =>
      displayOf(fields, { table: hosts, field }, { locale: "en-US", timeZone: "UTC" }).text(value);
    expect(utc({ time: { format: { hour: "2-digit" } } }, "time", at)).toBe("12 PM");
    expect(utc({ time: { format: { calendar: "gregory" } } }, "time", at)).toBe("1/1/2026");
    expect(utc({ time: { format: {} } }, "time", at)).toBe("1/1/2026");
    expect(utc({ cpu: { format: {} } }, "cpu", 42.5)).toBe("42.5");
    refused(
      { cpu: { format: { timeZone: "UTC" } } },
      'displayOf fields.cpu.format: "cpu" holds numbers; give a number format',
    );
  });

  it("refuse a field the table lacks, or one displays do not write", () => {
    expect(() => displayOf({}, { table: hosts, field: "cpuu" as "cpu" })).toThrow(
      'displayOf: no field "cpuu"; the table has "time", "host", "status", "bytes_in", "bytes_out", "bytes_quota", "cpu"',
    );
    expect(() => displayOf({}, { field: "x", kind: "geometry" as "number" })).toThrow(
      'displayOf kind: expected "number", "time", or "category"; received "geometry"',
    );
  });
});

describe("fieldsOf", () => {
  it("writes rules matching a table's fields, checked against its schema", () => {
    const fields = fieldsOf(rowView(hosts), {
      cpu: { label: "CPU", format: { number: ".1f", suffix: "%" }, min: 0, max: 100 },
      time: { format: { time: "%H:%M" } },
      status: { mappings: [{ value: "503", text: "Unavailable" }] },
    });
    expect(fields).toHaveLength(3);
    expect(fields[0]!.match).toEqual({ table: hosts, field: "cpu" });
    expect(displayOf(fields, { table: hosts, field: "cpu" }).text(42.25)).toBe("42.3%");
    expect(displayOf(fields, { table: table({ cpu: [1] }), field: "cpu" }).label).toBe("cpu");
    expect(displayOf(fields, { table: hosts, field: "status" }).text("503")).toBe("Unavailable");
  });

  it("refuses what a field's kind cannot take, and fields the table lacks", () => {
    expect(() => fieldsOf(hosts, { host: { min: 0 } as never })).toThrow(
      'fieldsOf fields.host.min: "host" holds categories; bounds are for numbers; drop min',
    );
    expect(() => fieldsOf(hosts, { cpuu: { label: "x" } } as never)).toThrow(
      'fieldsOf: no field "cpuu"; the table has',
    );
    expect(() => fieldsOf(hosts, { cpu: { min: 5, max: 1 } })).toThrow(
      "fieldsOf fields.cpu.min: 5 is not below max 1; give min below max",
    );
  });
});
