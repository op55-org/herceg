<!-- Anchors the tests move, mount, and put in panels, by `shape`. -->
<script lang="ts">
  import type { Chart as HercegChart, Table } from "herceg";
  import { setContext } from "svelte";
  import { Anchor, Chart, Line } from "../src/index.js";
  import { Columns, Panel } from "../src/layout.js";
  import Label from "./Label.svelte";

  let {
    data,
    shape,
    x = 1,
    shown = true,
    chart = $bindable(null),
  }: {
    data: Table<{ t: "number"; a: "number" }>;
    shape: "point" | "panels";
    x?: number | string | Date;
    shown?: boolean;
    chart?: HercegChart | null;
  } = $props();
  setContext("unit", "ms");
</script>

<Chart bind:chart>
  {#if shape === "point"}
    <Line {data} x="t" y="a" />
    {#if shown}
      <Anchor at={{ x, y: 4 }} side="top" offset={8}><Label /></Anchor>
    {/if}
  {:else}
    <Columns>
      <Panel id="a"><Line {data} x="t" y="a" /><Anchor at={{ x: 1, y: 4 }}><i>a</i></Anchor></Panel>
      <Panel id="b"><Line {data} x="t" y="a" /><Anchor at={{ x: 1, y: 4 }}><i>b</i></Anchor></Panel>
    </Columns>
    <Anchor at={{ x: 2, y: 4 }} panel="b"><i>chart</i></Anchor>
  {/if}
</Chart>
