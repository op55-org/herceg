<!-- Error bars: `x`, `y1`, `y2` (vertical) or `y`, `x1`, `x2` (horizontal). -->
<script lang="ts" generics="S extends Schema">
  import { type ErrorBarOptions, errorbar, type Schema } from "herceg";
  import { built, markAnchor, panelled, plain, type WithRows } from "./marks.js";

  let { data, ...options }: WithRows<ErrorBarOptions<S>, S> = $props();
  const inPanel = panelled("ErrorBar");
  const mark = $derived(built(() => errorbar(data, inPanel(plain(options)) as ErrorBarOptions<S>)));
  const anchor = markAnchor("ErrorBar", () => mark);
</script>

<template {@attach anchor}></template>
