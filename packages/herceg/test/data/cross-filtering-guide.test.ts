// The data guide's "Cross-filtering" example is the code its browser test
// runs (test/browser/cross-filtering.test.ts, between its markers): the
// guide prints it whole, after its import.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");

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
  const guide = readFileSync(join(ROOT, "docs/guide/data.md"), "utf8");
  const section = guide.slice(guide.indexOf("## Cross-filtering"));
  expect(section.slice(0, section.indexOf("\n```\n"))).toContain(example.trimEnd());
});
