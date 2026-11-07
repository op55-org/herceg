<!-- The cells scenarios' cells (cells.ts) as a Svelte component, drawing what `fillDomCell` draws, as react-cells.tsx's `CellView`. -->
<script lang="ts">
  import {
    barEnds,
    CHIP_FILLS,
    inkOver,
    LINK_URL,
    N0_DOMAIN,
    SHAPE_PATHS,
    SYMBOL_BOX,
    shapeOf,
  } from "../cells.ts";
  import type { CellProps } from "../react-cells.tsx";

  let { field, value, text, extent }: CellProps = $props();
  const fill = $derived(field === "c0" ? CHIP_FILLS[value as string] : undefined);
  const ends = $derived(
    (field === "n0" || field === "n4") && value !== undefined
      ? barEnds(value as number, field === "n0" ? N0_DOMAIN : extent)!
      : undefined,
  );
</script>

{#if value === undefined}
  <div class="bc-cell">{text}</div>
{:else if field === "c0"}
  <div class="bc-cell">
    <span class="bc-chip" style:background={fill} style:color={fill && inkOver(fill)}>{text}</span>
  </div>
{:else if field === "n1"}
  <div class="bc-cell">
    <a class="bc-link" href={LINK_URL + encodeURIComponent(String(value))} target="_blank" rel="noopener noreferrer">{text}</a>
  </div>
{:else if field === "n3"}
  <div class="bc-cell">
    <svg
      class="bc-symbol"
      width={SYMBOL_BOX}
      height={SYMBOL_BOX}
      viewBox={`${-SYMBOL_BOX / 2} ${-SYMBOL_BOX / 2} ${SYMBOL_BOX} ${SYMBOL_BOX}`}
      aria-hidden="true"
    >
      <path d={SHAPE_PATHS[shapeOf(value as number)!]} />
    </svg><span class="bc-text">{text}</span>
  </div>
{:else}
  <div class="bc-cell">
    <span class="bc-bar" style:--bc-start={ends![0]} style:--bc-end={ends![1]}></span><span class="bc-text">{text}</span>
  </div>
{/if}
