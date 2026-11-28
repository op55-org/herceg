// Runs a test suite so that it leaves evidence the contract check reads
// (scripts/check-contracts.mjs): `node scripts/contracts/run.mjs <suite> --
// <command...>` runs the command with its reporter writing its report in
// tmp/contracts/<source>/, then, once the report is written and only if the
// source did not change meanwhile, its run record: what ran, how it ended,
// and the report's hash.
//
// A Node or Python suite's report is <suite>.json (Vitest) or .xml (pytest),
// with the record <suite>.run.json. A browser suite keeps a record per
// engine, <suite>.<engine>.run.json, each naming the report of the run that
// ran it (<suite>.<engines>.json, the engines joined by "+"), so that a run
// of some engines (`HERCEG_BROWSERS`, as CI runs each in a step of its own)
// replaces only their evidence.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { runDirectory, sourceState } from "./source.mjs";
import { chosenEngines, SUITES } from "./suites.mjs";

const [suite, separator, command, ...args] = process.argv.slice(2);
if (!suite || separator !== "--" || !command)
  throw new Error("usage: node scripts/contracts/run.mjs <suite> -- <command> [args...]");
if (!Object.hasOwn(SUITES, suite))
  throw new Error(`run: no suite "${suite}"; name one of ${Object.keys(SUITES).join(", ")}`);

const source = sourceState();
const directory = runDirectory(source);
mkdirSync(directory, { recursive: true });
const { runs } = SUITES[suite];
const browsers = runs === "browser" ? chosenEngines(process.env.HERCEG_BROWSERS) : [];
const name = runs === "browser" ? `${suite}.${browsers.join("+")}` : suite;
const report = join(directory, `${name}.${runs === "python" ? "xml" : "json"}`);
const records =
  runs === "browser"
    ? browsers.map((engine) => ({ engine, path: join(directory, `${suite}.${engine}.run.json`) }))
    : [{ path: join(directory, `${suite}.run.json`) }];
for (const { path } of records) rmSync(path, { force: true });
rmSync(report, { force: true });

const reporter =
  runs === "python"
    ? [`--junitxml=${report}`]
    : ["--reporter=default", "--reporter=json", `--outputFile.json=${report}`];
const { status, signal } = spawnSync(command, [...args, ...reporter], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

const after = sourceState();
if (after.revision !== source.revision || after.sourceHash !== source.sourceHash)
  console.error(`run: the source changed while ${suite} ran; its report proves nothing`);
else if (existsSync(report)) {
  const written = {
    suite,
    ...source,
    command: [command, ...args].join(" "),
    browsers,
    node: process.version,
    exitCode: status ?? null,
    signal: signal ?? null,
    report: basename(report),
    reportHash: createHash("sha256").update(readFileSync(report)).digest("hex"),
  };
  for (const { engine, path } of records) {
    const record = engine === undefined ? written : { ...written, engine };
    writeFileSync(`${path}.part`, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(`${path}.part`, path);
  }
}
if (signal) process.kill(process.pid, signal);
process.exit(status ?? 1);
