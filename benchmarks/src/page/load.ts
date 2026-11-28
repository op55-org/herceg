// A load run: the page opened to time one chart from navigation to its
// first verified frame, run by the page itself as soon as the bundle has
// been evaluated, so no driver round trip stands between the steps. The
// runner opens it cold (an empty cache), with its assets cached, and
// through a throttled server (runner/run.ts, "Loads").

import type { Scenario } from "../scenarios/index.ts";
import type { Adapter } from "./adapter.ts";
import { mounted } from "./expect.ts";
import { box, kindFor, makeData, optionsFor } from "./fixtures.ts";
import { verifiedOperation } from "./verify.ts";

/** What a load took, in ms since navigation started (`performance.timeOrigin`). */
export interface LoadResult {
  /** Navigation to the first frame showing the chart: the wall-clock time a visitor waits. */
  loadToFrame: number;
  /** Navigation to the bundle (the library and the harness) evaluated. */
  evaluated: number;
  /** Making the data in the page (the harness's work, not the library's). */
  fixture: number;
  /** `create` to the first frame showing the chart. */
  createToFrame: number;
  /** What the page fetched: per resource, bytes on the wire (0 from the cache) and decoded. */
  resources: {
    name: string;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  }[];
}

export async function runLoad(
  adapter: Adapter,
  s: Scenario,
  evaluated: number,
): Promise<LoadResult> {
  const kind = kindFor(adapter, s);
  if (!kind) throw new Error(`${adapter.id} has no built-in ${s.chart} chart`);
  const fixtureStart = performance.now();
  const data = makeData(s, 1);
  const fixture = performance.now() - fixtureStart;
  const options = optionsFor(s);
  const container = box(options.width, options.height);
  let handle: Awaited<ReturnType<typeof kind.create>> | undefined;
  const verified = await verifiedOperation(
    async () => {
      handle = await kind.create(container, data, options);
    },
    () => (handle ? mounted(handle.drawn(), s.chart, data, options) : "not created yet"),
    () => handle?.rendered?.(),
  );
  const entries = [
    ...performance.getEntriesByType("navigation"),
    ...performance.getEntriesByType("resource"),
  ] as PerformanceResourceTiming[];
  return {
    loadToFrame: verified.start + verified.time,
    evaluated,
    fixture,
    createToFrame: verified.time,
    resources: entries.map((entry) => ({
      name: new URL(entry.name).pathname,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    })),
  };
}
