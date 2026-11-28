// Browser benchmark runner. See benchmarks/README.md for methodology.
//
//   npm run bench -- [--lib echarts,uplot] [--scenario line-small-init,...]
//                    [--filter line-] [--out results/name.json] [--headless]
//                    [--sample-scale 0.5] [--timeout 120] [--order-seed N]
//                    [--browser chrome|firefox|webkit]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  chromium,
  firefox,
  type Page,
  webkit,
} from "playwright";
import { createFirefoxAppData } from "../../../scripts/browser/firefox.ts";
import type { Metric, PageResult, RunOptions } from "../page/harness.ts";
import type { LoadResult } from "../page/load.ts";
import { type Operation, SCENARIOS, type Scenario } from "../scenarios/index.ts";
import { buildPage, ROOT, serve } from "./build.ts";
import {
  bounded,
  gpuMemory,
  heapBytes,
  LATENCY_ARGS,
  PROCESS_SETTLE_MS,
  processGrowth,
  processMemory,
  REALTIME_ARGS,
  rendererPid,
  scaleFactorArg,
} from "./chrome.ts";
import { COMPARED, commit, machine, PACKAGES, packageVersion, RUNTIMES } from "./environment.ts";
import { type Driver, driverFor, type Engine } from "./input.ts";
import { orderSeed, schedule } from "./order.ts";
import { CHART_RATIOS, ratios } from "./ratios.ts";
import { notMounted, type Status, statusOf, withPasses } from "./results.ts";
import { SLOW_4G } from "./server.ts";
import { type Summary, summarize } from "./stats.ts";

const { values: args } = parseArgs({
  options: {
    lib: { type: "string" },
    scenario: { type: "string" },
    filter: { type: "string" },
    out: { type: "string" },
    headless: { type: "boolean", default: false },
    "sample-scale": { type: "string", default: "1" },
    /** Seconds before a library's scenario is abandoned; overrides scenario timeouts. */
    timeout: { type: "string" },
    /** Installed Chrome, or Playwright's Firefox or WebKit build. */
    browser: { type: "string", default: "chrome" },
    /** Seeds the order scenarios and libraries run in; a new seed (recorded) when not given. */
    "order-seed": { type: "string" },
  },
});

const BROWSERS = ["chrome", "firefox", "webkit"] as const;
type BrowserName = (typeof BROWSERS)[number];
if (!BROWSERS.includes(args.browser as BrowserName))
  throw new Error(`--browser must be one of ${BROWSERS.join(", ")}, not ${args.browser}`);
const browserName = args.browser as BrowserName;
/** Heap sizes come from Chrome's DevTools protocol; other browsers skip memory scenarios. */
const measuresMemory = browserName === "chrome";

const VIEWPORT = { width: 1280, height: 1400 };
const DEVICE_SCALE_FACTOR = 2;
const contextOptions = { viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR };
const HOVER_SPACING_MS = 70;
/**
 * The pause after the check's page has closed, before the timed page opens:
 * that page decoded a screenshot, and the timed run's first samples would
 * otherwise overlap its teardown (small mounts read 0.1-0.6 ms slower in
 * Chrome without it).
 */
const AFTER_CHECK_MS = 1000;
/** A sustained trace sends a move every this many ms. */
const TRACE_STEP_MS = 8;
/** Operations timed to frames, which a second run times to WebGL drawing finished too. */
const FRAME_TIMED = new Set<Operation>(["stream", "hover", "zoom", "resize", "rotate"]);
/** Operations paced by the clock, run with the display's refresh on. */
const PACED = new Set<Operation>(["ingest", "orbit", "trace"]);
/** The load cases: an empty cache, the assets cached, and a throttled connection. */
const LOAD_CASES = ["cold", "warmAsset", "latency"] as const;
type LoadCase = (typeof LOAD_CASES)[number];

/**
 * The runs of a scenario: `check`, its operation once in a page of its own,
 * verified and then checked in a screenshot, before anything is timed;
 * `main`, the scenario as it always ran; `webgl`, frame-timed operations
 * again until WebGL drawing finished; `first-mount`, one first mount of a
 * memory scenario in a fresh page, per sample.
 */
type Pass = "check" | "main" | "webgl" | "first-mount";
// Firefox paints as soon as it can with a frame rate of 0 ("ASAP mode").
// WebKit has no such setting: its latencies include waiting for vsync.
const FIREFOX_LATENCY_PREFS = { "layout.frame_rate": 0 };
// Chrome draws at the ratio its pages emulate, whatever the display's.
const CHROME_ARGS = {
  latency: [...LATENCY_ARGS, scaleFactorArg(DEVICE_SCALE_FACTOR)],
  realtime: [...REALTIME_ARGS, scaleFactorArg(DEVICE_SCALE_FACTOR)],
};

/** How each kind of scenario runs, recorded with the results. */
const BROWSER_SETTINGS = {
  chrome: CHROME_ARGS,
  firefox: { latency: FIREFOX_LATENCY_PREFS, realtime: {} },
  webkit: { latency: "default (frames follow vsync)", realtime: "default" },
}[browserName];

const libraries = args.lib ? args.lib.split(",") : COMPARED;
const sampleScale = Number(args["sample-scale"]);
const seed = orderSeed(args["order-seed"]);
const scenarios = SCENARIOS.filter(
  (s) =>
    (!args.scenario || args.scenario.split(",").includes(s.id)) &&
    (!args.filter || s.id.includes(args.filter)) &&
    (measuresMemory || s.operation !== "memory"),
).map((s) => ({
  ...s,
  samples: Math.max(1, Math.round(s.samples * sampleScale)),
  warmup: Math.round(s.warmup * Math.min(1, sampleScale)),
  ...(s.load && { loadSamples: Math.max(1, Math.round((s.loadSamples ?? 5) * sampleScale)) }),
  // The limit actually applied, so recorded scenarios show it.
  timeout: Number(args.timeout ?? s.timeout ?? 600),
}));

interface ResultRow {
  scenario: string;
  library: string;
  status: Status;
  /** True when measured; kept beside `status` for readers of earlier results. */
  supported: boolean;
  reason?: string;
  /** Why a `webgl`, `first-mount`, or load run failed when the main run did not. */
  fullCostReason?: string;
  metrics: Record<string, Metric & { summary: Summary }>;
  distributions?: PageResult["distributions"];
  /** Per load case, what its first sample fetched: each resource's bytes on the wire (0 from the cache). */
  loads?: Partial<Record<LoadCase, LoadResult["resources"]>>;
}

/** A step of the run as it happened: the scenario, the library, the pass, and how it ended. */
interface Attempt {
  scenario: string;
  library: string;
  pass: Pass | LoadCase;
  status: Status;
  seconds: number;
}

async function runMemory(page: Page, cdp: CDPSession, s: Scenario): Promise<PageResult> {
  const names = [
    "retainedBytes",
    "sourceBytes",
    "jsHeapBytes",
    "domHeapBytes",
    "arrayBufferBytes",
    "canvasBytes",
    "leakedBytes",
  ] as const;
  const metrics: Record<string, Metric> = Object.fromEntries(
    names.map((name) => [name, { unit: "bytes", samples: [] }]),
  );
  metrics.domNodes = { unit: "count", samples: [] };
  metrics.dataBytes = { unit: "bytes", samples: [] };
  const push = (name: string, value: number) => metrics[name]!.samples.push(value);
  for (let i = 0; i < s.samples; i++) {
    const baseline = await heapBytes(cdp);
    const bytes = await page.evaluate((scenario) => window.bench.prepareData(scenario), s);
    const withData = await heapBytes(cdp);
    const mounted = await page.evaluate((scenario) => window.bench.mount(scenario), s);
    if (!mounted.supported) return notMounted(mounted);
    const withCharts = await heapBytes(cdp);
    const footprint = await page.evaluate(() => window.bench.footprint());
    // Unmount releases the charts and the source data.
    await page.evaluate(() => window.bench.unmount());
    const released = await heapBytes(cdp);
    push("dataBytes", bytes);
    push("sourceBytes", withData.total - baseline.total);
    push("retainedBytes", withCharts.total - withData.total);
    push("jsHeapBytes", withCharts.js - withData.js);
    push("domHeapBytes", withCharts.embedder - withData.embedder);
    push("arrayBufferBytes", withCharts.backing - withData.backing);
    push("canvasBytes", footprint.canvasBytes);
    push("domNodes", footprint.domNodes);
    push("leakedBytes", released.total - baseline.total);
  }
  return { supported: true, metrics };
}

/**
 * One sample of a memory scenario's first mount, in a fresh page: the heap
 * it retains (`firstRetainedBytes`), the renderer process's footprint, and
 * the GPU memory attributed to the page, from data prepared to charts
 * mounted. `runMemory` mounts repeatedly in one page, so its median leaves
 * out what a library pays only the first time (code, caches it keeps after
 * being destroyed); and the pauses and memory dumps here would change its
 * readings, so this runs apart. `browser` is a browser-level DevTools session.
 */
async function runFirstMount(
  page: Page,
  cdp: CDPSession,
  browser: CDPSession,
  s: Scenario,
): Promise<PageResult> {
  const pid = await rendererPid(cdp);
  // The first memory dump sets up tracing's buffers in every process; taken
  // before the baselines, it is not counted as the charts' memory.
  await gpuMemory(browser, pid);
  await page.evaluate((scenario) => window.bench.prepareData(scenario), s);
  await heapBytes(cdp);
  const dataProcess = await processMemory(page, browser, pid);
  // Read after the memory dump, so what the dump leaves in the heap is in the baseline.
  const withData = await heapBytes(cdp);
  const mounted = await page.evaluate((scenario) => window.bench.mount(scenario), s);
  if (!mounted.supported) return notMounted(mounted);
  const withCharts = await heapBytes(cdp);
  const chartsProcess = await processMemory(page, browser, pid);
  const growth = {
    firstRetainedBytes: withCharts.total - withData.total,
    ...processGrowth(dataProcess, chartsProcess),
  };
  return {
    supported: true,
    metrics: Object.fromEntries(
      Object.entries(growth).map(([name, value]) => [name, { unit: "bytes", samples: [value] }]),
    ),
  };
}

/** One trusted move to `target`, timed in the page from its arrival to the first frame showing the item there. */
async function hoverOnce(
  page: Page,
  driver: Driver,
  target: { x: number; y: number },
  options: RunOptions,
) {
  await page.evaluate(([target, options]) => window.bench.armPointer(target, options), [
    target,
    options,
  ] as const);
  await driver.step({ type: "move", x: target.x, y: target.y });
  return page.evaluate(() => window.bench.pointerLatency());
}

async function runHover(
  page: Page,
  driver: Driver,
  s: Scenario,
  options: RunOptions,
): Promise<PageResult> {
  const mounted = await page.evaluate((scenario) => window.bench.mount(scenario), s);
  if (!mounted.supported) return notMounted(mounted);
  // Aim at real data points so every library has something to hit.
  const targets = await page.evaluate(
    ([scenario, count]) => window.bench.hoverTargets(scenario, count),
    [s, s.warmup + s.samples] as const,
  );
  const latency: Metric = { unit: "ms", samples: [] };
  const rejected: Metric = { unit: "count", samples: [] };
  const checkTime: Metric = { unit: "ms", samples: [] };
  const queued: Metric = { unit: "ms", samples: [] };
  for (const [i, target] of targets.entries()) {
    // Space moves out so throttled hover handlers (Plotly: 50 ms) run for
    // every event instead of being skipped.
    await page.waitForTimeout(HOVER_SPACING_MS);
    const result = await hoverOnce(page, driver, target, options);
    if ("reason" in result)
      return { supported: false, incorrect: true, reason: result.reason, metrics: {} };
    if (i < s.warmup) continue;
    latency.samples.push(result.latency);
    rejected.samples.push(result.rejected);
    checkTime.samples.push(result.checkTime);
    queued.samples.push(result.queued);
  }
  await page.evaluate(() => window.bench.unmount());
  return {
    supported: true,
    metrics: {
      [options.webgl ? "pointerToWebglDone" : "pointerToFrame"]: latency,
      rejectedFrames: rejected,
      checkTime,
      // From the event's own time stamp to its arrival in the first listener.
      inputQueued: queued,
    },
  };
}

/**
 * A sustained trace: moves sent every `TRACE_STEP_MS` for the scenario's
 * duration along a sweep back and forth over series 0, without waiting for
 * the page, and what the page received and showed (page/paced.ts). Warmup
 * trials last five seconds.
 */
async function runTrace(page: Page, driver: Driver, s: Scenario): Promise<PageResult> {
  const mounted = await page.evaluate((scenario) => window.bench.mount(scenario), s);
  if (!mounted.supported) return notMounted(mounted);
  const path = await page.evaluate((scenario) => window.bench.hoverTargets(scenario, 250), s);
  const metrics: Record<string, Metric> = {};
  const distributions: NonNullable<PageResult["distributions"]> = {};
  const add = (name: string, metric: Metric) => {
    const kept = metrics[name];
    if (kept) kept.samples.push(...metric.samples);
    else metrics[name] = { ...metric, samples: [...metric.samples] };
  };
  for (let trial = 0; trial < s.warmup + s.samples; trial++) {
    const duration = trial < s.warmup ? 5000 : (s.durationMs ?? 60_000);
    await page.evaluate((scenario) => window.bench.traceStart(scenario), s);
    const start = performance.now();
    let scheduled = 0;
    let sent = 0;
    for (; performance.now() - start < duration; scheduled++) {
      const wait = start + scheduled * TRACE_STEP_MS - performance.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      // Back and forth along the path.
      const k = scheduled % (2 * path.length - 2);
      const point = path[k < path.length ? k : 2 * path.length - 2 - k]!;
      if (driver.send({ type: "move", x: point.x, y: point.y })) sent++;
    }
    await driver.drain();
    const seconds = (performance.now() - start) / 1000;
    const result = await page.evaluate(() => window.bench.traceStop());
    if ("reason" in result)
      return { supported: false, incorrect: true, reason: result.reason, metrics: {} };
    if (trial < s.warmup) continue;
    for (const [name, metric] of Object.entries(result.metrics)) add(name, metric);
    add("movesScheduled", { unit: "count", samples: [scheduled] });
    add("movesSent", { unit: "count", samples: [sent] });
    add("movesSkipped", { unit: "count", samples: [scheduled - sent] });
    add("sendRate", { unit: "hz", samples: [sent / seconds] });
    // Trials' histograms add up where their edges (the refresh) agree; the trials' own are kept otherwise.
    for (const [name, histogram] of Object.entries(result.distributions ?? {})) {
      const kept = distributions[name];
      const key =
        kept && kept.edges.join() !== histogram.edges.join() ? `${name}Trial${trial}` : name;
      const into = distributions[key];
      if (!into) distributions[key] = { edges: histogram.edges, counts: [...histogram.counts] };
      else for (const [i, count] of histogram.counts.entries()) into.counts[i]! += count;
    }
  }
  await page.evaluate(() => window.bench.unmount());
  return { supported: true, metrics, distributions };
}

/**
 * The check before timing, in a page of its own: the scenario's charts
 * mounted and its operation run once (a move to its first target for
 * hover and traces), each verified as the timed runs verify them, then a
 * screenshot checked for the charts' marks where their drawing says.
 */
async function runCheck(page: Page, driver: Driver, s: Scenario): Promise<PageResult> {
  const mounted = await page.evaluate((scenario) => window.bench.mount(scenario), s);
  if (!mounted.supported) return notMounted(mounted);
  let wrong: string | undefined;
  if (s.operation === "hover" || s.operation === "trace") {
    const [target] = await page.evaluate((scenario) => window.bench.hoverTargets(scenario, 1), s);
    const result = await hoverOnce(page, driver, target!, {});
    if ("reason" in result) wrong = result.reason;
  } else wrong = await page.evaluate((scenario) => window.bench.preflight(scenario), s);
  if (!wrong) {
    const shot = (await page.screenshot({ scale: "css" })).toString("base64");
    wrong = await page.evaluate(([scenario, shot]) => window.bench.pixelCheck(scenario, shot), [
      s,
      shot,
    ] as const);
  }
  await page.evaluate(() => window.bench.unmount());
  // Collected here, so the screenshot's decoding leaves nothing for the timed run (Chrome; see AFTER_CHECK_MS).
  await page.evaluate(() => (globalThis as { gc?: () => void }).gc?.());
  if (wrong) return { supported: false, incorrect: true, reason: wrong, metrics: {} };
  return { supported: true, metrics: {} };
}

async function main() {
  for (const library of libraries) await buildPage(library);
  const pages = await serve();
  // The latency case's assets come through a throttled connection of their own.
  const slow = scenarios.some((s) => s.load) ? await serve({ throttle: SLOW_4G }) : undefined;
  const launch = async (realtime: boolean) => {
    const headless = args.headless;
    let browser: Browser;
    if (browserName === "firefox") {
      const firefoxUserPrefs = realtime ? {} : FIREFOX_LATENCY_PREFS;
      browser = await firefox.launch({
        headless,
        firefoxUserPrefs,
        env: createFirefoxAppData().env,
      });
    } else if (browserName === "webkit") {
      browser = await webkit.launch({ headless });
    } else {
      const chromeArgs = realtime ? CHROME_ARGS.realtime : CHROME_ARGS.latency;
      browser = await chromium.launch({ channel: "chrome", headless, args: chromeArgs });
    }
    const context = await browser.newContext(contextOptions);
    return { browser, context };
  };
  let latency = await launch(false);
  const browserVersion = latency.browser.version();
  let realtime = scenarios.some((s) => PACED.has(s.operation)) ? await launch(true) : latency;

  const rows: ResultRow[] = [];
  const attempts: Attempt[] = [];
  const renderers: Record<string, unknown> = {};
  const verification: Record<string, string> = {};
  /** Browser-level DevTools sessions, for memory dumps; one per Chrome launched. */
  const browserSessions = new WeakMap<Browser, CDPSession>();

  // Environment readings in a page of their own, so no measured page makes
  // an extra WebGL context or runs extra frames first.
  const setup = await latency.context.newPage();
  await setup.goto(`${pages.origin}/${libraries[0]}.html`);
  await setup.waitForFunction(() => window.bench !== undefined);
  const gpu = await setup.evaluate(() => window.bench.gpu());
  const userAgent = await setup.evaluate(() => navigator.userAgent);
  /** Idle frame cadence in the latency browser, which bounds what WebKit timings can show. */
  const frameCadence = await setup.evaluate(() => window.bench.refreshInterval());
  await setup.close();

  /**
   * Runs one scenario in a fresh page, from page creation to measurement.
   * Resources it created are left in `opened` for the caller to clean up.
   */
  const measure = async (
    { browser, context }: { browser: Browser; context: BrowserContext },
    library: string,
    s: Scenario,
    pass: Pass,
    opened: { page?: Page; cdp?: CDPSession },
  ): Promise<PageResult> => {
    const page = await context.newPage();
    opened.page = page;
    await page.goto(`${pages.origin}/${library}.html`);
    await page.waitForFunction(() => window.bench !== undefined);
    renderers[library] ??= await page.evaluate(() => window.bench.renderer);
    verification[library] ??= await page.evaluate(() => window.bench.verification);
    if (browserName === "chrome") opened.cdp = await context.newCDPSession(page);
    const driver = await driverFor(page, browserName as Engine, opened.cdp);
    if (pass === "check") return runCheck(page, driver, s);
    if (s.operation === "memory") {
      if (pass !== "first-mount") return runMemory(page, opened.cdp!, s);
      let session = browserSessions.get(browser);
      if (!session) {
        session = await browser.newBrowserCDPSession();
        browserSessions.set(browser, session);
      }
      return runFirstMount(page, opened.cdp!, session, s);
    }
    const options: RunOptions = { webgl: pass === "webgl" };
    const result =
      s.operation === "hover"
        ? await runHover(page, driver, s, options)
        : s.operation === "trace"
          ? await runTrace(page, driver, s)
          : await page.evaluate(([scenario, options]) => window.bench.run(scenario, options), [
              s,
              options,
            ] as const);
    if (result.supported && FRAME_TIMED.has(s.operation)) {
      const created = await page.evaluate(() => window.bench.webglContexts());
      result.metrics.webglContexts = { unit: "count", samples: [created] };
    }
    return result;
  };

  /** Restarts the browser a failed page belonged to: a crashed or stuck page can leave it unable to open tabs. */
  const restart = async (paced: boolean) => {
    const shared = realtime === latency;
    const failed = paced ? realtime : latency;
    await failed.browser.close().catch(() => {});
    const fresh = await launch(paced && !shared);
    if (paced && !shared) realtime = fresh;
    else {
      latency = fresh;
      if (shared) realtime = fresh;
    }
  };

  /** Runs `body` within the scenario's time limit, as an error result when it fails or overruns. */
  const limited = async (s: Scenario, body: () => Promise<PageResult>): Promise<PageResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        body(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${s.timeout} s`)),
            (s.timeout ?? 600) * 1000,
          );
        }),
      ]);
    } catch (error) {
      return {
        supported: false,
        reason: `error: ${(error as Error).message.split("\n")[0]}`,
        metrics: {},
      };
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * Measures a scenario in a fresh page within its time limit, and starts
   * the browser again when the page crashed or got stuck.
   */
  const attempt = async (library: string, s: Scenario, pass: Pass = "main") => {
    const paced = PACED.has(s.operation);
    // A browser left without pages while the other runs can exit (headed
    // Firefox on macOS does after a minute or so): start it again.
    if (!(paced ? realtime : latency).browser.isConnected()) {
      const fresh = await launch(paced);
      if (paced) realtime = fresh;
      else latency = fresh;
    }
    const opened: { page?: Page; cdp?: CDPSession } = {};
    const started = performance.now();
    const result = await limited(s, () =>
      measure(paced ? realtime : latency, library, s, pass, opened),
    );
    // A page still running a timed-out scenario, or a crashed one, may
    // never answer; cleaning it up must not stall the run.
    if (opened.cdp) await bounded(opened.cdp.detach());
    if (opened.page) await bounded(opened.page.close({ runBeforeUnload: false }));
    if (statusOf(result) === "error") await restart(paced);
    attempts.push({
      scenario: s.id,
      library,
      pass,
      status: statusOf(result),
      seconds: (performance.now() - started) / 1000,
    });
    return result;
  };

  /**
   * One load of the page to the chart's first verified frame, in a context
   * of its own: `cold` with nothing cached, `warmAsset` after an earlier
   * visit cached its assets, `latency` cold through the throttled server.
   * Fails when the cache did not do what the case says (where the browser
   * reports transfer sizes), and reports a load whose chart never showed.
   */
  const loadOnce = async (
    library: string,
    s: Scenario,
    loadCase: LoadCase,
  ): Promise<LoadResult | { incorrect: string }> => {
    const context = await latency.browser.newContext(contextOptions);
    try {
      const origin = loadCase === "latency" ? slow!.origin : pages.origin;
      const url = `${origin}/${library}.html`;
      if (loadCase === "warmAsset") {
        const visit = await context.newPage();
        await visit.goto(url);
        await visit.waitForFunction(() => window.bench !== undefined);
        await visit.close();
      }
      const page = await context.newPage();
      await page.goto(`${url}?load=${Buffer.from(JSON.stringify(s)).toString("base64")}`);
      await page.waitForFunction(() => window.benchLoad !== undefined, undefined, {
        timeout: (s.timeout ?? 600) * 1000,
      });
      const result = await page.evaluate(() => window.benchLoad!);
      if ("error" in result) {
        if (result.incorrect) return { incorrect: result.error };
        throw new Error(result.error);
      }
      // The page itself is never cached; a browser reporting 0 for it reports no sizes.
      const reports = result.resources.some((r) => r.name.endsWith(".html") && r.transferSize > 0);
      const assets = result.resources.filter((r) => /\.(js|css)$/.test(r.name));
      const cached = assets.filter((r) => r.transferSize === 0).map((r) => r.name);
      if (reports && loadCase !== "warmAsset" && cached.length > 0)
        throw new Error(`${loadCase} load: ${cached.join(", ")} came from the cache`);
      if (reports && loadCase === "warmAsset" && cached.length < assets.length)
        throw new Error("warmAsset load: the assets were fetched again, not taken from the cache");
      return result;
    } finally {
      await bounded(context.close());
    }
  };

  /**
   * The load cases' metrics and, per case, its first sample's resources. A
   * case that fails ends the loads: as incorrect when its chart never
   * showed, otherwise with the reason and only the cases that finished.
   */
  const runLoads = async (
    library: string,
    s: Scenario,
  ): Promise<PageResult & { resources: Partial<Record<LoadCase, LoadResult["resources"]>> }> => {
    const metrics: Record<string, Metric> = {};
    const resources: Partial<Record<LoadCase, LoadResult["resources"]>> = {};
    for (const loadCase of LOAD_CASES) {
      const started = performance.now();
      const taken: Record<string, Metric> = {};
      const push = (name: string, unit: Metric["unit"], value: number) => {
        taken[name] ??= { unit, samples: [] };
        taken[name]!.samples.push(value);
      };
      const result = await limited(s, async () => {
        for (let i = 0; i < (s.loadSamples ?? 1); i++) {
          const load = await loadOnce(library, s, loadCase);
          if ("incorrect" in load)
            return { supported: false, incorrect: true, reason: load.incorrect, metrics: {} };
          resources[loadCase] ??= load.resources;
          push(`${loadCase}LoadToFrame`, "ms", load.loadToFrame);
          push(`${loadCase}Evaluated`, "ms", load.evaluated);
          push(`${loadCase}Fixture`, "ms", load.fixture);
          push(`${loadCase}CreateToFrame`, "ms", load.createToFrame);
          push(
            `${loadCase}TransferBytes`,
            "bytes",
            load.resources.reduce((sum, resource) => sum + resource.transferSize, 0),
          );
        }
        return { supported: true, metrics: {} };
      });
      attempts.push({
        scenario: s.id,
        library,
        pass: loadCase,
        status: statusOf(result),
        seconds: (performance.now() - started) / 1000,
      });
      if (!result.supported) {
        if (statusOf(result) === "error") await restart(false);
        return { ...result, metrics: result.incorrect ? {} : metrics, resources };
      }
      Object.assign(metrics, taken);
    }
    return { supported: true, metrics, resources };
  };

  const planned = schedule(seed, scenarios, () => libraries);
  let complete = false;
  try {
    for (const { block: s, member: library } of planned) {
      const started = performance.now();
      // Checked first, in a page of its own: an adapter drawing the wrong thing is not timed.
      const check = await attempt(library, s, "check");
      if (check.supported) await new Promise((resolve) => setTimeout(resolve, AFTER_CHECK_MS));
      let result = check.supported ? await attempt(library, s) : check;
      // Full-cost metrics come from runs of their own in fresh pages, so
      // the main run's readings stay as they were: frame-timed operations
      // again, each to WebGL drawing finished; memory scenarios as one
      // first mount per page and sample; loads in contexts of their own.
      const passes: Pass[] = !result.supported
        ? []
        : FRAME_TIMED.has(s.operation)
          ? ["webgl"]
          : s.operation === "memory"
            ? Array<Pass>(s.samples).fill("first-mount")
            : [];
      const extras: PageResult[] = [];
      const contexts = (r: PageResult) => r.metrics.webglContexts?.samples[0];
      for (const pass of passes) {
        const extra = await attempt(library, s, pass);
        // A run that made other WebGL contexts (one failed to start, say)
        // did not wait for the drawing the main run did.
        if (extra.supported && contexts(extra) !== contexts(result)) {
          extras.push({
            supported: false,
            reason: `error: the WebGL-done run created ${contexts(extra)} WebGL contexts, the main run ${contexts(result)}`,
            metrics: {},
          });
          break;
        }
        delete extra.metrics.webglContexts;
        extras.push(extra);
        if (!extra.supported) break;
      }
      const joined = withPasses(result, extras);
      result = joined.result;
      let fullCostReason = joined.fullCostReason;
      let resources: Awaited<ReturnType<typeof runLoads>>["resources"] | undefined;
      if (result.supported && s.load) {
        const loads = await runLoads(library, s);
        const withLoads = withPasses(result, [loads]);
        result = withLoads.result;
        fullCostReason ??= withLoads.fullCostReason;
        if (loads.supported) resources = loads.resources;
      }
      if (result.supported && s.operation === "memory") {
        const bytes = result.metrics.dataBytes?.samples[0] ?? 0;
        Object.assign(result.metrics, ratios(result.metrics, bytes, CHART_RATIOS));
      }
      const metrics = Object.fromEntries(
        Object.entries(result.metrics).map(([name, m]) => [
          name,
          { ...m, summary: summarize(m.samples) },
        ]),
      );
      rows.push({
        scenario: s.id,
        library,
        status: statusOf(result),
        supported: result.supported,
        reason: result.reason,
        ...(fullCostReason && { fullCostReason }),
        metrics,
        ...(result.distributions && { distributions: result.distributions }),
        ...(resources && { loads: resources }),
      });
      const headline = Object.entries(metrics)[0];
      const text = result.supported
        ? `${headline?.[0]} median ${headline?.[1].summary.median.toFixed(2)} ${headline?.[1].unit}`
        : `${statusOf(result) === "incorrect" ? "incorrect" : "skipped"} (${result.reason})`;
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.log(`${library.padEnd(9)} ${s.id.padEnd(24)} ${text} [${seconds}s]`);
    }

    complete = true;
  } finally {
    // Results gathered so far are written even if the run cannot continue.
    await latency.browser.close().catch(() => {});
    if (realtime !== latency) await realtime.browser.close().catch(() => {});
    pages.close();
    slow?.close();
    writeResults({
      rows,
      renderers,
      verification,
      gpu,
      userAgent,
      browserVersion,
      frameCadence,
      complete,
      order: {
        seed,
        planned: planned.map(({ block, member }) => [block.id, member]),
        attempts,
      },
    });
  }
}

function writeResults(run: {
  rows: ResultRow[];
  renderers: Record<string, unknown>;
  verification: Record<string, string>;
  gpu: string;
  userAgent: string;
  browserVersion: string;
  frameCadence: number | undefined;
  complete: boolean;
  order: { seed: number; planned: [string, string][]; attempts: Attempt[] };
}) {
  const { rows, renderers, verification, gpu, userAgent, browserVersion, frameCadence } = run;
  const output = {
    schema: 1,
    date: new Date().toISOString(),
    commit: commit(),
    /** False when the run stopped early; the results cover what finished. */
    complete: run.complete,
    method: {
      timing:
        browserName === "webkit"
          ? "operation start (the harness's call, or an input's arrival in the page) until the end of the first frame whose drawing a pre-paint check verified (rAF + ResizeObserver + MessageChannel); frames follow vsync, so short operations include waiting for it"
          : "operation start (the harness's call, or an input's arrival in the page) until the end of the first frame whose drawing a pre-paint check verified (rAF + ResizeObserver + MessageChannel); frame rate limit disabled except for paced scenarios (ingest, orbit, trace)",
      verification:
        "each frame checked just before it paints: the library's last draw (read at its draw boundary, per each library's `verification`) against what the operation asked, the same comparison for every library; before timing, the operation once in a page of its own and a screenshot showing the marks where the drawing says; a library failing either is incorrect and untimed",
      input:
        browserName === "chrome"
          ? "trusted input through the DevTools Protocol's Input domain"
          : "trusted input through Playwright's mouse and keyboard, each waiting for the page to receive it",
      memory: measuresMemory
        ? "CDP Runtime.getHeapUsage after forced GC: V8 heap + Blink heap + ArrayBuffer backing stores; ratios over dataBytes (the source data's own bytes): heapRatio = retainedBytes (the median of mounts repeated in one page), firstHeapRatio = firstRetainedBytes, processRatio = rendererBytes, gpuRatio = gpuBytes (first mounts in fresh pages, from the data prepared, the adapter's conversion included), canvasRatio = canvasBytes"
        : "not measured: heap sizes need Chrome's DevTools protocol, so memory scenarios were skipped",
      processMemory: measuresMemory
        ? `separate runs, one fresh page per sample, each a first mount from data prepared to charts mounted, readings after forced GC and a ${PROCESS_SETTLE_MS} ms pause: firstRetainedBytes = heap as above; rendererBytes = the page's renderer process phys_footprint (macOS footprint); gpuBytes = GPU memory the renderer's memory-infra dump lists (webgl buffers and drawing buffers, canvas resources shared with the GPU process, cc tile memory); gpuProcessBytes = the GPU process's phys_footprint`
        : "not measured: after a forced GC this browser keeps freed memory in its process, and it attributes no GPU memory to a page",
      webglDone:
        "second run of each frame-timed scenario in a fresh page: operation start until the verified frame and then a 1-pixel readPixels on every live WebGL context the page created (waits for their GPU work); 2D canvas and compositor rasterization on the GPU are not waited for",
      loads: `scenarios with load cases: navigation start to the first verified frame, a new browser context per sample: cold (empty cache), warmAsset (after one earlier visit in that context), latency (cold through the server's throttle: ${SLOW_4G.latencyMs} ms before each response, ${SLOW_4G.bitsPerSecond / 1e6} Mbit/s shared by response bodies)`,
      sampleScale,
    },
    order: run.order,
    environment: {
      ...machine(),
      browser: `${{ chrome: "Chrome", firefox: "Firefox", webkit: "WebKit" }[browserName]} ${browserVersion}`,
      userAgent,
      gpu,
      headless: args.headless,
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      browserSettings: BROWSER_SETTINGS,
      /** Playwright drives the browser; Firefox and WebKit are its own builds. */
      playwright: packageVersion("playwright"),
      browserBuild: browserBuild(browserName),
      /** Median idle requestAnimationFrame interval in latency scenarios, ms. */
      frameCadence,
    },
    libraries: Object.fromEntries(
      libraries.map((id) => [
        id,
        {
          package: PACKAGES[id] ?? id,
          version: packageVersion(PACKAGES[id] ?? id),
          renderer: renderers[id],
          verification: verification[id],
          runtime: Object.fromEntries(
            (RUNTIMES[id] ?? []).map((name) => [name, packageVersion(name)]),
          ),
        },
      ]),
    ),
    scenarios: Object.fromEntries(scenarios.map((s) => [s.id, s])),
    results: rows,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = args.out
    ? resolve(ROOT, args.out)
    : join(ROOT, "..", "tmp", "benchmarks", `bench-${stamp}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(output, null, 1)}\n`);
  console.log(`\nWrote ${out} (order seed ${run.order.seed})`);
}

/** The Playwright browser build used, from playwright-core's browsers.json; Chrome is the installed one. */
function browserBuild(name: BrowserName): string {
  if (name === "chrome") return "installed Google Chrome";
  try {
    const path = join(ROOT, "..", "node_modules", "playwright-core", "browsers.json");
    const { browsers } = JSON.parse(readFileSync(path, "utf8")) as {
      browsers: { name: string; revision: string; browserVersion?: string }[];
    };
    const build = browsers.find((browser) => browser.name === name);
    return build ? `${name} revision ${build.revision}` : "unknown";
  } catch {
    return "unknown";
  }
}

await main();
