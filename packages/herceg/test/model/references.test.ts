// What keys name as references name them (`referenceOf`, marks/mark.ts),
// and what a legend entry stands for (`legendMembers`), which a
// chart's legend entries and legend targets give as references.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { graph } from "../../src/marks/graph.ts";
import { line } from "../../src/marks/line.ts";
import { referenceOf } from "../../src/marks/mark.ts";
import { pie } from "../../src/marks/pie.ts";
import { legendMembers } from "../../src/model/legend.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { NO_PAGE } from "../../src/render/fallbacks.ts";

const marks = [{ spec: { id: "lines" } }, { spec: {} }, { spec: { id: "bins" } }];

describe("referenceOf", () => {
  it("names a series key's mark and source, and an item key's mark and parts", () => {
    expect(referenceOf("series", '["lines","auth"]', marks)).toEqual({
      mark: "lines",
      series: "auth",
    });
    expect(referenceOf("item", '["lines","auth",1767225600000]', marks)).toEqual({
      mark: "lines",
      item: ["auth", 1767225600000],
    });
    // A row without an item key, by its identity; a bin by its interval; a missing name.
    expect(referenceOf("item", '["lines","row",3,0,1042]', marks)).toEqual({
      mark: "lines",
      item: ["row", 3, 0, 1042],
    });
    expect(referenceOf("item", '["bins",[0,10]]', marks)).toEqual({
      mark: "bins",
      item: [[0, 10]],
    });
    expect(referenceOf("item", '["bins",null]', marks)).toEqual({ mark: "bins", item: [null] });
  });

  it("reads a key that is a series' and an item's alike as the kind the caller says", () => {
    // A wide line's series "auth" and a bar's item keyed "auth" write the same text.
    const key = '["lines","auth"]';
    expect(referenceOf("series", key, marks)).toEqual({ mark: "lines", series: "auth" });
    expect(referenceOf("item", key, marks)).toEqual({ mark: "lines", item: ["auth"] });
    // An item key of more parts is no series key.
    expect(referenceOf("series", '["lines","auth",3]', marks)).toBeUndefined();
  });

  it("gives nothing for keys of marks without an id, of no mark, groups, and other text", () => {
    for (const key of [
      '[1,"auth"]',
      '["gone","auth"]',
      '{"mark":"lines","nodes":["a"]}',
      '["lines"]',
      "not json",
      "",
    ]) {
      expect(referenceOf("series", key, marks), key).toBeUndefined();
      expect(referenceOf("item", key, marks), key).toBeUndefined();
    }
    expect(referenceOf("series", 3 as unknown as string, marks)).toBeUndefined();
  });
});

describe("legend members", () => {
  function drawn(config: ChartConfig) {
    const model = new ChartModel(
      { locale: "en-US", timeZone: "UTC", ...config },
      NO_PAGE,
      staticCompilers(),
    );
    model.setSize(600, 400, 1);
    model.scene(estimateText);
    return model;
  }
  /** What each legend entry stands for, as references. */
  const references = (model: ChartModel) =>
    model.legendEntries().map(({ key }) => {
      const { series, items } = legendMembers(
        model.hidden,
        [key],
        model.series().map((s) => s.key),
      );
      const { marks } = model.config;
      return [
        ...series.map((s) => referenceOf("series", s, marks)),
        ...items.map((i) => referenceOf("item", i, marks)),
      ].filter((reference) => reference !== undefined);
    });

  it("lists every series of an identity a line and an area share, and none of marks without an id", () => {
    const latency = table({ t: [0, 1], p50: [1, 2], p99: [3, 4] });
    const model = drawn({
      marks: [
        area(latency, { id: "band", x: "t", y: "p50" }),
        line(latency, { id: "lines", x: "t", y: ["p50", "p99"] }),
        line(latency, { x: "t", y: "p99" }),
      ],
    });
    expect(model.legendEntries().map(({ label }) => label)).toEqual(["p50", "p99"]);
    expect(references(model)).toEqual([
      [
        { mark: "band", series: "p50" },
        { mark: "lines", series: "p50" },
      ],
      [{ mark: "lines", series: "p99" }],
    ]);
  });

  it("lists a pie's slices as items, a series field's series by their values, and no network group", () => {
    const sales = table({ brand: ["Coca-Cola", "Pepsi"], units: [3, 2] });
    expect(
      references(
        drawn({ marks: [pie(sales, { id: "brands", category: "brand", value: "units" })] }),
      ),
    ).toEqual([[{ mark: "brands", item: ["Coca-Cola"] }], [{ mark: "brands", item: ["Pepsi"] }]]);
    const long = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], host: ["a", "a", "b", "b"] });
    expect(
      references(drawn({ marks: [line(long, { id: "hosts", x: "t", y: "v", series: "host" })] })),
    ).toEqual([[{ mark: "hosts", series: "a" }], [{ mark: "hosts", series: "b" }]]);
    const links = table({ from: ["a", "b"], to: ["b", "c"] });
    const people = table({ name: ["a", "b", "c"], team: ["x", "y", "y"] });
    const network = drawn({
      marks: [
        graph(links, {
          id: "net",
          source: "from",
          target: "to",
          nodes: people,
          node: "name",
          color: "team",
        }),
      ],
    });
    expect(network.legendEntries().length).toBeGreaterThan(0);
    for (const entry of references(network)) expect(entry).toEqual([]);
  });
});
