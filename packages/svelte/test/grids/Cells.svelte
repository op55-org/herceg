<!--
  A grid, local or remote, whose columns' Svelte cells are this fixture's
  snippets, as `use` names them by column id; it provides a context the
  cells read (and `context`, as "given"), and `gone` replaces the grid with
  a paragraph.
-->
<script lang="ts">
  import { setContext, untrack } from "svelte";
  import { RemoteGrid } from "../../src/grid/remote.js";
  import { Grid } from "../../src/grid.js";
  import Badge from "./Badge.svelte";
  import Counter from "./Counter.svelte";
  import type { Hooks, Snippets, Use } from "./hooks.js";
  import Probe from "./Probe.svelte";
  import Toggle from "./Toggle.svelte";

  let {
    model,
    remote = false,
    use,
    hooks = {},
    suffix = "",
    reads = [],
    gone = false,
    context,
    grid = $bindable(null),
    onrender,
    counted,
    clicked,
  }: {
    // biome-ignore lint/suspicious/noExplicitAny: a model of any schema, local or remote
    model: any;
    remote?: boolean;
    use?: Record<string, Use> | undefined;
    hooks?: Hooks;
    suffix?: string;
    reads?: string[];
    gone?: boolean;
    context?: object;
    // biome-ignore lint/suspicious/noExplicitAny: a grid of either kind, as `model`
    grid?: any;
    onrender?: ((event: { revision: number }) => void) | undefined;
    counted?: (name: string) => void;
    clicked?: () => void;
  } = $props();
  setContext("theme", "loud");
  setContext(
    "given",
    untrack(() => context),
  );

  const fail = (message: string) => {
    throw new Error(message);
  };
  const snippets = $derived({
    text,
    span,
    badge,
    counter,
    button,
    toggle,
    input,
    throws,
    read,
    kept,
    probe,
    fail: failing,
    a,
    b,
  });
  const cells = $derived(
    use &&
      Object.fromEntries(
        Object.entries(use).map(([id, one]) => [
          id,
          typeof one === "string"
            ? snippets[one]
            : { ...one, render: snippets[one.snippet as Snippets] },
        ]),
      ),
  );
</script>

{#snippet text(cell: import("herceg/grid").GridCellContext)}<i>{cell.text}{suffix}</i>{/snippet}
{#snippet span(cell: import("herceg/grid").GridCellContext)}<span data-row={cell.row.ref.id}>{cell.text}</span>{/snippet}
{#snippet badge(cell: import("herceg/grid").GridCellContext)}<Badge name={cell.text} />{/snippet}
{#snippet counter(cell: import("herceg/grid").GridCellContext)}<Counter name={cell.text} mounted={counted} />{/snippet}
{#snippet button(cell: import("herceg/grid").GridCellContext)}<button type="button" onclick={clicked}>{cell.text}</button>{/snippet}
{#snippet toggle(cell: import("herceg/grid").GridCellContext)}<Toggle text={cell.text} />{/snippet}
{#snippet input(cell: import("herceg/grid").GridCellContext)}<input aria-label="Service" value={cell.text} />{/snippet}
{#snippet throws(cell: import("herceg/grid").GridCellContext)}<i>{cell.rowIndex === 2 ? fail("no svc2") : cell.text}</i>{/snippet}
{#snippet read(cell: import("herceg/grid").GridCellContext)}<i>{reads.map((one) => cell.read(one as never)).join(" ")}{suffix}</i>{/snippet}
{#snippet kept(cell: import("herceg/grid").GridCellContext)}<Counter name={reads.map((one) => cell.read(one as never)).join(" ") + suffix} mounted={counted} />{/snippet}
{#snippet probe(cell: import("herceg/grid").GridCellContext)}<Probe {cell} {hooks} />{/snippet}
{#snippet failing(cell: import("herceg/grid").GridCellContext)}<button type="button" onclick={() => fail("clicked")}>{cell.text}</button>{/snippet}
{#snippet a()}<i>a</i>{/snippet}
{#snippet b()}<i>b</i>{/snippet}

{#if gone}
  <p>Gone</p>
{:else if remote}
  <RemoteGrid {model} ariaLabel="Services" style="height: 300px" {cells} bind:grid {onrender} />
{:else}
  <Grid {model} ariaLabel="Services" style="height: 300px; width: 600px" {cells} bind:grid {onrender} />
{/if}
