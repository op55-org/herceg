// Runs a test suite so that it leaves evidence the contract check reads
// (scripts/check-contracts.mjs): `node scripts/contracts/run.mjs <suite> --
// <command...>` runs the command with its reporter writing
// tmp/contracts/<source>/<suite>.json (Vitest) or .xml (pytest), then, once
// the report is written and only if the source did not change meanwhile,
// <suite>.run.json: what ran, how it ended, and the report's hash.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDirectory, sourceState } from "./source.mjs";
import { ENGINES, SUITES } from "./suites.mjs";

const [suite, separator, command, ...args] = process.argv.slice(2);
if (!suite || separator !== "--" || !command)
  throw new Error("usage: node scripts/contracts/run.mjs <suite> -- <command> [args...]");
if (!Object.hasOwn(SUITES, suite))
  throw new Error(`run: no suite "${suite}"; name one of ${Object.keys(SUITES).join(", ")}`);

const source = sourceState();
const directory = runDirectory(source);
mkdirSync(directory, { recursive: true });
const python = SUITES[suite].runs === "python";
const report = join(directory, `${suite}.${python ? "xml" : "json"}`);
const record = join(directory, `${suite}.run.json`);
rmSync(record, { force: true });
rmSync(report, { force: true });

const reporter = python
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
  const browsers =
    SUITES[suite].runs === "browser"
      ? (process.env.HERCEG_BROWSERS?.split(",").map((name) => name.trim()) ?? ENGINES)
      : [];
  const written = {
    suite,
    ...source,
    command: [command, ...args].join(" "),
    browsers,
    node: process.version,
    exitCode: status ?? null,
    signal: signal ?? null,
    reportHash: createHash("sha256").update(readFileSync(report)).digest("hex"),
  };
  writeFileSync(`${record}.part`, `${JSON.stringify(written, null, 2)}\n`);
  renameSync(`${record}.part`, record);
}
if (signal) process.kill(process.pid, signal);
process.exit(status ?? 1);
