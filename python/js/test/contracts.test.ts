// Proofs of the matrix's cells for Python's live surfaces (test/contracts/):
// the notebook widget, Streamlit, and web fragments draw the specs Python
// writes. Each mark row's cells there are declared but not proved yet
// (marks.json's `unproved`); a custom mark's are not applicable, which is
// proved here: it is a TypeScript function, which no spec can hold.

import { describe, expect } from "vitest";
import { validateSpec } from "../../../packages/herceg/src/spec/validate.ts";
import { specOf } from "../../../packages/herceg/test/contracts/matrix.ts";
import { contractTest } from "../../../packages/herceg/test/helpers/contracts.ts";

describe("integration of a custom mark", () => {
  for (const surface of ["widget", "streamlit", "web"])
    contractTest(`custom.integration.${surface}`, () => {
      // The row has no spec, and a spec naming the mark is refused.
      expect(specOf("custom")).toBeUndefined();
      expect(() => validateSpec({ marks: [{ type: "custom" }] })).toThrow(/^marks\[0\]\.type: /);
    });
});
