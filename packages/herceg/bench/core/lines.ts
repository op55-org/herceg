// Lines' level of detail: M4 over a million points, gaps, a min-max index, time breaks, a zoomed window.

import { fromWall } from "../../src/format/zone.ts";
import { m4 } from "../../src/lod/m4.ts";
import { MinMaxIndex } from "../../src/lod/minmax-index.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import { LinearScale } from "../../src/scale/scale.ts";
import { measure, millionPoints, N } from "./shared.ts";

export async function run(): Promise<void> {
  const { x, y } = millionPoints();
  const yMap = new LinearScale([-120, 120], [400, 0]).mapping();
  const out = new Polyline();

  const full = new LinearScale([x[0]!, x[N - 1]!], [0, 800]).mapping();
  measure("m4: 1M points, 800 px at 2x", () => {
    out.reset();
    m4(x, y, 0, N, full, yMap, 2, out);
  });
  const gapped = y.map((value, i) => (i % 100 === 99 ? Number.NaN : value));
  measure("m4: 1M points with a gap every 100, 800 px at 2x", () => {
    out.reset();
    m4(x, gapped, 0, N, full, yMap, 2, out);
  });
  measure("min/max index: build over 1M points", () => {
    new MinMaxIndex(y);
  });
  const index = new MinMaxIndex(y);
  measure("m4 with index: 1M points, 800 px at 2x", () => {
    out.reset();
    m4(x, y, 0, N, full, yMap, 2, out, undefined, index);
  });
  // Minute bars of New York trading sessions, about ten years of them, on an
  // axis that leaves out nights and weekends.
  const ZONE = "America/New_York";
  const sessions = new Float64Array(N);
  for (let day = Date.UTC(2016, 0, 4), n = 0; n < N; day += 86_400_000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const open = fromWall(ZONE, day + 9.5 * 3_600_000);
    for (let m = 0; m < 390 && n < N; m++) sessions[n++] = open + m * 60_000;
  }
  const breaks = timeBreaks([{ weekdays: ["sat", "sun"] }, { hours: ["16:00", "09:30"] }]);
  measure(
    "breaks: resolve ten years in New York",
    () => {
      timeBreaks([{ weekdays: ["sat", "sun"] }, { hours: ["16:00", "09:30"] }])
        .calendar(ZONE)
        .cover(sessions[0]!, sessions[N - 1]!);
    },
    { warmup: 3, samples: 15 },
  );
  const calendar = breaks.calendar(ZONE);
  const sessionMap = calendar.scale([sessions[0]!, sessions[N - 1]!], [0, 800]).mapping();
  measure("m4 with breaks: 1M points, ~2,600 sessions, 800 px at 2x", () => {
    out.reset();
    m4(sessions, y, 0, N, sessionMap, yMap, 2, out);
  });
  measure("m4 with breaks and index: 1M points, 800 px at 2x", () => {
    out.reset();
    m4(sessions, y, 0, N, sessionMap, yMap, 2, out, undefined, index);
  });

  const zoomed = new LinearScale([x[400_000]!, x[410_000]!], [0, 800]).mapping();
  measure("m4: 10k visible of 1M, 800 px at 2x", () => {
    out.reset();
    m4(x, y, 399_999, 410_001, zoomed, yMap, 2, out);
  });
}
