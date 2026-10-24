// Each drawn contract case (herceg's test/fixtures/contracts.json) written
// with Vue's mark components and chart props, spelled as the spec spells
// them, draws what a chart made from its spec draws.

import { describe } from "vitest";
import { type Component, createApp, h, shallowRef } from "vue";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import {
  chartOptions,
  drawnCases,
  fixtureTable,
  sameDrawing,
  specChart,
} from "../../herceg/test/helpers/surfaces.ts";
import { Bar, Chart, Line, Point, Point3D, Region, Rule, Text } from "../src/index.ts";

/** Vue's mark components, by the mark type of the spec. */
const COMPONENTS: Record<string, Component> = {
  bar: Bar,
  line: Line,
  point: Point,
  point3d: Point3D,
  region: Region,
  rule: Rule,
  text: Text,
};

function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "600px";
  document.body.append(element);
  return element;
}

describe("Vue spells the spec's options", () => {
  for (const { contract, name, spec } of drawnCases())
    contractTest(
      `${contract}.vue`,
      async () => {
        const data = fixtureTable();
        const view = shallowRef<InstanceType<typeof Chart> | null>(null);
        const [mine, theirs] = [host(), host()];
        const app = createApp({
          render: () =>
            h(Chart, { ref: view, height: 240, ...chartOptions(spec) }, () =>
              spec.marks.map(({ type, ...options }) => h(COMPONENTS[type]!, { data, ...options })),
            ),
        });
        app.mount(mine);
        const reference = specChart(theirs, spec, 240);
        try {
          await sameDrawing(view.value!.chart!, reference);
        } finally {
          reference.destroy();
          app.unmount();
          mine.remove();
          theirs.remove();
        }
      },
      name,
    );
});
