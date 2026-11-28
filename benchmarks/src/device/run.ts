// Device runner: the chart suite's scenarios in Safari through safaridriver,
// on an attached iPhone (by UDID) or, as a dry run, in Safari on this Mac.
// The pages, adapters, verified frames, and checks are the browser suite's
// (page/harness.ts); WebDriver loads the pages, calls them, and sends input
// through its actions, which Safari dispatches as trusted events: taps on
// the phone (it has no hover; a tap shows the readout), mouse moves on the
// Mac. Every (scenario, library) is checked before it is timed, in the
// seeded order the browser suite uses. The phone loads the pages from this
// Mac over the local network. See benchmarks/README.md, "Device runner",
// for the settings it needs.
//
//   npm run bench:device -- --udid UDID [--host 192.168.1.20]
//   npm run bench:device -- --desktop
//     [--lib herceg,echarts] [--scenario line-small-init,...] [--sample-scale 0.5]
//     [--order-seed N] [--out results/device.json]

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Metric, Mounted, PageResult, PointerResult } from "../page/harness.ts";
import { buildPage, ROOT, serve } from "../runner/build.ts";
import { COMPARED, commit, machine, PACKAGES, packageVersion } from "../runner/environment.ts";
import { orderSeed, schedule } from "../runner/order.ts";
import { notMounted, type Status, statusOf } from "../runner/results.ts";
import { summarize } from "../runner/stats.ts";
import { SCENARIOS, type Scenario } from "../scenarios/index.ts";
import { type ActionSource, newSession, type Session, WebDriverError } from "./webdriver.ts";

const { values: args } = parseArgs({
  options: {
    udid: { type: "string" },
    desktop: { type: "boolean", default: false },
    /** The Mac's address the phone reaches the pages at; the first non-loopback IPv4 address otherwise. */
    host: { type: "string" },
    lib: { type: "string" },
    scenario: { type: "string" },
    "sample-scale": { type: "string", default: "1" },
    "order-seed": { type: "string" },
    out: { type: "string" },
  },
});
if (!args.desktop && !args.udid)
  throw new Error(
    "bench:device: give --udid UDID for an iPhone, or --desktop for Safari on this Mac",
  );

/**
 * The scenarios run by default: initial render, updates, streaming, zoom,
 * resize, hover (taps), and a dashboard at the sizes a phone handles. Memory
 * readings need Chrome's DevTools protocol, and sustained traces a driver
 * that sends without waiting, so neither runs here.
 */
const DEVICE_SCENARIOS = [
  "line-small-init",
  "line-medium-init",
  "bar-small-init",
  "scatter-medium-init",
  "heatmap-medium-init",
  "line-medium-update",
  "bar-medium-update",
  "stream-dashboard-chart",
  "ingest-chart-60hz",
  "zoom-line-large",
  "resize-line-medium",
  "hover-line-medium",
  "hover-scatter-medium",
  "dashboard",
];
const UNSUPPORTED = new Set(["memory", "trace"]);

const sampleScale = Number(args["sample-scale"]);
const seed = orderSeed(args["order-seed"]);
const libraries = args.lib ? args.lib.split(",") : COMPARED;
const wanted = args.scenario ? args.scenario.split(",") : DEVICE_SCENARIOS;
const scenarios = wanted.map((id) => {
  const s = SCENARIOS.find((candidate) => candidate.id === id);
  if (!s) throw new Error(`--scenario: no scenario ${id}`);
  if (UNSUPPORTED.has(s.operation))
    throw new Error(`--scenario: ${id} (${s.operation}) does not run on devices`);
  return {
    ...s,
    samples: Math.max(1, Math.round(s.samples * sampleScale)),
    warmup: Math.round(s.warmup * Math.min(1, sampleScale)),
  };
});

/** Spacing between taps, as the browser suite spaces hover moves. */
const TAP_SPACING_MS = 70;

/** What the owner sets up once, printed when a session cannot start. */
const SETUP = `Safari's WebDriver needs, on this Mac (once):
  1. Safari > Settings > Advanced: "Show features for web developers".
  2. Safari > Develop > "Allow Remote Automation".
  3. In a terminal: safaridriver --enable  (asks for an administrator password).
and for an iPhone, in addition:
  4. iPhone: Settings > Apps > Safari > Advanced: "Web Inspector" and "Remote Automation" on.
  5. Connect it by cable, unlock it, and trust this Mac; keep it unlocked and awake while the run lasts
     (Settings > Display & Brightness > Auto-Lock: Never).
  6. Its UDID: Finder, the phone's page, click the line under its name until the UDID shows (or: xcrun xctrace list devices).
  7. The phone and this Mac on the same network, which lets this Mac's port through (macOS firewall: allow node).`;

/** A free TCP port on this Mac for safaridriver. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

/** The first non-loopback IPv4 address: where the phone reaches this Mac. */
function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces()))
    for (const address of addresses ?? [])
      if (address.family === "IPv4" && !address.internal) return address.address;
  throw new Error("bench:device: this Mac has no network address the phone can reach; give --host");
}

/** Starts safaridriver and waits until it answers. */
async function startDriver(): Promise<{ endpoint: string; driver: ChildProcess }> {
  const port = await freePort();
  const driver = spawn("/usr/bin/safaridriver", ["--port", String(port)], { stdio: "inherit" });
  const endpoint = `http://127.0.0.1:${port}`;
  for (const start = Date.now(); Date.now() - start < 10_000; ) {
    try {
      if ((await fetch(`${endpoint}/status`)).ok) return { endpoint, driver };
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  driver.kill();
  throw new Error("bench:device: safaridriver did not start");
}

/**
 * Calls `window.bench[name](...args)` in the page and returns its value; a
 * rejection in the page is thrown here.
 */
async function bench<T>(session: Session, name: string, ...params: unknown[]): Promise<T> {
  const answer = await session.executeAsync<{ value?: T; error?: string }>(
    `const [name, params, done] = arguments;
     Promise.resolve()
       .then(() => window.bench[name](...params))
       .then((value) => done({ value }), (error) => done({ error: String((error && error.stack) || error) }));`,
    [name, params],
  );
  if (answer.error !== undefined) throw new Error(`page: ${answer.error.split("\n")[0]}`);
  return answer.value as T;
}

/** Opens a library's page afresh and waits for its harness. */
async function open(session: Session, origin: string, library: string): Promise<void> {
  await session.navigate(`${origin}/${library}.html`);
  const ready = await session.executeAsync<boolean>(
    `const done = arguments[arguments.length - 1];
     const start = Date.now();
     (function wait() {
       if (window.bench) done(true);
       else if (Date.now() - start > 30000) done(false);
       else setTimeout(wait, 50);
     })();`,
  );
  if (!ready) throw new Error(`bench:device: ${library}'s page did not load its harness`);
}

/** A tap at a point on the phone, a mouse move on the Mac: the input that shows a readout there. */
function pointAt(target: { x: number; y: number }): ActionSource[] {
  const x = Math.round(target.x);
  const y = Math.round(target.y);
  if (args.desktop)
    return [
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [{ type: "pointerMove", x, y, duration: 0, origin: "viewport" }],
      },
    ];
  return [
    {
      type: "pointer",
      id: "finger",
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", x, y, duration: 0, origin: "viewport" },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: 50 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ];
}

/** The event a timed hover starts at: the tap's pointerdown on the phone, the move's pointermove on the Mac. */
const hoverEvent = args.desktop ? "pointermove" : "pointerdown";

/**
 * Pointer moves are whole numbers of CSS pixels in WebDriver: the targets
 * are rounded so the page's arrival check (within 1 px) matches.
 */
async function pointer(session: Session, target: { x: number; y: number }): Promise<PointerResult> {
  const at = { x: Math.round(target.x), y: Math.round(target.y) };
  await bench(session, "armPointer", at, {}, hoverEvent);
  await session.perform(pointAt(at));
  await session.releaseActions();
  return bench<PointerResult>(session, "pointerLatency");
}

async function runHover(session: Session, s: Scenario): Promise<PageResult> {
  const mounted = await bench<Mounted>(session, "mount", s);
  if (!mounted.supported) return notMounted(mounted);
  const targets = await bench<{ x: number; y: number }[]>(
    session,
    "hoverTargets",
    s,
    s.warmup + s.samples,
  );
  const latency: Metric = { unit: "ms", samples: [] };
  const rejected: Metric = { unit: "count", samples: [] };
  for (const [i, target] of targets.entries()) {
    await new Promise((done) => setTimeout(done, TAP_SPACING_MS));
    const result = await pointer(session, target);
    if ("reason" in result)
      return { supported: false, incorrect: true, reason: result.reason, metrics: {} };
    if (i < s.warmup) continue;
    latency.samples.push(result.latency);
    rejected.samples.push(result.rejected);
  }
  await bench(session, "unmount");
  return {
    supported: true,
    metrics: {
      [args.desktop ? "pointerToFrame" : "tapToFrame"]: latency,
      rejectedFrames: rejected,
    },
  };
}

/** The check before timing: the operation once, verified, then a screenshot showing the marks. */
async function runCheck(session: Session, s: Scenario): Promise<PageResult> {
  const mounted = await bench<Mounted>(session, "mount", s);
  if (!mounted.supported) return notMounted(mounted);
  let wrong: string | undefined;
  if (s.operation === "hover") {
    const [target] = await bench<{ x: number; y: number }[]>(session, "hoverTargets", s, 1);
    const result = await pointer(session, target!);
    if ("reason" in result) wrong = result.reason;
  } else wrong = await bench<string | undefined>(session, "preflight", s);
  if (!wrong)
    wrong = await bench<string | undefined>(session, "pixelCheck", s, await session.screenshot());
  await bench(session, "unmount");
  if (wrong) return { supported: false, incorrect: true, reason: wrong, metrics: {} };
  return { supported: true, metrics: {} };
}

/** What the page says about where it runs: the viewport, its scale, isolation, and the timer's resolution. */
const PAGE_ENVIRONMENT = `
  let step = Infinity;
  for (let i = 0, last = performance.now(); i < 100000 && step === Infinity; i++) {
    const now = performance.now();
    if (now > last) step = now - last;
    last = now;
  }
  return {
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    orientation: screen.orientation ? screen.orientation.type : innerWidth > innerHeight ? "landscape" : "portrait",
    visualScale: visualViewport ? visualViewport.scale : 1,
    devicePixelRatio,
    crossOriginIsolated,
    timerResolution: step,
  };`;

async function main() {
  for (const library of libraries) await buildPage(library);
  const pages = await serve({ host: args.desktop ? "127.0.0.1" : (args.host ?? lanAddress()) });
  const { endpoint, driver } = await startDriver();
  const capabilities = args.desktop
    ? { browserName: "safari" }
    : {
        browserName: "safari",
        platformName: "iOS",
        "safari:useSimulator": false,
        "safari:deviceUDID": args.udid,
      };
  let session: Session;
  try {
    session = await newSession(endpoint, capabilities);
  } catch (error) {
    driver.kill();
    pages.close();
    if (error instanceof WebDriverError) {
      console.error(
        `bench:device: Safari's WebDriver refused a session (${error.message}).\n\n${SETUP}`,
      );
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  const rows: unknown[] = [];
  const attempts: {
    scenario: string;
    library: string;
    pass: string;
    status: Status;
    seconds: number;
  }[] = [];
  const planned = schedule(seed, scenarios, () => libraries);
  let environment: Record<string, unknown> = {};
  let complete = false;
  try {
    // The longest operation's limit, with room for the page to answer.
    await session.timeouts({ script: 300_000, pageLoad: 60_000 });
    await open(session, pages.origin, libraries[0]!);
    // Safari matched the session to what was asked: this Mac, or a phone.
    const platform = String(session.capabilities.platformName ?? "").toLowerCase();
    const wantedPlatform = args.desktop ? /^mac/ : /^ios/;
    if (!wantedPlatform.test(platform))
      throw new Error(
        `bench:device: the session runs on "${platform}", not ${args.desktop ? "this Mac" : "an iPhone"}`,
      );
    environment = {
      ...(await session.execute<Record<string, unknown>>(PAGE_ENVIRONMENT)),
      frameCadence: await bench<number>(session, "refreshInterval"),
    };
    const attempt = async (library: string, s: Scenario, pass: "check" | "main") => {
      const started = performance.now();
      let result: PageResult;
      try {
        await open(session, pages.origin, library);
        result =
          pass === "check"
            ? await runCheck(session, s)
            : s.operation === "hover"
              ? await runHover(session, s)
              : await bench<PageResult>(session, "run", s, {});
      } catch (error) {
        result = {
          supported: false,
          reason: `error: ${(error as Error).message.split("\n")[0]}`,
          metrics: {},
        };
      }
      attempts.push({
        scenario: s.id,
        library,
        pass,
        status: statusOf(result),
        seconds: (performance.now() - started) / 1000,
      });
      return result;
    };
    for (const { block: s, member: library } of planned) {
      const check = await attempt(library, s, "check");
      const result = check.supported ? await attempt(library, s, "main") : check;
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
        metrics,
        ...(result.distributions && { distributions: result.distributions }),
      });
      const headline = Object.entries(metrics)[0];
      console.log(
        `${library.padEnd(9)} ${s.id.padEnd(24)} ${
          result.supported
            ? `${headline?.[0]} median ${headline?.[1].summary.median.toFixed(2)} ${headline?.[1].unit}`
            : `${statusOf(result)} (${result.reason})`
        }`,
      );
    }
    complete = true;
  } finally {
    await session.close().catch(() => {});
    driver.kill();
    pages.close();
    const output = {
      schema: 1,
      suite: "device",
      date: new Date().toISOString(),
      commit: commit(),
      complete,
      method: {
        timing:
          "the browser suite's: operation start (the harness's call, or the input's arrival in the page) until the end of the first frame whose drawing a pre-paint check verified; Safari runs with its frame rate following the display (no flags), so short operations include waiting for it",
        input: args.desktop
          ? "WebDriver actions (safaridriver): mouse moves, dispatched by Safari as trusted events"
          : "WebDriver actions (safaridriver): taps (touch pointer down and up), dispatched by Safari as trusted events; hover scenarios time a tap from its pointerdown to the readout",
        checks:
          "each (scenario, library) checked before it is timed, as in the browser suite; WebDriver's screenshot is in device pixels and the check reads it in CSS pixels",
        pages:
          "served from this Mac over plain HTTP; on the phone that is not a secure context, so pages are not cross-origin isolated and the timer's resolution is Safari's coarser one (environment.page.timerResolution)",
        sampleScale,
      },
      order: { seed, planned: planned.map(({ block, member }) => [block.id, member]), attempts },
      environment: {
        host: machine(),
        target: args.desktop ? "Safari on this Mac" : "iPhone (by UDID; the UDID is not recorded)",
        // What Safari says it matched, without the device's identifier.
        capabilities: Object.fromEntries(
          Object.entries(session.capabilities).filter(([key]) => !/udid/i.test(key)),
        ),
        page: environment,
      },
      libraries: Object.fromEntries(
        libraries.map((id) => [
          id,
          { package: PACKAGES[id] ?? id, version: packageVersion(PACKAGES[id] ?? id) },
        ]),
      ),
      scenarios: Object.fromEntries(scenarios.map((s) => [s.id, s])),
      results: rows,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = args.out
      ? resolve(ROOT, args.out)
      : join(ROOT, "..", "tmp", "benchmarks", `device-${stamp}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(output, null, 1)}\n`);
    console.log(`\nWrote ${out} (order seed ${seed})`);
  }
}

await main();
