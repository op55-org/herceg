// Stacks of layers over rolling windows: rows, positions, unions, and shares.

import { col } from "../../src/data/expr.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { PositionStack } from "../../src/marks/position-stack.ts";
import { SplitRows } from "../../src/marks/split.ts";
import { RowStack } from "../../src/marks/stack.ts";
import { UnionStack } from "../../src/marks/union-stack.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { measure, millionPoints, N } from "./shared.ts";

export async function run(): Promise<void> {
  const { x, y } = millionPoints();
  // Five stacked layers over a million-row window, 10,000 rows per tick.
  const layers = ["a", "b", "c", "d", "e"];
  const stacked = table(
    Object.fromEntries([["t", x], ...layers.map((name, l) => [name, y.map((v) => v + l)])]),
    { maxRows: N },
  );
  const stack = new RowStack("sum");
  const update = () =>
    stack.update(
      stacked,
      layers.map((name) => stacked.numbers(name)),
      "11111",
    );
  update();
  let tick = N;
  measure("stack: 5 layers, append 10,000 rows, 1M window", () => {
    const t = Float64Array.from({ length: 10_000 }, (_, i) => tick + i);
    const v = t.map((value) => Math.sin(value / 1000));
    stacked.append(Object.fromEntries([["t", t], ...layers.map((name) => [name, v])]));
    tick += 10_000;
    update();
  });
  // Ten series of a category field, 10,000 positions in a rolling window, one
  // position (a row per series) appended per tick: bars stacked at positions,
  // areas on the union of the series' x.
  const SERIES = 10;
  const POSITIONS = 10_000;
  const positionRows = (from: number, count: number) => {
    const t = new Float64Array(count * SERIES);
    const v = new Float64Array(count * SERIES);
    const s: string[] = [];
    for (let p = 0; p < count; p++)
      for (let k = 0; k < SERIES; k++) {
        t[p * SERIES + k] = from + p;
        v[p * SERIES + k] = 1 + (((from + p) * 7 + k * 13) % 17);
        s.push(`s${k}`);
      }
    return { t, v, s };
  };
  const long = table(positionRows(0, POSITIONS), { maxRows: POSITIONS * SERIES });
  // Grouped as charts group a streaming table's rows, which the times include.
  const split = new SplitRows(long as unknown as Table, "s", "t");
  const groupsOf = () => split.groups().map(({ name, rows }) => ({ name, rows, shown: true }));
  const bars = new PositionStack();
  const areas = new UnionStack();
  const stackSeries = (layers = groupsOf()) => {
    bars.update(long, long.numbers("t"), long.numbers("v"), layers, false, undefined);
    areas.update(long, long.numbers("t"), long.numbers("v"), layers, {
      gaps: "zero",
      support: "union",
    });
  };
  stackSeries();
  let position = POSITIONS;
  const appendPosition = () => {
    long.append(positionRows(position++, 1));
    return groupsOf();
  };
  measure("stack: bars of 10 series, append a position, 100k rows", () => {
    const layers = appendPosition();
    bars.update(long, long.numbers("t"), long.numbers("v"), layers, false, undefined);
  });
  measure("stack: areas of 10 series, append a position, 100k rows", () => {
    const layers = appendPosition();
    areas.update(long, long.numbers("t"), long.numbers("v"), layers, {
      gaps: "zero",
      support: "union",
    });
  });
  measure("stack: bars of 10 series, 100k rows again", () => {
    long.set("v", 0, long.numbers("v")[0]! + 1);
    bars.update(long, long.numbers("t"), long.numbers("v"), groupsOf(), false, undefined);
  });
  measure("stack: areas of 10 series, 100k rows again", () => {
    long.set("v", 0, long.numbers("v")[0]! + 1);
    areas.update(long, long.numbers("t"), long.numbers("v"), groupsOf(), {
      gaps: "zero",
      support: "union",
    });
  });
  // A chart's shares stack of three fields over a 100k window, 100 rows a
  // tick: without `where`, with one keeping every row (stacked as without),
  // and with one leaving rows out, whose offsets take the rows it keeps anew.
  const shareRows = (from: number, count: number) => {
    const t = Float64Array.from({ length: count }, (_, i) => from + i);
    return { t, a: t.map((v) => 1 + (v % 7)), b: t.map((v) => 2 + (v % 5)), c: t.map(() => 3) };
  };
  for (const [name, where] of [
    ["without where", undefined],
    ["where keeping every row", col("a").ge(0)],
    ["where leaving 100 rows in 10,000 out", col("t").mod(10_000).ge(100)],
  ] as const) {
    const shares = table(shareRows(0, 100_000), { maxRows: 100_000 });
    const model = new ChartModel(
      {
        legend: false,
        marks: [
          area(shares, {
            x: "t",
            y: ["a", "b", "c"],
            series: false,
            stack: { offset: "fill" },
            ...(where && { where }),
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.setSize(1100, 400, 1);
    model.scene(estimateText);
    let at = 100_000;
    measure(`stack: a chart's shares of 3 fields, ${name}, append 100 rows, 100k window`, () => {
      shares.append(shareRows(at, 100));
      at += 100;
      model.scene(estimateText);
    });
  }
}
