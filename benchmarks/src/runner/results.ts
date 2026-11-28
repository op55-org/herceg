// How a page's result is recorded, for every runner of the chart suite
// (run.ts, device/run.ts): its status, a mount that failed, and the
// readings of extra passes joined to the main run's.

import type { Mounted, PageResult } from "../page/harness.ts";

/**
 * A row's status: measured; unsupported (the library has no such chart or
 * path); incorrect (no frame showed what was asked, so nothing is timed);
 * error (the page, the browser, or the driver failed).
 */
export type Status = "measured" | "unsupported" | "incorrect" | "error";

export function statusOf(result: PageResult): Status {
  if (result.supported) return "measured";
  if (result.incorrect || /^incorrect\b/i.test(result.reason ?? "")) return "incorrect";
  if (result.reason?.startsWith("error")) return "error";
  return "unsupported";
}

/** The result of a scenario whose charts did not mount: unsupported, or incorrect. */
export function notMounted(mounted: Mounted): PageResult {
  return {
    supported: false,
    ...(mounted.incorrect && { incorrect: true }),
    ...(mounted.reason !== undefined && { reason: mounted.reason }),
    metrics: {},
  };
}

/**
 * The main result with the readings of the extra passes run after it (each
 * in a page of its own; the list ends at the first that did not measure),
 * all of them or none: a pass found incorrect makes the row incorrect, with
 * no readings at all; one that failed otherwise leaves the main result as
 * it was, with its reason as the full-cost reason.
 */
export function withPasses(
  main: PageResult,
  passes: PageResult[],
): { result: PageResult; fullCostReason?: string } {
  const gathered: Record<string, PageResult["metrics"][string]> = {};
  for (const pass of passes) {
    if (statusOf(pass) === "incorrect") return { result: { ...pass, metrics: {} } };
    if (!pass.supported)
      return { result: main, fullCostReason: pass.reason ?? "error: the pass failed" };
    for (const [name, metric] of Object.entries(pass.metrics)) {
      const kept = gathered[name];
      if (kept) kept.samples.push(...metric.samples);
      else gathered[name] = { ...metric, samples: [...metric.samples] };
    }
  }
  const metrics = { ...main.metrics };
  for (const [name, metric] of Object.entries(gathered)) {
    const kept = metrics[name];
    metrics[name] = kept ? { ...kept, samples: [...kept.samples, ...metric.samples] } : metric;
  }
  return { result: { ...main, metrics } };
}
