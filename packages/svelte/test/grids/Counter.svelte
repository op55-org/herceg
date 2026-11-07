<!-- A cell's component with state of its own: a button counting its presses. -->
<script lang="ts">
  import { onMount } from "svelte";

  let { name, mounted }: { name: string; mounted?: ((name: string) => void) | undefined } =
    $props();
  let count = $state(0);
  onMount(() => mounted?.(name));
</script>

<button type="button" onclick={() => count++}>{name} {count}</button>
