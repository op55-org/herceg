// <Anchor>: React content a <Chart> holds at a place in its data (herceg's
// `anchor`). <Chart> reads it among its children, as it reads marks, and
// renders what it adds with its chart.

import { type Anchor as Anchored, type AnchorOptions, anchor, type Chart } from "herceg";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PartElement } from "./chart.tsx";

export interface AnchorProps extends AnchorOptions {
  /** What the chart holds there, rendered by React (with the application's context) into the anchored element. */
  children?: ReactNode;
}

/**
 * Content the chart holds at a place in its data: moved with every frame
 * the chart draws and hidden while the place is out of view, as herceg's
 * `anchor` holds an element. It renders `children` through a portal into
 * an element of its own, which the chart holds; changing its props moves
 * it from the next frame, and unmounting removes it. Among the chart's
 * children; inside a <Panel> or an <Inset>, in that panel. It renders from
 * the commit after its first, so servers, and the first render of a
 * hydrated chart, have nothing of it.
 *
 * ```tsx
 * <Chart interaction={{ zoom: "x" }}>
 *   <Line data={metrics} x="time" y="latency" />
 *   <Anchor at={{ x: peak.time, y: peak.value }} side="top" offset={8}>
 *     <button onClick={onPeak}>Peak</button>
 *   </Anchor>
 * </Chart>
 * ```
 */
export const Anchor: PartElement<AnchorProps> = /* @__PURE__ */ (() => {
  const element = (() => {
    throw new Error("<Anchor> must be among the children of a <Chart>");
  }) as unknown as PartElement<AnchorProps>;
  element.displayName = "Anchor";
  element.addTo = (props, parts, placing, key) => {
    // Keyed by its panel and its place, so that those of panels and fragments do not meet.
    parts.rendered.push(
      <Held
        key={JSON.stringify([placing?.panel, key])}
        chart={parts.chart}
        {...((placing?.props(element, props) ?? props) as AnchorProps)}
      />,
    );
  };
  return element;
})();

/** Options as JSON to compare, a Date as its time: the same place, where a date's text is a category. */
function json(options: AnchorOptions): string {
  return JSON.stringify(options, function (this: Record<string, unknown>, key, value) {
    const given = this[key];
    return given instanceof Date ? given.getTime() : value;
  });
}

/** An <Anchor> as its <Chart> renders it, with the chart. */
function Held({ chart, children, ...options }: AnchorProps & { chart: RefObject<Chart | null> }) {
  // Made after the first render, so that servers and hydration render nothing of it.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => setElement(document.createElement("div")), []);
  /** The anchor, the chart it is in, and the options it was last given (as JSON). */
  const held = useRef<{ chart: Chart; anchor: Anchored; options: string } | null>(null);
  const given = json(options);
  // A passive effect, after the layout effects in which <Chart> makes its chart.
  useEffect(() => {
    const current = chart.current;
    const last = held.current;
    if (!current || !element) return;
    if (last?.chart !== current)
      held.current = { chart: current, anchor: anchor(current, element, options), options: given };
    else if (last.options !== given) {
      last.anchor.set(options);
      last.options = given;
    }
  });
  useEffect(
    () => () => {
      held.current?.anchor.remove();
      held.current = null;
    },
    [],
  );
  return element && createPortal(children, element);
}
