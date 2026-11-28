// The test suites whose reports prove contracts: each run by its command
// through scripts/contracts/run.mjs, which leaves its report and a run
// record in tmp/contracts/<source>/ (see source.mjs).

/** Browser engines every browser suite must pass in, as scripts/browser/browsers.ts runs them. */
export const ENGINES = ["chromium", "firefox", "webkit"];

/** The engines `HERCEG_BROWSERS` (a comma-separated list) names, in ENGINES' order; every engine when unset. */
export function chosenEngines(value) {
  if (value === undefined) return ENGINES;
  const names = value.split(",").map((name) => name.trim());
  for (const name of names)
    if (!ENGINES.includes(name))
      throw new Error(
        `HERCEG_BROWSERS: no browser "${name}"; name chromium, firefox, or webkit, comma-separated`,
      );
  return ENGINES.filter((engine) => names.includes(engine));
}

/**
 * Each suite: the command that runs it from the repository root, and where
 * its tests run ("node", "browser", or "python").
 */
export const SUITES = {
  "herceg-unit": { command: "npm test", runs: "node" },
  "herceg-browser": { command: "npm run test:browser -w herceg", runs: "browser" },
  react: { command: "npm run test:browser -w @herceg/react", runs: "browser" },
  vue: { command: "npm run test:browser -w @herceg/vue", runs: "browser" },
  svelte: { command: "npm run test:browser -w @herceg/svelte", runs: "browser" },
  "python-js": { command: "npm run test:browser (python/js)", runs: "browser" },
  python: { command: "npm run test:python", runs: "python" },
  "python-web": { command: "npm run test:python-web", runs: "browser" },
};
