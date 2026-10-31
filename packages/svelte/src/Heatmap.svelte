<!-- A grid of colored cells. -->
<script lang="ts" generics="S extends Schema">
  import { type HeatmapOptions, heatmap, type Schema } from "herceg";
  import { built, markAnchor, panelled, plain, type WithRows } from "./marks.js";

  let { data, ...options }: WithRows<HeatmapOptions<S>, S> = $props();
  const inPanel = panelled("Heatmap");
  const mark = $derived(built(() => heatmap(data, inPanel(plain(options)) as HeatmapOptions<S>)));
  const anchor = markAnchor("Heatmap", () => mark);
</script>

<template {@attach anchor}></template>
