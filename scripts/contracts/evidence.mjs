// What the test runs of a source proved: each suite's run records and
// reports in tmp/contracts/<source>/ (scripts/contracts/run.mjs), read into
// executions of contract tests, `{ id, suite, engine, test, status }`.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { root } from "./source.mjs";
import { ENGINES, SUITES } from "./suites.mjs";

const CONTRACT = /\[contract:([^\]]+)\]/;

/** Executions in a Vitest JSON report: tests named `[contract:id]`. */
export function vitestExecutions(report, suite) {
  const executions = [];
  for (const file of report.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      const id = test.meta?.contract ?? CONTRACT.exec(test.fullName ?? test.title ?? "")?.[1];
      if (id === undefined) continue;
      executions.push({
        id,
        suite,
        engine: test.meta?.engine,
        test: `${relative(root, file.name)} > ${test.fullName}`,
        status: test.status,
      });
    }
  }
  return executions;
}

const decode = (text) =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** Executions in pytest's JUnit XML: test cases with a `contract` property. */
export function junitExecutions(xml, suite) {
  const executions = [];
  for (const [, attributes, body = ""] of xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const attribute = (name) =>
      decode(new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? "");
    const ids = [...body.matchAll(/<property name="contract" value="([^"]*)"/g)].map(([, id]) =>
      decode(id),
    );
    const status = /<(failure|error)\b/.test(body)
      ? "failed"
      : /<skipped\b/.test(body)
        ? "skipped"
        : "passed";
    for (const id of ids)
      executions.push({
        id,
        suite,
        engine: "python",
        test: `${attribute("classname")}::${attribute("name")}`,
        status,
      });
  }
  return executions;
}

/**
 * The executions of `suites` run on `source` (`{ revision, sourceHash }`)
 * in `directory`, and errors where a suite has no complete run there, its
 * record is another suite's or another source's, its run failed, or its
 * report is not the one its run wrote. A browser suite's evidence in each
 * engine is that engine's last complete run, of it alone or of several
 * engines at once; `runs[suite].browsers` lists the engines found.
 */
export function readEvidence(directory, suites, source) {
  const errors = [];
  const executions = [];
  const runs = {};
  for (const suite of suites) {
    const { command, runs: where } = SUITES[suite];
    const browser = where === "browser";
    // The runs found: a record each, with the engines whose records name its report.
    const found = new Map();
    let refused = false;
    for (const engine of browser ? ENGINES : [undefined]) {
      const recordPath = join(directory, `${suite}${engine ? `.${engine}` : ""}.run.json`);
      if (!existsSync(recordPath)) continue;
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      if (
        record.suite !== suite ||
        record.engine !== engine ||
        record.revision !== source.revision ||
        record.sourceHash !== source.sourceHash
      ) {
        errors.push(
          `${suite}${engine ? ` (${engine})` : ""}: its run record is of another suite, engine, or source; run ${command} again`,
        );
        refused = true;
        continue;
      }
      const key = `${record.report}\0${record.reportHash}`;
      if (!found.has(key)) found.set(key, { record, engines: [] });
      if (engine) found.get(key).engines.push(engine);
    }
    if (found.size === 0 && !refused)
      errors.push(`${suite}: no complete run of this source; run ${command}`);
    const browsers = [];
    for (const { record, engines } of found.values()) {
      browsers.push(...engines);
      const of = browser ? ` of ${engines.join(", ")}` : "";
      const reportPath = join(directory, String(record.report));
      const report = existsSync(reportPath) ? readFileSync(reportPath) : undefined;
      if (!report || createHash("sha256").update(report).digest("hex") !== record.reportHash) {
        errors.push(`${suite}: the report${of} is not the one its run wrote; run ${command} again`);
        continue;
      }
      if (record.exitCode !== 0)
        errors.push(
          `${suite}: its run${of} ended ${record.signal ? `by ${record.signal}` : `with exit code ${record.exitCode}`}; every test, setup, and teardown must pass`,
        );
      const ran =
        where === "python"
          ? junitExecutions(report.toString(), suite)
          : vitestExecutions(JSON.parse(report.toString()), suite);
      // Of a run of several engines, only those whose records still name it:
      // a later run of one replaces its executions. Executions that name no
      // engine stay, for the check to refuse.
      executions.push(
        ...(browser
          ? ran.filter(({ engine }) => engines.includes(engine) || !ENGINES.includes(engine))
          : ran),
      );
    }
    if (found.size > 0) runs[suite] = { browsers: ENGINES.filter((e) => browsers.includes(e)) };
  }
  return { errors, executions, runs };
}
