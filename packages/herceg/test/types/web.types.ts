// Compile-time tests: checked by `npm run typecheck`, never executed.
import type { ChartErrorCode } from "../../src/spec/errors.ts";
import { getChart, loadPayload, mount, observe } from "../../src/web.ts";

declare const element: HTMLElement;

// Listeners of a fragment's events read their details, on the host and
// wherever they bubble to.
element.addEventListener("herceg:select", (event) => {
  const range: [number, number] | [string, string] | null | undefined = event.detail.selection?.x;
  const panels: string[] | undefined = event.detail.panels;
  return [range, panels];
});
document.addEventListener("herceg:click", (event) => event.detail.inspection?.points[0]?.row);
document.addEventListener("herceg:error", (event) => {
  const code: ChartErrorCode = event.detail.error.code;
  event.preventDefault();
  return code;
});
window.addEventListener("herceg:viewport", (event) => event.detail.viewport.time);
// @ts-expect-error a ready event says which host, and nothing else
element.addEventListener("herceg:ready", (event) => event.detail.chart);

async function use() {
  const options = await loadPayload("/charts/latency.bin");
  const marks = options.marks.length;
  const chart = await mount(element, { src: new Uint8Array(8) });
  chart.setViewport({ x: [0, 1] });
  // @ts-expect-error sources are URLs or bytes
  await mount(element, { src: 42 });
  const stop: () => void = observe();
  stop();
  return [marks, getChart(element)?.root];
}
use();
