// First-hover latency: how long a tooltip takes to show for a pointer
// that moves onto a chart a set time after it mounted, while its
// interaction controller may still be loading (docs/architecture/interaction.md,
// "The interaction controller"). Every sample is a fresh page load of a
// production build split as applications bundle it, the controller a chunk
// of its own. Caches: "cold" (the HTTP cache off), "warm" (the chunk cached
// by an earlier load), and "slow" (cold, 100 ms of network latency). A
// baseline build of `--baseline` (a source tree without the split) has
// nothing to load. The move is trusted input through the DevTools Protocol,
// sent when the page says its delay has passed; times run from its arrival
// in the page. Cases, and the builds within each, run in a seeded order.
//
// Run from the repository root:
//   node --experimental-strip-types benchmarks/src/first-hover/run.ts \
//     [--baseline DIR --baseline-label COMMIT] [--samples 15] \
//     [--order-seed N] [--out benchmarks/results/first-hover.json]

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { type Browser, chromium } from "playwright";
import { HERCEG_ALIAS } from "../runner/build.ts";
import { LATENCY_ARGS } from "../runner/chrome.ts";
import { commit, machine, packageVersion } from "../runner/environment.ts";
import { driverFor } from "../runner/input.ts";
import { orderSeed, schedule } from "../runner/order.ts";
import { summarize } from "../runner/stats.ts";

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    baseline: { type: "string" },
    /** What the baseline is (its commit), for the results. */
    "baseline-label": { type: "string" },
    samples: { type: "string", default: "15" },
    "order-seed": { type: "string" },
  },
});
const seed = orderSeed(args["order-seed"]);
const SAMPLES = Number(args.samples);
const DELAYS = [0, 10, 25, 50, 100];
const CACHES = ["cold", "warm", "slow"] as const;
const DASHBOARDS = [1, 10];

/** Builds the page against a herceg source tree, split into chunks as an application's bundler would. */
async function bundle(name: string, source: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), `first-hover-${name}-`));
  await build({
    entryPoints: [join(import.meta.dirname, "page.ts")],
    bundle: true,
    minify: true,
    splitting: true,
    format: "esm",
    target: "es2022",
    outdir: directory,
    alias: { ...HERCEG_ALIAS, herceg: join(source, "index.ts") },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  return directory;
}

const builds: [name: string, directory: string][] = [
  ["split", await bundle("split", dirname(HERCEG_ALIAS.herceg))],
];
if (args.baseline) builds.push(["baseline", await bundle("baseline", resolve(args.baseline))]);

const server = createServer((request, response) => {
  const [, build, file = ""] = (request.url ?? "/").split("/");
  const directory = builds.find(([name]) => name === build)?.[1];
  if (!directory) return response.writeHead(404).end();
  if (file === "") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      '<!doctype html><body style="margin:0"><div id="stage"></div><script type="module" src="page.js"></script></body>',
    );
    return;
  }
  response.writeHead(200, {
    "content-type": extname(file) === ".js" ? "text/javascript" : "text/plain",
    // Chunks are immutable within a run, so a warm load takes them from the cache.
    "cache-control": "max-age=3600",
  });
  response.end(readFileSync(join(directory, file)));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string") throw new Error("first-hover: the server has no port");
const origin = `http://127.0.0.1:${address.port}`;

const browser: Browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: LATENCY_ARGS,
});
const browserVersion = browser.version();
const CASES = DASHBOARDS.flatMap((charts) =>
  CACHES.flatMap((cache) => DELAYS.map((delay) => ({ charts, cache, delay }))),
);
const planned = schedule(seed, CASES, () => builds.map(([name]) => name));
const results = [];
try {
  for (const {
    block: { charts, cache, delay },
    member: name,
  } of planned) {
    const samples: number[] = [];
    const frames: number[] = [];
    const shown: number[] = [];
    const rejected: number[] = [];
    const sinceMount: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      if (cache === "warm") {
        // An earlier visit, whose chart loaded what charts load, caches the chunks.
        await page.goto(`${origin}/${name}/`);
        await page.waitForFunction(() => window.firstHover !== undefined);
        await page.evaluate(() => window.firstHover.warm());
      } else await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      if (cache === "slow")
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 100,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
      await page.goto(`${origin}/${name}/`);
      await page.waitForFunction(() => window.firstHover !== undefined);
      const driver = await driverFor(page, "chrome", cdp);
      const target = await page.evaluate((options) => window.firstHover.mount(options), {
        delay,
        charts,
      });
      await driver.step({ type: "move", ...target });
      const result = await page.evaluate(() => window.firstHover.result());
      await context.close();
      if ("error" in result)
        throw new Error(
          `first-hover: ${name}, ${charts} chart(s), ${cache}, +${delay} ms: ${result.error}`,
        );
      samples.push(result.drawn);
      frames.push(result.frame);
      shown.push(result.shown);
      rejected.push(result.rejected);
      sinceMount.push(result.sinceMount);
    }
    const summary = summarize(samples);
    const frame = summarize(frames);
    const verified = summarize(shown);
    results.push({
      build: name,
      charts,
      cache,
      delay,
      drawn: summary,
      frame,
      shown: verified,
      sinceMount: summarize(sinceMount),
      // From createChart returning, sample by sample: the delay asked, the
      // dispatch, and the move's verified frame.
      mountToShown: summarize(sinceMount.map((since, k) => since + shown[k]!)),
      samples,
      frames,
      shownSamples: shown,
      rejectedFrames: rejected,
      sinceMountSamples: sinceMount,
    });
    console.log(
      `${name.padEnd(8)} ${String(charts).padStart(2)} chart(s) ${cache.padEnd(4)} +${String(delay).padStart(3)} ms: drawn p50 ${summary.median.toFixed(1)} p95 ${summary.p95.toFixed(1)} p99 ${summary.p99.toFixed(1)}; next frame p50 ${frame.median.toFixed(1)}; shown p50 ${verified.median.toFixed(1)}, from mount ${summarize(sinceMount.map((since, k) => since + shown[k]!)).median.toFixed(1)} ms`,
    );
  }
} finally {
  await browser.close();
  server.close();
  for (const [, directory] of builds) rmSync(directory, { recursive: true, force: true });
}

if (args.out) {
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        schema: 1,
        date: new Date().toISOString(),
        commit: commit(),
        method:
          "Chrome (headless, frame rate limit and vsync off), a fresh page per sample; esbuild production build with code splitting; input is a trusted pointer move through the DevTools Protocol's Input domain, sent once the page says a set delay has passed since createChart returned (sinceMount: the delay to its arrival, dispatch included); times from its arrival in the page: drawn to the tooltip's box being shown (a MutationObserver), frame to the animation frame after, shown to the end of the first frame whose pre-paint check saw the tooltip write series a's value under the pointer, its frames watched from when chart.loading settled (watching from the move would draw frames back to back while the controller's code loads, delaying it); frame, the animation frame after drawn, is a scheduling diagnostic: after a trusted move's frame Chrome often waits a refresh before the next, which it does not after a synthetic event; compare shown; mountToShown, per sample, sinceMount plus shown; caches: cold (HTTP cache disabled), warm (chunks cached by an earlier load), slow (cold, 100 ms added latency, no bandwidth limit); cases, and builds within each, in the order `order` records",
        environment: {
          ...machine(),
          browser: `Chrome ${browserVersion}`,
          herceg: packageVersion("herceg"),
        },
        baseline: args.baseline ? (args["baseline-label"] ?? "unnamed") : null,
        order: {
          seed,
          planned: planned.map(({ block, member }) => [
            member,
            block.charts,
            block.cache,
            block.delay,
          ]),
        },
        results,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`Wrote ${out}`);
}
