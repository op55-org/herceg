<!-- A matrix row's chart through the components (contracts.test.svelte.ts):
     chart options as props, and the row's mark component by its name with
     its props and any more given. -->
<script lang="ts">
  import type { ChartError, Chart as HercegChart, Inspection } from "herceg";
  import type { Component } from "svelte";
  import * as components from "../src/index.js";

  let {
    chart = $bindable(null),
    options,
    element,
    props,
    mark = {},
    onhover,
    onerror,
  }: {
    chart?: HercegChart | null;
    options: Record<string, unknown>;
    element: string;
    props: Record<string, unknown>;
    mark?: Record<string, unknown>;
    onhover: (event: { inspection: Inspection | undefined }) => void;
    onerror: (error: ChartError) => void;
  } = $props();
  const Mark = $derived(
    (components as unknown as Record<string, Component<Record<string, unknown>>>)[element]!,
  );
</script>

<components.Chart bind:chart {...options} {onhover} {onerror}>
  <Mark {...props} {...mark} />
</components.Chart>
