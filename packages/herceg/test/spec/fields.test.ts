// Specs' field displays and the format forms durations, SI and binary
// prefixes, and text around number patterns: what is refused, and where,
// and what static output draws.
import { describe, expect, it } from "vitest";
import { specToSVG } from "../../src/from-spec.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { checkSpec, validateSpec } from "../../src/spec/validate.ts";

const marks: ChartSpec["marks"] = [{ type: "line", x: "t", y: "v" }];
const valid = (spec: Partial<ChartSpec>) => () => validateSpec({ marks, ...spec } as ChartSpec);
const data: ChartSpec["data"] = {
  usage: { columns: { t: [0, 1, 2, 3], v: [450, 66_000, 95_000, 120_000] } },
};

describe("format forms in specs", () => {
  it("take durations, prefixed units, and text around patterns wherever a format goes", () => {
    expect(
      valid({ y: { format: { duration: "millisecond", maxUnits: 3, decimals: 1 } } }),
    ).not.toThrow();
    expect(
      valid({ y: { format: { si: "B" }, tooltipFormat: { binary: "B", decimals: 2 } } }),
    ).not.toThrow();
    expect(
      valid({ y: { format: { number: ".3~s", prefix: "~", suffix: " req/s" } } }),
    ).not.toThrow();
    expect(
      valid({
        marks: [
          {
            type: "line",
            x: "t",
            y: "v",
            tooltip: { fields: [{ field: "v", format: { si: "B" } }] },
          },
          { type: "gauge", value: "v", format: { duration: "second" } },
        ],
      }),
    ).not.toThrow();
  });

  it("refuse a mix of forms, another form's settings, and settings out of range, naming where", () => {
    expect(valid({ y: { format: { number: ".2f", duration: "second" } as never } })).toThrow(
      "y.format: give one of number, time, duration, si, binary, or Intl options; received number and duration",
    );
    expect(valid({ y: { format: { si: "B", maxUnits: 2 } as never } })).toThrow(
      "y.format.maxUnits: describes durations; give duration, or drop maxUnits",
    );
    expect(valid({ y: { format: { maximumFractionDigits: 1, suffix: "%" } as never } })).toThrow(
      'y.format.suffix: text around numbers goes with a number pattern; give { number: ",.0f", suffix }',
    );
    expect(valid({ y: { format: { duration: "ms" } as never } })).toThrow(
      /^y\.format\.duration: expected one of "nanosecond", .*; received "ms"$/,
    );
    expect(valid({ y: { format: { duration: "second", maxUnits: 0 } } })).toThrow(
      "y.format.maxUnits: expected a whole number of units from 1 to 7; received 0",
    );
    expect(valid({ y: { format: { duration: "second", maxUnits: null } as never } })).toThrow(
      "y.format.maxUnits: expected a whole number of units from 1 to 7; received null",
    );
    expect(valid({ y: { format: { si: 1000 } as never } })).toThrow(
      'y.format.si: expected the unit\'s symbol, such as "B" or "W"; received 1000',
    );
    expect(valid({ x: { type: "time", format: { duration: "second" } } })).toThrow(
      'x.format.duration: expected { time: "..." } or Intl date options on a time axis; received "second"',
    );
    expect(
      valid({ marks: [{ type: "gauge", value: "v", format: { time: "%H" } as never }] }),
    ).toThrow(/^marks\[0\]\.format\.time: expected \{ number: "\.\.\." \} or Intl number options/);
  });

  it("list settings no form has as unknown", () => {
    const spec = { marks, y: { format: { si: "B", unit: "x" } } } as unknown as ChartSpec;
    expect(checkSpec(spec)).toEqual(["y.format.unit"]);
  });

  it("are drawn by static output", () => {
    const svg = specToSVG({
      data,
      width: 480,
      height: 240,
      y: { format: { duration: "millisecond" } },
      marks: [{ type: "line", data: "usage", x: "t", y: "v" }],
    });
    for (const label of ["0ms", "1m", "2m"]) expect(svg).toContain(`>${label}<`);
  });
});

describe("field displays in specs", () => {
  const fields = (fields: unknown) => valid({ fields: fields as NonNullable<ChartSpec["fields"]> });

  it("take a record, or rules matching names, regular expressions, kinds, and tables", () => {
    expect(
      fields({
        latency: {
          label: "Latency",
          description: "Time to the last byte.",
          format: { duration: "millisecond" },
          min: 0,
          max: 120_000,
          missing: "no data",
        },
        status: {
          mappings: [
            { value: "200", text: "OK" },
            { regex: "^5(\\d\\d)$", text: "Server error $1" },
          ],
        },
        score: { mappings: [{ between: [0.9, null], text: "Healthy" }] },
        trace: {
          link: { url: ["https://traces.example.com/", { value: true }], text: [{ field: "id" }] },
        },
      }),
    ).not.toThrow();
    expect(
      fields([
        { match: { kind: "number" }, format: { number: ",.1f" }, missing: "–" },
        { match: { regex: "^bytes_", kind: ["number"] }, format: { binary: "B" } },
        { match: "bytes_out", label: "Sent" },
        { match: { table: "quotas", field: ["bytes_in"] }, label: "Quota" },
        { match: "bytes_quota", format: false, label: false },
        { missing: "n/a" },
      ]),
    ).not.toThrow();
  });

  it("refuse malformed rules, naming where", () => {
    expect(fields([{ match: { regex: "^bytes_(" } }])).toThrow(
      /^fields\[0\]\.match\.regex: "\^bytes_\(" is not a regular expression \(.+\); give a JavaScript one$/,
    );
    expect(fields([{ match: {} }])).toThrow(
      "fields[0].match: {} matches every field; drop match for that",
    );
    expect(fields([{ match: { kind: "geometry" } }])).toThrow(
      'fields[0].match.kind: expected "number", "time", or "category"; received "geometry"',
    );
    expect(fields([{ match: { kind: "time" }, format: { duration: "second" } }])).toThrow(
      'fields[0].format: this rule matches kind "time"; give { time } or Intl date options',
    );
    expect(fields([{ match: { kind: "category" }, min: 0 }])).toThrow(
      'fields[0].min: this rule matches kind "category"; bounds are for numbers; drop min',
    );
    expect(fields({ status: { mappings: [{ value: "1", regex: "1", text: "a" }] } })).toThrow(
      "fields.status.mappings[0]: a mapping matches by value, between, or regex; give one",
    );
    expect(fields({ status: { mappings: [{ value: "1" }] } })).toThrow(
      "fields.status.mappings[0]: give text, color, or both",
    );
    expect(fields({ score: { mappings: [{ between: [0.9, 0.5], text: "a" }] } })).toThrow(
      "fields.score.mappings[0].between: 0.9 is above 0.5; give from, then to",
    );
    expect(fields({ x: { link: { url: [{ value: false }] } } })).toThrow(
      /^fields\.x\.link\.url\[0\]\.value: expected true/,
    );
    expect(fields({ x: { label: 3 } })).toThrow("fields.x.label: expected a string; received 3");
    expect(fields([{ min: 5, max: 1 }])).toThrow(
      "fields[0].min: 5 is not below max 1; give min below max",
    );
    expect(fields([{ match: { kind: [] } }])).toThrow(
      "fields[0].match.kind: expected at least one kind",
    );
    expect(fields("latency")).toThrow(/^fields: expected an object/);
  });

  it("list settings displays do not have as unknown", () => {
    const spec = { marks, fields: { latency: { colour: "red" } } } as unknown as ChartSpec;
    expect(checkSpec(spec)).toEqual(["fields.latency.colour"]);
    const rule = { marks, fields: [{ match: { pattern: "x" } }] } as unknown as ChartSpec;
    expect(checkSpec(rule)).toEqual(["fields[0].match.pattern"]);
  });

  it("travel through JSON unchanged, and charts draw specs through them", () => {
    const spec: ChartSpec = {
      data,
      width: 320,
      height: 200,
      fields: [
        { match: { kind: "number" }, format: { si: "B" } },
        { match: "v", label: "Latency" },
      ],
      marks: [{ type: "line", data: "usage", x: "t", y: "v" }],
    };
    const copy = JSON.parse(JSON.stringify(spec)) as ChartSpec;
    expect(copy).toEqual(spec);
    expect(() => validateSpec(copy)).not.toThrow();
    const drawn = (one: ChartSpec) => specToSVG(one).replace(/herceg-svg-\d+/g, "id");
    expect(drawn(copy)).toBe(drawn(spec));
    expect(drawn(copy)).toContain("Latency: 4 points, from 450 B to 120 kB, last 120 kB.");
    expect(drawn(copy)).toContain(">120 kB</text>");
  });
});
