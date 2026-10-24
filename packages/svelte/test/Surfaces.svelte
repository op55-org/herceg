<!-- A contract case's chart through the components: its chart options as
     props and a component per mark, by the mark type of the spec. -->
<script lang="ts">
  import type { Chart as HercegChart, Table } from "herceg";
  import type { Component } from "svelte";
  import { Bar, Chart, Line, Point, Point3D, Region, Rule, Text } from "../src/index.js";

  let {
    chart = $bindable(null),
    options,
    marks,
    data,
  }: {
    chart?: HercegChart | null;
    options: Record<string, unknown>;
    marks: { type: string; [option: string]: unknown }[];
    data: Table;
  } = $props();
  const COMPONENTS: Record<string, Component<never>> = {
    bar: Bar as never,
    line: Line as never,
    point: Point as never,
    point3d: Point3D as never,
    region: Region as never,
    rule: Rule as never,
    text: Text as never,
  };
</script>

<Chart bind:chart height={240} {...options}>
  {#each marks as { type, ...mark }, i (i)}
    {@const Mark = COMPONENTS[type] as Component<Record<string, unknown>>}
    <Mark {data} {...mark} />
  {/each}
</Chart>
