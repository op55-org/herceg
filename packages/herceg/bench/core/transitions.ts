// Value transitions: copying, planning, and a frame half way.

import { category } from "../../src/data/column.ts";
import { type Table, table } from "../../src/data/table.ts";
import { keepCustom } from "../../src/dom/value-custom.ts";
import {
  followedOf,
  frameAt,
  MOVING_ITEMS,
  plan,
  positionsOf,
  sidesOf,
  snapshot,
} from "../../src/dom/value-transition.ts";
import { estimateText, type MeasureText, shapeOf } from "../../src/layout/text.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { bar } from "../../src/marks/bar.ts";
import { monotonePolyline } from "../../src/marks/curve.ts";
import { custom } from "../../src/marks/custom.ts";
import { point } from "../../src/marks/point.ts";
import { text } from "../../src/marks/text.ts";
import { planAxis } from "../../src/model/axis.ts";
import { axisGuide } from "../../src/model/axis-guide.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { cometPath, measure, pageMeasurer } from "./shared.ts";

export async function run(): Promise<void> {
  // Value transitions (`animation.values`): copying what a scene shows, planning
  // the change to the next scene, and a frame half way, for 2,000 bars, 10,000
  // keyed points, A2's comets (custom marks, which keep their declared fields
  // and draw again each frame): 300 on a band y and 2,000 on two number axes,
  // a fifth of their ends moving, B6's 12 bars whose labels of parts count,
  // and 200 text labels counting one number each or two parts.
  {
    const transition = (
      name: string,
      model: ChartModel,
      edit: (forth: boolean) => void,
      height = 640,
      measureText: MeasureText = estimateText,
      across = false,
    ) => {
      const builders = {
        planAxis,
        axisGuide,
        Polyline,
        monotonePolyline,
        measure: measureText,
        shapeOf,
      };
      model.setSize(960, height, 1);
      const drawn = model.scene(measureText);
      const copy = () => {
        const shown = snapshot(drawn, model.panels(), 0)!;
        shown.custom = keepCustom(drawn, undefined, MOVING_ITEMS);
        return shown;
      };
      measure(`value transition, ${name}: copy what is shown`, copy);
      const shown = copy();
      edit(true);
      const next = model.scene(measureText);
      const { config } = model;
      const planned = () =>
        plan(
          shown,
          next,
          model.panels(),
          250,
          builders,
          sidesOf(config),
          followedOf(config),
          positionsOf(config),
        );
      measure(`value transition, ${name}: plan`, planned, { warmup: 10, samples: 40 });
      const tween = planned()!;
      // Each sample a frame at another time, as frames are: their values are
      // written anew; `across` the change, each at a time of its own, so that
      // every frame writes numbers none wrote before.
      let frames = 0;
      measure(
        `value transition, ${name}: ${across ? "frames across it" : "frame half way"}`,
        () => frameAt(tween, across ? 2 + ((frames++ * 37) % 246) : 124 + (frames++ % 3)),
        {
          warmup: 10,
          samples: 40,
        },
      );
      edit(false);
    };
    const animating = (config: Omit<ChartConfig, "locale">) =>
      new ChartModel(
        { locale: "en-US", animation: { values: true }, ...config },
        undefined,
        staticCompilers(),
      );
    /** Writes `v` flipped, and back. */
    const swapped = (data: Table, flip: (v: number) => number) => {
      const back = Float64Array.from(data.numbers("v"));
      const forth = back.map(flip);
      return (on: boolean) => data.setColumn("v", on ? forth : back);
    };
    const bars = table({
      x: Float64Array.from({ length: 2000 }, (_, i) => i),
      v: Float64Array.from({ length: 2000 }, (_, i) => 10 + (i % 17)),
    });
    transition(
      "2,000 bars",
      animating({ marks: [bar(bars, { x: "x", y: "v" })], y: { domain: [0, 40] } }),
      swapped(bars as unknown as Table, (v) => 40 - v),
    );
    const dots = table({
      id: Float64Array.from({ length: 10_000 }, (_, i) => i),
      x: Float64Array.from({ length: 10_000 }, (_, i) => (i * 7919) % 1000),
      v: Float64Array.from({ length: 10_000 }, (_, i) => (i * 104729) % 1000),
    });
    transition(
      "10,000 keyed points",
      animating({
        marks: [point(dots, { x: "x", y: "v", itemKey: "id" })],
        x: { domain: [0, 1000] },
        y: { domain: [0, 1000] },
      }),
      swapped(dots as unknown as Table, (v) => 1000 - v),
    );
    for (const length of [300, 2000]) {
      const scatter = length > 300;
      const rows = table({
        id: Array.from({ length }, (_, i) => `F-${i}`),
        x0: Float64Array.from({ length }, (_, i) => (i * 37) % 100),
        y0: Float64Array.from({ length }, (_, i) => (i * 53) % 100),
        x1: Float64Array.from({ length }, (_, i) => (i * 37 + 20) % 100),
        y1: Float64Array.from({ length }, (_, i) => (i * 53 + 30) % 100),
        confidence: Float64Array.from({ length }, (_, i) => (i % 10) / 10),
        age: Float64Array.from({ length }, (_, i) => i % 30),
        kind: category(Array.from({ length }, (_, i) => ["energy", "metals", "grains"][i % 3]!)),
      });
      const ends = Float64Array.from(rows.numbers("x1"));
      const moved = ends.map((v, i) => (i % 5 === 0 ? (v + 40) % 100 : v));
      const model = animating({
        x: { domain: [0, 100] },
        ...(scatter && { y: { domain: [0, 100] } }),
        scales: {
          widths: { type: "linear", domain: [0, 1], range: [2, 7] },
          fade: { type: "linear", domain: [0, 30], range: [1, 0.35] },
        },
        marks: [
          custom(rows, {
            x: ["x0", "x1"],
            y: scatter ? ["y0", "y1"] : "id",
            series: "kind",
            itemKey: "id",
            encode: {
              strokeWidth: { field: "confidence", scale: "widths" },
              opacity: { field: "age", scale: "fade" },
            },
            draw({ table: t, series, x, y, item, path, circle, encoded }) {
              const [bx, by] = [t.numbers("x1"), t.numbers("y1")];
              for (const s of series)
                for (let k = 0; k < s.length; k++) {
                  const row = s.rowAt(k);
                  const [sx, sy] = [x(s.x[row]!), y(s.y[row]!)];
                  const ey = scatter ? y(by[row]!) : sy;
                  const style = { fill: s.color, opacity: encoded("opacity", row) };
                  item(s, row, () => {
                    path(
                      cometPath(sx, sy, x(bx[row]!), ey, encoded("strokeWidth", row) ?? 2),
                      style,
                    );
                    circle(sx, sy, 3, style);
                  });
                }
            },
          }),
        ],
      });
      // 300 lanes on a band y, as A2 draws them, or a scatter.
      transition(
        `A2, ${length.toLocaleString("en-US")} comets`,
        model,
        (on) => rows.setColumn("x1", on ? moved : ends),
        scatter ? 640 : 3100,
      );
    }
    // B6's race: 12 bars keyed by brand on ranks, each labeled by its brand
    // above its value, which counts. Text is measured as a page's canvas
    // measurer does (`pageMeasurer`), so frames pay for what they measure anew.
    const brands = table({
      brand: category(Array.from({ length: 12 }, (_, i) => `Brand ${String.fromCharCode(65 + i)}`)),
      rank: Float64Array.from({ length: 12 }, (_, i) => i),
      v: Float64Array.from({ length: 12 }, (_, i) => 60_000 - i * 3_917.3),
    });
    const page = pageMeasurer();
    transition(
      "12 bars' counting labels of parts",
      animating({
        marks: [
          bar(brands, {
            itemKey: "brand",
            orient: "y",
            x: "v",
            y: "rank",
            labels: {
              content: [
                { field: "brand", style: { fontWeight: 700 } },
                "\n",
                { value: true, format: { number: ",.0f" }, style: { opacity: 0.7 } },
              ],
              place: { outside: false },
              style: { fontSize: 12, align: "end", halo: false },
            },
          }),
        ],
        x: { nice: false },
        y: { domain: [11.5, -0.5], show: false },
      }),
      swapped(brands as unknown as Table, (v) => v * 1.37 + 2_711),
      600,
      page,
      true,
    );
    // 200 text labels counting their values as they move, start-aligned, the
    // last fifth by the chart's right edge: frames keep them inside it.
    const counted = table({
      id: category(Array.from({ length: 200 }, (_, i) => `n${i}`)),
      x: Float64Array.from({ length: 200 }, (_, i) => i),
      v: Float64Array.from({ length: 200 }, (_, i) => 100 + ((i * 37) % 1700)),
    });
    transition(
      "200 counting text labels",
      animating({
        marks: [
          text(counted, {
            x: "x",
            y: "v",
            itemKey: "id",
            label: { field: "v", format: { number: ",.2f" }, style: { align: "start" } },
          }),
        ],
        x: { domain: [0, 200] },
        y: { domain: [0, 2000] },
      }),
      swapped(counted as unknown as Table, (v) => 1900 - v * 0.93),
      640,
      page,
      true,
    );
    // The same 200 labels made of parts: their name in bold, then two
    // numbers counting together, each in its format and the second in a look
    // of its own, aligned to their end.
    const shares = table({
      id: category(Array.from({ length: 200 }, (_, i) => `n${i}`)),
      x: Float64Array.from({ length: 200 }, (_, i) => i),
      v: Float64Array.from({ length: 200 }, (_, i) => 100 + ((i * 37) % 1700)),
      share: Float64Array.from({ length: 200 }, (_, i) => ((i * 53) % 100) / 100),
    });
    transition(
      "200 text labels of two counting parts",
      animating({
        marks: [
          text(shares, {
            x: "x",
            y: "v",
            itemKey: "id",
            label: {
              content: [
                { field: "id", style: { fontWeight: 700 } },
                " ",
                { field: "v", format: { number: ",.2f" } },
                " · ",
                { field: "share", format: { number: ".1%" }, style: { opacity: 0.7 } },
              ],
              style: { align: "end" },
            },
          }),
        ],
        x: { domain: [0, 200] },
        y: { domain: [0, 2000] },
      }),
      (() => {
        const v = swapped(shares as unknown as Table, (v) => 1900 - v * 0.93);
        const back = Float64Array.from(shares.numbers("share"));
        const forth = back.map((s) => 1 - s * 0.9);
        return (on: boolean) => {
          v(on);
          shares.setColumn("share", on ? forth : back);
        };
      })(),
      640,
      page,
      true,
    );
  }
}
