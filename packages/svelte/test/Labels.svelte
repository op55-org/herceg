<!-- Custom marks alike but for what they write, one per name, in a keyed each. -->
<script lang="ts">
  import type { DrawContext, Chart as HercegChart } from "herceg";
  import { Chart, Custom, Line } from "../src/index.js";
  import type { Flights } from "./flights.js";

  let {
    data,
    names,
    written,
    shown = true,
    chart = $bindable(null),
  }: {
    data: Flights;
    names: string[];
    /** What each name's mark writes. */
    written: Record<string, string>;
    shown?: boolean;
    chart?: HercegChart | null;
  } = $props();

  const writing =
    (text: string) =>
    ({ text: write, x, y }: DrawContext) =>
      write(x(1), y(2), text);
</script>

<Chart bind:chart x={{ domain: [0, 2] }} y={{ domain: [0, 3] }}>
  <Line {data} x="start" y="lane" />
  {#if shown}
    {#each names as name (name)}
      <Custom draw={writing(written[name] ?? name)} />
    {/each}
  {/if}
</Chart>
