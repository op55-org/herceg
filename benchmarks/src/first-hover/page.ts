// The page of the first-hover benchmark (run.ts): mounts one chart, or a
// dashboard of ten, and a set time after it mounted asks the runner for a
// trusted pointer move onto the first chart; then reports how long the
// tooltip took to show after the move arrived.

import { createChart, line, table, time } from "herceg";
import { readoutText } from "../page/adapter.ts";
import { writesFor } from "../page/expect.ts";
// Listens on the window in the capture phase: it hears the move before the chart does.
import { nextArrival } from "../page/input.ts";
import { Incorrect, watchFrames } from "../page/verify.ts";

/** ms a frame may take to show the tooltip before the sample counts as incorrect. */
const SHOWN_WITHIN_MS = 5000;

/** A sample's times, ms from the move's arrival in the page. */
export interface Sample {
  /** To the tooltip's box being shown (the frame that paints it has begun). */
  drawn: number;
  /** To the animation frame after `drawn`. */
  frame: number;
  /** To the end of the first frame whose pre-paint check saw the tooltip write the value under the pointer. */
  shown: number;
  /** Frames checked before that one. */
  rejected: number;
  /** ms from createChart returning to the move's arrival: the delay asked, then the runner's dispatch. */
  sinceMount: number;
}

declare global {
  interface Window {
    firstHover: {
      /**
       * Mounts the charts and resolves `delay` ms after createChart returned,
       * with where the runner should move the pointer.
       */
      mount(options: { delay: number; charts: number }): Promise<{ x: number; y: number }>;
      /** The times of the move the runner sent after `mount`, once its tooltip showed. */
      result(): Promise<Sample | { error: string }>;
      /** Mounts a chart and waits for what it loads: an earlier visit, which caches the chunks. */
      warm(): Promise<void>;
    };
  }
}

const N = 1440;
const START = Date.UTC(2026, 0, 1);
const xs = Float64Array.from({ length: N }, (_, i) => START + i * 60_000);
const as = Float64Array.from({ length: N }, (_, i) => 50 + 20 * Math.sin(i / 60));

/** A day of minutes, two series. */
function minutes() {
  return table({
    t: time(xs),
    a: as,
    b: Float64Array.from({ length: N }, (_, i) => 40 + 15 * Math.cos(i / 45)),
  });
}

const tooltipOf = (root: Element) =>
  [...root.children].find(
    (el) => el.tagName === "DIV" && (el as HTMLElement).style.pointerEvents === "none",
  ) as HTMLElement | undefined;

let pending: Promise<Sample | { error: string }> | undefined;

window.firstHover = {
  async warm() {
    const host = document.createElement("div");
    host.style.cssText = "width:600px;height:300px";
    document.getElementById("stage")!.append(host);
    const chart = createChart(host, { marks: [line(minutes(), { x: "t", y: ["a", "b"] })] });
    await chart.loading;
    chart.destroy();
    host.remove();
  },

  async mount({ delay, charts }) {
    const stage = document.getElementById("stage")!;
    const hosts = Array.from({ length: charts }, () => {
      const host = document.createElement("div");
      host.style.cssText = "width:600px;height:300px;display:inline-block";
      stage.append(host);
      return host;
    });
    const data = minutes();
    const created = hosts.map((host) =>
      createChart(host, { marks: [line(data, { x: "t", y: ["a", "b"] })], timeZone: "UTC" }),
    );
    // The delay runs from createChart returning (the last chart's).
    const mounted = performance.now();
    const chart = created[0]!;
    const rect = chart.root.getBoundingClientRect();
    const panel = chart.getPanels()[0]!;
    const target = {
      x: rect.left + panel.plot.x + panel.plot.width / 2,
      y: rect.top + panel.plot.y + panel.plot.height / 2,
    };
    // Series a's values within 1.5 CSS px of the pointer's x, by the plot's x domain.
    const [x0, x1] = panel.x!.domain;
    const perPixel = (x1 - x0) / panel.plot.width;
    const atX = x0 + (target.x - rect.left - panel.plot.x) * perPixel;
    const near: number[] = [];
    for (let i = 0; i < N; i++) if (Math.abs(xs[i]! - atX) <= 1.5 * perPixel) near.push(as[i]!);
    const check = () => {
      const tooltip = tooltipOf(chart.root);
      if (tooltip?.style.display !== "block") return "no tooltip shown";
      const text = readoutText(tooltip);
      return near.some((value) => writesFor({ text }, "a", value))
        ? undefined
        : `the tooltip "${text}" writes no value of series a under the pointer`;
    };
    pending = (async () => {
      const arrival = await nextArrival(
        (a) =>
          a.type === "pointermove" &&
          Math.abs(a.x - target.x) <= 1 &&
          Math.abs(a.y - target.y) <= 1,
      );
      const input = arrival.at;
      /** The animation frame the tooltip's box was shown in (`document.timeline` moves on each frame). */
      let drawnFrame: CSSNumberish | null | undefined;
      const drawn = new Promise<[number, number]>((resolve) => {
        const observer = new MutationObserver(() => {
          if (tooltipOf(chart.root)?.style.display !== "block") return;
          observer.disconnect();
          drawnFrame = document.timeline.currentTime;
          const at = performance.now() - input;
          requestAnimationFrame(() => resolve([at, performance.now() - input]));
        });
        observer.observe(chart.root, { subtree: true, childList: true, attributes: true });
      });
      try {
        // Frames are watched once the chart has what it loads, its
        // interaction controller among it, so no frame can show the tooltip
        // before: watching every frame from the move's arrival would draw
        // frames back to back while that code loads, which delays it (by
        // 13-19 ms at 0 ms, cold or slow). Should a frame have come since
        // the tooltip was drawn, the watch would credit a later one.
        await chart.loading;
        if (drawnFrame !== undefined && document.timeline.currentTime !== drawnFrame)
          return { error: "a frame showed the tooltip before its frames were watched" };
        const verified = await watchFrames(input, check, () => true, SHOWN_WITHIN_MS).shown;
        const [drawnAt, frame] = await drawn;
        return {
          drawn: drawnAt,
          frame,
          shown: verified.time,
          rejected: verified.rejected,
          sinceMount: input - mounted,
        };
      } catch (error) {
        if (error instanceof Incorrect) return { error: `incorrect: ${error.message}` };
        throw error;
      }
    })();
    // Input a set time after mounting, whatever has loaded by then.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, mounted + delay - performance.now())),
    );
    return target;
  },

  result() {
    if (!pending) throw new Error("first-hover: result() before mount()");
    return pending;
  },
};
