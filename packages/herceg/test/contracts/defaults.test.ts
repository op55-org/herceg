// The API audit's defaults (test/contracts/fixtures/defaults.json): a
// chart drawn without an option draws as one given its documented default,
// and otherwise than one given another value, so that the comparison tells
// the default apart. python/tests/test_api_defaults.py proves the same with
// Python's keywords.

import { afterAll, beforeAll, describe, expect } from "vitest";
import fixture from "../../../../test/contracts/fixtures/defaults.json";
import { specToSVG } from "../../src/from-spec.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { contractTest } from "../helpers/contracts.ts";

interface Default {
  contract: string;
  table: string;
  mark: Record<string, unknown>;
  at?: "chart";
  option: string;
  value: unknown;
  other: unknown;
}

/** A local time zone neither UTC nor any case's `other`, so that "local" draws as itself alone. */
const LOCAL = "America/New_York";

const drawn = (spec: object) => specToSVG(spec as ChartSpec, [], { idPrefix: "d" });

describe("an option left out draws as its default", () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = LOCAL;
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  for (const { contract, table, mark, at, option, value, other } of fixture.defaults as Default[])
    contractTest(`${contract}.spec`, () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(LOCAL);
      const data = { [table]: { columns: fixture.tables[table as keyof typeof fixture.tables] } };
      const spec = { data, marks: [{ ...mark, data: table }], locale: "en-US" };
      const given = (setting: unknown) =>
        at === "chart"
          ? { ...spec, [option]: setting }
          : { ...spec, marks: [{ ...spec.marks[0], [option]: setting }] };
      expect(drawn(spec)).toBe(drawn(given(value)));
      expect(drawn(spec)).not.toBe(drawn(given(other)));
    });
});
