<!--
  Content the chart holds at a place in its data: moved with every frame the
  chart draws and hidden while the place is out of view, as herceg's
  `anchor` holds an element. Its children render into an element the chart
  holds; changing its props moves it from the next frame, and unmounting
  removes it. Among the chart's children; inside a <Panel> or an <Inset>, in
  that panel. It is held once mounted, so servers render it hidden, with the
  chart's children.
-->
<script lang="ts">
  import { type Anchor as Anchored, type AnchorOptions, anchor, type Chart } from "herceg";
  import { type Snippet, untrack } from "svelte";
  import { chartOf, panelled, plain } from "./marks.js";

  let { children, ...options }: AnchorOptions & { children?: Snippet } = $props();
  const list = chartOf("Anchor");
  const inPanel = panelled("Anchor");
  /** What the chart holds, moved out of the element <Chart> renders its children in. */
  let element: HTMLDivElement;
  /** The anchor, the chart it is in, and the options it was last given (as JSON). */
  let held: { chart: Chart; anchor: Anchored; options: string } | undefined;
  // Runs again as the chart is made and the props change.
  $effect(() => {
    const chart = list.chart;
    const given = inPanel(plain(options)) as AnchorOptions;
    const json = JSON.stringify(given, function (this: Record<string, unknown>, key, value) {
      // A Date as its time: the same place, where a date's text is a category.
      const at = this[key];
      return at instanceof Date ? at.getTime() : value;
    });
    untrack(() => {
      if (!chart) return;
      if (held?.chart !== chart)
        held = { chart, anchor: anchor(chart, element, given), options: json };
      else if (held.options !== json) {
        held.anchor.set(given);
        held.options = json;
      }
    });
  });
  $effect(() => () => {
    held?.anchor.remove();
    held = undefined;
  });
</script>

<!-- The outer element stays where Svelte put it; the chart holds the inner one. -->
<div><div bind:this={element}>{@render children?.()}</div></div>
