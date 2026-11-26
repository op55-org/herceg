<!-- Segments: each row from one place to another, with dots or arrowheads at its ends. -->
<script lang="ts" generics="S extends Schema">
  import { type Schema, type SegmentOptions, segment } from "herceg";
  import { built, markAnchor, panelled, plain, type WithRows } from "./marks.js";

  let { data, ...options }: WithRows<SegmentOptions<S>, S> = $props();
  const inPanel = panelled("Segment");
  const mark = $derived(built(() => segment(data, inPanel(plain(options)) as SegmentOptions<S>)));
  const anchor = markAnchor("Segment", () => mark);
</script>

<template {@attach anchor}></template>
