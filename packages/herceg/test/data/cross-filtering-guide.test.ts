// The data guide's "Cross-filtering" example is the code its browser test
// runs (test/browser/cross-filtering.test.ts, between its markers): the
// guide prints it whole, after its import. Its spec is the regions' panel
// the browser test loads (test/fixtures/cross-filter.json), but for the
// columns of the table the page gives.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import fixture from "../fixtures/cross-filter.json";

const ROOT = join(import.meta.dirname, "../../../..");

const guide = readFileSync(join(ROOT, "docs/guide/data.md"), "utf8");
const section = guide.slice(
  guide.indexOf("## Cross-filtering"),
  guide.indexOf("\n## ", guide.indexOf("## Cross-filtering") + 1),
);

it("prints the example its browser test runs", () => {
  const test = readFileSync(
    join(ROOT, "packages/herceg/test/browser/cross-filtering.test.ts"),
    "utf8",
  );
  const begin = "  // ---- The guide's example ----\n";
  const end = "  // ---- End of the guide's example ----";
  const run = test.slice(test.indexOf(begin) + begin.length, test.indexOf(end));
  expect(run.length).toBeGreaterThan(1000);
  const example = run.replace(/^ {2}/gm, "");
  expect(section.slice(0, section.indexOf("\n```\n"))).toContain(example.trimEnd());
});

it("prints the spec of the panel its browser test loads", () => {
  const json = /```json\n([\s\S]*?)```/.exec(section)?.[1];
  const printed = JSON.parse(json!);
  expect(Object.keys(printed.data.sales.columns).length).toBeGreaterThan(0);
  printed.data.sales.columns = {};
  expect(printed).toEqual(fixture.spec.regions);
});
