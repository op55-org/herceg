// Grid export benchmark: every row of a grid of 20 columns (100,000 or
// 1,000,000 rows) exported as CSV, text and raw, by Herceg's `exportGrid`
// and AG Grid Community's CSV export; and Herceg's copy of a selection of
// 100,000 rows (see page.ts and benchmarks/README.md, "Grid export").
//
//   npm run bench:grid-export -- [--lib herceg,ag-grid] [--size 100k,1m]
//                                [--values text,raw] [--no-copy] [--out results/grid-export.json]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as esbuild from "esbuild";
import { type Browser, type CDPSession, chromium, type Page } from "playwright";
import { HERCEG_ALIAS, ROOT, serve } from "../../runner/build.ts";
import {
  footprints,
  heapBytes,
  PROCESS_SETTLE_MS,
  REALTIME_ARGS,
  rendererPid,
  type TraceEvent,
  trace,
} from "../../runner/chrome.ts";
import { commit, machine, packageVersion } from "../../runner/environment.ts";
import { type Summary, summarize } from "../../runner/stats.ts";
import type { exportBench } from "./page.ts";

const LIBRARIES: Record<string, string> = {
  herceg: "herceg",
  "ag-grid": "ag-grid-community",
};
const SIZES: Record<string, { rows: number; samples: number; warmup: number }> = {
  "100k": { rows: 100_000, samples: 10, warmup: 2 },
  "1m": { rows: 1_000_000, samples: 5, warmup: 1 },
};
/** Traced exports (for the tasks) and fresh pages (for memory) per case. */
const TRACES = 3;
const MEMORY = 3;
/** Copies timed per case. */
const COPIES = { samples: 10, warmup: 2 };
const COPY_ROWS = 100_000;
/** Limits raised for the copy of every row: 2,000,000 cells, 256 MiB. */
const RAISED = { maxCells: 2_000_000, maxBytes: 2 ** 28 };
const VIEWPORT = { width: 1280, height: 720 };

const { values: args } = parseArgs({
  options: {
    lib: { type: "string" },
    size: { type: "string", default: "100k,1m" },
    values: { type: "string", default: "text,raw" },
    /** Leaves the copy timings out. */
    "no-copy": { type: "boolean", default: false },
    out: { type: "string" },
    headless: { type: "boolean", default: false },
    seed: { type: "string", default: "1" },
  },
});

const libraries = args.lib ? args.lib.split(",") : Object.keys(LIBRARIES);
for (const id of libraries) if (!LIBRARIES[id]) throw new Error(`unknown library ${id}`);
const sizes = args.size.split(",");
for (const size of sizes) if (!SIZES[size]) throw new Error(`unknown size ${size}`);
const valueCases = args.values.split(",") as ("text" | "raw")[];
for (const values of valueCases)
  if (values !== "text" && values !== "raw") throw new Error(`unknown values ${values}`);
const SEED = Number(args.seed);

declare global {
  interface Window {
    exportBench: typeof exportBench;
  }
}

interface Metric {
  unit: "ms" | "bytes" | "count";
  samples: number[];
  summary?: Summary;
}

async function build() {
  await esbuild.build({
    stdin: {
      contents: `import "./src/grid/export/page.ts";`,
      resolveDir: ROOT,
      sourcefile: "grid-export-entry.ts",
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    outfile: join(ROOT, ".build", "grid-export.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    alias: HERCEG_ALIAS,
    logLevel: "warning",
  });
}

/** A fresh page with `rows` rows of the fixture and `library`'s grid over them. */
async function open(
  browser: Browser,
  origin: string,
  rows: number,
  library: string,
  copy?: { maxCells: number; maxBytes: number },
): Promise<{ page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${origin}/grid-export.html`);
  await page.waitForFunction(() => window.exportBench !== undefined);
  await page.evaluate(([r, seed]) => window.exportBench.prepare(r, seed), [rows, SEED] as const);
  await page.evaluate(([l, c]) => window.exportBench.mount(l as "herceg" | "ag-grid", c), [
    library,
    copy,
  ] as const);
  return { page, cdp: await context.newCDPSession(page) };
}

const RUN_TASK = "ThreadControllerImpl::RunTask";
const MICROTASKS = "BlinkScheduler_PerformMicrotaskCheckpoint";

/**
 * The renderer main thread's tasks during an export (between the page's
 * marks): the longest, and their total, in ms; a task the export began or
 * ended inside counts its part inside. A task runs on through the
 * microtasks after it, which Chrome traces apart: nothing else (input
 * included) runs before they end, and an export's chunks after the first
 * run there, as continuations of `await`. Chrome traces a task too short
 * to time as an instant.
 */
function tasksOf(events: TraceEvent[], pid: number): { longest: number; busy: number } {
  const main = events.find(
    (event) =>
      event.pid === pid &&
      event.name === "thread_name" &&
      (event.args as { name?: string } | undefined)?.name === "CrRendererMain",
  );
  const mark = (name: string) => events.find((event) => event.name === name)?.ts;
  const start = mark("hg-export-start");
  const end = mark("hg-export-end");
  if (!main || start === undefined || end === undefined)
    throw new Error("tasksOf: the trace lacks the renderer's main thread or the export's marks");
  const spans = events
    .filter(
      (event) =>
        event.pid === pid &&
        event.tid === main.tid &&
        (event.name === RUN_TASK
          ? event.ph === "X" || event.ph === "I"
          : event.name === MICROTASKS && event.ph === "X"),
    )
    .sort((a, b) => a.ts! - b.ts!);
  // Each task, from its start to the end of the microtasks after it; a task nested in one is its.
  const tasks: [number, number][] = [];
  let ran = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    const last = tasks.at(-1);
    if (span.name === RUN_TASK && span.ts! >= ran) {
      ran = span.ts! + (span.dur ?? 0);
      tasks.push([span.ts!, ran]);
    } else if (last) last[1] = Math.max(last[1], span.ts! + span.dur!);
  }
  let longest = 0;
  let busy = 0;
  for (const [from, to] of tasks) {
    const inside = Math.min(end, to) - Math.max(start, from);
    if (inside <= 0) continue;
    longest = Math.max(longest, inside);
    busy += inside;
  }
  return { longest: longest / 1000, busy: busy / 1000 };
}

/** The browser process's footprint: Blobs a page makes are stored there. */
async function browserFootprint(cdp: CDPSession): Promise<number | undefined> {
  const { processInfo } = (await cdp.send("SystemInfo.getProcessInfo")) as {
    processInfo: { type: string; id: number }[];
  };
  const browser = processInfo.find((info) => info.type === "browser");
  return browser ? footprints(browser.id)?.now : undefined;
}

/**
 * Memory of one export in a fresh page: the renderer's peak footprint over
 * its footprint before (null where it never passed the peak mounting left,
 * which is then an upper bound: `earlierPeak`); and what holding the
 * output takes, after garbage collection, in the renderer and in the
 * browser process, where Blobs live.
 */
async function memory(
  browser: Browser,
  origin: string,
  rows: number,
  library: string,
  values: "text" | "raw",
) {
  const { page, cdp } = await open(browser, origin, rows, library);
  const browserSession = await browser.newBrowserCDPSession();
  const pid = await rendererPid(cdp);
  await heapBytes(cdp);
  await page.waitForTimeout(PROCESS_SETTLE_MS);
  const before = footprints(pid);
  const browserBefore = await browserFootprint(browserSession);
  await page.evaluate((v) => window.exportBench.run(v), values);
  const during = footprints(pid);
  await heapBytes(cdp);
  await page.waitForTimeout(PROCESS_SETTLE_MS);
  const after = footprints(pid);
  const browserAfter = await browserFootprint(browserSession);
  await browserSession.detach();
  await page.context().close();
  if (!before || !during || !after) return null;
  return {
    peak: during.peak > before.peak ? during.peak - before.now : null,
    earlierPeak: before.peak - before.now,
    heldRenderer: after.now - before.now,
    heldBrowser:
      browserBefore !== undefined && browserAfter !== undefined
        ? browserAfter - browserBefore
        : null,
  };
}

async function main() {
  await build();
  const { server, origin } = await serve();
  const browser = await chromium.launch({
    channel: "chrome",
    headless: args.headless,
    args: REALTIME_ARGS,
  });
  const results: {
    size: string;
    library: string;
    values: string;
    metrics: Record<string, Metric>;
    bytes: number;
    peakNotPassed?: number[];
  }[] = [];
  const checks: Record<string, unknown> = {};
  for (const size of sizes) {
    const { rows, samples, warmup } = SIZES[size]!;
    for (const values of valueCases) {
      if (rows <= 100_000 && libraries.length === 2) {
        // Both grids' output, cell by cell: the comparison is of the same export.
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        await page.goto(`${origin}/grid-export.html`);
        await page.waitForFunction(() => window.exportBench !== undefined);
        await page.evaluate(([r, seed]) => window.exportBench.prepare(r, seed), [
          rows,
          SEED,
        ] as const);
        const check = await page.evaluate((v) => window.exportBench.check(v), values);
        await context.close();
        checks[`${size} ${values}`] = check;
        console.log(
          `check ${size} ${values}: rows ${check.rows.join(" and ")}, ${check.differ ?? "same cells"}`,
        );
      }
      for (const library of libraries) {
        const metrics: Record<string, Metric> = {
          time: { unit: "ms", samples: [] },
          longestTask: { unit: "ms", samples: [] },
          busy: { unit: "ms", samples: [] },
          peakBytes: { unit: "bytes", samples: [] },
          heldRendererBytes: { unit: "bytes", samples: [] },
          heldBrowserBytes: { unit: "bytes", samples: [] },
        };
        let bytes = 0;
        const { page, cdp } = await open(browser, origin, rows, library);
        for (let i = 0; i < warmup + samples; i++) {
          await heapBytes(cdp);
          const run = await page.evaluate((v) => window.exportBench.run(v), values);
          bytes = run.bytes;
          if (i >= warmup) metrics.time!.samples.push(run.ms);
        }
        const pid = await rendererPid(cdp);
        for (let i = 0; i < TRACES; i++) {
          await heapBytes(cdp);
          const events = await trace(cdp, ["toplevel", "blink.user_timing", "__metadata"], () =>
            page.evaluate((v) => window.exportBench.run(v), values),
          );
          const tasks = tasksOf(events, pid);
          metrics.longestTask!.samples.push(tasks.longest);
          metrics.busy!.samples.push(tasks.busy);
        }
        await page.context().close();
        const notPassed: number[] = [];
        for (let i = 0; i < MEMORY; i++) {
          const one = await memory(browser, origin, rows, library, values);
          if (!one) continue;
          if (one.peak === null) notPassed.push(one.earlierPeak);
          else metrics.peakBytes!.samples.push(one.peak);
          metrics.heldRendererBytes!.samples.push(one.heldRenderer);
          if (one.heldBrowser !== null) metrics.heldBrowserBytes!.samples.push(one.heldBrowser);
        }
        for (const metric of Object.values(metrics))
          if (metric.samples.length > 0) metric.summary = summarize(metric.samples);
        results.push({
          size,
          library,
          values,
          metrics,
          bytes,
          ...(notPassed.length > 0 && { peakNotPassed: notPassed }),
        });
        const m = (id: string) => metrics[id]!.summary?.median;
        const mib = (id: string) => {
          const value = m(id);
          return value === undefined ? "n/a" : `${(value / 2 ** 20).toFixed(1)} MiB`;
        };
        console.log(
          `${size} ${values} ${library}: ${m("time")!.toFixed(0)} ms (p95 ${metrics.time!.summary!.p95.toFixed(0)}), longest task ${m("longestTask")!.toFixed(1)} ms, busy ${m("busy")!.toFixed(0)} ms, peak ${mib("peakBytes")}${notPassed.length ? ` (${notPassed.length} under the mount's peak)` : ""}, held ${mib("heldRendererBytes")} renderer, ${mib("heldBrowserBytes")} browser; ${(bytes / 2 ** 20).toFixed(1)} MiB`,
        );
      }
    }
  }
  const copies: Record<string, unknown> = {};
  if (!args["no-copy"] && libraries.includes("herceg")) {
    // Every row selected: with limits raised to take it, with the default
    // limits (which refuse it), and 5,000 rows, as many as they take.
    for (const [name, rows, limits] of [
      ["100k rows, limits raised", COPY_ROWS, RAISED],
      ["100k rows, default limits", COPY_ROWS, undefined],
      ["5k rows, default limits", 5_000, undefined],
    ] as const) {
      const { page } = await open(browser, origin, rows, "herceg", limits);
      await page.evaluate(() => window.exportBench.selectAll());
      const times: number[] = [];
      let last: { chars: number; taken: boolean; said: string } | null = null;
      for (let i = 0; i < COPIES.warmup + COPIES.samples; i++) {
        await page.evaluate(() => window.exportBench.armCopy());
        await page.keyboard.press("ControlOrMeta+c");
        const one = await page.evaluate(() => window.exportBench.copied());
        if (i >= COPIES.warmup) times.push(one.ms);
        last = one;
      }
      await page.context().close();
      copies[name] = { time: { unit: "ms", samples: times, summary: summarize(times) }, ...last };
      const summary = summarize(times);
      console.log(
        `copy ${name}: ${summary.median.toFixed(1)} ms (p95 ${summary.p95.toFixed(1)}), ${last!.chars} characters, "${last!.said}"`,
      );
    }
  }
  const browserVersion = browser.version();
  await browser.close();
  server.close();
  const output = {
    date: new Date().toISOString(),
    commit: commit(),
    method: {
      data: "the grid suite's fixture (fixture.ts): 20 fields (16 numbers, 2 times, 2 categories) with missing values; the grid suite's formats (2 decimals, en-US; times in UTC; missing values as an em dash)",
      herceg:
        "exportGrid(model, { values }) with its defaults: CSV, titles as the header, formulas escaped, values quoted only where needed, chunks of about 8 ms yielding to the page; to a Blob",
      agGrid:
        "api.getDataAsCsv() to a Blob, as exportDataAsCsv does before downloading. Text: the columns' valueFormatter (used by exports by default). Raw: a processCellCallback writing times as ISO 8601 and missing values empty; every value quoted, no formula escaping (its defaults)",
      check:
        "at 100,000 rows, both grids' CSV parsed and compared cell by cell (quoting aside, they write the same cells)",
      time: "from the call to the Blob, in the page; the grid mounted, garbage collected before each export",
      tasks: `the renderer main thread's tasks between the export's marks (Chrome trace, 'toplevel'), ${TRACES} traced exports: the longest, and their total (busy)`,
      memory: `${MEMORY} fresh pages, the grid mounted: the renderer's peak footprint (macOS phys_footprint_peak) over its footprint before the export, where the export passed the peak mounting left (else listed under peakNotPassed as an upper bound); and after garbage collection, holding the output, the renderer's and the browser process's footprints over before (Blobs are stored in the browser process)`,
      copy: `Herceg only (AG Grid's clipboard is Enterprise): every row selected, Ctrl+C (Cmd+C) pressed, timed from the copy event reaching the window to a listener after the grid's; ${COPIES.samples} copies after ${COPIES.warmup}`,
      sizes: SIZES,
      seed: SEED,
    },
    environment: {
      ...machine(),
      browser: `Chrome ${browserVersion}`,
      headless: args.headless,
      viewport: VIEWPORT,
      devicePixelRatio: 1,
      browserSettings: REALTIME_ARGS,
      playwright: packageVersion("playwright"),
    },
    libraries: Object.fromEntries(
      libraries.map((id) => [
        id,
        { package: LIBRARIES[id], version: packageVersion(LIBRARIES[id]!) },
      ]),
    ),
    checks,
    results,
    copies,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = args.out
    ? resolve(ROOT, args.out)
    : join(ROOT, "..", "tmp", "benchmarks", `grid-export-${stamp}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(output, null, 1)}\n`);
  console.log(`\nWrote ${out}`);
}

await main();
