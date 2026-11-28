// Run from the repo root:
//   node --experimental-strip-types benchmarks/src/layouts/run.ts --out PATH [--order-seed N]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright";
import { HERCEG_ALIAS } from "../runner/build.ts";
import { commit, machine, packageVersion } from "../runner/environment.ts";
import { driverFor } from "../runner/input.ts";
import { orderSeed, schedule } from "../runner/order.ts";
import type { Sample, Shape } from "./page.ts";

const { values } = parseArgs({
  options: { out: { type: "string" }, "order-seed": { type: "string" } },
});
const seed = orderSeed(values["order-seed"]);
/** Verified moves after the work moves, to the first targets. */
const SHOWN_MOVES = 30;
if (!values.out) throw new Error("--out: expected a result path; give --out PATH");
const output = resolve(values.out);
const directory = mkdtempSync(join(dirname(output), "layouts-"));
await build({
  entryPoints: [join(import.meta.dirname, "page.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: join(directory, "page.js"),
  alias: HERCEG_ALIAS,
  define: { "process.env.NODE_ENV": '"production"' },
});
const server = createServer((request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader(
    "Content-Type",
    request.url === "/page.js" ? "application/javascript" : "text/html",
  );
  response.end(
    request.url === "/page.js"
      ? readFileSync(join(directory, "page.js"))
      : '<div id="chart" style="width:1000px;height:600px"></div><script type="module" src="/page.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const stats = (given: number[]) => {
  const sorted = [...given].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), n: sorted.length };
};
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("benchmark server has no port");
  const runs: Record<Shape, Sample[]> = { single: [], dashboard: [] };
  // Five fresh pages per shape, the shapes of each round in a seeded order, so drift falls on both.
  const planned = schedule(seed, [0, 1, 2, 3, 4], () => ["single", "dashboard"] as const);
  for (const { member: shape } of planned) {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 700 },
      deviceScaleFactor: 2,
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(() => window.layouts);
    const driver = await driverFor(page, "chrome");
    const { targets, ...measured } = await page.evaluate((s) => window.layouts.mount(s), shape);
    const pointers: number[] = [];
    for (const target of targets) {
      await page.evaluate(() => window.layouts.arm());
      await driver.step({ type: "move", ...target });
      pointers.push(await page.evaluate(() => window.layouts.pointer()));
    }
    // Apart from the work moves, so checking frames does not add to them.
    const shown: number[] = [];
    for (const [i, target] of targets.slice(0, SHOWN_MOVES).entries()) {
      await page.evaluate(([i, target]) => window.layouts.armShown(i, target), [
        i,
        target,
      ] as const);
      await driver.step({ type: "move", ...target });
      const result = await page.evaluate(() => window.layouts.shown());
      if (typeof result !== "number")
        throw new Error(`layouts: ${shape}, move ${i + 1}: ${result.error}`);
      shown.push(result);
    }
    await page.evaluate(() => window.layouts.unmount());
    runs[shape].push({ ...measured, pointers, shown });
    await page.close();
  }
  const summary = (samples: Sample[]) => ({
    // The first mount of each page pays for compiling the code; the rest do not.
    mounts: stats(samples.flatMap(({ mounts }) => mounts.slice(1))),
    resizes: stats(samples.flatMap(({ resizes }) => resizes)),
    pointers: stats(samples.flatMap(({ pointers }) => pointers)),
    shown: stats(samples.flatMap(({ shown }) => shown)),
  });
  const timings = { single: summary(runs.single), dashboard: summary(runs.dashboard) };
  const result = {
    schema: 1,
    date: new Date().toISOString(),
    commit: commit(),
    environment: {
      ...machine(),
      browser: await browser.version(),
      viewport: { width: 1100, height: 700 },
      dpr: 2,
      herceg: packageVersion("herceg"),
    },
    method:
      "Production esbuild bundle; Canvas; five tables of three series of 2,000 points (30,000 points); 1000x600 CSS px; single: the five lines in one panel; dashboard: columns [2, 1] of rows [2, 1] and [1, 1] (four titled panels) with an inset over the first showing 400..600 with an indicator; mounts: createChart plus a synchronous render, 19 per page after the first; resizes: 40 synchronous renders alternating 900 and 1000 px wide; pointers: 120 trusted pointer moves across the panels through the DevTools Protocol's Input domain, each the event's handling (from its arrival in the page to a window listener after the chart's) plus the chart's part of the next frame (to a callback requested after the chart's, from the frame's timestamp or, where Chrome dispatched the move at the start of that frame, from the end of the event's handling; main's runs measured it from the frame's timestamp alone, which also counted the time until the main thread started the frame); shown: 30 further trusted moves to the first targets, each from its arrival to the end of the first frame whose pre-paint check saw the tooltip write series s0's value at a minute under the pointer (the panel's table); five fresh pages per shape, each round's shapes in a seeded order; no competitor timings",
    order: { seed, planned: planned.map(({ block, member }) => [block, member]) },
    timings,
    samples: runs,
  };
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(timings)}\n`);
} finally {
  await browser.close();
  server.close();
  rmSync(directory, { recursive: true, force: true });
}
