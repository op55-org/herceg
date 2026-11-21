// Pointer-interaction regression benchmark: Herceg's per-move latency and
// main-thread work in seven fixtures (page.ts), each move checked for its
// effect. With `--baseline DIR` (another herceg source tree, main's say) it
// builds the page against both and alternates them in one Chrome session,
// in blocks ordered AB, BA, AB, ..., and compares them block by block.
//
// Two modes. "sustained" sends each move as soon as the last one's effect
// has been drawn, so the input keeps the CPU out of its idle states, as a
// hover or drag does; its figures are the regression gate. "quiet" waits
// 70 ms before each move, as the browser suite's hover rows do: on a
// machine that lowers its clocks while idle, each move then starts cold
// and its latency includes that (benchmarks/README.md, "Pointer
// interactions"), so quiet figures are reported, not gated.
//
// Run from the repository root:
//   node --experimental-strip-types benchmarks/src/interaction/run.ts \
//     [--baseline DIR --baseline-label COMMIT] [--fixture NAME,...] [--mode sustained|quiet|both] \
//     [--blocks 6] [--moves 30] [--warmup 10] [--out benchmarks/results/interaction.json]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { HERCEG_ALIAS, ISOLATION } from "../runner/build.ts";
import { LATENCY_ARGS, scaleFactorArg } from "../runner/chrome.ts";
import { commit, machine, packageVersion } from "../runner/environment.ts";
import { type Summary, summarize } from "../runner/stats.ts";
import type { FixtureName } from "./page.ts";

const FIXTURES: FixtureName[] = [
  "hover-listener",
  "hover-headings",
  "custom-hover",
  "pan-labels",
  "pan-view-labels",
  "anchor-pan",
  "cross-filter",
  "crosshair-dashboard",
];
type Mode = "sustained" | "quiet";
const QUIET_GAP_MS = 70;
/**
 * A gated figure regressed when the median of its paired blocks' ratios
 * (candidate over baseline) and the difference of its medians both pass
 * these. Main against itself stayed within 0.93-1.07 in sustained mode,
 * and 0.25 ms of work added to every frame passed 1.1 in every fixture but
 * the cross-filter in one of two sessions (benchmarks/README.md, "Pointer
 * interactions").
 */
const GATE = { ratio: 1.1, ms: 0.1 };

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    baseline: { type: "string" },
    /** What the baseline is (its commit), for the results. */
    "baseline-label": { type: "string" },
    fixture: { type: "string" },
    mode: { type: "string", default: "both" },
    blocks: { type: "string", default: "6" },
    moves: { type: "string", default: "30" },
    warmup: { type: "string", default: "10" },
  },
});
const BLOCKS = Number(args.blocks);
const MOVES = Number(args.moves);
const WARMUP = Number(args.warmup);
const MODES: Mode[] = args.mode === "both" ? ["sustained", "quiet"] : [args.mode as Mode];
const fixtures = args.fixture ? (args.fixture.split(",") as FixtureName[]) : FIXTURES;
for (const name of fixtures)
  if (!FIXTURES.includes(name)) throw new Error(`--fixture: no fixture ${name}; use ${FIXTURES}`);
for (const mode of MODES)
  if (mode !== "sustained" && mode !== "quiet")
    throw new Error(`--mode: no mode ${mode}; use sustained, quiet, or both`);
for (const [name, value] of Object.entries({ blocks: BLOCKS, moves: MOVES, warmup: WARMUP }))
  if (!Number.isInteger(value) || value < (name === "warmup" ? 0 : 1))
    throw new Error(`--${name}: ${args[name as "blocks"]} is not a count; give a whole number`);

/** Builds the page against a herceg source tree. */
async function bundle(name: string, source: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), `interaction-${name}-`));
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

const sources: [name: string, source: string][] = [["candidate", dirname(HERCEG_ALIAS.herceg)]];
if (args.baseline) sources.push(["baseline", resolve(args.baseline)]);
const builds: [name: string, directory: string][] = [];
for (const [name, source] of sources) builds.push([name, await bundle(name, source)]);

/** What a build was made from: its source tree's commit and changes, and a hash of the bundle. */
function provenance(source: string, directory: string) {
  const git = (...command: string[]) =>
    execFileSync("git", ["-C", source, ...command], { encoding: "utf8" }).trim();
  const hash = createHash("sha256");
  for (const file of readdirSync(directory).sort())
    hash.update(readFileSync(join(directory, file)));
  return {
    source,
    commit: git("rev-parse", "--short", "HEAD"),
    dirty: git("status", "--porcelain", "--", ".") !== "",
    bundle: hash.digest("hex").slice(0, 12),
  };
}
const made = Object.fromEntries(
  builds.map(([name, directory], i) => [
    name,
    {
      ...provenance(sources[i]![1], directory),
      ...(name === "baseline" ? { label: args["baseline-label"] ?? null } : {}),
    },
  ]),
);

const server = createServer((request, response) => {
  const [, name, file = ""] = (request.url ?? "/").split("/");
  const directory = builds.find(([build]) => build === name)?.[1];
  if (!directory) return response.writeHead(404).end();
  if (file === "") {
    response.writeHead(200, { "content-type": "text/html", ...ISOLATION });
    response.end(
      '<!doctype html><body style="margin:0;font:12px system-ui,sans-serif"><div id="stage" style="line-height:0"></div><script type="module" src="page.js"></script></body>',
    );
    return;
  }
  const path = join(directory, file);
  if (!existsSync(path)) return response.writeHead(404).end();
  response.writeHead(200, {
    "content-type": extname(file) === ".js" ? "text/javascript" : "text/plain",
    ...ISOLATION,
  });
  response.end(readFileSync(path));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string") throw new Error("interaction: the server has no port");
const origin = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [...LATENCY_ARGS, scaleFactorArg(2)],
});
const browserVersion = browser.version();

interface Block {
  block: number;
  /** 0 when this build ran first in its block. */
  position: number;
  /**
   * Per measured move: in the latency pass, ms to the frame after its effect
   * (null where it was not drawn within 1 s); in the work pass, main-thread
   * task ms from arming it to its effect's frame.
   */
  samples: (number | null)[];
  missed: number;
}

/** Mounts `fixture` in a fresh page and runs its moves; with `work`, times task time instead of latency. */
async function runBlock(
  name: string,
  fixture: FixtureName,
  mode: Mode,
  work: boolean,
): Promise<Omit<Block, "block" | "position">> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1400 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "UTC",
  });
  const errors: string[] = [];
  try {
    const page: Page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/${name}/`);
    await page.waitForFunction(() => window.interaction !== undefined);
    const { press, moves, checks, screenshot } = await page.evaluate(
      ([fixture, count]) => window.interaction.mount(fixture, count),
      [fixture, WARMUP + MOVES] as const,
    );
    const cdp = await context.newCDPSession(page);
    const taskTime = async () => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return (metrics.find((m) => m.name === "TaskDuration")?.value ?? 0) * 1000;
    };
    if (work) await cdp.send("Performance.enable");
    if (press) {
      await page.mouse.move(press.x, press.y);
      await page.mouse.down();
    }
    const samples: (number | null)[] = [];
    for (const [i, move] of moves.entries()) {
      if (mode === "quiet") await page.waitForTimeout(QUIET_GAP_MS);
      const before = work ? await taskTime() : 0;
      await page.evaluate((index) => window.interaction.arm(index), i);
      await page.mouse.move(move.x, move.y);
      const ms = await page.evaluate(() => window.interaction.result());
      const sample = work && ms !== null ? (await taskTime()) - before : ms;
      if (i >= WARMUP) samples.push(sample);
    }
    // Untimed: moves to places no measured move went, each one's result
    // checked as the page shows it (the live DOM, or a screenshot).
    let wrong: string | undefined;
    for (const [j, move] of checks.entries()) {
      const index = moves.length + j;
      await page.evaluate((index) => window.interaction.arm(index), index);
      await page.mouse.move(move.x, move.y);
      if ((await page.evaluate(() => window.interaction.result())) === null) {
        wrong = `check move ${j + 1} drew no effect within 1 s`;
        break;
      }
      const shot = screenshot ? (await page.screenshot({ scale: "css" })).toString("base64") : "";
      wrong = await page.evaluate(([index, shot]) => window.interaction.verify(index, shot), [
        index,
        shot,
      ] as const);
      if (wrong) {
        wrong = `after check move ${j + 1} of ${checks.length}, ${wrong}`;
        break;
      }
    }
    if (press) await page.mouse.up();
    await page.evaluate(() => window.interaction.unmount());
    if (errors.length) throw new Error(`interaction: ${fixture} (${name}): ${errors[0]}`);
    if (wrong)
      throw new Error(
        `interaction: ${fixture} (${name}): ${wrong}; the fixture or the engine no longer draws what the moves change`,
      );
    return { samples, missed: samples.filter((ms) => ms === null).length };
  } finally {
    await context.close();
  }
}

/** A block's samples whose move drew its effect. */
const valid = (block: Block) => block.samples.filter((ms): ms is number => ms !== null);

interface Result {
  fixture: FixtureName;
  mode: Mode;
  build: string;
  latency: { blocks: Block[]; summary: Summary };
  work: { blocks: Block[]; summary: Summary };
}

const results: Result[] = [];
let missedTotal = 0;
try {
  for (const fixture of fixtures)
    for (const mode of MODES) {
      const runs = new Map(
        builds.map(([name]) => [name, { latency: [] as Block[], work: [] as Block[] }]),
      );
      // Unrecorded, a block of each build first: a session's first pages run
      // slower (5.2 ms against 1.3-1.5 in later blocks), which the block
      // order would charge to the candidate.
      for (const [name] of builds) await runBlock(name, fixture, mode, false);
      for (const work of [false, true])
        for (let block = 0; block < BLOCKS; block++) {
          const order = block % 2 ? [...builds].reverse() : builds;
          for (const [position, [name]] of order.entries()) {
            const run = await runBlock(name, fixture, mode, work);
            missedTotal += run.missed;
            runs.get(name)![work ? "work" : "latency"].push({ block, position, ...run });
          }
        }
      for (const [name, { latency, work }] of runs) {
        const result: Result = {
          fixture,
          mode,
          build: name,
          latency: { blocks: latency, summary: summarize(latency.flatMap(valid)) },
          work: { blocks: work, summary: summarize(work.flatMap(valid)) },
        };
        results.push(result);
        console.log(
          `${fixture.padEnd(20)} ${mode.padEnd(9)} ${name.padEnd(9)} latency p50 ${result.latency.summary.median.toFixed(2)} p95 ${result.latency.summary.p95.toFixed(2)} ms; work ${result.work.summary.median.toFixed(2)} ms/move`,
        );
      }
    }
} finally {
  await browser.close();
  server.close();
  for (const [, directory] of builds) rmSync(directory, { recursive: true, force: true });
}

const comparisons = args.baseline
  ? results
      .filter((r) => r.build === "candidate")
      .flatMap((candidate) => {
        const baseline = results.find(
          (r) =>
            r.build === "baseline" && r.fixture === candidate.fixture && r.mode === candidate.mode,
        )!;
        return (["latency", "work"] as const).map((metric) => {
          const value = (block: Block) => summarize(valid(block)).median;
          const ratios = candidate[metric].blocks.map(
            (block, i) => value(block) / value(baseline[metric].blocks[i]!),
          );
          const ratio = summarize(ratios);
          const ms = candidate[metric].summary.median - baseline[metric].summary.median;
          // The gate's bounds were set for runs of at least the default size.
          const gated = candidate.mode === "sustained" && BLOCKS >= 6 && MOVES >= 30;
          const regressed = gated && ratio.median > GATE.ratio && ms > GATE.ms;
          return {
            fixture: candidate.fixture,
            mode: candidate.mode,
            metric,
            baseline: baseline[metric].summary.median,
            candidate: candidate[metric].summary.median,
            ratio: { median: ratio.median, min: ratio.min, max: ratio.max, blocks: ratios },
            gated,
            regressed,
          };
        });
      })
  : [];
for (const c of comparisons)
  console.log(
    `${c.fixture.padEnd(20)} ${c.mode.padEnd(9)} ${c.metric.padEnd(7)} candidate/baseline ${c.ratio.median.toFixed(3)} (blocks ${c.ratio.min.toFixed(2)}-${c.ratio.max.toFixed(2)}), ${c.baseline.toFixed(2)} -> ${c.candidate.toFixed(2)} ms${c.regressed ? "  REGRESSED" : ""}`,
  );

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
          "Chrome (headless, frame rate limit and vsync off, device pixel ratio 2, viewport 1280x1400, cross-origin isolated pages), a fresh page per block; esbuild production build; real pointer moves through the DevTools Protocol, each checked for its effect; latency runs from the move's first pointermove to a MessageChannel message posted from the requestAnimationFrame after its effect was drawn (null when not drawn within 1 s); work is the main-thread TaskDuration between a reading before each move is armed and one after its latency resolved (the move's work and the harness's evaluations), in a separate pass; sustained mode sends each move once the last was drawn, quiet mode waits 70 ms before each; with a baseline, blocks alternate AB/BA and comparisons are medians of the ratios of paired blocks' medians",
        environment: {
          ...machine(),
          browser: `Chrome ${browserVersion}`,
          herceg: packageVersion("herceg"),
        },
        builds: made,
        blocks: BLOCKS,
        moves: MOVES,
        warmup: WARMUP,
        gate: GATE,
        results,
        comparisons,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`Wrote ${out}`);
}
if (missedTotal > 0) {
  console.error(`interaction: ${missedTotal} moves drew no effect within 1 s`);
  process.exitCode = 1;
}
if (comparisons.some((c) => c.regressed)) {
  console.error("interaction: the candidate regressed against the baseline (REGRESSED above)");
  process.exitCode = 1;
}
