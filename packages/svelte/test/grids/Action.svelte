<!-- An action of a row: a button, counting its mounts. -->
<script lang="ts">
  import { onMount } from "svelte";

  let {
    service,
    opened,
    live,
  }: {
    service: string;
    opened: (service: string) => void;
    live: (service: string, by: number) => void;
  } = $props();
  onMount(() => {
    const mounted = service;
    live(mounted, 1);
    return () => live(mounted, -1);
  });
</script>

<button type="button" onclick={() => opened(service)}>Open</button>
