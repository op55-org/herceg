// Swarm layouts: laid out from scratch, and a chart's swarm laid out again as it zooms.

import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { point } from "../../src/marks/point.ts";
import { packSwarm } from "../../src/marks/swarm.ts";
import { ChartModel } from "../../src/model/model.ts";
import { measure, seeded } from "./shared.ts";

export async function run(): Promise<void> {
  const random = seeded(8);
  // Swarm layout: normally distributed values in one band 80 pixels wide over
  // a 300-pixel plot, points of radius 2.5, laid out from scratch; and a
  // chart's scene of a swarm over four bands, as zooming lays it out again.
  const normal = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  for (const n of [1000, 10_000, 100_000]) {
    const pixels = Float64Array.from({ length: n }, () => 150 + 40 * normal()).sort();
    const radii = new Float64Array(n).fill(2.5);
    const offsets = new Float64Array(n);
    measure(
      `swarm: pack ${n.toLocaleString("en-US")} points in one band`,
      () => {
        packSwarm(pixels, radii, 0, n, 80, offsets);
      },
      { warmup: 3, samples: n >= 100_000 ? 5 : 20 },
    );
  }
  for (const n of [1000, 10_000, 100_000]) {
    const days = ["thu", "fri", "sat", "sun"];
    const swarmed = new ChartModel({
      marks: [
        point(
          table({
            day: Array.from({ length: n }, (_, i) => days[i % 4]!),
            v: Float64Array.from({ length: n }, normal),
          }),
          { x: "day", y: "v", swarm: true },
        ),
      ],
    });
    swarmed.setSize(800, 400, 1);
    let zoom = 0;
    measure(
      `swarm: scene of ${n.toLocaleString("en-US")} points in 4 bands, zoomed`,
      () => {
        const spread = 3 + (zoom++ % 2);
        swarmed.applyViews(swarmed.viewChanges({ y: [-spread, spread] }));
        swarmed.scene(estimateText);
      },
      { warmup: 2, samples: n >= 100_000 ? 5 : 15 },
    );
  }
}
