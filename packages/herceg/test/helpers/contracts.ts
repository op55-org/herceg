// Tests that prove a contract: what an option, mark, or surface promises,
// by an ID other tooling can find in a run's results (see docs/contributing.md,
// "Contracts"). A contract test is an ordinary Vitest test whose name
// starts with its ID; its assertions are its own.

import { it, type TestFunction } from "vitest";

declare module "vitest" {
  interface TaskMeta {
    /** The contract the test proves, for scripts/check-contracts.mjs. */
    contract?: string;
    /** Where it ran: "node", or the browser engine ("chromium", "firefox", "webkit"). */
    engine?: string;
  }
}

/**
 * Lowercase words of letters, digits, and hyphens joined by dots: what the
 * contract is about (a mark, a guide, an export), the behavior, and where
 * it is proved when several surfaces prove it (`line.z-index.refused.spec`).
 */
export const CONTRACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

const seen = new Set<string>();

/** A test proving contract `id`, named `[contract:id]` and then `name` when given. */
export function contractTest(id: string, fn: TestFunction, name?: string): void {
  if (!CONTRACT_ID.test(id))
    throw new Error(`contractTest: "${id}" is not a contract ID; write words.joined.by-dots`);
  if (seen.has(id)) throw new Error(`contractTest: "${id}" is proved twice in this file`);
  seen.add(id);
  it(name === undefined ? `[contract:${id}]` : `[contract:${id}] ${name}`, (context) => {
    // Recorded before the test runs, so a failure reports them too. A
    // browser project is named for its engine ("browser (webkit)").
    const project = context.task.file.projectName ?? "";
    context.task.meta.contract = id;
    context.task.meta.engine = /chromium|firefox|webkit/.exec(project)?.[0] ?? "node";
    return fn(context);
  });
}
