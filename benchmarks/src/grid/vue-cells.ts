// The cells scenarios' cells (cells.ts) as Vue components, as
// react-cells.tsx draws them in React: `CellView` (functional) draws what
// `fillDomCell` draws, and `VueCell`, the framework cells scenarios' cell
// for Vue grids, wraps it with state of its own (whether it was pressed).

import { defineComponent, type FunctionalComponent, h, type PropType, ref } from "vue";
import {
  barEnds,
  CHIP_FILLS,
  inkOver,
  LINK_URL,
  N0_DOMAIN,
  SHAPE_PATHS,
  SYMBOL_BOX,
  shapeOf,
} from "./cells.ts";
import type { CellProps } from "./react-cells.tsx";

export const CellView: FunctionalComponent<CellProps> = ({ field, value, text, extent }) => {
  if (value === undefined) return h("div", { class: "bc-cell" }, text);
  if (field === "c0") {
    const fill = CHIP_FILLS[value as string];
    return h("div", { class: "bc-cell" }, [
      h(
        "span",
        { class: "bc-chip", style: fill ? { background: fill, color: inkOver(fill) } : {} },
        text,
      ),
    ]);
  }
  if (field === "n1")
    return h("div", { class: "bc-cell" }, [
      h(
        "a",
        {
          class: "bc-link",
          href: `${LINK_URL}${encodeURIComponent(String(value))}`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
        text,
      ),
    ]);
  if (field === "n3")
    return h("div", { class: "bc-cell" }, [
      h(
        "svg",
        {
          class: "bc-symbol",
          width: SYMBOL_BOX,
          height: SYMBOL_BOX,
          viewBox: `${-SYMBOL_BOX / 2} ${-SYMBOL_BOX / 2} ${SYMBOL_BOX} ${SYMBOL_BOX}`,
          "aria-hidden": "true",
        },
        [h("path", { d: SHAPE_PATHS[shapeOf(value as number)!] })],
      ),
      h("span", { class: "bc-text" }, text),
    ]);
  const [start, end] = barEnds(value as number, field === "n0" ? N0_DOMAIN : extent)!;
  return h("div", { class: "bc-cell" }, [
    h("span", { class: "bc-bar", style: { "--bc-start": start, "--bc-end": end } }),
    h("span", { class: "bc-text" }, text),
  ]);
};

/** A cell of the framework cells scenarios: `CellView`, under state of its own. */
export const VueCell = defineComponent({
  props: {
    field: { type: String, required: true },
    value: [Number, String] as PropType<number | string | undefined>,
    text: { type: String, required: true },
    extent: { type: Array as unknown as PropType<readonly [number, number]>, required: true },
  },
  setup(props) {
    const pressed = ref(false);
    return () =>
      h(
        "div",
        {
          class: "bc-react",
          "data-pressed": pressed.value || undefined,
          onPointerdown: () => {
            pressed.value = true;
          },
        },
        [h(CellView, props)],
      );
  },
});
