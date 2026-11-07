<!--
  One of a grid's Svelte cells: its column's snippet in a boundary of its
  own, drawing the cell's text if it throws (reported once, as long as the
  cell shows its row), each commit told to the grid after the content's own
  effects.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import type { CellPacket } from "./cells.svelte.js";
  import Drawn from "./Drawn.svelte";

  let { packet }: { packet: CellPacket } = $props();

  // A control or composite cell's content changed on its own (a
  // component's state): told to the grid as drawn too, before paint, so the
  // cell's focus and tab stop follow its controls.
  const host = $derived(packet.host);
  $effect(() => {
    if (!host) return;
    const observer = new MutationObserver(() => untrack(() => packet.drawn()));
    observer.observe(host, { childList: true, subtree: true, attributeFilter: FOCUSING });
    return () => observer.disconnect();
  });

  /**
   * Attributes deciding whether an element takes the focus, or is drawn at
   * all; the grid's own `tabindex` writes change only what differs, and
   * leave its tab stop be, so they settle.
   */
  const FOCUSING = ["disabled", "hidden", "inert", "href", "type", "style", "class", "tabindex"];

  function report(error: unknown) {
    if (typeof reportError === "function") reportError(error);
    else console.error(error);
  }
</script>

<!-- Content and acknowledgement written together: whitespace between them would be text in the host. -->
{#if packet.render}
  <svelte:boundary onerror={report}>
    {#snippet failed()}{packet.cell.text}<Drawn drawn={packet.drawn} />{/snippet}
    {@render packet.render(packet.cell)}<Drawn drawn={packet.drawn} />
  </svelte:boundary>
{:else}
  {packet.cell.text}
{/if}
