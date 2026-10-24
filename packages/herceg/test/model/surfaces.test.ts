// Each drawn contract case (test/fixtures/contracts.json) written in
// TypeScript, with the mark functions and the chart's options spelled as
// the spec spells them, draws what its spec draws. The adapters' tests do
// the same through their components, and Python's through its helpers,
// panels, and transports.
import { describe, expect } from "vitest";
import { specToSVG } from "../../src/from-spec.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { contractTest } from "../helpers/contracts.ts";
import {
  chartOptions,
  drawnCases,
  fullSpec,
  markSpecs,
  surfaceMarks,
} from "../helpers/surfaces.ts";

describe("TypeScript spells the spec's options", () => {
  for (const { contract, name, spec } of drawnCases())
    contractTest(
      `${contract}.factory`,
      () => {
        const marks = surfaceMarks(spec);
        // Each mark keeps every option as given, which the spec's mark holds.
        const { config } = loadSpec(fullSpec(spec));
        expect(markSpecs(marks)).toEqual(markSpecs(config.marks));
        const written = renderToSVG(
          { ...chartOptions(spec), marks, width: 640, height: 320 } as never,
          { idPrefix: "s" },
        );
        expect(written).toBe(specToSVG(fullSpec(spec), [], { idPrefix: "s" }));
      },
      name,
    );
});
