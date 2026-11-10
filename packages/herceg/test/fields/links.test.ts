// Links of field displays: URLs made of literal text and the row's raw
// values, URL-encoded; text made of values as their displays write them;
// only http, https, mailto, and relative URLs, whatever spelling a scheme
// takes; and the refusals, with paths.
import { describe, expect, it } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { fromGeoJSON } from "../../src/data/geojson.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { describeInspection } from "../../src/dom/tooltip.ts";
import { linkable } from "../../src/fields/check.ts";
import { columnDisplay } from "../../src/fields/grid.ts";
import {
  compileFields,
  displayOf,
  type FieldDisplays,
  type FieldLink,
  type LinkRows,
} from "../../src/fields.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { titlesOf } from "../../src/render/titles.ts";
import { xScale, yScale } from "../helpers/scales.ts";

const traces = table({
  time: time([Date.UTC(2026, 0, 1, 12), Number.NaN]),
  trace: category(["4bf92f35 a/b?c&d#é", null]),
  service: category(["auth", "web"]),
  latency: [1.5, Number.NaN],
  big: [1e21, -0],
  proto: category(["javascript", "data"]),
  rest: category(["script", "x"]),
});
const link = (fields: FieldDisplays, field: string, row = 0) =>
  displayOf(fields, { table: traces, field: field as "trace" }, { locale: "en-US" }).link(
    traces,
    row,
  );
const url = (url: FieldLink, row = 0) => link({ trace: { link: url } }, "trace", row)?.url;

describe("link URLs", () => {
  it("write the row's raw values URL-encoded: numbers as digits, times as epoch ms, categories as they are", () => {
    expect(url({ url: ["https://t.example/", { value: true }] })).toBe(
      "https://t.example/4bf92f35%20a%2Fb%3Fc%26d%23%C3%A9",
    );
    expect(
      url({
        url: [
          "/q?latency=",
          { field: "latency" },
          "&at=",
          { field: "time" },
          "&big=",
          { field: "big" },
        ],
      }),
    ).toBe(`/q?latency=1.5&at=${Date.UTC(2026, 0, 1, 12)}&big=1e%2B21`);
    // Formats and mappings are for people, not addresses.
    expect(
      link(
        {
          latency: {
            format: { duration: "second" },
            link: { url: ["/l/", { value: true }] },
            mappings: [{ value: 1.5, text: "fast" }],
          },
        },
        "latency",
      ),
    ).toEqual({ url: "/l/1.5", text: "fast" });
    expect(link({ big: { link: { url: ["/b/", { value: true }] } } }, "big", 1)?.url).toBe("/b/0");
  });

  it("write a lone surrogate as browsers encode it, U+FFFD, and pairs as they are", () => {
    const odd = table({ name: category(["a\ud800b", "\udfff", "\ud83d\ude00"]) });
    const fields: FieldDisplays = { name: { link: { url: ["/n/", { value: true }] } } };
    const at = (row: number) =>
      displayOf(fields, { table: odd, field: "name" }).link(odd, row)?.url;
    expect([at(0), at(1), at(2)]).toEqual(["/n/a%EF%BF%BDb", "/n/%EF%BF%BD", "/n/%F0%9F%98%80"]);
  });

  it("take a constant URL as it is", () => {
    expect(url({ url: "https://status.example.com/a b" })).toBe("https://status.example.com/a b");
    // Missing values do not matter to a URL that reads none.
    expect(url({ url: "https://status.example.com" }, 1)).toBe("https://status.example.com");
  });

  it("give a row missing a value they read no link", () => {
    expect(url({ url: ["/t/", { value: true }] }, 1)).toBeUndefined();
    expect(url({ url: ["/t/", { field: "latency" }] }, 1)).toBeUndefined();
    expect(url({ url: ["/t/", { field: "time" }] }, 1)).toBeUndefined();
    expect(url({ url: ["/t/", { field: "service" }] }, 1)).toBe("/t/web");
  });
});

describe("link text", () => {
  it("is the value's text through its display by default", () => {
    const fields: FieldDisplays = {
      service: {
        mappings: [{ value: "auth", text: "Auth" }],
        link: { url: ["/s/", { value: true }] },
      },
    };
    expect(link(fields, "service")).toEqual({ url: "/s/auth", text: "Auth" });
    expect(link(fields, "service", 1)).toEqual({ url: "/s/web", text: "web" });
  });

  it("writes parts through each field's display, missing values by their missing text", () => {
    const fields: FieldDisplays = {
      latency: { format: { number: ".2f", suffix: " s" }, missing: "no data" },
      service: { mappings: [{ value: "auth", text: "Auth" }] },
      trace: {
        link: {
          url: "/traces",
          text: ["Trace of ", { field: "service" }, " (", { field: "latency" }, ")"],
        },
      },
    };
    expect(link(fields, "trace")?.text).toBe("Trace of Auth (1.50 s)");
    expect(link(fields, "trace", 1)?.text).toBe("Trace of web (no data)");
    expect(link({ trace: { link: { url: "/t", text: [{ value: true }] } } }, "trace", 1)).toEqual({
      url: "/t",
      text: "–",
    });
  });

  it("writes the field's own value as the surface does: a grid's cells", () => {
    const fields = compileFields({
      latency: { link: { url: ["/l/", { value: true }], text: ["~", { value: true }] } },
    });
    const column = columnDisplay(
      fields,
      { field: "latency", format: { maximumFractionDigits: 0 } },
      "number",
      traces,
      { locale: "en-US" },
    );
    expect(column.link!(traces, 0)).toEqual({ url: "/l/1.5", text: "~2" });
  });

  it("writes fields of the table the display is of, whatever reads the rows", () => {
    // A remote grid's source by name, its rows read by a reader of its own.
    const fields = compileFields([
      { match: { table: "requests", field: "status" }, mappings: [{ value: "200", text: "OK" }] },
      {
        match: { table: "requests", field: "id" },
        link: { url: "/r", text: [{ field: "status" }] },
      },
    ]);
    const column = columnDisplay(fields, { field: "id" }, "category", "requests", {
      locale: "en-US",
    });
    const rows: LinkRows = {
      has: (field) => field === "id" || field === "status",
      kind: () => "category",
      value: (field) => (field === "id" ? "r1" : "200"),
      fields: () => ["id", "status"],
    };
    expect(column.link!(rows, 0)).toEqual({ url: "/r", text: "OK" });
  });

  it("reads a row view's table, and a later rule's false drops the link", () => {
    const view = rowView(traces);
    const fields: FieldDisplays = [{ match: "trace", link: { url: ["/t/", { value: true }] } }];
    expect(displayOf(fields, { table: view, field: "trace" }).link(view, 0)?.url).toMatch(/^\/t\//);
    expect(link([...fields, { match: "trace", link: false }], "trace")).toBeUndefined();
    expect(link({}, "trace")).toBeUndefined();
  });
});

describe("schemes", () => {
  it("take http, https, mailto, and relative URLs, in any case", () => {
    for (const ok of [
      "https://x.example",
      "HTTP://x.example",
      "mailto:ops@example.com",
      "MailTo:ops@example.com",
      "/traces/1",
      "traces/1:2",
      "//x.example/a",
      "?q=1",
      "#top",
      "",
    ])
      expect(linkable(ok), ok).toBe(true);
  });

  it("refuse others, as browsers read them past spaces, control characters, tabs, and newlines", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "\u0001\u001fjavascript:alert(1)",
      "\tjava\nscr\ript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:x",
      "file:///etc/passwd",
    ])
      expect(linkable(bad), JSON.stringify(bad)).toBe(false);
  });

  it("write a link whose values make another scheme as text, never as a link", () => {
    expect(url({ url: [{ field: "proto" }, ":alert(1)"] })).toBeUndefined();
    expect(url({ url: ["\u0001 java", { field: "rest" }, ":alert(1)"] })).toBeUndefined();
    expect(url({ url: ["JAVA\t", { field: "rest" }, ":alert(1)"] })).toBeUndefined();
    expect(url({ url: [{ field: "proto" }, ":text/html,x"] }, 1)).toBeUndefined();
    // Encoded values carry no scheme of their own.
    expect(url({ url: [{ field: "trace" }] })).toBe("4bf92f35%20a%2Fb%3Fc%26d%23%C3%A9");
  });

  it("refuse a scheme given as text when the displays are checked", () => {
    const refused = (url: string | readonly (string | { value: true })[]) =>
      expect(() => displayOf({ trace: { link: { url } } }, { field: "trace", kind: "category" }));
    refused("javascript:alert(1)").toThrow(
      'displayOf fields.trace.link.url: "javascript:alert(1)" has a scheme links do not take; give an http, https, mailto, or relative URL',
    );
    refused(" JavaScript:alert(1)").toThrow(/has a scheme links do not take/);
    refused("\u0000data:text/html,x").toThrow(/has a scheme links do not take/);
    refused(["vbscript:", { value: true }]).toThrow(
      'displayOf fields.trace.link.url: "vbscript:" has a scheme links do not take',
    );
    refused(["https://x.example/", { value: true }]).not.toThrow();
  });
});

describe("link fields", () => {
  it("are refused as a table is first read where it lacks them, naming the part", () => {
    expect(() => link({ trace: { link: { url: ["/t/", { field: "span" }] } } }, "trace")).toThrow(
      'displayOf fields.trace.link.url[1].field: no field "span" in the table of "trace"; the table has "time", "trace", "service", "latency", "big", "proto", "rest"',
    );
    expect(() =>
      link([{ match: "trace", link: { url: "/t", text: [{ field: "span" }] } }], "trace"),
    ).toThrow('displayOf fields[0].link.text[0].field: no field "span"');
    const regions = fromGeoJSON({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "R" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    expect(() =>
      displayOf(
        { name: { link: { url: ["/r/", { field: "geometry" }] } } },
        { table: regions, field: "name" },
      ).link(regions, 0),
    ).toThrow(
      'displayOf fields.name.link.url[1].field: "geometry" holds shapes; give a number, time, or category field',
    );
    // A display asked for by name reads its field from the table it is given.
    expect(() =>
      displayOf(
        { span: { link: { url: ["/s/", { value: true }] } } },
        { field: "span", kind: "category" },
      ).link(traces, 0),
    ).toThrow('displayOf fields.span.link: no field "span" in the table; the table has "time"');
  });
});

describe("tooltip fields' links", () => {
  const requests = () =>
    table(
      {
        time: time([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)]),
        latency: [120, 340],
        trace: category(["4bf92f35", null]),
        span: category(["s1", "s2"]),
      },
      { name: "requests" },
    );
  const fields: FieldDisplays = {
    trace: {
      label: "Trace",
      link: { url: ["https://t.example/", { value: true }, "?span=", { field: "span" }] },
    },
  };
  function build(config: Omit<ChartConfig, "locale">) {
    const model = new ChartModel(
      { locale: "en-US", timeZone: "UTC", legend: false, ...config },
      NO_PAGE,
      staticCompilers(),
    );
    model.writers = tooltipWriters;
    model.setSize(400, 300, 1);
    model.scene(estimateText);
    return model;
  }
  const at = (model: ChartModel, x: number) =>
    model.inspect(xScale(model)!.map(x), 150)!.points[0]!.fields!;

  it("carry each row's link, reading fields nothing else draws, and its text", () => {
    const model = build({
      fields,
      marks: [line(requests(), { x: "time", y: "latency", tooltip: { fields: ["trace"] } })],
    });
    const [first] = at(model, Date.UTC(2026, 0, 1));
    expect(first).toEqual({
      field: "trace",
      label: "Trace",
      kind: "category",
      value: "4bf92f35",
      text: "4bf92f35",
      link: { url: "https://t.example/4bf92f35?span=s1", text: "4bf92f35" },
    });
    // A missing trace has no address: its value is written as text.
    expect(at(model, Date.UTC(2026, 0, 2))[0]).toEqual({
      field: "trace",
      label: "Trace",
      kind: "category",
      value: null,
      text: "–",
    });
    // Announcements and native titles say what the tooltip shows: the link's text.
    const inspection = model.inspect(xScale(model)!.map(Date.UTC(2026, 0, 1)), 150)!;
    expect(
      describeInspection({
        ...inspection,
        points: [
          {
            ...inspection.points[0]!,
            fields: [{ ...first!, link: { url: "/", text: "Open the trace" } }],
          },
        ],
      }),
    ).toMatch(/Trace: Open the trace$/);
  });

  it("write the value as the tooltip field does, with its own format", () => {
    const model = build({
      fields: {
        latency: { link: { url: ["/l/", { value: true }], text: ["~", { value: true }] } },
      },
      marks: [
        bar(requests(), {
          x: "span",
          y: "latency",
          tooltip: { fields: [{ field: "latency", format: { number: ".1f" } }] },
        }),
      ],
    });
    const [field] = model.inspect(xScale(model)!.map(0), yScale(model)!.map(10))!.points[0]!
      .fields!;
    expect(field).toMatchObject({ text: "120.0", link: { url: "/l/120", text: "~120.0" } });
  });

  it("are read only where tooltips show the field, and refuse fields their table lacks there", () => {
    const broken: FieldDisplays = [
      { match: { kind: "number" }, link: { url: ["/x/", { field: "missing" }] } },
    ];
    // The axis and the series write latency without reading its link.
    expect(() =>
      build({ fields: broken, marks: [line(requests(), { x: "time", y: "latency" })] }),
    ).not.toThrow();
    const model = build({
      fields: broken,
      marks: [line(requests(), { x: "time", y: "latency", tooltip: { fields: ["latency"] } })],
    });
    expect(() => at(model, Date.UTC(2026, 0, 1))).toThrow(
      'chart fields[0].link.url[1].field: no field "missing" in the table of "latency"; the table has "time", "latency", "trace", "span"',
    );
  });

  it("are text in static SVG's titles, as unpinned tooltips write them", () => {
    const model = build({
      fields: {
        trace: { link: { url: ["/t/", { value: true }], text: ["Trace ", { value: true }] } },
      },
      marks: [bar(requests(), { x: "span", y: "latency", tooltip: { fields: ["trace"] } })],
    });
    const { scene, titles } = titlesOf(model, estimateText);
    const svg = renderSvg(scene, { idPrefix: "t", titles });
    expect(svg).toContain("<title>s1\nlatency: 120, trace: Trace 4bf92f35</title>");
    expect(svg).not.toContain("<a");
    expect(svg).not.toContain("/t/");
  });
});
