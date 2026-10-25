// Checks the contract declarations (test/contracts/) against the code and
// the test runs of the source checked out:
//
//   node scripts/check-contracts.mjs                 every suite's evidence
//   node scripts/check-contracts.mjs --suite python  that suite's alone
//   node scripts/check-contracts.mjs --declarations  the declarations alone
//
// The declarations must be complete (every row declares every capability
// of its table once), name what exists, and cover everything the surfaces
// offer, under the names api.json's audit expects (contracts/api.mjs), and
// every adapter component must have a compile-time check (contracts/props.mjs). A
// suite's evidence is its last complete run of this exact source
// (scripts/contracts/run.mjs): every proof the declarations oblige passed
// there, in its suite and in every browser engine (`--browsers chromium`
// narrows them), proved by one test; no test proves an undeclared contract,
// or a cell declared unproved (declared to work, with no test proving it
// yet), which the check lists and a proof makes works.

import { parseArgs } from "node:util";
import { auditsOf, checkApi } from "./contracts/api.mjs";
import { checkDeclarations, readDeclarations } from "./contracts/declarations.mjs";
import { readEvidence } from "./contracts/evidence.mjs";
import { checkInventory, discoverInventory } from "./contracts/inventory.mjs";
import { checkPropChecks } from "./contracts/props.mjs";
import { root, runDirectory, sourceState } from "./contracts/source.mjs";
import { ENGINES, SUITES } from "./contracts/suites.mjs";
import { checkEvidence } from "./contracts/verify.mjs";

/**
 * Checks the declarations and, unless `declarationsOnly`, the evidence of
 * `suites` (every suite by default): their runs of `source` (the tree
 * checked out) in `directory`. Returns the errors and what was read.
 */
export function checkContracts({
  declarationsOnly = false,
  suites,
  engines = ENGINES,
  source = sourceState(),
  directory = runDirectory(source),
} = {}) {
  const declarations = readDeclarations(root);
  const { errors, cells, proofs } = checkDeclarations(declarations);
  const inventory = discoverInventory(root);
  errors.push(...checkInventory(declarations, inventory));
  errors.push(...checkApi(declarations.api, auditsOf(declarations.marks, inventory.options)));
  errors.push(...checkPropChecks(root));
  if (declarationsOnly) return { errors, declarations, cells, proofs };
  const checked = suites ?? Object.keys(SUITES);
  for (const suite of checked)
    if (!Object.hasOwn(SUITES, suite))
      throw new Error(
        `check-contracts: no suite "${suite}"; name one of ${Object.keys(SUITES).join(", ")}`,
      );
  const { errors: unread, executions, runs } = readEvidence(directory, checked, source);
  errors.push(...unread);
  errors.push(...checkEvidence({ proofs, executions, runs, checked, engines }));
  return { errors, declarations, cells, proofs, executions, runs, checked };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      declarations: { type: "boolean" },
      suite: { type: "string", multiple: true },
      browsers: { type: "string" },
    },
  });
  const engines = values.browsers?.split(",").map((name) => name.trim());
  const result = checkContracts({
    declarationsOnly: values.declarations,
    suites: values.suite,
    engines,
  });
  const scope = values.declarations
    ? "the declarations"
    : values.suite
      ? `suites ${values.suite.join(", ")} (not every suite: not a complete check)`
      : "every suite";
  for (const error of result.errors) console.error(`  ${error}`);
  // What is declared to work with no test proving it yet, which no error stands for.
  const unproved = new Map(result.proofs.filter((p) => p.unproved).map((p) => [p.id, p.for]));
  for (const [id, cell] of unproved) console.log(`  unproved: ${id} (${cell})`);
  const proofs = new Set(result.proofs.filter((p) => !p.unproved).map((p) => p.id));
  console.log(
    `contracts: ${result.cells.length} cells, ${proofs.size} proofs, ${unproved.size} unproved; checked ${scope}: ${result.errors.length === 0 ? "ok" : `${result.errors.length} errors`}`,
  );
  process.exit(result.errors.length === 0 ? 0 : 1);
}
