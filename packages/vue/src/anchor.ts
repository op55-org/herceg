// <Anchor>: a slot's content a <Chart> holds at a place in its data
// (herceg's `anchor`). <Chart> reads it from its slot, as it reads marks,
// and renders what it adds with its chart.

import { type Anchor as Anchored, type AnchorOptions, anchor, type Chart } from "herceg";
import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  type ShallowRef,
  type Slots,
  shallowRef,
  Teleport,
  watchEffect,
} from "vue";
import { type PartComponent, pathKey } from "./chart.ts";
import { optionsOf } from "./marks.ts";

export type AnchorProps = AnchorOptions;

/**
 * A slot's content the chart holds at a place in its data: moved with
 * every frame the chart draws and hidden while the place is out of view,
 * as herceg's `anchor` holds an element. Its default slot is teleported
 * into an element of its own, which the chart holds; changing its props
 * moves it from the next frame, and unmounting removes it. In the chart's
 * slot; inside a <Panel> or an <Inset>, in that panel. It renders once
 * mounted, so servers have nothing of it.
 *
 * ```vue
 * <Chart :interaction="{ zoom: 'x' }">
 *   <Line :data="metrics" x="time" y="latency" />
 *   <Anchor :at="{ x: peak.time, y: peak.value }" side="top" :offset="8">
 *     <button @click="onPeak">Peak</button>
 *   </Anchor>
 * </Chart>
 * ```
 */
export const Anchor = /* @__PURE__ */ (() => {
  const component = (() => {
    throw new Error("<Anchor> must be in the slot of a <Chart>");
  }) as unknown as PartComponent;
  component.displayName = "Anchor";
  component.addTo = (vnode, parts, placing, path) => {
    const options = optionsOf(vnode.props) as unknown as AnchorOptions;
    parts.rendered.push(
      h(
        Held,
        {
          // Keyed by its panel and its place in the panel's slot, so that keys alike meet nowhere.
          key: pathKey([placing?.panel, path]),
          chart: parts.chart,
          options: (placing?.props(component, options) ?? options) as AnchorOptions,
        },
        vnode.children as Slots,
      ),
    );
  };
  return component as unknown as (props: AnchorProps) => null;
})();

/** Options as JSON to compare, a Date as its time: the same place, where a date's text is a category. */
function json(options: AnchorOptions): string {
  return JSON.stringify(options, function (this: Record<string, unknown>, key, value) {
    const given = this[key];
    return given instanceof Date ? given.getTime() : value;
  });
}

/** An <Anchor> as its <Chart> renders it, with the chart. */
const Held = defineComponent({
  props: {
    chart: { type: Object as PropType<ShallowRef<Chart | null>>, required: true },
    options: { type: Object as PropType<AnchorOptions>, required: true },
  },
  setup(props, { slots }) {
    // Made once mounted, so that servers render nothing of it.
    const element = shallowRef<HTMLDivElement | null>(null);
    onMounted(() => {
      element.value = document.createElement("div");
    });
    /** The anchor, the chart it is in, and the options it was last given (as JSON). */
    let held: { chart: Chart; anchor: Anchored; options: string } | undefined;
    // Runs again as the chart is made and the props change.
    watchEffect(
      () => {
        const current = props.chart.value;
        const given = json(props.options);
        if (!current || !element.value) return;
        if (held?.chart !== current)
          held = {
            chart: current,
            anchor: anchor(current, element.value, props.options),
            options: given,
          };
        else if (held.options !== given) {
          held.anchor.set(props.options);
          held.options = given;
        }
      },
      { flush: "post" },
    );
    onBeforeUnmount(() => {
      held?.anchor.remove();
      held = undefined;
    });
    return () => element.value && h(Teleport, { to: element.value }, slots.default?.() ?? []);
  },
});
