// Tests that prove a contract: what an option, mark, or surface promises,
// by an ID other tooling can find in a run's results (see the architecture's
// "Contract tests"). A contract test is an ordinary Vitest test whose name
// starts with its ID; its assertions are its own.

import { it, type TestFunction } from "vitest";

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
  it(name === undefined ? `[contract:${id}]` : `[contract:${id}] ${name}`, fn);
}
