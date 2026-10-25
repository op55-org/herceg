// What the test runs of a source proved: each suite's run record and
// report in tmp/contracts/<source>/ (scripts/contracts/run.mjs), read into
// executions of contract tests, `{ id, suite, engine, test, status }`.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { root } from "./source.mjs";
import { SUITES } from "./suites.mjs";

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
 * report is not the one its run wrote.
 */
export function readEvidence(directory, suites, source) {
  const errors = [];
  const executions = [];
  const runs = {};
  for (const suite of suites) {
    const { command, runs: where } = SUITES[suite];
    const recordPath = join(directory, `${suite}.run.json`);
    if (!existsSync(recordPath)) {
      errors.push(`${suite}: no complete run of this source; run ${command}`);
      continue;
    }
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (
      record.suite !== suite ||
      record.revision !== source.revision ||
      record.sourceHash !== source.sourceHash
    ) {
      errors.push(`${suite}: its run record is of another suite or source; run ${command} again`);
      continue;
    }
    runs[suite] = record;
    const reportPath = join(directory, `${suite}.${where === "python" ? "xml" : "json"}`);
    const report = existsSync(reportPath) ? readFileSync(reportPath) : undefined;
    if (!report || createHash("sha256").update(report).digest("hex") !== record.reportHash) {
      errors.push(`${suite}: its report is not the one its run wrote; run ${command} again`);
      continue;
    }
    if (record.exitCode !== 0)
      errors.push(
        `${suite}: its run ended ${record.signal ? `by ${record.signal}` : `with exit code ${record.exitCode}`}; every test, setup, and teardown must pass`,
      );
    executions.push(
      ...(where === "python"
        ? junitExecutions(report.toString(), suite)
        : vitestExecutions(JSON.parse(report.toString()), suite)),
    );
  }
  return { errors, executions, runs };
}
