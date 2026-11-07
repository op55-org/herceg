<!--
  Tells the grid a cell's update is in its host, on each update: after the
  content before it has run its own effects.
-->
<script lang="ts">
  import { untrack } from "svelte";

  let { drawn }: { drawn: () => void } = $props();
  $effect(() => {
    const told = drawn;
    untrack(told);
  });
</script>
