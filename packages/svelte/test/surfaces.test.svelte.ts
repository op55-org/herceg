// Each drawn contract case (herceg's test/fixtures/contracts.json) written
// with Svelte's mark components and chart props, spelled as the spec
// spells them, draws what a chart made from its spec draws.

import type { Chart as HercegChart } from "herceg";
import { flushSync, mount, unmount } from "svelte";
import { describe } from "vitest";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import {
  chartOptions,
  drawnCases,
  fixtureTable,
  sameDrawing,
  specChart,
} from "../../herceg/test/helpers/surfaces.ts";
import Surfaces from "./Surfaces.svelte";

function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "600px";
  document.body.append(element);
  return element;
}

describe("Svelte spells the spec's options", () => {
  for (const { contract, name, spec } of drawnCases())
    contractTest(
      `${contract}.svelte`,
      async () => {
        const [mine, theirs] = [host(), host()];
        const props = $state<{ chart: HercegChart | null }>({ chart: null });
        const mounted = mount(Surfaces, {
          target: mine,
          props: {
            get chart() {
              return props.chart;
            },
            set chart(value) {
              props.chart = value;
            },
            options: chartOptions(spec),
            marks: spec.marks,
            data: fixtureTable(),
          },
        });
        flushSync();
        const reference = specChart(theirs, spec, 240);
        try {
          await sameDrawing(props.chart!, reference);
        } finally {
          reference.destroy();
          unmount(mounted);
          mine.remove();
          theirs.remove();
        }
      },
      name,
    );
});
