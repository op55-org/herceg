// `npm run test:browser`: the engine's, the adapters', and python/js's
// browser suites in the engines HERCEG_BROWSERS names (every engine when
// unset), each leaving its report for the contract check, then the
// ease-of-use samples, which run in Chrome only, when Chrome is named. Each
// suite runs whether or not the ones before it passed, so a failure hides no
// other suite's results; the run fails if any suite did.

import { spawnSync } from "node:child_process";
import { root } from "../contracts/source.mjs";
import { chosenEngines } from "../contracts/suites.mjs";

// Each suite's name and command.
const suites = [
  ["herceg", "npm run test:browser -w herceg"],
  ["@herceg/react", "npm run test:browser -w @herceg/react"],
  ["@herceg/vue", "npm run test:browser -w @herceg/vue"],
  ["@herceg/svelte", "npm run test:browser -w @herceg/svelte"],
  [
    "python/js",
    "node scripts/contracts/run.mjs python-js -- vitest run --config python/js/vitest.config.ts",
  ],
];
if (chosenEngines(process.env.HERCEG_BROWSERS).includes("chromium"))
  suites.push(["ease-of-use samples", "vitest run --config benchmarks/vitest.config.ts"]);

const failed = [];
for (const [name, line] of suites) {
  const [command, ...args] = line.split(" ");
  const { status, signal } = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (status !== 0) failed.push(`${name} (${signal ?? `exit code ${status}`})`);
}
if (failed.length > 0) {
  console.error(`test:browser: ${failed.join(", ")} failed`);
  process.exit(1);
}
