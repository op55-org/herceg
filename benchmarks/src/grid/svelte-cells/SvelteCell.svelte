<!-- A cell of the framework cells scenarios: `CellView`, under state of its own (whether it was pressed), as react-cells.tsx's `ReactCell`. -->
<script lang="ts">
  import type { CellProps } from "../react-cells.tsx";
  import CellView from "./CellView.svelte";

  let props: CellProps = $props();
  let pressed = $state(false);
</script>

<div class="bc-react" data-pressed={pressed || undefined} onpointerdown={() => (pressed = true)}>
  <CellView {...props} />
</div>
