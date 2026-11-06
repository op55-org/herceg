// Cells without a DOM: bars' domains and their edge cases as data streams,
// chips' and symbols' checks, the symbol channel, links' text, columns
// without fields and their text, descriptors' portable form, and what
// remote grids ask for and refuse.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { afterEach, describe, expect, it } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { barCell, chipCell, createGridModel, symbolCell } from "../../src/grid/model.ts";
import { createRemoteGridModel, type RemoteGridModelOptions } from "../../src/grid/remote.ts";
import type { GridSource, RowsRequest } from "../../src/grid/source.ts";

const services = () =>
  table({
    id: Float64Array.from({ length: 6 }, (_, i) => i),
    service: category(["web", "api", "db", "web", null, "api"]),
    ms: [10, -20, Number.NaN, 40, 30, 70],
    url: category(["/a", "javascript:alert(1)", "/c", null, "/e", "/f"]),
  });

const models: { dispose(): void }[] = [];
afterEach(() => {
  for (const model of models.splice(0)) model.dispose();
});

type Model = ReturnType<typeof createGridModel>;

/** A model over `data`, its options loosely typed so tests can give what types refuse. */
function grid(
  options: Record<string, unknown> & { columns: unknown[] },
  data: unknown = services(),
) {
  const model: Model = createGridModel({
    data: rowView(data as never),
    locale: "en-US",
    ...options,
  } as never);
  models.push(model);
  return { model };
}

/** Each row's bar of column 0. */
const bars = (model: Model) =>
  Array.from({ length: model.rowCount }, (_, i) => model.cellAt(i, 0).bar);

describe("bars", () => {
  it("span the records' extent with the base, drawing negative values toward the start", () => {
    const { model } = grid({ columns: [{ field: "ms", cell: barCell() }] });
    // Domain -20 to 70 (0, the base, within it): the base at 2/9.
    const base = 20 / 90;
    expect(bars(model)).toEqual([
      [base, 30 / 90],
      [0, base],
      undefined,
      [base, 60 / 90],
      [base, 50 / 90],
      [base, 1],
    ]);
  });

  it("take their own domain, else each end from the field's display", () => {
    const own = grid({ columns: [{ field: "ms", cell: barCell({ domain: [0, 50] }) }] });
    // -20 fills to the start, 70 to the end: values past an end fill to it.
    expect(bars(own.model)).toEqual([[0, 0.2], [0, 0], undefined, [0, 0.8], [0, 0.6], [0, 1]]);
    const display = grid({
      columns: [{ field: "ms", cell: barCell() }],
      fields: { ms: { max: 100 } },
    });
    // The low end from the records with the base (-20), the high end the display's.
    expect(display.model.cellAt(5, 0).bar).toEqual([20 / 120, 90 / 120]);
  });

  it("hold the base within the domain, and draw none for an empty one", () => {
    const above = grid({
      columns: [{ field: "ms", cell: barCell({ domain: [10, 20], base: 30 }) }],
    });
    // The base past the end is held at it: bars draw from the end back.
    expect(above.model.cellAt(0, 0).bar).toEqual([0, 1]);
    const flat = table({ v: [0, 0, Number.NaN] });
    const none = grid({ columns: [{ field: "v", cell: barCell() }] }, flat);
    expect(bars(none.model)).toEqual([undefined, undefined, undefined]);
    const missing = grid(
      { columns: [{ field: "v", cell: barCell({ base: 5 }) }] },
      table({ v: [Number.NaN, Number.NaN] }),
    );
    expect(bars(missing.model)).toEqual([undefined, undefined]);
  });

  it("keep spans too small for halves", () => {
    const tiny = grid(
      { columns: [{ field: "v", cell: barCell({ domain: [0, Number.MIN_VALUE] }) }] },
      table({ v: [Number.MIN_VALUE, 0] }),
    );
    expect(bars(tiny.model)).toEqual([
      [0, 1],
      [0, 0],
    ]);
  });

  it("make one value's domain from the base to it", () => {
    const one = grid({ columns: [{ field: "v", cell: barCell() }] }, table({ v: [4] }));
    expect(one.model.cellAt(0, 0).bar).toEqual([0, 1]);
  });

  it("keep fractions finite over spans past the largest double", () => {
    const wide = grid(
      { columns: [{ field: "v", cell: barCell() }] },
      table({ v: [-1.5e308, 1.5e308, 0] }),
    );
    expect(bars(wide.model)).toEqual([
      [0, 0.5],
      [0.5, 1],
      [0.5, 0.5],
    ]);
  });

  it("halve spans as they stream past the largest double", () => {
    const data = table({ v: [-1e308, 0] });
    const { model } = grid({ columns: [{ field: "v", cell: barCell() }] }, data);
    // A span of 1e308, whole: the base at its end.
    expect(model.cellAt(1, 0).bar).toEqual([1, 1]);
    data.append({ v: [1e308] });
    // The same low end and span, in halves: the base halfway.
    expect(model.cellAt(1, 0).bar).toEqual([0.5, 0.5]);
    expect(model.cellAt(2, 0).bar).toEqual([0.5, 1]);
  });

  it("follow the records as they stream and as the view filters them", () => {
    const data = services();
    const { model } = grid({ columns: [{ field: "ms", cell: barCell() }] }, data);
    const before = model.cellsRevision(0);
    expect(model.cellAt(5, 0).bar).toEqual([20 / 90, 1]);
    data.append({ id: [6], service: ["web"], ms: [160], url: ["/g"] });
    // The extent grew: mounted bars draw again.
    expect(model.cellsRevision(0)).not.toBe(before);
    expect(model.cellAt(5, 0).bar).toEqual([20 / 180, 90 / 180]);
    const view = model.data;
    view.setQuery({ filter: col("ms").ge(0) });
    // -20 is filtered out: the domain is 0 to 160.
    expect(model.cellAt(0, 0).bar).toEqual([0, 10 / 160]);
  });

  it("refuse other fields, and domains that are not ends low first", () => {
    expect(() => grid({ columns: [{ field: "service", cell: barCell() }] })).toThrow(
      'grid columns[0].cell: bar cells draw numbers; "service" holds categories; give a number field, or chipCell()',
    );
    expect(() => grid({ columns: [{ field: "ms", cell: barCell({ domain: [0, 0] }) }] })).toThrow(
      "grid columns[0].cell.domain: 0 is not below 0; give the bar's ends, low first",
    );
    expect(() =>
      grid({ columns: [{ field: "ms", cell: barCell({ domain: [0, Number.NaN] as never }) }] }),
    ).toThrow("grid columns[0].cell.domain: expected two finite numbers, low first");
    expect(() =>
      grid({ columns: [{ field: "ms", cell: { spec: { kind: "bar" } } as never }] }),
    ).toThrow(
      'grid columns[0].cell: expected a cell kind such as barCell(); received {"spec":{"kind":"bar"}}',
    );
  });

  it("write group rows as text", () => {
    const data = services();
    const view = rowView(data);
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { field: "ms", cell: barCell() }],
      groups: groupRows(view, { by: ["service"] }),
    });
    models.push(model);
    expect(model.row(0).kind).toBe("group");
    expect(model.cellAt(0, 1).bar).toBeUndefined();
  });
});

describe("descriptors", () => {
  it("carry their portable form apart from their implementation, frozen", () => {
    const cell = barCell({ domain: [0, 1], track: true });
    expect(JSON.parse(JSON.stringify(cell))).toEqual({
      spec: { kind: "bar", domain: [0, 1], track: true },
    });
    expect(Object.isFrozen(cell) && Object.isFrozen(cell.spec)).toBe(true);
    expect(JSON.parse(JSON.stringify(chipCell()))).toEqual({ spec: { kind: "chip" } });
    expect(JSON.parse(JSON.stringify(symbolCell({ text: false })))).toEqual({
      spec: { kind: "symbol", text: false },
    });
  });

  it("keep a domain as it was given", () => {
    const domain: [number, number] = [0, 100];
    const cell = barCell({ domain });
    domain[1] = 10;
    const { model } = grid({ columns: [{ field: "ms", cell }] });
    // 10 within 0 to 100, not to 10; and the spec says the same.
    expect(model.cellAt(0, 0).bar).toEqual([0, 0.1]);
    expect(cell.spec).toEqual({ kind: "bar", domain: [0, 100] });
  });
});

describe("chips and symbols", () => {
  it("refuse what they do not draw", () => {
    const timed = table({ at: time(Float64Array.of(1)) });
    expect(() =>
      createGridModel({
        data: rowView(timed),
        columns: [{ field: "at", cell: chipCell() as never }],
      }),
    ).toThrow(
      'grid columns[0].cell: chip cells draw numbers and categories; "at" holds times; give a number or category field',
    );
    expect(() => grid({ columns: [{ field: "ms", cell: symbolCell({ size: 0 }) }] })).toThrow(
      "grid columns[0].cell.size: expected an area above 0 square pixels; received 0",
    );
  });

  it("give symbols by the symbol channel: categories in turn, a scale's map, constants, conditions", () => {
    const { model } = grid({
      scales: { shapes: { type: "ordinal", map: { web: "triangle", api: "x" } } },
      columns: [
        { field: "service", cell: symbolCell(), encode: { symbol: { field: "service" } } },
        {
          field: "id",
          id: "mapped",
          cell: symbolCell(),
          encode: { symbol: { field: "service", scale: "shapes" } },
        },
        {
          field: "ms",
          cell: symbolCell(),
          encode: {
            symbol: [{ condition: { when: col("ms").gt(35), then: "star" } }, { value: "square" }],
          },
        },
      ],
    });
    const symbols = (column: number) =>
      Array.from({ length: 6 }, (_, i) => model.cellAt(i, column).look?.symbol);
    expect(symbols(0)).toEqual(["circle", "square", "triangle", "circle", undefined, "square"]);
    // "db" has no map entry: it takes the symbol of its place, as unmapped categories do.
    expect(symbols(1)).toEqual(["triangle", "x", "triangle", "triangle", undefined, "x"]);
    expect(symbols(2)).toEqual(["square", "square", "square", "star", "square", "star"]);
  });

  it("keep a category's symbol in turn as columns change", () => {
    const data = table({
      a: category(["x", "y"]),
      b: category(["y", "x"]),
    });
    const column = (field: string) => ({
      field,
      cell: symbolCell(),
      encode: { symbol: { field } },
    });
    const { model } = grid({ columns: [column("a"), column("b")] }, data);
    expect(model.cellAt(0, 0).look?.symbol).toBe("circle");
    model.setColumns([column("b"), column("a")] as never);
    // "x" took its place first, and keeps it.
    expect(model.cellAt(0, 1).look?.symbol).toBe("circle");
    expect(model.cellAt(0, 0).look?.symbol).toBe("square");
  });

  it("refuse the symbol channel elsewhere, and names that are no symbol's", () => {
    expect(() =>
      grid({ columns: [{ field: "ms", encode: { symbol: { value: "circle" } } }] }),
    ).toThrow(
      "grid columns[0].encode.symbol: symbol cells draw shapes; give the column cell: symbolCell(), or drop symbol",
    );
    expect(() =>
      grid({
        columns: [
          { field: "ms", cell: symbolCell(), encode: { symbol: { value: "circel" as never } } },
        ],
      }),
    ).toThrow('grid columns[0].encode.symbol.value: expected a symbol: "circle", "square",');
    expect(() =>
      grid({ columns: [{ field: "ms" }], encode: { symbol: { value: "circle" } } as never }),
    ).toThrow("grid encode.symbol: symbol cells draw shapes");
  });
});

describe("links", () => {
  const linked = (text?: (string | { field: string })[]) =>
    grid({
      columns: [{ field: "id" }, { field: "url" }],
      fields: {
        url: { link: { url: [{ value: true }], ...(text && { text }) } },
      },
    }).model;

  it("give a linked cell its link, and its text as the link's", () => {
    const model = linked(["Go to ", { field: "service" }]);
    expect(model.cellAt(0, 1).link).toEqual({ url: "%2Fa", text: "Go to web" });
    expect(model.textAt(0, 1)).toBe("Go to web");
    expect(model.cellAt(0, 1).text).toBe("Go to web");
    // A row missing a value its URL reads has no link, and writes its text.
    expect(model.cellAt(3, 1).link).toBeUndefined();
    expect(model.textAt(3, 1)).toBe("");
  });

  it("never link a URL of another scheme, though values make it", () => {
    const model = grid(
      {
        columns: [{ field: "scheme" }, { field: "path" }],
        fields: {
          scheme: { link: { url: [{ value: true }, ":example.com"] } },
          path: { link: { url: [{ value: true }] } },
        },
      },
      table({
        scheme: category(["https", "javascript", "mailto"]),
        path: category(["/a", "javascript:alert(1)", " data:x"]),
      }),
    ).model;
    expect([0, 1, 2].map((row) => model.cellAt(row, 0).link?.url)).toEqual([
      "https:example.com",
      undefined,
      "mailto:example.com",
    ]);
    // A value is encoded: its own ":" never makes a scheme.
    expect([0, 1, 2].map((row) => model.cellAt(row, 1).link?.url)).toEqual([
      "%2Fa",
      "javascript%3Aalert(1)",
      "%20data%3Ax",
    ]);
    expect(model.textAt(1, 0)).toBe("javascript");
    expect(() =>
      grid({ columns: [{ field: "url" }], fields: { url: { link: { url: "javascript:x" } } } }),
    ).toThrow(
      '"javascript:x" has a scheme links do not take; give an http, https, mailto, or relative URL',
    );
  });

  it("leave columns of fields without a link as text", () => {
    const model = grid({ columns: [{ field: "url" }], fields: { url: { label: "URL" } } }).model;
    expect(model.cellAt(0, 0).link).toBeUndefined();
  });
});

describe("columns without fields", () => {
  it("write their text from literal text and fields through their displays", () => {
    const { model } = grid({
      columns: [
        { field: "id" },
        {
          id: "open",
          title: "",
          text: ["Open ", { field: "service" }, " (", { field: "ms" }, ")"],
        },
      ],
      fields: { service: { missing: "none" } },
    });
    expect(model.textAt(0, 1)).toBe("Open web (10)");
    expect(model.textAt(4, 1)).toBe("Open none (30)");
    expect(model.cellAt(0, 1)).toEqual({
      state: "empty",
      value: undefined,
      kind: null,
      text: "Open web (10)",
      look: undefined,
      link: undefined,
    });
    expect(model.columnLayout[1]).toMatchObject({ id: "open", field: null, kind: null, title: "" });
  });

  it("are titled by their id, and empty without text", () => {
    const { model } = grid({ columns: [{ id: "actions" }] });
    expect(model.columnTitle("actions")).toBe("actions");
    expect(model.textAt(0, 0)).toBe("");
  });

  it("take looks, and nothing that needs a field", () => {
    const { model } = grid({
      columns: [
        {
          id: "flag",
          encode: { fill: { condition: { when: col("ms").gt(35), then: "#ffeeee" } } },
        },
      ],
    });
    expect(model.lookAt(3, 0)).toEqual({ fill: "#ffeeee" });
    expect(() => grid({ columns: [{ title: "Open" }] })).toThrow(
      "grid columns[0]: a column without a field needs an id; give id",
    );
    for (const [key, value, problem] of [
      ["format", { number: ".1f" }, "value to format"],
      ["aggregate", "n", "aggregate"],
    ] as const)
      expect(() => grid({ columns: [{ id: "x", [key]: value }] })).toThrow(
        `grid columns[0].${key}: a column without a field has no ${problem}; drop ${key}`,
      );
    for (const cell of [barCell(), { spec: { kind: "bar" } }])
      expect(() => grid({ columns: [{ id: "x", cell }] })).toThrow(
        "grid columns[0].cell: a column without a field takes sparklineCell() alone; give a field for other cell kinds",
      );
    expect(() => grid({ columns: [{ id: "x", text: [{ field: "srvice" }] }] })).toThrow(
      'grid columns[0].text[0].field: no field "srvice" in the grid\'s table',
    );
  });

  it("refuse sorting, and write nothing on group rows", () => {
    const view = rowView(services());
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { id: "open", text: ["Open ", { field: "service" }] }],
      groups: groupRows(view, { by: ["service"] }),
    });
    models.push(model);
    expect(() => model.cycleSort("open")).toThrow(
      'grid cycleSort: column "open" has no field to sort by; sort by a field',
    );
    expect(model.textAt(0, 1)).toBe("");
  });
});

describe("remote grids", () => {
  const data = () =>
    table({
      id: Float64Array.from({ length: 200 }, (_, i) => i),
      ms: Float64Array.from({ length: 200 }, (_, i) => i % 100),
      trace: category(Array.from({ length: 200 }, (_, i) => `t${i}`)),
      host: category(Array.from({ length: 200 }, (_, i) => ["web", "api"][i % 2]!)),
    });

  function remote(options: Partial<RemoteGridModelOptions>) {
    const memory = memorySource(data(), { key: "id" });
    const asked: RowsRequest[] = [];
    const source: GridSource = {
      schema: memory.schema,
      rows(request, signal) {
        asked.push(request);
        return memory.rows(request, signal);
      },
    };
    const model = createRemoteGridModel({
      source,
      blockSize: 50,
      ...options,
    } as RemoteGridModelOptions);
    model.setViewport(800, 280);
    models.push(model);
    return { model, asked };
  }

  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("ask for the fields links, texts, and renderers read, and draw links from windows", async () => {
    const { model, asked } = remote({
      columns: [{ field: "trace" }, { id: "open", text: ["Open ", { field: "id" }] }] as never,
      fields: {
        trace: { link: { url: ["/trace/", { value: true }, "?host=", { field: "host" }] } },
      },
    });
    const asker = {};
    model.askFields(asker, [["ms", "createRemoteGrid cells.open.fields[0]"]]);
    await settle();
    expect(asked.at(-1)!.fields).toEqual(["host", "id", "ms", "trace"]);
    expect(model.cellAt(1, 0).link).toEqual({ url: "/trace/t1?host=api", text: "t1" });
    expect(model.textAt(1, 1)).toBe("Open 1");
    expect(model.rowValues(1)("ms")).toBe(1);
    expect(() =>
      model.askFields(asker, [["mss", "createRemoteGrid cells.open.fields[0]"]]),
    ).toThrow(
      'createRemoteGrid cells.open.fields[0]: no field "mss"; the source has "id", "ms", "trace", "host"',
    );
  });

  it("read missing values for renderers as local grids do: times out of range too", async () => {
    const t = table({ id: Float64Array.of(0, 1), at: time(Float64Array.of(9e15, 1000)) });
    const local = createGridModel({ data: rowView(t), columns: [{ field: "at" }] });
    models.push(local);
    const model = createRemoteGridModel({
      source: memorySource(t, { key: "id" }),
      columns: [{ field: "at" }],
    } as RemoteGridModelOptions);
    model.setViewport(800, 280);
    models.push(model);
    await settle();
    expect(model.cellAt(0, 0).state).toBe("missing");
    expect([local.rowValues(0)("at"), model.rowValues(0)("at")]).toEqual([null, null]);
    expect([local.rowValues(1)("at"), model.rowValues(1)("at")]).toEqual([1000, 1000]);
  });

  it("refuse bars without both ends, and symbols in turn", () => {
    expect(() => remote({ columns: [{ field: "ms", cell: barCell() }] as never })).toThrow(
      "remote grid columns[0].cell: a bar's ends come from every row, which a remote grid does not hold; give domain, or fields.ms min and max",
    );
    const bounded = remote({
      columns: [{ field: "ms", cell: barCell() }] as never,
      fields: { ms: { min: 0, max: 100 } },
    });
    expect(bounded.model.columnLayout).toHaveLength(1);
    expect(() =>
      remote({
        columns: [
          { field: "host", cell: symbolCell(), encode: { symbol: { field: "host" } } },
        ] as never,
      }),
    ).toThrow(
      "remote grid columns[0].encode.symbol: a remote grid's categories arrive block by block, so symbols in turn would depend on load order; name a scale of categories with a domain or a map",
    );
  });

  it("name rows by light refs, which hold no rows", async () => {
    const { model } = remote({ columns: [{ field: "id" }] as never });
    await settle();
    const ref = model.row(0).ref;
    expect(Object.keys(ref.scope as object)).toEqual(["revision"]);
    model.setQuery({ sort: [{ field: "ms", order: "descending" }] });
    await settle();
    expect(model.row(0).ref.scope).not.toBe(ref.scope);
  });
});
