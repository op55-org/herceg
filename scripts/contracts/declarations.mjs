// The contract declarations in test/contracts/: what each capability
// promises, every row's cell of each, and the other contracts' IDs. Checked
// here for shape and completeness, and turned into the proofs they oblige:
// a contract ID and the suite it must run in, where one is required.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUITES } from "./suites.mjs";

const FILES = ["capabilities", "marks", "express", "interaction", "behaviors", "api"];

/** The ChartError codes a refusal may carry (packages/herceg/src/spec/errors.ts). */
export const CODES = [
  "invalid-option",
  "unknown-field",
  "field-type",
  "series-varies",
  "series-with-values",
  "unknown-reference",
  "unsupported",
  "layout-failed",
  "load-failed",
  "render-failed",
];

/** Where a mark row is something on each surface. */
export const SURFACES = ["spec", "typescript", "python", "helper", "react", "vue", "svelte"];

/** The spec's contracts both languages keep, with the cases each surface proves. */
const SPEC_CONTRACTS = "packages/herceg/test/fixtures/contracts.json";

/** The documented defaults both languages keep (see api.json). */
const DEFAULTS = "test/contracts/fixtures/defaults.json";

/**
 * The parsed declaration files, by name, the spec contracts' fixture as
 * `spec`, and the API audit's defaults as `defaults`.
 */
export function readDeclarations(root) {
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  return {
    ...Object.fromEntries(FILES.map((name) => [name, read(`test/contracts/${name}.json`)])),
    spec: read(SPEC_CONTRACTS),
    defaults: read(DEFAULTS),
  };
}

/**
 * The proofs of a spec contract's case on each surface: every case its
 * spec's (the engine loads it, or refuses it); a drawn case its mark
 * functions', each adapter's, and each Python front end's; a case Python
 * builds, Python's, and if drawn its transports'. Python's helpers and
 * panels prove the drawn cases they can make (one mark that has a helper;
 * a chart of no panels), so their proofs are not obliged.
 */
function specProofs({ cases, exports }) {
  const proofs = [];
  const optional = [];
  for (const { contract, code, builder } of cases) {
    proofs.push([`${contract}.spec`, "herceg-unit"]);
    if (builder !== undefined) proofs.push([`${contract}.python`, "python"]);
    if (code !== undefined) continue;
    proofs.push([`${contract}.factory`, "herceg-unit"]);
    for (const adapter of ["react", "vue", "svelte"])
      proofs.push([`${contract}.${adapter}`, adapter]);
    for (const front of ["widget", "streamlit", "web"])
      proofs.push([`${contract}.${front}`, "python-js"]);
    if (builder === undefined) continue;
    proofs.push([`${contract}.transport`, "python"]);
    optional.push(`${contract}.helper`, `${contract}.panel`);
  }
  for (const { contract } of exports)
    proofs.push([`${contract}.spec`, "herceg-unit"], [`${contract}.python`, "python"]);
  return { proofs, optional };
}

/** "location: problem; correction", the shape of every error message. */
const SHAPED = /^[^:]+: .+; .+$/s;

/**
 * Each row's cells, as `{ row, capability, state, ...declaration }`, and
 * errors where a row declares a capability twice, none, or one that does
 * not exist, or a cell's declaration is malformed.
 */
function cellsOf(table, rows, capabilities, required, errors) {
  const cells = [];
  for (const [row, declared] of Object.entries(rows)) {
    const seen = new Map();
    const add = (capability, state, details) => {
      const where = `${table} ${row} ${capability}`;
      if (!(capability in capabilities))
        errors.push(`${where}: no such capability in capabilities.json`);
      else if (seen.has(capability))
        errors.push(`${where}: declared ${seen.get(capability)} and ${state}; declare it once`);
      else if (!required.includes(capability))
        errors.push(`${where}: not a capability of ${table}; drop it`);
      seen.set(capability, state);
      cells.push({ row, capability, state, ...details });
    };
    for (const capability of declared.works ?? []) add(capability, "works", {});
    // Declared to work, with no test proving it yet: nothing is obliged, and a proof upgrades it.
    for (const capability of declared.unproved ?? []) add(capability, "unproved", {});
    for (const [capability, refusal] of Object.entries(declared.refused ?? {})) {
      const where = `${table} ${row} ${capability}`;
      const { error, alternative } = refusal;
      if (!CODES.includes(error?.code))
        errors.push(
          `${where}: refused with code ${JSON.stringify(error?.code)}; name a ChartError code`,
        );
      if (typeof error?.message !== "string" || !SHAPED.test(error.message))
        errors.push(`${where}: the refusal's message must read "location: problem; correction"`);
      if (typeof alternative?.text !== "string" || !alternative.text)
        errors.push(`${where}: a refusal names its alternative in alternative.text`);
      if (!Array.isArray(alternative?.proofs) || alternative.proofs.length === 0)
        errors.push(`${where}: a refusal's alternative needs the proofs that it works`);
      add(capability, "refused", refusal);
    }
    for (const [capability, reason] of Object.entries(declared.na ?? {})) {
      const where = `${table} ${row} ${capability}`;
      if (typeof reason !== "string" || !reason)
        errors.push(`${where}: not applicable needs its reason`);
      else if (capabilities[capability] && capabilities[capability].na === null)
        errors.push(`${where}: ${capability} is never not applicable; declare it works or refused`);
      add(capability, "na", { reason });
    }
    for (const capability of required)
      if (!seen.has(capability)) errors.push(`${table} ${row}: declares nothing of ${capability}`);
  }
  return cells;
}

/**
 * Checks the declarations' shape and completeness. Returns the errors, the
 * matrix's cells, and the proofs they oblige: `{ id, suite, for }`, the
 * suite undefined where any suite may prove it; and, `unproved`, those of
 * what is declared to work with no test proving it yet, which none may.
 */
export function checkDeclarations({
  capabilities,
  marks,
  express,
  interaction,
  behaviors,
  spec,
  defaults,
}) {
  const errors = [];
  const defined = capabilities.capabilities;
  const grouped = capabilities.groups.flatMap((group) => group.capabilities);
  // Groups `for` Express are recipes' alone; marks declare the others'.
  const ofMarks = capabilities.groups
    .filter((group) => group.for === undefined)
    .flatMap((group) => group.capabilities);
  for (const group of capabilities.groups)
    if (group.for !== undefined && group.for !== "express")
      errors.push(`capabilities.json group ${group.id}: for names "express" or nothing`);
  for (const id of grouped)
    if (!(id in defined)) errors.push(`capabilities.json groups: ${id} is not defined`);
  for (const id of Object.keys(defined)) {
    const count = grouped.filter((listed) => listed === id).length;
    if (count !== 1) errors.push(`capabilities.json ${id}: in ${count} groups; list it in one`);
    if (!Object.hasOwn(SUITES, defined[id].suite))
      errors.push(
        `capabilities.json ${id}: suite ${JSON.stringify(defined[id].suite)}; name one of ${Object.keys(SUITES).join(", ")}`,
      );
  }

  const cells = [
    ...cellsOf("marks", marks.rows, defined, ofMarks, errors).map((cell) => ({
      table: "marks",
      ...cell,
    })),
    ...cellsOf("express", express.recipes, defined, express.capabilities, errors).map((cell) => ({
      table: "express",
      ...cell,
    })),
  ];
  for (const capability of express.capabilities)
    if (!(capability in defined)) errors.push(`express.json capabilities: no ${capability}`);

  for (const [row, { inventory, absent = {} }] of Object.entries(marks.rows)) {
    for (const surface of SURFACES) {
      if (!(surface in (inventory ?? {})))
        errors.push(`marks ${row} inventory: names nothing on ${surface}; give its name or null`);
      else if (inventory[surface] === null && !absent[surface])
        errors.push(`marks ${row} inventory: no ${surface} without a reason in absent.${surface}`);
    }
  }

  const proofs = [];
  const oblige = (id, suite, cell) => proofs.push({ id, suite, for: cell });
  // A proof awaited (an unproved cell's): no test may prove it until it is declared works.
  const awaitProof = (id, suite, cell) => proofs.push({ id, suite, for: cell, unproved: true });
  const proofOf = (cell) =>
    cell.table === "marks"
      ? `${cell.row}.${cell.capability}`
      : `${cell.row}.${cell.capability}.python`;
  /** The proofs of refused and not-applicable cells, which prove nothing works. */
  const unproving = new Set(
    cells.filter((cell) => cell.state === "refused" || cell.state === "na").map(proofOf),
  );
  const awaited = new Set(cells.filter((cell) => cell.state === "unproved").map(proofOf));
  for (const cell of cells) {
    const name = `${cell.table} ${cell.row} ${cell.capability}`;
    if (cell.state === "unproved") {
      awaitProof(
        proofOf(cell),
        cell.table === "marks" ? defined[cell.capability]?.suite : "python",
        name,
      );
      continue;
    }
    if (cell.table === "marks") {
      const capability = defined[cell.capability];
      if (!capability) continue;
      oblige(`${cell.row}.${cell.capability}`, capability.suite, name);
      // A capability's shared proofs are its own suite's, beside its cells'.
      for (const id of capability.shared ?? []) oblige(id, capability.suite, name);
    } else oblige(`${cell.row}.${cell.capability}.python`, "python", name);
    for (const id of cell.alternative?.proofs ?? []) {
      // What works instead is proved working, not refused or absent.
      if (unproving.has(id))
        errors.push(
          `${name}: the alternative's proof ${id} proves a refusal or an absence; name a proof of what works instead`,
        );
      if (awaited.has(id))
        errors.push(
          `${name}: the alternative's proof ${id} is of a cell not proved yet; name a proof of what works instead`,
        );
      oblige(id, undefined, `${name}'s alternative`);
    }
  }
  for (const [name, { title, proofs: ids, unproved }] of Object.entries(express.utilities ?? {})) {
    if (!title || !(ids?.length > 0 || unproved?.length > 0))
      errors.push(`express.json utilities.${name}: give a title and the proofs of what it does`);
    for (const id of ids ?? []) oblige(id, "python", `express utility ${name}`);
    for (const id of unproved ?? []) awaitProof(id, "python", `express utility ${name}`);
  }
  for (const [path, { title, when, proofs: ids }] of Object.entries(
    capabilities.gpu?.paths ?? {},
  )) {
    if (!title || !when || !(ids?.length > 0))
      errors.push(
        `capabilities.json gpu.paths.${path}: give a title, when it is taken, and proofs`,
      );
    for (const id of ids ?? []) oblige(id, "herceg-browser", `gpu path ${path}`);
  }
  const suites = interaction.suites ?? {};
  for (const kind of ["cells", "fixture", "web"])
    if (!Object.hasOwn(SUITES, suites[kind] ?? ""))
      errors.push(
        `interaction.json suites.${kind}: no suite ${JSON.stringify(suites[kind])}; name the suite proving them`,
      );
  for (const id of interaction.cells) oblige(`${id}.engine`, suites.cells, "interaction.json");
  for (const id of interaction.fixture) {
    oblige(`${id}.engine`, suites.fixture, "interaction.json fixture");
    oblige(`${id}.python`, "python", "interaction.json fixture");
  }
  for (const id of interaction.web) oblige(id, suites.web, "interaction.json web");
  for (const [id, suite] of Object.entries(behaviors.contracts))
    if (!Object.hasOwn(SUITES, suite))
      errors.push(`behaviors.json ${id}: no suite ${JSON.stringify(suite)}`);
  for (const [id, suite] of Object.entries(behaviors.contracts))
    oblige(id, suite, "behaviors.json");
  for (const { contract } of defaults?.defaults ?? [])
    proofs.push(
      { id: `${contract}.spec`, suite: "herceg-unit", for: DEFAULTS },
      { id: `${contract}.python`, suite: "python", for: DEFAULTS },
    );
  const specContracts = specProofs(spec);
  for (const [id, suite] of specContracts.proofs) oblige(id, suite, SPEC_CONTRACTS);
  // Proofs that may run where a test can make the case, and must pass where they run.
  for (const id of specContracts.optional)
    proofs.push({ id, suite: "python", for: SPEC_CONTRACTS, optional: true });
  // A proof obliged only where no suite is named (an alternative's, a capability's shared ones) could pass anywhere.
  const named = new Set(proofs.filter(({ suite }) => suite !== undefined).map(({ id }) => id));
  for (const { id, for: by } of proofs)
    if (!named.has(id)) {
      errors.push(
        `${by}: no declaration names the suite proving ${id}; declare it where it is proved`,
      );
      named.add(id);
    }
  // What awaits a proof is proved only once its cell is declared works, not by naming it elsewhere.
  const awaiting = new Map(proofs.filter((p) => p.unproved).map((p) => [p.id, p.for]));
  for (const { id, for: by, unproved } of proofs)
    if (!unproved && awaiting.has(id))
      errors.push(
        `${by}: names ${id}, which ${awaiting.get(id)} declares unproved; declare that cell works instead`,
      );
  return { errors, cells, proofs };
}
