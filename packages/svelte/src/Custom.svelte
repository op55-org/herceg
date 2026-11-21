<!-- A custom mark: `draw` places shapes with the chart's scales, without `data` or over the fields of `data`. -->
<script lang="ts" generics="T = undefined">
  import {
    type ChartMark,
    type CustomDataOptions,
    type CustomOptions,
    custom,
    type Schema,
    type Table,
  } from "herceg";
  import { untrack } from "svelte";
  import { canonical } from "./chart.js";
  import {
    built,
    type CustomCalls,
    type CustomProps,
    holdCustom,
    markAnchor,
    panelled,
    plain,
  } from "./marks.js";

  let { data, draw, ...options }: CustomProps<T> = $props();
  const inPanel = panelled("Custom");
  /** The `draw` and `pointText` given now. */
  const latest = () =>
    ({ draw, pointText: (options as Partial<CustomCalls>).pointText }) as CustomCalls;
  // The component keeps its mark while its props but `draw` and `pointText`
  // are the same (as `canonical` writes them), so a new `draw` keeps a
  // transition playing: the mark calls what it holds, which the chart gives
  // the latest once it takes an update (chart.ts, `install`).
  let kept: { key: string; mark: ChartMark } | undefined;
  const mark = $derived(
    built(() => {
      const { pointText, ...others } = inPanel(plain(options)) as Partial<CustomCalls>;
      // A pointText given or not is another mark: without one, values are written as axes write them.
      const key = canonical({ ...others, data, pointText: pointText !== undefined });
      if (kept?.key === key) return kept.mark;
      const calls = untrack(latest);
      const own: CustomDataOptions<Schema> = {
        ...(others as Omit<CustomDataOptions<Schema>, keyof CustomCalls>),
        draw: (context) => calls.draw(context),
        ...(pointText && { pointText: (...args) => calls.pointText!(...args) }),
      };
      const made = data
        ? custom(data as unknown as Table, own)
        : custom(own as unknown as CustomOptions);
      holdCustom(made, { calls, latest });
      kept = { key, mark: made };
      return made;
    }),
  );
  // The chart reads `draw` and `pointText` with the mark, so that a new one updates it.
  const anchor = markAnchor("Custom", () => {
    latest();
    return mark;
  });
</script>

<template {@attach anchor}></template>
