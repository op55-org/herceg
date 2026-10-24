// Each drawn contract case (herceg's test/fixtures/contracts.json) written
// with React's mark elements and chart props, spelled as the spec spells
// them, draws what a chart made from its spec draws.

import type { Chart as HercegChart } from "herceg";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe } from "vitest";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import {
  chartOptions,
  drawnCases,
  fixtureTable,
  sameDrawing,
  specChart,
} from "../../herceg/test/helpers/surfaces.ts";
import { Bar, Chart, Line, Point, Point3D, Region, Rule, Text } from "../src/index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** React's mark elements, by the mark type of the spec. */
const ELEMENTS: Record<string, (props: Record<string, unknown>) => null> = {
  bar: Bar as never,
  line: Line as never,
  point: Point as never,
  point3d: Point3D as never,
  region: Region as never,
  rule: Rule as never,
  text: Text as never,
};

function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "600px";
  document.body.append(element);
  return element;
}

describe("React spells the spec's options", () => {
  for (const { contract, name, spec } of drawnCases())
    contractTest(
      `${contract}.react`,
      async () => {
        const data = fixtureTable();
        const ref: { current: HercegChart | null } = { current: null };
        const [mine, theirs] = [host(), host()];
        const root = createRoot(mine);
        act(() =>
          root.render(
            <Chart ref={ref} height={240} {...(chartOptions(spec) as object)}>
              {spec.marks.map(({ type, ...options }, i) => {
                const Mark = ELEMENTS[type]!;
                // biome-ignore lint/suspicious/noArrayIndexKey: the case's marks are fixed
                return <Mark key={i} data={data} {...options} />;
              })}
            </Chart>,
          ),
        );
        const reference = specChart(theirs, spec, 240);
        try {
          await sameDrawing(ref.current!, reference);
        } finally {
          reference.destroy();
          act(() => root.unmount());
          mine.remove();
          theirs.remove();
        }
      },
      name,
    );
});
