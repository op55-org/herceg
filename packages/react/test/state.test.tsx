// State props: set when their value changes, written back from what the
// chart reports with no loop, and applied alone when only they change.
import {
  type ChartEvents,
  type ChartSelection,
  type Chart as HercegChart,
  table,
  type ViewportState,
} from "herceg";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { brushOf } from "../../herceg/test/helpers/selections.ts";
import { Chart, Line } from "../src/index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  host.style.width = "600px";
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const metrics = table({ t: [0, 1, 2, 3], a: [1, 2, 3, 4] });
const brush = (x: readonly [number, number]): ChartSelection => ({
  kind: "brush",
  x,
  y: null,
  lasso: null,
});

it("writes the selection and the view it reports back, with no loop", () => {
  let chart: HercegChart | null = null;
  let select: (selection: ChartSelection | null) => void = () => {};
  let renders = 0;
  function App() {
    const [selection, setSelection] = useState<ChartSelection | null>(null);
    const [viewport, setViewport] = useState<ViewportState | undefined>(undefined);
    select = setSelection;
    renders++;
    return (
      <Chart
        ref={(value) => {
          chart = value;
        }}
        interaction={{ brush: "x", zoom: "x" }}
        selection={selection}
        viewport={viewport}
        onSelect={(event) => setSelection(event.selection)}
        onViewport={(event) => setViewport(event.state)}
      >
        <Line data={metrics} x="t" y="a" />
      </Chart>
    );
  }
  act(() => root.render(<App />));
  const events: ChartEvents["select"][] = [];
  const views: ChartEvents["viewport"][] = [];
  chart!.on("select", (event) => events.push(event));
  chart!.on("viewport", (event) => views.push(event));
  const updates: string[][] = [];
  const update = chart!.update.bind(chart!);
  chart!.update = (options) => {
    updates.push(Object.keys(options));
    update(options);
  };
  const before = renders;
  act(() => chart!.select([1, 2]));
  act(() => chart!.setViewport([0, 3]));
  // Each change reported once, written back, and the chart told only of state.
  expect(events.map(({ cause }) => cause)).toEqual(["api"]);
  expect(views).toHaveLength(1);
  expect(renders - before).toBe(2);
  expect(updates).toEqual([["selection"], ["viewport"]]);
  // The application's own value applies, as an option.
  act(() => select(brush([0, 1])));
  expect(brushOf(chart!.selection)?.x).toEqual([0, 1]);
  expect(events.at(-1)).toMatchObject({ cause: "options", phase: "commit" });
  expect(events).toHaveLength(2);
});
