// Joins the proofs the declarations oblige with the contract tests the runs
// executed: every obliged proof passed, in its suite, in every required
// browser engine, proved by one test; every executed contract is declared,
// and none is of a cell declared unproved, which a proof makes works.

import { ENGINES, SUITES } from "./suites.mjs";

/**
 * Errors of the evidence for `proofs` (`{ id, suite, for }`) in
 * `executions` of the suites `checked`. Proofs of other suites are not
 * checked, nor are executions of them; `engines` are the browser engines a
 * browser suite's proofs must pass in.
 */
export function checkEvidence({ proofs, executions, runs, checked, engines = ENGINES }) {
  const errors = [];
  const byId = new Map();
  for (const execution of executions) {
    if (!byId.has(execution.id)) byId.set(execution.id, []);
    byId.get(execution.id).push(execution);
  }
  for (const suite of checked) {
    const ran = runs[suite]?.browsers;
    if (SUITES[suite].runs !== "browser" || !ran) continue;
    const missing = engines.filter((engine) => !ran.includes(engine));
    if (missing.length > 0)
      errors.push(
        `${suite}: ran without ${missing.join(", ")}; run every engine, or narrow --browsers`,
      );
  }

  const obliged = new Map();
  for (const proof of proofs) {
    const known = obliged.get(proof.id);
    if (known?.suite && proof.suite && known.suite !== proof.suite)
      errors.push(
        `${proof.id}: obliged in ${known.suite} (${known.for}) and ${proof.suite} (${proof.for})`,
      );
    obliged.set(proof.id, {
      ...known,
      ...proof,
      suite: proof.suite ?? known?.suite,
      // Optional only if every cell naming it says so; awaited if any does.
      optional: (known?.optional ?? true) && proof.optional === true,
      unproved: known?.unproved === true || proof.unproved === true,
    });
  }

  for (const [id, { suite, for: cell, optional, unproved }] of obliged) {
    const runsOf = byId.get(id) ?? [];
    if (unproved) {
      if (runsOf.length > 0)
        errors.push(
          `${id}: proved by ${runsOf[0].test}, but declared unproved (${cell}); declare it works`,
        );
      continue;
    }
    if (suite !== undefined && !Object.hasOwn(SUITES, suite)) {
      errors.push(
        `${id}: obliged in suite ${JSON.stringify(suite)}, which does not exist (${cell})`,
      );
      continue;
    }
    // A checked suite's run of a proof another suite owes is misplaced, whichever suites are checked.
    if (suite !== undefined)
      for (const runSuite of new Set(runsOf.map((run) => run.suite)))
        if (runSuite !== suite)
          errors.push(`${id}: proved in ${runSuite}, but its cell needs ${suite} (${cell})`);
    if (suite !== undefined && !checked.includes(suite)) continue;
    if (runsOf.length === 0) {
      if (optional) continue;
      if (suite !== undefined || checked.length === Object.keys(SUITES).length)
        errors.push(`${id}: no test proves it (for ${cell})`);
      continue;
    }
    const tests = [...new Set(runsOf.map((run) => `${run.suite}: ${run.test}`))];
    if (tests.length > 1)
      errors.push(`${id}: proved by ${tests.length} tests; one proves it: ${tests.join("; ")}`);
    // One test runs once in each engine: two runs alike are two tests of one name, or one marked twice.
    const seen = new Set();
    for (const run of runsOf) {
      const where = `${run.suite} (${run.engine})`;
      if (seen.has(where)) errors.push(`${id}: proved twice in ${where}: ${run.test}`);
      seen.add(where);
    }
    for (const run of runsOf)
      if (run.status !== "passed")
        errors.push(
          `${id}: ${run.status} in ${run.suite}${run.engine ? ` (${run.engine})` : ""}: ${run.test}`,
        );
    for (const runSuite of new Set(runsOf.map((run) => run.suite))) {
      if (SUITES[runSuite]?.runs !== "browser") continue;
      const passed = runsOf.filter((run) => run.suite === runSuite && run.status === "passed");
      if (passed.some((run) => !ENGINES.includes(run.engine)))
        errors.push(`${id}: ${runSuite} recorded no browser engine; prove it with contractTest`);
      const missing = engines.filter((engine) => !passed.some((run) => run.engine === engine));
      if (missing.length > 0)
        errors.push(`${id}: not passed in ${missing.join(", ")} (${runSuite})`);
    }
  }

  for (const [id, runsOf] of byId)
    if (!obliged.has(id))
      errors.push(
        `${id}: proved by ${runsOf[0].test}, but no declaration names it; declare it, or drop the test`,
      );
  return errors;
}
