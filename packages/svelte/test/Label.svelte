<!-- A button with state of its own, which reads the application's context. -->
<script lang="ts">
  import { getContext } from "svelte";

  let clicks = $state(0);
  const unit = getContext<string>("unit");
</script>

<button type="button" onclick={() => clicks++}>Peak {unit} {clicks}</button>
