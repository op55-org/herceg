<!-- A region and a custom mark reading channels through the chart's scales. -->
<script lang="ts">
  import { type Chart as HercegChart, table } from "herceg";
  import { Chart, Custom, Region } from "../src/index.js";

  let {
    widths,
    chart = $bindable(null),
  }: {
    /** Receives the stroke widths each draw reads, by row. */
    widths: (read: (number | undefined)[]) => void;
    chart?: HercegChart | null;
  } = $props();

  const spans = table({ a: [0, 2], b: [1, 3], w: [0, 1], kind: ["x", "y"] });
</script>

<Chart
  bind:chart
  renderer="svg"
  scales={{
    widths: { type: "linear", range: [1, 5] },
    kinds: { type: "ordinal", domain: ["x", "y"], map: { x: "#ff0000", y: "#0000ff" } },
  }}
>
  <Region data={spans} x1="a" x2="b" encode={{ fill: { field: "kind", scale: "kinds" } }} />
  <Custom
    data={spans}
    x={["a", "b"]}
    y="w"
    encode={{ strokeWidth: { field: "w", scale: "widths" } }}
    draw={({ series, item, path, encoded }) => {
      const read: (number | undefined)[] = [];
      for (let row = 0; row < spans.length; row++) {
        read.push(encoded("strokeWidth", row));
        item(series[0]!, row, () => path("M0 0L10 10", { stroke: "#000000" }));
      }
      widths(read);
    }}
  />
</Chart>
