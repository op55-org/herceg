<!-- A cell's component reading a context of the app's. -->
<script lang="ts">
  import { getContext } from "svelte";

  let { name }: { name: string } = $props();
  const theme = getContext<string>("theme") ?? "plain";
</script>

<b class={theme}>{name}</b>
