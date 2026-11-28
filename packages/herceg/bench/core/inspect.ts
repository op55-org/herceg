// Inspection along an axis: readings walking outward from the pointer's value.

import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { ChartModel } from "../../src/model/model.ts";
import { measure, N } from "./shared.ts";

export async function run(): Promise<void> {
  // Inspection along an axis (model/inspect.ts): readings walk outward from
  // the drawn points either side of the pointer's value while points may tie
  // (within a ten-thousandth of the nearer distance), at most 1,024 drawn
  // points each way and 1,024 in a row not drawn. Ordinary data hands on one
  // to three points; the other cases are the walk's bounds. Each reading's
  // rows visited are counted once, apart from the timing.
  {
    const reader = (x: Float64Array, v: Float64Array, domain?: [number, number]) => {
      const model = new ChartModel({
        locale: "en-US",
        marks: [line(table({ x, v }), { x: "x", y: "v" })],
        ...(domain && { x: { domain, nice: false } }),
        inspection: { mode: "nearest-x", snap: "each" },
      });
      model.setSize(1000, 400, 1);
      model.scene(estimateText);
      const inspector = model.inspectorOf("")!;
      const { plot } = inspector.frame;
      const y = plot.y + plot.height / 2;
      return { model, inspector, plot, read: (px: number) => model.inspect(px, y) };
    };
    /** Rows the readings at `places` check for being drawn, on average. */
    const visits = (case_: ReturnType<typeof reader>, places: readonly number[]) => {
      const { inspector } = case_;
      const drawn = inspector.drawn.bind(inspector);
      let rows = 0;
      inspector.drawn = (s, row) => {
        rows++;
        return drawn(s, row);
      };
      for (const px of places) case_.read(px);
      inspector.drawn = drawn;
      return rows / places.length;
    };
    const cases: [string, ReturnType<typeof reader>, number[]][] = [];
    // A million sorted points, read at 100 places.
    {
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const c = reader(
        x,
        Float64Array.from(x, (i) => Math.sin(i / 1000)),
      );
      const places = Array.from(
        { length: 100 },
        (_, i) => c.plot.x + ((i + 0.37) / 100) * c.plot.width,
      );
      cases.push(["inspect: 1M sorted points, 100 places", c, places]);
    }
    // A million points within 0.1 px, the pointer 1,000 px from them: all tie.
    {
      const x = Float64Array.from({ length: N }, (_, i) => i * 5e-11);
      const c = reader(x, new Float64Array(N).fill(1), [0, 1]);
      cases.push(["inspect: 1M points within 0.1 px, one place", c, [c.plot.x + c.plot.width]]);
    }
    // 2,000 points not drawn between two drawn ones, past a walk's 1,024.
    {
      const n = 2002;
      const x = Float64Array.from({ length: n }, (_, i) => i / (n - 1));
      const v = Float64Array.from({ length: n }, (_, i) =>
        i === 0 || i === n - 1 ? 1 : Number.NaN,
      );
      const c = reader(x, v, [0, 1]);
      cases.push([
        "inspect: 2,000 points not drawn in a row, one place",
        c,
        [c.plot.x + c.plot.width * 0.4],
      ]);
    }
    // The walk's worst case: 1,024 drawn points each after 1,023 not drawn,
    // all within the band (0.1 px, the pointer 1,000 px off).
    {
      const n = 1024 * 1024;
      const x = Float64Array.from({ length: n }, (_, i) => i * 5e-11);
      const v = Float64Array.from({ length: n }, (_, i) => (i % 1024 === 1023 ? 1 : Number.NaN));
      const c = reader(x, v, [0, 1]);
      cases.push([
        "inspect: 1,024 drawn, each after 1,023 not, one place",
        c,
        [c.plot.x + c.plot.width],
      ]);
    }
    for (const [name, c, places] of cases) {
      measure(
        name,
        () => {
          for (const px of places) c.read(px);
        },
        { warmup: 5, samples: 30, repeat: Math.max(1, Math.round(100 / places.length)) },
      );
      console.log(`${"  rows visited a reading".padEnd(48)} ${visits(c, places).toFixed(1)}`);
    }
  }
}
