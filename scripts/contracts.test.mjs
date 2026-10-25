// Tests of the contract tooling (scripts/check-contracts.mjs and its
// modules) on declarations and reports made up here.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkContracts } from "./check-contracts.mjs";
import { auditsOf, checkApi } from "./contracts/api.mjs";
import { checkDeclarations } from "./contracts/declarations.mjs";
import { junitExecutions, readEvidence, vitestExecutions } from "./contracts/evidence.mjs";
import { checkInventory, settingsOfType } from "./contracts/inventory.mjs";
import { exportedComponents, uncheckedComponents } from "./contracts/props.mjs";
import { ENGINES, SUITES } from "./contracts/suites.mjs";
import { checkEvidence } from "./contracts/verify.mjs";
import { capabilityMarkdown, capabilityRecords } from "./generate-capabilities.mjs";

const inventory = {
  spec: "line",
  typescript: "line",
  python: "Chart.line",
  helper: "line",
  react: "Line",
  vue: "Line",
  svelte: "Line",
};

/** Declarations of two capabilities and one row, with `row` over the row's cells. */
function declarations(row = {}, extra = {}) {
  return {
    capabilities: {
      groups: [
        {
          id: "placement",
          title: "Placement",
          capabilities: ["placement.panel", "legend.colorbar"],
        },
      ],
      capabilities: {
        "placement.panel": {
          title: "Named panel",
          works: "draws there",
          na: null,
          suite: "herceg-unit",
        },
        "legend.colorbar": {
          title: "Colorbar",
          works: "a ramp",
          na: "no color scale",
          suite: "herceg-unit",
        },
      },
    },
    marks: {
      rows: {
        line: {
          title: "line",
          inventory,
          works: ["placement.panel"],
          na: { "legend.colorbar": "no ramp" },
          ...row,
        },
      },
      unlisted: {},
    },
    express: { capabilities: [], recipes: {}, utilities: {} },
    interaction: {
      suites: { cells: "herceg-browser", fixture: "herceg-browser", web: "herceg-browser" },
      placements: ["chart"],
      fixture: [],
      cells: [],
      web: [],
    },
    // The proof of a refusal's alternative (below), declared with its suite.
    behaviors: { contracts: { "line.alone": "herceg-unit" } },
    spec: { cases: [], exports: [] },
    api: {
      about: ["Python spells options in snake_case."],
      audits: { "chart helper": { spelled: { x: { as: "x_axis", reason: "x is a column" } } } },
    },
    defaults: { defaults: [{ contract: "default.line.curve" }] },
    ...extra,
  };
}

const passed = (id, suite = "herceg-unit", engine = "node", file = "a.test.ts") => ({
  id,
  suite,
  engine,
  test: `${file} > [contract:${id}]`,
  status: "passed",
});

const everySuite = Object.keys(SUITES);
const runs = Object.fromEntries(everySuite.map((suite) => [suite, { browsers: ENGINES }]));
const check = (proofs, executions, checked = everySuite) =>
  checkEvidence({ proofs, executions, runs, checked });

test("a complete declaration obliges each cell's proof in its capability's suite", () => {
  const { errors, cells, proofs } = checkDeclarations(declarations());
  assert.deepEqual(errors, []);
  assert.deepEqual(
    cells.map(({ row, capability, state }) => [row, capability, state]),
    [
      ["line", "placement.panel", "works"],
      ["line", "legend.colorbar", "na"],
    ],
  );
  assert.deepEqual(
    proofs.map(({ id, suite }) => [id, suite]),
    [
      ["line.placement.panel", "herceg-unit"],
      ["line.legend.colorbar", "herceg-unit"],
      ["line.alone", "herceg-unit"],
      // A documented default, proved in the spec and in Python.
      ["default.line.curve.spec", "herceg-unit"],
      ["default.line.curve.python", "python"],
    ],
  );
});

test("declarations fail where a row declares a capability twice, none, or an unknown one", () => {
  const twice = checkDeclarations(declarations({ works: ["placement.panel", "legend.colorbar"] }));
  assert.match(
    twice.errors.join("\n"),
    /line legend.colorbar: declared works and na; declare it once/,
  );
  const none = checkDeclarations(declarations({ na: {} }));
  assert.match(none.errors.join("\n"), /marks line: declares nothing of legend.colorbar/);
  const unknown = checkDeclarations(declarations({ works: ["placement.panel", "placement.moon"] }));
  assert.match(unknown.errors.join("\n"), /line placement.moon: no such capability/);
});

test("a refusal needs a ChartError code, a shaped message, and an alternative with proofs", () => {
  const refused = (refusal) =>
    checkDeclarations(
      declarations({ works: [], refused: { "placement.panel": refusal } }),
    ).errors.join("\n");
  const good = {
    error: {
      code: "unsupported",
      path: "panel",
      message: "line panel: not here; draw it in a chart of its own",
    },
    alternative: { text: "A chart of its own.", proofs: ["line.alone"] },
  };
  assert.equal(refused(good), "");
  const { proofs } = checkDeclarations(
    declarations({ works: [], refused: { "placement.panel": good } }),
  );
  assert.ok(proofs.some((proof) => proof.id === "line.alone" && proof.suite === undefined));
  assert.match(
    refused({ ...good, error: { ...good.error, code: "nope" } }),
    /name a ChartError code/,
  );
  assert.match(
    refused({ ...good, error: { ...good.error, message: "line panel cannot" } }),
    /location: problem; correction/,
  );
  assert.match(
    refused({ ...good, alternative: { text: "Something.", proofs: [] } }),
    /needs the proofs/,
  );
  // A refusal's or an absence's proof shows nothing working.
  for (const proof of ["line.placement.panel", "line.legend.colorbar"])
    assert.match(
      refused({ ...good, alternative: { text: "Itself.", proofs: [proof] } }),
      new RegExp(`the alternative's proof ${proof} proves a refusal or an absence`),
    );
});

test("every proof is obliged in a suite that exists", () => {
  const declared = declarations();
  declared.capabilities.capabilities["placement.panel"].suite = "herceg-unitt";
  declared.behaviors.contracts["dashboard.drawing.react"] = "reactt";
  // A name every object has is no suite either.
  declared.behaviors.contracts["dashboard.panels.react"] = "constructor";
  assert.deepEqual(checkDeclarations(declared).errors, [
    `capabilities.json placement.panel: suite "herceg-unitt"; name one of ${Object.keys(SUITES).join(", ")}`,
    'behaviors.json dashboard.drawing.react: no suite "reactt"',
    'behaviors.json dashboard.panels.react: no suite "constructor"',
  ]);
  const proofs = [
    { id: "line.placement.panel", suite: "herceg-unitt", for: "marks line" },
    { id: "line.legend.toggle", suite: "toString", for: "marks line" },
  ];
  assert.deepEqual(check(proofs, []), [
    'line.placement.panel: obliged in suite "herceg-unitt", which does not exist (marks line)',
    'line.legend.toggle: obliged in suite "toString", which does not exist (marks line)',
  ]);
});

test("every proof has a suite: an alternative's proof is declared where it is proved", () => {
  const unnamed = declarations({}, { behaviors: { contracts: {} } });
  unnamed.marks.rows.line.works = [];
  unnamed.marks.rows.line.refused = {
    "placement.panel": {
      error: { code: "unsupported", path: "panel", message: "line panel: not here; draw it alone" },
      alternative: { text: "Alone.", proofs: ["line.alone"] },
    },
  };
  assert.deepEqual(checkDeclarations(unnamed).errors, [
    "marks line placement.panel's alternative: no declaration names the suite proving line.alone; declare it where it is proved",
  ]);
  const suiteless = declarations();
  delete suiteless.interaction.suites.web;
  assert.deepEqual(checkDeclarations(suiteless).errors, [
    "interaction.json suites.web: no suite undefined; name the suite proving them",
  ]);
});

test("not applicable needs a reason, and only where the capability allows it", () => {
  const errors = checkDeclarations(
    declarations({ works: ["legend.colorbar"], na: { "placement.panel": "it floats" } }),
  ).errors.join("\n");
  assert.match(errors, /placement.panel is never not applicable/);
  const reasonless = checkDeclarations(declarations({ na: { "legend.colorbar": "" } })).errors;
  assert.match(reasonless.join("\n"), /not applicable needs its reason/);
});

test("a surface without a name needs the reason it has none", () => {
  const { errors } = checkDeclarations(declarations({ inventory: { ...inventory, helper: null } }));
  assert.match(errors.join("\n"), /no helper without a reason in absent.helper/);
  const reasoned = checkDeclarations(
    declarations({
      inventory: { ...inventory, helper: null },
      absent: { helper: "no one-call chart" },
    }),
  );
  assert.deepEqual(reasoned.errors, []);
});

test("the inventory fails both ways: an undeclared mark, and a declared one that is gone", () => {
  const found = {
    spec: ["line", "bar"],
    typescript: ["line"],
    python: ["Chart.line", "Chart.columns"],
    helper: ["line"],
    react: ["Line"],
    vue: ["Line"],
    svelte: ["Line", "Chart"],
    express: [],
  };
  const declared = declarations();
  declared.marks.unlisted = {
    python: { "Chart.columns": "places panels" },
    svelte: { Chart: "the chart" },
  };
  assert.deepEqual(checkInventory(declared, found), [
    "spec bar: neither a row nor listed in marks.json's unlisted; declare it",
  ]);
  assert.deepEqual(checkInventory(declared, { ...found, spec: ["bar"] }), [
    "spec bar: neither a row nor listed in marks.json's unlisted; declare it",
    "spec line: marks.json names it, but it does not exist; drop it",
  ]);
});

test("recipes declare the capabilities express.json lists, those of Express groups alone", () => {
  const declared = declarations();
  declared.capabilities.groups.push({
    id: "express",
    title: "Express",
    for: "express",
    capabilities: ["express.recompute"],
  });
  declared.capabilities.capabilities["express.recompute"] = {
    title: "Recompute",
    works: "made again",
    na: null,
    suite: "python",
  };
  declared.express = {
    capabilities: ["placement.panel", "express.recompute"],
    recipes: { lineplot: { title: "lineplot", inventory: "lineplot", works: ["placement.panel"] } },
    utilities: { recompute: { title: "made again", proofs: ["express.recompute.reuse.python"] } },
  };
  const { errors, proofs } = checkDeclarations(declared);
  // The mark declares nothing of the Express group; the recipe must.
  assert.deepEqual(errors, ["express lineplot: declares nothing of express.recompute"]);
  declared.express.recipes.lineplot.works.push("express.recompute");
  declared.express.utilities.recompute.proofs = [];
  const again = checkDeclarations(declared);
  assert.deepEqual(again.errors, [
    "express.json utilities.recompute: give a title and the proofs of what it does",
  ]);
  assert.deepEqual(
    proofs
      .filter(({ for: cell }) => !cell.startsWith("marks") && !cell.endsWith("defaults.json"))
      .map(({ id, suite }) => [id, suite]),
    [
      ["lineplot.placement.panel.python", "python"],
      ["express.recompute.reuse.python", "python"],
      ["line.alone", "herceg-unit"],
    ],
  );
  const found = { ...Object.fromEntries(Object.keys(inventory).map((k) => [k, [inventory[k]]])) };
  assert.deepEqual(checkInventory(declared, { ...found, express: ["lineplot", "kdeplot"] }), [
    "express kdeplot: neither a row nor listed in express.json's utilities; declare it",
    "express recompute: express.json names it, but it does not exist; drop it",
  ]);
});

test("evidence fails where a proof is missing, skipped, failed, or proved twice", () => {
  const proofs = [
    { id: "line.placement.panel", suite: "herceg-unit", for: "marks line placement.panel" },
  ];
  assert.deepEqual(check(proofs, [passed("line.placement.panel")]), []);
  assert.deepEqual(check(proofs, []), [
    "line.placement.panel: no test proves it (for marks line placement.panel)",
  ]);
  assert.match(
    check(proofs, [{ ...passed("line.placement.panel"), status: "skipped" }]).join("\n"),
    /line.placement.panel: skipped in herceg-unit/,
  );
  assert.match(
    check(proofs, [
      passed("line.placement.panel"),
      passed("line.placement.panel", "herceg-unit", "node", "b.test.ts"),
    ]).join("\n"),
    /proved by 2 tests/,
  );
  // Two tests of one name, or one test marked twice, run alike.
  assert.deepEqual(
    check(proofs, [passed("line.placement.panel"), passed("line.placement.panel")]),
    [
      "line.placement.panel: proved twice in herceg-unit (node): a.test.ts > [contract:line.placement.panel]",
    ],
  );
});

test("evidence fails where a proof ran in another suite, or not in every browser engine", () => {
  const proofs = [
    { id: "line.render.canvas", suite: "herceg-browser", for: "marks line render.canvas" },
  ];
  const inBrowsers = (engines) =>
    engines.map((engine) => passed("line.render.canvas", "herceg-browser", engine));
  assert.deepEqual(check(proofs, inBrowsers(ENGINES)), []);
  assert.deepEqual(check(proofs, inBrowsers(["chromium", "webkit"])), [
    "line.render.canvas: not passed in firefox (herceg-browser)",
  ]);
  assert.match(
    check(proofs, [passed("line.render.canvas")]).join("\n"),
    /proved in herceg-unit, but its cell needs herceg-browser/,
  );
  // Checking the suite it ran in alone, too.
  const inReact = ENGINES.map((engine) => passed("line.render.canvas", "react", engine));
  assert.deepEqual(check(proofs, inReact, ["react"]), [
    "line.render.canvas: proved in react, but its cell needs herceg-browser (marks line render.canvas)",
  ]);
  // Narrowed engines, for a local run in one browser.
  assert.deepEqual(
    checkEvidence({
      proofs,
      executions: inBrowsers(["chromium"]),
      runs,
      checked: everySuite,
      engines: ["chromium"],
    }),
    [],
  );
});

test("a browser suite run in fewer engines than required fails, unless narrowed", () => {
  const narrow = { ...runs, react: { browsers: ["chromium"] } };
  assert.deepEqual(
    checkEvidence({ proofs: [], executions: [], runs: narrow, checked: ["react"] }),
    ["react: ran without firefox, webkit; run every engine, or narrow --browsers"],
  );
  assert.deepEqual(
    checkEvidence({
      proofs: [],
      executions: [],
      runs: narrow,
      checked: ["react"],
      engines: ["chromium"],
    }),
    [],
  );
});

test("a contract no declaration names is obsolete evidence", () => {
  assert.deepEqual(check([], [passed("line.placement.moon")]), [
    "line.placement.moon: proved by a.test.ts > [contract:line.placement.moon], but no declaration names it; declare it, or drop the test",
  ]);
});

test("a suite's check leaves out other suites' proofs, and says nothing is missing elsewhere", () => {
  const proofs = [
    { id: "line.placement.panel", suite: "herceg-unit", for: "x" },
    { id: "line.integration.react", suite: "react", for: "y" },
    { id: "line.alone", suite: undefined, for: "z" },
  ];
  assert.deepEqual(check(proofs, [passed("line.placement.panel")], ["herceg-unit"]), []);
  assert.deepEqual(check(proofs, [passed("line.placement.panel")]), [
    "line.integration.react: no test proves it (for y)",
    "line.alone: no test proves it (for z)",
  ]);
});

test("optional proofs may be absent, and must pass where they run", () => {
  const proofs = [{ id: "case.helper", suite: "python", for: "f", optional: true }];
  assert.deepEqual(check(proofs, []), []);
  assert.match(
    check(proofs, [{ ...passed("case.helper", "python", "python"), status: "failed" }]).join("\n"),
    /case.helper: failed in python/,
  );
});

test("an unproved cell obliges no proof, and fails once a test proves it until it is declared works", () => {
  const declared = declarations({ unproved: ["placement.panel"], works: [] });
  const { errors, cells, proofs } = checkDeclarations(declared);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    cells.map(({ capability, state }) => [capability, state]),
    [
      ["placement.panel", "unproved"],
      ["legend.colorbar", "na"],
    ],
  );
  // The fixture's other proofs aside.
  const of = (errors) => errors.filter((error) => error.startsWith("line.placement.panel"));
  assert.deepEqual(of(check(proofs, [])), []);
  assert.deepEqual(of(check(proofs, [passed("line.placement.panel")])), [
    "line.placement.panel: proved by a.test.ts > [contract:line.placement.panel], but declared unproved (marks line placement.panel); declare it works",
  ]);
  // Declared works, it is obliged again.
  assert.deepEqual(of(check(checkDeclarations(declarations()).proofs, [])), [
    "line.placement.panel: no test proves it (for marks line placement.panel)",
  ]);
  // Declared elsewhere, it is still the cell's to prove.
  const elsewhere = declarations({ unproved: ["placement.panel"], works: [] });
  elsewhere.behaviors.contracts["line.placement.panel"] = "herceg-unit";
  const named = checkDeclarations(elsewhere);
  assert.deepEqual(named.errors, [
    "behaviors.json: names line.placement.panel, which marks line placement.panel declares unproved; declare that cell works instead",
  ]);
  assert.match(
    check(named.proofs, [passed("line.placement.panel")]).join("\n"),
    /line\.placement\.panel: proved by .*, but declared unproved/,
  );
});

test("an alternative names a proof of what works, not of a cell unproved", () => {
  const unproved = { title: "area", inventory, unproved: ["placement.panel"], works: [] };
  const declared = declarations({
    works: [],
    refused: {
      "placement.panel": {
        error: { code: "unsupported", message: "line panel: not here; draw it as an area" },
        alternative: { text: "Draw it as an area.", proofs: ["area.placement.panel"] },
      },
    },
  });
  declared.marks.rows.area = { ...unproved, na: { "legend.colorbar": "no ramp" } };
  assert.ok(
    checkDeclarations(declared).errors.includes(
      "marks line placement.panel: the alternative's proof area.placement.panel is of a cell not proved yet; name a proof of what works instead",
    ),
  );
});

test("Vitest's and pytest's reports are read into contract executions", () => {
  const vitest = {
    testResults: [
      {
        name: join(process.cwd(), "packages/herceg/test/x.test.ts"),
        assertionResults: [
          {
            fullName: "x [contract:a.b] case",
            status: "passed",
            meta: { contract: "a.b", engine: "webkit" },
          },
          // A skipped test runs no code, so it records no metadata; its name says its contract.
          { fullName: "x [contract:a.c]", status: "skipped", meta: {} },
          { fullName: "plain test", status: "passed", meta: {} },
        ],
      },
    ],
  };
  assert.deepEqual(
    vitestExecutions(vitest, "herceg-browser").map(({ id, engine, status }) => [
      id,
      engine,
      status,
    ]),
    [
      ["a.b", "webkit", "passed"],
      ["a.c", undefined, "skipped"],
    ],
  );
  const xml = `<testsuites><testsuite>
    <testcase classname="tests.test_x" name="test_a"><properties><property name="contract" value="a.python"/></properties></testcase>
    <testcase classname="tests.test_x" name="test_b[1]"><properties><property name="contract" value="b.python"/></properties><skipped message="no"/></testcase>
    <testcase classname="tests.test_x" name="test_c"><properties><property name="contract" value="c.python"/></properties><failure message="x"/></testcase>
    <testcase classname="tests.test_x" name="test_d"/>
  </testsuite></testsuites>`;
  assert.deepEqual(
    junitExecutions(xml, "python").map(({ id, status, test }) => [id, status, test]),
    [
      ["a.python", "passed", "tests.test_x::test_a"],
      ["b.python", "skipped", "tests.test_x::test_b[1]"],
      ["c.python", "failed", "tests.test_x::test_c"],
    ],
  );
});

test("evidence is a suite's complete run of this source, whose report is the one it wrote", () => {
  const directory = mkdtempSync(join(tmpdir(), "contracts-"));
  const report = JSON.stringify({ testResults: [] });
  const hash = createHash("sha256").update(report).digest("hex");
  writeFileSync(join(directory, "react.json"), report);
  const source = { revision: "abc", sourceHash: "def" };
  const read = () => readEvidence(directory, ["react"], source).errors;
  const record = (fields) =>
    writeFileSync(
      join(directory, "react.run.json"),
      JSON.stringify({ suite: "react", ...source, exitCode: 0, reportHash: hash, ...fields }),
    );
  assert.deepEqual(read(), [
    "react: no complete run of this source; run npm run test:browser -w @herceg/react",
  ]);
  record({ reportHash: "other" });
  assert.match(read()[0], /its report is not the one its run wrote/);
  record({ exitCode: 1 });
  assert.match(read()[0], /ended with exit code 1/);
  // A record copied from another run proves nothing here.
  for (const other of [{ suite: "vue" }, { revision: "abd" }, { sourceHash: "deg" }]) {
    record(other);
    assert.match(read()[0], /its run record is of another suite or source/);
  }
  record({});
  assert.deepEqual(read(), []);
});

test("the docs list each cell, linked to its proof, with refusals' messages and alternatives and the reasons", () => {
  const declared = declarations({
    works: [],
    refused: {
      "placement.panel": {
        error: { code: "unsupported", message: "line panel: not here; draw it alone" },
        alternative: { text: "Draw it alone.", proofs: ["line.alone"] },
      },
    },
  });
  declared.capabilities.gpu = {
    about: "Where a GPU draws, in an element <Chart> as `<Chart>`.",
    paths: { points: { title: "Points", when: "100,000 points", proofs: ["gpu.points"] } },
  };
  declared.interaction.cells = ["interaction.zoom-x.chart"];
  Object.assign(declared.api.audits["chart helper"], {
    choices: { tooltip: { takes: ["*", "nearest"], reason: "any mode, checked later" } },
    untyped: { limits: "a dict" },
  });
  const { cells, proofs } = checkDeclarations(declared);
  // An interaction cell is proved by the engine's `<cell>.engine`, whose file its record names.
  const executions = [
    passed("interaction.zoom-x.chart.engine", "herceg-browser", "chromium", "zoom.test.ts"),
    passed("line.placement.panel", "herceg-unit", "node", "placement.test.ts"),
    passed("line.alone", "herceg-unit", "node", "alone.test.ts"),
    passed("gpu.points", "herceg-browser", "chromium", "gpu.test.ts"),
  ];
  const records = capabilityRecords({ declarations: declared, cells, proofs, executions });
  assert.deepEqual(records.marks.line.cells["legend.colorbar"], {
    state: "na",
    reason: "no ramp",
    proofs: [{ id: "line.legend.colorbar", file: undefined }],
  });
  assert.deepEqual(records.interaction.cells, [
    { id: "interaction.zoom-x.chart", file: "../zoom.test.ts" },
  ]);
  assert.deepEqual(records.marks.line.cells["placement.panel"].alternative.proofs, [
    { id: "line.alone", file: "../alone.test.ts" },
  ]);
  const markdown = capabilityMarkdown(records);
  // Each mark links to the file proving it (an unrun proof has none).
  assert.match(markdown, /\| line \| \[✗1\]\(\.\.\/placement\.test\.ts\) \| ·2 \|/);
  assert.match(
    markdown,
    /1\. line, Named panel: refused: `line panel: not here; draw it alone`\. Instead: Draw it alone\. \(\[`line\.alone`\]\(\.\.\/alone\.test\.ts\)\)/,
  );
  assert.match(markdown, /2\. line, Colorbar: not applicable: no ramp/);
  // What Markdown would read as HTML is text, but in code spans.
  assert.match(markdown, /an element &lt;Chart> as `<Chart>`/);
  assert.match(markdown, /\| zoom-x \| \[✓\]\(\.\.\/zoom\.test\.ts\) \|/);
  assert.match(
    markdown,
    /\| Points \| 100,000 points \| \[`gpu\.points`\]\(\.\.\/gpu\.test\.ts\) \|/,
  );
  assert.match(
    markdown,
    /## Names across surfaces\n\nPython spells options in snake_case\.\n[\s\S]*- `chart helper`\n {2}- `x` is `x_axis`: x is a column\n/,
  );
  assert.match(markdown, /- `tooltip` takes any string, "nearest": any mode, checked later\n/);
  assert.match(markdown, /- `limits`'s settings are typed on one side alone: a dict\n/);
});

/** Settings as the inventory finds them: their options' choices, those of their own settings, and their type's name. */
const held = (options, nested = {}, type = undefined) => ({ options, nested, type });

/** What the inventory finds of a chart of lines, alike on every surface, with `change` over it. */
function surfaces(change = (options) => options) {
  const line = { x: [], curve: ["linear", "step"], color: ["*"], label: [], data: [] };
  const { data, ...factory } = line;
  // HelperOptions: the keywords Python's helper takes for its chart, and their settings.
  const helper = { keywords: { title: [], zoom: ["x", "y"] }, nested: {} };
  const methods = { line: { x: [], curve: ["linear", "step"], color: ["*"], label: [], data: [] } };
  // A line's label: { text, place }, its place { side, offset }, in each surface (Python's hg.Label).
  const label = () => ({
    label: held(
      { text: ["*"], place: [] },
      { place: held({ side: ["end", "start"], offset: [] }) },
    ),
  });
  return change({
    marks: { line },
    factories: { line: factory },
    marksNested: { line: label() },
    factoriesNested: { line: label() },
    chart: {
      spec: { title: [], interaction: [] },
      nested: { interaction: held({ zoom: ["x", "y"] }) },
      typescript: { title: [], interaction: [] },
      typescriptNested: { interaction: held({ zoom: ["x", "y"] }) },
      react: { title: [], interaction: [], onHover: [] },
      svelte: { title: [], interaction: [], onhover: [] },
      vue: { title: [], interaction: [] },
    },
    panel: { spec: { id: [] }, nested: {}, typescript: { id: [] }, typescriptNested: {} },
    inset: { spec: { place: [] }, nested: {}, typescript: { place: [] }, typescriptNested: {} },
    handle: ["getViewport", "setViewport"],
    vueFlags: { Line: { flags: ["dodge"], booleans: ["dodge"] } },
    events: { typescript: ["hover"], react: ["onHover"], svelte: ["onhover"], vue: ["hover"] },
    python: {
      methods,
      panelMethods: structuredClone(methods),
      helpers: {
        line: {
          data: [],
          x: [],
          curve: ["linear", "step"],
          color: ["*"],
          label: [],
          "**HelperOptions": [],
        },
      },
      chart: { title: [], zoom: ["x", "y"] },
      update: { title: [], zoom: ["x", "y"] },
      helper: helper.keywords,
      panel: { id: [] },
      panelClass: { id: [] },
      inset: { id: [], place: [] },
      events: ["on_hover"],
      widget: ["viewport"],
      express: { lineplot: { hue: ["*"], orient: ["x", "y"] }, barplot: { hue: ["*"] } },
      // The chart's options each function making a chart unpacks.
      unpacked: {
        helpers: { line: "HelperOptions" },
        express: { lineplot: "HelperOptions", barplot: "HelperOptions" },
      },
      unpackedTypes: { HelperOptions: helper },
      // Seaborn's functions of the Express functions' names: their keywords, and their keyword dicts' settings.
      seaborn: { keywords: { lineplot: ["hue", "orient"], barplot: ["hue"] }, settings: {} },
      nested: {
        chart: {},
        update: {},
        helper: helper.nested,
        methods: { line: label() },
        panelMethods: { line: label() },
        helpers: { line: label() },
        express: { lineplot: {}, barplot: {} },
        panel: {},
        panelClass: {},
        inset: {},
      },
    },
  });
}

const lines = { rows: { line: { inventory } } };
/** Python's nested settings of a line: its method's, its panel method's, and its helper's. */
const pythonNested = ({ python }) => [
  python.nested.methods,
  python.nested.panelMethods,
  python.nested.helpers,
];
/** api.json's audits for `surfaces()`: Python spreads the interaction settings. */
const SPREAD = {
  "chart python": { spread: { interaction: { reason: "keywords of their own" } } },
  "chart update": { spread: { interaction: { reason: "keywords of their own" } } },
};
const audited = (audits, options = surfaces()) => checkApi({ audits }, auditsOf(lines, options));

/** `surfaces()` with Python's line keyword `curve` spelled `shape` (the method's, panel's, and helper's). */
const renamed = () =>
  surfaces((options) => {
    const { python } = options;
    for (const keywords of [python.methods.line, python.panelMethods.line, python.helpers.line]) {
      keywords.shape = keywords.curve;
      delete keywords.curve;
    }
    return options;
  });

test("the docs show an unproved cell as supported but not proved, and count every state", () => {
  const declared = declarations({ unproved: ["placement.panel"], works: [] });
  declared.capabilities.gpu = { about: "Where a GPU draws.", paths: {} };
  const { cells, proofs } = checkDeclarations(declared);
  const executions = [passed("line.legend.colorbar", "herceg-unit", "node", "colorbar.test.ts")];
  const records = capabilityRecords({ declarations: declared, cells, proofs, executions });
  assert.deepEqual(records.marks.line.cells["placement.panel"], { state: "unproved", proofs: [] });
  assert.deepEqual(records.totals, { works: 0, unproved: 1, refused: 0, na: 1 });
  const markdown = capabilityMarkdown(records);
  assert.match(
    markdown,
    /Of 2 cells: 0 proved to work, 1 supported but not yet proved, 0 refused, and 1 not applicable\./,
  );
  assert.match(markdown, /\| line \| ○ \| \[·1\]\(\.\.\/colorbar\.test\.ts\) \|/);
});

test("the API audit spells the spec's names as each surface's convention does", () => {
  assert.deepEqual(audited(SPREAD), []);
  // The interaction settings are Python's keywords only where api.json spreads them.
  assert.deepEqual(audited({ "chart update": SPREAD["chart update"] }), [
    'chart python: no interaction for interaction; add it, or list interaction in api.json audits["chart python"].without with the reason',
    'chart python: zoom is not the reference\'s; list it in api.json audits["chart python"].only with the reason',
  ]);
  assert.deepEqual(audited({ ...SPREAD, "chart vue": {}, "panel nowhere": {} }), [
    'api.json audits["panel nowhere"]: no such audit; drop it',
  ]);
});

test("a Vue component reads every option that takes true as true from a bare attribute", () => {
  const unflagged = surfaces((options) => {
    options.vueFlags.Line.booleans.push("markers");
    return options;
  });
  assert.deepEqual(audited(SPREAD, unflagged), [
    'vue flags Line: no markers for markers; add it, or list markers in api.json audits["vue flags Line"].without with the reason',
  ]);
});

test("the settings of options both sides type are audited at any depth", () => {
  const dropped = surfaces((options) => {
    for (const methods of [options.python.nested.methods, options.python.nested.helpers])
      delete methods.line.label.nested.place.options.offset;
    options.factoriesNested.line.label.nested.place.options.side = ["end"];
    return options;
  });
  assert.deepEqual(audited(SPREAD, dropped), [
    'mark line typescript label place side: choices ["end"] where side has ["end","start"]; make them one, or give the reason in api.json audits["mark line typescript label place"].choices.side',
    'mark line python label place: no offset for offset; add it, or list offset in api.json audits["mark line python label place"].without with the reason',
    'mark line panel label place: offset is not the reference\'s; list it in api.json audits["mark line panel label place"].only with the reason',
  ]);
  // An option the surface does not take has no settings to audit.
  const without = { "mark line python": { without: { label: "drawn apart" } } };
  const unlabelled = surfaces((options) => {
    const { methods, panelMethods, helpers } = options.python;
    for (const keywords of [methods.line, panelMethods.line, helpers.line]) delete keywords.label;
    return options;
  });
  assert.deepEqual(audited({ ...SPREAD, ...without }, unlabelled), []);
  assert.deepEqual(audited({ ...SPREAD, "mark line python label place": {} }), []);
  assert.deepEqual(audited({ ...SPREAD, "mark line python curve": {} }), [
    'api.json audits["mark line python curve"]: no such audit; drop it',
  ]);
});

test("settings held by name on one side are each of the other's named settings", () => {
  // The spec's limits by axis, { x, y }, and Python's dict of hg.ViewLimits.
  const limits = (change = () => {}) =>
    surfaces((options) => {
      const axes = () =>
        held(
          { x: [], y: [] },
          { x: held({ extent: [], edge: [] }), y: held({ extent: [], edge: [] }) },
        );
      const byName = () => ({ ...held({ extent: [], edge: [] }), keyed: true });
      const { chart, python } = options;
      const { spec, typescript, react, svelte, vue } = chart;
      for (const keywords of [spec, typescript, react, svelte, vue, python.chart, python.update])
        keywords.limits = [];
      python.helper.limits = [];
      Object.assign(chart.nested, { limits: axes() });
      Object.assign(chart.typescriptNested, { limits: axes() });
      for (const nested of [python.nested.chart, python.nested.update, python.nested.helper])
        nested.limits = byName();
      change(options);
      return options;
    });
  assert.deepEqual(audited(SPREAD, limits()), []);
  const dropped = limits(({ python }) => delete python.nested.chart.limits.options.edge);
  assert.deepEqual(audited(SPREAD, dropped), [
    'chart helper limits: edge is not the reference\'s; list it in api.json audits["chart helper limits"].only with the reason',
    'chart python limits x: no edge for edge; add it, or list edge in api.json audits["chart python limits x"].without with the reason',
    'chart python limits y: no edge for edge; add it, or list edge in api.json audits["chart python limits y"].without with the reason',
  ]);
  // A named setting whose settings are untyped is told, as any is.
  const untyped = limits(({ chart }) => {
    delete chart.nested.limits.nested.y;
    delete chart.typescriptNested.limits.nested.y;
  });
  assert.deepEqual(audited(SPREAD, untyped), [
    'chart python limits y: y\'s settings are typed on the surface alone; type them on the other side, or give the reason in api.json audits["chart python limits"].untyped["y"]',
    'chart update limits y: y\'s settings are typed on the surface alone; type them on the other side, or give the reason in api.json audits["chart update limits"].untyped["y"]',
  ]);
});

test("settings of named types are audited once a pair, wherever they are", () => {
  // The spec's LabelSpec and Python's hg.Label, met in the method's and the panel method's label.
  const named = (change) =>
    surfaces((options) => {
      options.marksNested.line.label.type = "LabelSpec";
      for (const methods of pythonNested(options)) methods.line.label.type = "hg.Label";
      return change(options);
    });
  const pair = 'api.json audits["settings LabelSpec hg.Label"]';
  const dropped = named((options) => {
    for (const methods of pythonNested(options)) delete methods.line.label.options.text;
    return options;
  });
  assert.deepEqual(audited(SPREAD, dropped), [
    `settings LabelSpec hg.Label: no text for text; add it, or list text in ${pair}.without with the reason (met at mark line python label)`,
  ]);
  const listed = { "settings LabelSpec hg.Label": { without: { text: "Python's own" } } };
  assert.deepEqual(audited({ ...SPREAD, ...listed }, dropped), []);
  // A pair met again with other settings (two types of one name) is audited where it is.
  const unlike = named((options) => {
    for (const keywords of [
      options.marks.line,
      options.factories.line,
      options.python.methods.line,
      options.python.panelMethods.line,
      options.python.helpers.line,
    ])
      keywords.note = [];
    const note = (type, size = { size: [] }) => held({ text: ["*"], ...size }, {}, type);
    options.marksNested.line.note = note("LabelSpec");
    options.factoriesNested.line.note = note(undefined);
    for (const methods of pythonNested(options)) methods.line.note = note("hg.Label", {});
    return options;
  });
  assert.deepEqual(audited(SPREAD, unlike), [
    'mark line python note: no size for size; add it, or list size in api.json audits["mark line python note"].without with the reason',
  ]);
});

test("settings one side types and the other takes untyped fail until api.json says why", () => {
  const untyped = surfaces((options) => {
    for (const methods of pythonNested(options)) delete methods.line.label.nested.place;
    return options;
  });
  assert.deepEqual(audited(SPREAD, untyped), [
    'mark line python label place: place\'s settings are typed on the reference alone; type them on the other side, or give the reason in api.json audits["mark line python label"].untyped["place"]',
  ]);
  const listed = { "mark line python label": { untyped: { place: "Python takes a dict" } } };
  assert.deepEqual(audited({ ...SPREAD, ...listed }, untyped), []);
  assert.deepEqual(audited({ ...SPREAD, ...listed }), [
    'mark line python label place: place\'s settings are typed on both sides; drop api.json audits["mark line python label"].untyped["place"]',
  ]);
  // A class with no settings of its own (hg.IdentityScale) is typed: the class is its type.
  const classed = surfaces((options) => {
    for (const methods of pythonNested(options))
      methods.line.label.nested.place = held({}, {}, "hg.Place");
    return options;
  });
  assert.deepEqual(audited(SPREAD, classed), [
    'mark line python label place: no side for side; add it, or list side in api.json audits["mark line python label place"].without with the reason',
    'mark line python label place: no offset for offset; add it, or list offset in api.json audits["mark line python label place"].without with the reason',
  ]);
});

test("TypeScript settings keep their aliases' names, read records' values, and intersect at depth", () => {
  const directory = mkdtempSync(join(tmpdir(), "herceg-settings-"));
  const config = join(directory, "tsconfig.json");
  const file = join(directory, "chart.ts");
  const compilerOptions = { strict: true, exactOptionalPropertyTypes: true, noEmit: true };
  writeFileSync(config, JSON.stringify({ compilerOptions, files: ["chart.ts"] }));
  writeFileSync(
    file,
    `export type Ticks = number | { every: number } | { count: number };
export interface Axis { ticks?: Ticks; style?: { color?: string } }
export interface Scale { type?: "linear" | "log" }
type Narrow = { curve?: "linear" | "step"; label?: { place?: "end" | "start" } } & {
  curve?: "linear";
  label?: { place?: "end" };
};
export interface Chart {
  y?: Axis | false;
  scales?: { x?: Scale; readonly [name: string]: Scale | undefined };
  narrow?: Narrow;
}
`,
  );
  const { nested } = settingsOfType(config, file, "Chart");
  assert.equal(nested.y.type, "Axis");
  assert.deepEqual(nested.y.nested.ticks, held({ every: [], count: [] }, {}, "Ticks"));
  assert.equal(nested.y.nested.style.type, undefined);
  assert.deepEqual(nested.scales, {
    ...held({ type: ["linear", "log"] }, {}, "Scale"),
    keyed: true,
  });
  assert.deepEqual(nested.narrow.options.curve, ["linear"]);
  assert.deepEqual(nested.narrow.nested.label.options, { place: ["end"] });
});

test("every component an adapter exports has a compile-time check of its props", () => {
  const entries = {
    "src/index.ts":
      'export { Line, type LineProps } from "./marks.ts";\nexport const Chart = make();',
    "src/layout.ts": "export const Panel = placed();\nexport function rows() {}",
  };
  assert.deepEqual(exportedComponents(entries["src/index.ts"]), ["Chart", "Line"]);
  const checks = `import type { Chart, Line as L } from "../src/index.ts";
import type { Panel } from "../src/marks.ts";
true satisfies Takes<PropsOf<typeof L>, X>;
true satisfies Takes<PropsOf<Chart>, X>;
true satisfies Takes<PropsOf<typeof Panel>, X>;`;
  assert.deepEqual(uncheckedComponents("test/props.ts", checks, entries), [
    "test/props.ts: no check of Chart from src/index.ts; import it from there and compare its props as `typeof Chart`",
    "test/props.ts: no check of Panel from src/layout.ts; import it from there and compare its props as `typeof Panel`",
  ]);
});

test("a keyword Express functions share takes the choices the core's marks take for it, in each", () => {
  const seaborn = surfaces((options) => {
    options.python.express.barplot.orient = ["h", "v", "x", "y"];
    options.python.seaborn.keywords.barplot.push("orient");
    return options;
  });
  const error = (fn) =>
    `express ${fn} orient: choices ["h","v","x","y"] where orient has ["x","y"]; make them one, or give the reason in api.json audits["express ${fn}"].choices.orient`;
  // The core's line takes orient too, in every surface.
  seaborn.python.methods.line.orient = ["x", "y"];
  seaborn.python.panelMethods.line.orient = ["x", "y"];
  seaborn.python.helpers.line.orient = ["x", "y"];
  seaborn.marks.line.orient = ["x", "y"];
  seaborn.factories.line.orient = ["x", "y"];
  assert.deepEqual(audited(SPREAD, seaborn), [error("barplot")]);
  const listed = (takes) => ({
    ...SPREAD,
    "express *": { choices: { orient: { takes, reason: "seaborn's spellings" } } },
  });
  assert.deepEqual(audited(listed(["h", "v", "x", "y"]), seaborn), []);
  // The difference holds for the choices listed, not others.
  assert.deepEqual(audited(listed(["h", "v"]), seaborn), [
    'express barplot orient: choices ["h","v","x","y"] where api.json audits["express *"].choices.orient takes ["h","v"]; list them there, or take orient\'s',
  ]);
});

test("a function making a chart unpacks the chart's options, as HelperOptions has them", () => {
  const unpacking = surfaces((options) => {
    delete options.python.helpers.line["**HelperOptions"];
    options.python.unpacked.helpers.line = null;
    return options;
  });
  assert.deepEqual(audited(SPREAD, unpacking), [
    'mark line helper options: no title for title; add it, or list title in api.json audits["mark line helper options"].without with the reason',
    'mark line helper options: no zoom for zoom; add it, or list zoom in api.json audits["mark line helper options"].without with the reason',
  ]);
  // Express's own options, ExpressOptions: HelperOptions's and a panel to draw in.
  const paneled = (panel) =>
    surfaces((options) => {
      const { keywords } = options.python.unpackedTypes.HelperOptions;
      options.python.unpackedTypes.ExpressOptions = {
        keywords: { ...keywords, [panel]: [] },
        nested: {},
      };
      options.python.unpacked.express.lineplot = "ExpressOptions";
      return options;
    });
  assert.deepEqual(audited(SPREAD, paneled("panel")), [
    'express lineplot options: panel is not the reference\'s; list it in api.json audits["express lineplot options"].only with the reason',
  ]);
  const own = { ...SPREAD, "express lineplot options": { only: { panel: "a panel to draw in" } } };
  assert.deepEqual(audited(own, paneled("panel")), []);
  // Renamed, it is found again, and the entry for panel is no longer needed.
  assert.deepEqual(audited(own, paneled("cell")), [
    'express lineplot options: cell is not the reference\'s; list it in api.json audits["express lineplot options"].only with the reason',
    'api.json audits["express lineplot options"].only.panel: not the surface\'s own; drop it',
  ]);
});

test("an Express function takes seaborn's keywords, in Herceg's words where api.json spells them", () => {
  // Seaborn's barplot takes hue and errorbar; this one, series and errorbar.
  const renamed = surfaces((options) => {
    options.python.seaborn.keywords.barplot = ["hue", "errorbar"];
    options.python.express.barplot = { series: ["*"], errorbar: [] };
    return options;
  });
  assert.deepEqual(audited(SPREAD, renamed), [
    'express barplot seaborn: no hue for hue; add it, or list hue in api.json audits["express barplot seaborn"].without with the reason',
    'express barplot seaborn: series is not the reference\'s; list it in api.json audits["express barplot seaborn"].only with the reason',
  ]);
  const hue = { hue: { as: "series", reason: "Herceg's word" } };
  const spelled = { ...SPREAD, "express barplot seaborn": { spelled: hue } };
  assert.deepEqual(audited(spelled, renamed), []);
  // Express's own options are listed function by function, so that one dropping them fails.
  const own = (audit) => ({
    ...spelled,
    [audit]: { ...spelled[audit], only: { z_index: "the marks' drawing order" } },
  });
  renamed.python.express.barplot.z_index = [];
  assert.deepEqual(audited(own("express barplot seaborn"), renamed), []);
  assert.deepEqual(audited(own("express * seaborn"), renamed), [
    "api.json audits[\"express * seaborn\"].only.z_index: an Express function's own options are its own; list z_index in each function's audit",
  ]);
  delete renamed.python.express.barplot.z_index;
  assert.deepEqual(audited(own("express barplot seaborn"), renamed), [
    'api.json audits["express barplot seaborn"].only.z_index: not the surface\'s own; drop it',
  ]);
  // One of seaborn's keywords dropped.
  delete renamed.python.express.barplot.errorbar;
  assert.deepEqual(audited(spelled, renamed), [
    'express barplot seaborn: no errorbar for errorbar; add it, or list errorbar in api.json audits["express barplot seaborn"].without with the reason',
  ]);
});

test("a keyword the core's marks take means what they take, in each Express function taking it", () => {
  // Only lineplot takes curve.
  const curved = surfaces((options) => {
    options.python.express.lineplot.curve = ["bogus"];
    options.python.seaborn.keywords.lineplot.push("curve");
    return options;
  });
  assert.deepEqual(audited(SPREAD, curved), [
    'express lineplot curve: choices ["bogus"] where curve has ["linear","step"]; make them one, or give the reason in api.json audits["express lineplot"].choices.curve',
  ]);
});

test("a keyword dict of seaborn's that Express types takes what seaborn's class it holds takes", () => {
  // lineplot's kde holds hx.KdeOptions where seaborn takes kde_kws, its KDE's parameters.
  const kde = (change = () => {}) =>
    surfaces((options) => {
      options.python.seaborn.settings.lineplot = { kde: ["bw", "cut"] };
      const settings = held({ bw: [], cut: ["auto"] }, {}, "hx.KdeOptions");
      options.python.nested.express.lineplot.kde = settings;
      change(options.python);
      return options;
    });
  assert.deepEqual(audited(SPREAD, kde()), []);
  // A setting dropped, or the dict untyped.
  const dropped = kde((python) => delete python.nested.express.lineplot.kde.options.cut);
  assert.deepEqual(audited(SPREAD, dropped), [
    'express lineplot kde: no cut for cut; add it, or list cut in api.json audits["express lineplot kde"].without with the reason',
  ]);
  const untyped = kde((python) => delete python.nested.express.lineplot.kde);
  assert.deepEqual(audited(SPREAD, untyped), [
    'express lineplot kde: no bw for bw; add it, or list bw in api.json audits["express lineplot kde"].without with the reason',
    'express lineplot kde: no cut for cut; add it, or list cut in api.json audits["express lineplot kde"].without with the reason',
  ]);
  // Settings of a class of Express's own, which no dict of seaborn's holds, are each listed.
  const unmatched = kde((python) => (python.seaborn.settings = {}));
  assert.deepEqual(audited(SPREAD, unmatched), [
    'express lineplot kde: bw is not the reference\'s; list it in api.json audits["express lineplot kde"].only with the reason',
    'express lineplot kde: cut is not the reference\'s; list it in api.json audits["express lineplot kde"].only with the reason',
  ]);
  // Settings of the class the core's marks hold for that keyword are the core's, audited there.
  const labelled = surfaces((options) => {
    options.python.nested.express.lineplot.label = options.python.nested.methods.line.label;
    return options;
  });
  assert.deepEqual(audited(SPREAD, labelled), []);
});

test("a panel takes the chart's marks by their methods", () => {
  const panelless = surfaces((options) => {
    delete options.python.panelMethods.line;
    return options;
  });
  assert.deepEqual(audited(SPREAD, panelless), [
    'names panel: no line for line; add it, or list line in api.json audits["names panel"].without with the reason',
  ]);
});

test("a difference fails until api.json gives its reason, and an entry no longer needed fails", () => {
  assert.deepEqual(audited(SPREAD, renamed()), [
    'mark line python: no curve for curve; add it, or list curve in api.json audits["mark line python"].without with the reason',
    'mark line python: shape is not the reference\'s; list it in api.json audits["mark line python"].only with the reason',
  ]);
  const spelled = (entry) => ({ ...SPREAD, "mark line python": { spelled: { curve: entry } } });
  assert.deepEqual(audited(spelled({ as: "shape", reason: "Python's word" }), renamed()), []);
  assert.deepEqual(audited(spelled({ as: "shape" }), renamed()), [
    'api.json audits["mark line python"].spelled.curve: give the reason',
  ]);
  assert.deepEqual(audited(spelled({ as: "shape", reason: "Python's word" })), [
    'mark line python: no shape for curve; add it, or list curve in api.json audits["mark line python"].without with the reason',
    'mark line python: curve is not the reference\'s; list it in api.json audits["mark line python"].only with the reason',
  ]);
  assert.deepEqual(
    audited({ ...SPREAD, "mark line python": { without: { dash: "none" }, only: { x: "own" } } }),
    [
      'api.json audits["mark line python"].without.dash: no such option; drop it',
      'api.json audits["mark line python"].only.x: not the surface\'s own; drop it',
    ],
  );
});

test("string choices agree where the reference names them, and anything goes where it takes any string", () => {
  // Python's line takes any string for its curve and one color, wherever it takes them.
  const loose = surfaces((options) => {
    const { python } = options;
    for (const keywords of [python.methods.line, python.panelMethods.line, python.helpers.line])
      Object.assign(keywords, { curve: ["*", "linear", "step"], color: ["red"] });
    return options;
  });
  assert.deepEqual(audited(SPREAD, loose), [
    'mark line python curve: choices ["*","linear","step"] where curve has ["linear","step"]; make them one, or give the reason in api.json audits["mark line python"].choices.curve',
  ]);
  const later = { takes: ["*", "linear", "step"], reason: "Python checks the name later" };
  const listed = { "mark line python": { choices: { curve: later } } };
  assert.deepEqual(audited({ ...SPREAD, ...listed }, loose), []);
  assert.deepEqual(audited({ ...SPREAD, ...listed }), [
    'mark line python curve: the choices agree; drop api.json audits["mark line python"].choices.curve',
  ]);
  // A shared difference of choices is needed only where some mark's choices differ.
  const shared = { "mark * python": { choices: { curve: later } } };
  assert.deepEqual(audited({ ...SPREAD, ...shared }, loose), []);
  assert.deepEqual(audited({ ...SPREAD, ...shared }), [
    'api.json audits["mark * python"].choices.curve: no audit needs it; drop it',
  ]);
});

test("what every mark's helper shares is listed once, and fails once no helper needs it", () => {
  const helperless = surfaces((options) => {
    delete options.python.helpers.line.color;
    return options;
  });
  assert.deepEqual(audited(SPREAD, helperless), [
    'mark line helper: no color for color; add it, or list color in api.json audits["mark line helper"].without with the reason',
  ]);
  const shared = (without) => ({ ...SPREAD, "mark * helper": { without } });
  assert.deepEqual(audited(shared({ color: "the chart's" }), helperless), []);
  assert.deepEqual(audited(shared({ color: "the chart's", legend: "the chart's" }), helperless), [
    'api.json audits["mark * helper"].without.legend: no audit needs it; drop it',
  ]);
});

test("the check reports what the runs do not prove beside what it cannot read of them", () => {
  // A complete run of python-web that proves nothing, and none of python's.
  const directory = mkdtempSync(join(tmpdir(), "contracts-"));
  const source = { revision: "abc", sourceHash: "def" };
  const report = JSON.stringify({ testResults: [] });
  writeFileSync(join(directory, "python-web.json"), report);
  const reportHash = createHash("sha256").update(report).digest("hex");
  const record = { suite: "python-web", ...source, exitCode: 0, reportHash };
  writeFileSync(join(directory, "python-web.run.json"), JSON.stringify(record));
  const engines = ["chromium"];
  const checked = checkContracts({ suites: ["python-web", "python"], engines, source, directory });
  assert.ok(checked.errors.some((error) => /^python: no complete run/.test(error)));
  const lacking = checkEvidence({ ...checked, engines });
  assert.ok(lacking.some((error) => / no test proves it /.test(error)));
  for (const error of lacking) assert.ok(checked.errors.includes(error), error);
});
