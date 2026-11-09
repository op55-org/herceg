// Svelte cells in herceg grids: snippets mounted into the grid's hosts
// with the component's contexts, each row's state its own; the first draw's
// cells committed by Svelte's running flush and later frames' with
// `flushSync` in the grid's frame, never a frame of another row's content;
// `onrender` after the commit; boundaries for throwing cells (event
// handlers' errors left to the app); focus into Svelte controls; effects
// changing the model, the cells, or unmounting the grid; new models and
// props; remote grids across queries and evicted blocks; and what is left
// behind.
import { rowView, table } from "herceg";
import { createGridModel, type GridCellContext, type Grid as HercegGrid } from "herceg/grid";
import { memorySource } from "herceg/grid/memory";
import { createRemoteGridModel, type GridSource } from "herceg/grid/remote";
import { type Component, createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { collectGarbage } from "../../herceg/test/browser/helpers.ts";
import { Grid } from "../src/grid.js";
import Cells from "./grids/Cells.svelte";
import type { Hooks, Use } from "./grids/hooks.ts";

const ROW = 28;
let host: HTMLDivElement;
let mounted: Record<string, unknown> | undefined;
/** Errors reported (`reportError`), or thrown by event handlers, during the test. */
let reported: string[];
const report = (event: ErrorEvent) => {
  reported.push((event.error as Error).message);
  event.preventDefault();
};

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px";
  document.body.append(host);
  reported = [];
  window.addEventListener("error", report);
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  flushSync();
  host.remove();
  window.removeEventListener("error", report);
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const frames = async () => {
  await frame();
  await frame();
};
async function until(ready: () => boolean, ms = 3000): Promise<void> {
  for (const start = performance.now(); !ready(); await frame())
    if (performance.now() - start > ms) throw new Error("until: timed out");
}

type CellsProps = Parameters<typeof Cells>[1];

type Props = CellsProps & { grid: HercegGrid };

/**
 * Mounts `<Cells>` with `initial` as state the tests change, and runs its
 * effects; `grid` is bound. `ready` has the props before the effects run.
 */
function render(
  initial: Partial<CellsProps> & Pick<CellsProps, "model">,
  ready?: (props: Props) => void,
): Props {
  const props = $state({ grid: null, ...initial }) as Props;
  mounted = mount(Cells, { target: host, props });
  ready?.(props);
  flushSync();
  return props;
}

function services(rows: number) {
  return table({
    id: Float64Array.from({ length: rows }, (_, i) => i),
    service: Array.from({ length: rows }, (_, i) => `svc${i}`),
    owner: Array.from({ length: rows }, (_, i) => `own${i % 7}`),
  });
}

function servicesModel(rows: number) {
  return createGridModel({
    data: rowView(services(rows)),
    columns: [{ field: "id" }, { field: "service" }],
  });
}

/** The body's rows, top to bottom. */
const rowsOf = () =>
  [...host.querySelectorAll<HTMLElement>(".hg-body [role=row]")].sort(
    (a, b) => Number(a.getAttribute("aria-rowindex")) - Number(b.getAttribute("aria-rowindex")),
  );
/** The body's cells of column `column` (1-based), top to bottom. */
const cellsOf = (column: number) =>
  rowsOf().map((row) => row.querySelector<HTMLElement>(`[aria-colindex="${column}"]`)!);
/** A row's id, as its first cell writes it (with separators: "1,500"). */
const idOf = (cell: HTMLElement) =>
  cell.parentElement!.querySelector('[aria-colindex="1"]')!.textContent!.replace(/,/g, "");
/** Whether a cell's Svelte content is in its host, shown. */
const shown = (cell: HTMLElement) => {
  const held = cell.querySelector<HTMLElement>(".hg-host");
  return !!held && !held.hidden && held.children.length > 0;
};

describe("<Grid> cells", () => {
  it("draw the first frame's cells before paint, in the app's context, then tell onrender", async () => {
    const model = servicesModel(100);
    const told: boolean[] = [];
    render({
      model,
      use: { service: "badge" },
      onrender: () => told.push(cellsOf(2).every(shown)),
    });
    const cells = cellsOf(2);
    expect(cells.length).toBeGreaterThan(5);
    expect(cells.every(shown)).toBe(true);
    expect(cells[0]!.querySelector("b")!.outerHTML).toBe('<b class="loud">svc0</b>');
    // Text cells are named by their text, and their content is not read.
    expect(cells[0]!.getAttribute("aria-label")).toBe("svc0");
    expect(cells[0]!.querySelector<HTMLElement>(".hg-host")!.inert).toBe(true);
    // Once, after the first frame's cells were committed.
    await Promise.resolve();
    expect(told).toEqual([true]);
  });

  it("commit a frame's cells in the grid's frame, before it paints: never another row's content", async () => {
    const model = servicesModel(1000);
    const told: boolean[] = [];
    render({ model, use: { service: "span" }, onrender: () => told.push(cellsOf(2).every(shown)) });
    await frames();
    for (const top of [ROW * 300, ROW * 310, ROW * 900, 0]) {
      model.scrollTo({ top });
      const painted = await new Promise<{ id: string; row: string | null; text: string }[]>(
        (resolve) =>
          // A callback after the grid's, in its frame: what paints.
          requestAnimationFrame(() =>
            resolve(
              cellsOf(2).map((cell) => ({
                id: idOf(cell),
                row: cell.querySelector("span")?.getAttribute("data-row") ?? null,
                text: cell.textContent!,
              })),
            ),
          ),
      );
      expect(painted.length).toBeGreaterThan(10);
      for (const { id, row, text } of painted) expect([row, text]).toEqual([id, `svc${id}`]);
    }
    expect(told.length).toBeGreaterThanOrEqual(5);
    expect(told.every(Boolean)).toBe(true);
    expect(reported).toEqual([]);
  });

  it("keep each cell's state its row's: kept while it shows the row, new for another row", async () => {
    const model = servicesModel(1000);
    const counted: string[] = [];
    render({
      model,
      use: { service: { snippet: "counter", interaction: "control" } },
      counted: (name) => counted.push(name),
    });
    const button = () => cellsOf(2)[0]!.querySelector("button")!;
    button().click();
    flushSync();
    expect(button().textContent).toBe("svc0 1");
    // The row's selection changes: the cell draws again, its state the same.
    model.select(0, "only");
    await frames();
    expect(button().textContent).toBe("svc0 1");
    expect(counted.filter((name) => name === "svc0")).toHaveLength(1);
    // Its element shows another row: a new component, of that row.
    model.scrollTo({ top: ROW * 500 });
    await frames();
    for (const cell of cellsOf(2))
      expect(cell.querySelector("button")!.textContent).toBe(`svc${idOf(cell)} 0`);
    model.scrollTo({ top: 0 });
    await frames();
    expect(button().textContent).toBe("svc0 0");
  });

  it("keep what a cell drew, and its state, as it runs again between a call's draw and the next frame", async () => {
    const model = servicesModel(100);
    const counted: string[] = [];
    const props = render({
      model,
      use: { service: { snippet: "kept", fields: ["id", "owner"], interaction: "control" } },
      reads: ["id"],
      counted: (name) => counted.push(name),
    });
    const button = () => cellsOf(2)[0]!.querySelector("button")!;
    button().click();
    flushSync();
    expect(button().textContent).toBe("0 1");
    // A call's draw supersedes the cell's update and hands the next over in
    // the grid's next frame; the snippet runs again before that on its own,
    // reading a field it had not read.
    model.select(0, "only");
    props.grid.render();
    props.suffix = "!";
    props.reads = ["id", "owner"];
    flushSync();
    expect(button().textContent).toBe("0 own0! 1");
    await frames();
    expect(button().textContent).toBe("0 own0! 1");
    expect(counted).toHaveLength(cellsOf(2).length);
    expect(reported).toEqual([]);
  });

  it("keep the values content last read, not those handed over, once the update is superseded", async () => {
    const data = services(100);
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const props = render({
      model,
      use: { service: { snippet: "read", fields: ["owner"] } },
      reads: ["owner"],
    });
    await frames();
    // The value changes; the snippet reads it again before the grid's next
    // frame (`reads` anew: Svelte keeps the expression's last result).
    data.set("owner", 0, "new");
    props.reads = ["owner"];
    props.suffix = "!";
    flushSync();
    expect(cellsOf(2)[0]!.querySelector("i")!.textContent).toBe("new!");
    props.grid.render();
    props.reads = ["owner"];
    props.suffix = "!!";
    flushSync();
    expect(cellsOf(2)[0]!.querySelector("i")!.textContent).toBe("new!!");
    expect(reported).toEqual([]);
  });

  it("follow state nested in `cells`: a column's interaction and fields changed in place", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const button = createRawSnippet((cell: () => GridCellContext) => ({
      render: () => `<button type="button">${cell().text}</button>`,
    }));
    const owner = createRawSnippet((cell: () => GridCellContext) => ({
      render: () => `<i>${cell().read("owner")}</i>`,
    }));
    const props = $state({
      model,
      ariaLabel: "Services",
      style: "height: 300px",
      cells: {
        service: { render: button, interaction: "text" as "text" | "control" },
        who: { render: owner, fields: ["owner"] },
      },
    });
    // mount() takes no generic component's schema from its props: cast.
    mounted = mount(Grid as unknown as Component<typeof props>, { target: host, props });
    flushSync();
    const held = (column: number) => cellsOf(column)[0]!.querySelector<HTMLElement>(".hg-host")!;
    expect(held(2).inert).toBe(true);
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
    const who = held(3);
    props.cells.service.interaction = "control";
    props.cells.who.fields.push("id");
    flushSync();
    await frames();
    expect(held(2).inert).toBe(false);
    // New fields: a new renderer, whose cells draw in new hosts.
    expect(held(3)).not.toBe(who);
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
    expect(reported).toEqual([]);
  });

  it("draw with the latest snippet and props, without a new grid or host", () => {
    const model = servicesModel(100);
    const props = render({ model, use: { service: "text" }, suffix: "!" });
    const grid = host.querySelector("[role=grid]");
    const held = cellsOf(2)[0]!.querySelector(".hg-host");
    expect(cellsOf(2)[0]!.textContent).toBe("svc0!");
    props.suffix = "?";
    flushSync();
    expect(cellsOf(2)[0]!.textContent).toBe("svc0?");
    // Another snippet, of the same fields: drawn in the same host.
    props.use = { service: "span" };
    flushSync();
    expect(cellsOf(2)[0]!.querySelector("span")!.textContent).toBe("svc0");
    expect(host.querySelector("[role=grid]")).toBe(grid);
    expect(cellsOf(2)[0]!.querySelector(".hg-host")).toBe(held);
  });

  it("read the fields a column's cells name; new fields replace that column's hosts alone", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const props = render({
      model,
      use: { service: "text", who: { snippet: "read", fields: ["owner"] } },
      reads: ["owner"],
    });
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
    const service = cellsOf(2)[0]!.querySelector(".hg-host");
    const who = cellsOf(3)[0]!.querySelector(".hg-host");
    props.use = { service: "text", who: { snippet: "read", fields: ["owner", "id"] } };
    props.reads = ["owner", "id"];
    flushSync();
    // The old hosts went before this paints; drawn again in the grid's next frame.
    expect(cellsOf(3)[1]!.querySelector(".hg-host")).not.toBe(who);
    expect(cellsOf(2)[0]!.querySelector(".hg-host")).toBe(service);
    await frames();
    expect(cellsOf(3)[1]!.textContent).toBe("own1 1");
    expect(reported).toEqual([]);
  });

  it("draw a throwing cell's text, reported once a mount, the rest of the grid drawn", async () => {
    const model = servicesModel(1000);
    render({ model, use: { service: "throws" } });
    await Promise.resolve();
    expect(reported).toEqual(["no svc2"]);
    const cells = cellsOf(2);
    expect(cells[2]!.textContent).toBe("svc2");
    expect(cells[2]!.querySelector("i")).toBeNull();
    expect(cells[3]!.querySelector("i")!.textContent).toBe("svc3");
    // Its element shows another row: a new boundary, and the row draws.
    model.scrollTo({ top: ROW * 500 });
    await frames();
    expect(cellsOf(2).every((cell) => cell.querySelector("i") !== null)).toBe(true);
    // Back again: mounted again, it throws again, reported again.
    model.scrollTo({ top: 0 });
    await frames();
    expect(reported).toEqual(["no svc2", "no svc2"]);
    expect(cellsOf(2)[2]!.textContent).toBe("svc2");
  });

  it("leave errors of event handlers in cells to the app, the cell drawn on", async () => {
    const model = servicesModel(100);
    render({ model, use: { service: { snippet: "fail", interaction: "control" } } });
    // Thrown as the page's error, as any event handler's.
    cellsOf(2)[1]!
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await frame();
    expect(reported).toEqual(["clicked"]);
    expect(cellsOf(2)[1]!.querySelector("button")!.textContent).toBe("svc1");
  });

  it("take the focus into a Svelte control, and into the next one after scrolling", async () => {
    const model = servicesModel(1000);
    const props = render({
      model,
      use: { service: { snippet: "button", interaction: "control" } },
    });
    props.grid.focusCell(0, "service");
    expect(document.activeElement!.outerHTML).toBe(
      '<button type="button" tabindex="0">svc0</button>',
    );
    await userEvent.keyboard("{PageDown}{PageDown}{PageDown}");
    await frames();
    const at = model.focus!.rowIndex;
    expect(at).toBeGreaterThan(20);
    expect(document.activeElement!.textContent).toBe(`svc${at}`);
    await userEvent.keyboard("{Control>}{End}{/Control}");
    await frames();
    expect(document.activeElement!.textContent).toBe("svc999");
    // One tab stop: the focused control's.
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("follow a control cell's own changes: the focus moves into what replaced its control", async () => {
    const model = servicesModel(100);
    const props = render({
      model,
      use: { service: { snippet: "toggle", interaction: "control" } },
    });
    props.grid.focusCell(2, "service");
    const cell = cellsOf(2)[2]!;
    expect(document.activeElement).toBe(cell.querySelector("button"));
    await userEvent.keyboard("{Enter}");
    await until(() => document.activeElement === cell.querySelector("input"));
    expect(cell.querySelector("input")!.tabIndex).toBe(0);
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("enter a composite cell's controls with Enter, and leave with Escape", async () => {
    const model = servicesModel(100);
    const props = render({
      model,
      use: { service: { snippet: "input", interaction: "composite" } },
    });
    props.grid.focusCell(1, "service");
    const cell = cellsOf(2)[1]!;
    expect(document.activeElement).toBe(cell);
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(cell.querySelector("input"));
    await userEvent.keyboard("{ArrowLeft}x");
    expect(cell.querySelector("input")!.value).toBe("svcx1");
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(cell);
    expect(model.focus!.rowIndex).toBe(1);
  });

  it("leave the focus where a cell's effect moves it out of the grid in the grid's frame", async () => {
    const model = servicesModel(1000);
    const dialog = document.createElement("button");
    dialog.textContent = "Dialog";
    document.body.append(dialog);
    let opened = false;
    const hooks: Hooks = {
      mounted: (cell) => {
        if (cell.rowIndex !== 300 || opened) return;
        opened = true;
        dialog.focus();
      },
    };
    try {
      const props = render({ model, use: { service: "probe" }, hooks });
      props.grid.focusCell(1, "id");
      expect(idOf(document.activeElement as HTMLElement)).toBe("1");
      model.scrollTo({ top: ROW * 300 });
      await until(() => opened);
      await frames();
      expect(document.activeElement).toBe(dialog);
    } finally {
      dialog.remove();
    }
  });

  it("let cells' effects change the model, and a parent's effects call the grid", async () => {
    const model = createGridModel({
      data: rowView(services(1000)),
      columns: [{ field: "id" }, { field: "service" }],
    });
    let armed = false;
    const hooks: Hooks = {
      mounted: (cell) => {
        if (armed && cell.read("id" as never) === 0)
          model.setSort([{ field: "id", order: "descending" }]);
      },
    };
    const props = render({ model, use: { service: { snippet: "probe", fields: ["id"] } }, hooks });
    // What a parent's effect would: calls on the bound grid as it mounts.
    armed = true;
    props.grid.model.scrollTo({ top: ROW * 200 });
    props.grid.render();
    props.grid.focusCell(5, "service");
    // Sorted as row 0's cell mounted (focusing row 5 had brought it into view); the focus follows its row.
    await until(() => model.sort.length === 1);
    await frames();
    expect(model.focus!.column).toBe("service");
    expect(idOf(document.activeElement as HTMLElement)).toBe("5");
    expect(model.focus!.rowIndex).toBe(994);
    for (const cell of cellsOf(2)) expect(cell.textContent).toBe(`svc${idOf(cell)}`);
    expect(cellsOf(2).every(shown)).toBe(true);
    expect(reported).toEqual([]);
  });

  it("let a cell's effect move the focus into the grid during the grid's frame", async () => {
    const model = servicesModel(1000);
    let asked = false;
    let focus = (_row: number) => {};
    const hooks: Hooks = {
      mounted: (cell) => {
        if (cell.rowIndex !== 300 || asked) return;
        asked = true;
        focus(301);
      },
    };
    const props = render({ model, use: { service: "probe" }, hooks });
    focus = (row) => props.grid.focusCell(row, "id");
    expect(document.activeElement).toBe(document.body);
    model.scrollTo({ top: ROW * 300 });
    await until(() => asked);
    await frames();
    expect(model.focus).toMatchObject({ rowIndex: 301, column: "id" });
    expect(idOf(document.activeElement as HTMLElement)).toBe("301");
  });

  it("let a cell's effect scroll the grid in the grid's frame: the next frame draws where it went", async () => {
    const model = servicesModel(1000);
    let scrolled = false;
    render({
      model,
      use: { service: "probe" },
      hooks: {
        mounted: (cell) => {
          if (cell.rowIndex !== 300 || scrolled) return;
          scrolled = true;
          model.scrollTo({ top: ROW * 600 });
        },
      },
    });
    model.scrollTo({ top: ROW * 300 });
    await until(() => scrolled);
    await until(() => cellsOf(2).some((cell) => idOf(cell) === "600"));
    await frames();
    for (const cell of cellsOf(2))
      expect([shown(cell), cell.textContent]).toEqual([true, `svc${idOf(cell)}`]);
    expect(reported).toEqual([]);
  });

  it("draw their text, never nothing, as a cell's effect removes cells in the grid's frame", async () => {
    const model = servicesModel(1000);
    let remove = () => {};
    const props = render({
      model,
      use: { service: "probe" },
      hooks: { mounted: (cell) => cell.rowIndex === 300 && remove() },
    });
    remove = () => {
      props.use = undefined;
    };
    model.scrollTo({ top: ROW * 300 });
    // What paints in the frame the cells went in: each cell its row's text.
    const painted = await new Promise<string[][]>((resolve) =>
      requestAnimationFrame(() =>
        resolve(cellsOf(2).map((cell) => [idOf(cell), (cell as HTMLElement).innerText])),
      ),
    );
    for (const [id, text] of painted) expect(text).toBe(`svc${id}`);
    await frames();
    expect(props.use).toBeUndefined();
    expect(host.querySelectorAll(".hg-host")).toHaveLength(0);
    expect(cellsOf(2)[0]!.textContent).toBe(`svc${idOf(cellsOf(2)[0]!)}`);
  });

  it("let a cell's effect unmount the grid in the grid's frame", async () => {
    const model = servicesModel(1000);
    let gone = () => {};
    const props = render({
      model,
      use: { service: "probe" },
      hooks: { mounted: (cell) => cell.rowIndex >= 300 && gone() },
    });
    gone = () => {
      props.gone = true;
    };
    model.scrollTo({ top: ROW * 300 });
    await until(() => host.querySelector("p") !== null);
    await frames();
    expect(host.querySelector(".herceg-grid")).toBeNull();
    expect(host.textContent).toBe("Gone");
    expect(reported).toEqual([]);
  });

  it("let a cell's first effect destroy the grid: no onrender of it", async () => {
    const model = servicesModel(100);
    let destroy = () => {};
    const told: number[] = [];
    render(
      {
        model,
        use: { service: "probe" },
        hooks: { mounted: () => destroy() },
        onrender: ({ revision }) => told.push(revision),
      },
      (props) => {
        destroy = () => props.grid?.destroy();
      },
    );
    await frames();
    expect(host.querySelector("[role=grid]")).toBeNull();
    expect(told).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("unmount every cell they mounted, and leave nothing, as the component unmounts", async () => {
    const model = servicesModel(1000);
    const mounts: string[] = [];
    render({
      model,
      use: { service: "probe" },
      hooks: {
        mounted: (cell) => mounts.push(`+${cell.text}`),
        destroyed: (cell) => mounts.push(`-${cell.text}`),
      },
    });
    model.scrollTo({ top: ROW * 400 });
    await frames();
    expect(cellsOf(2).every((cell) => cell.textContent === `svc${idOf(cell)}`)).toBe(true);
    unmount(mounted!);
    mounted = undefined;
    flushSync();
    expect(host.innerHTML).toBe("");
    const live = new Map<string, number>();
    for (const entry of mounts) {
      const name = entry.slice(1);
      live.set(name, (live.get(name) ?? 0) + (entry[0] === "+" ? 1 : -1));
    }
    expect([...live.values()].every((n) => n === 0)).toBe(true);
    expect(mounts.length).toBeGreaterThan(20);
  });

  it("make a new grid with its cells for a new model", () => {
    const second = createGridModel({
      data: rowView(services(20)),
      columns: [{ field: "service" }, { field: "id" }],
    });
    const props = render({ model: servicesModel(10), use: { service: "text" } });
    const hosts = [...host.querySelectorAll(".hg-host")];
    props.model = second;
    flushSync();
    expect(host.querySelectorAll("[role=grid]")).toHaveLength(1);
    expect(cellsOf(1)[3]!.querySelector("i")!.textContent).toBe("svc3");
    expect(props.grid.model).toBe(second);
    expect(hosts.some((one) => one.isConnected)).toBe(false);
  });

  it("let go of their hosts when cells go, and tell onrender of later grids' first frames", async () => {
    const told: string[] = [];
    const props = render({
      model: servicesModel(100),
      use: { service: "text" },
      onrender: () => told.push(host.querySelector("[role=grid]")!.getAttribute("aria-rowcount")!),
    });
    const refs = [...host.querySelectorAll(".hg-host")].map((one) => new WeakRef(one));
    props.use = undefined;
    flushSync();
    await frames();
    for (const rows of [50, 20]) {
      props.model = servicesModel(rows);
      flushSync();
      await Promise.resolve();
      expect(told.at(-1)).toBe(String(rows + 1));
    }
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
  });

  it("draw columns of any id, those Object's prototype names too", () => {
    const model = createGridModel({
      data: rowView(services(10)),
      columns: [
        { field: "id" },
        { id: "toString", title: "A" },
        { id: "__proto__", title: "B" },
        { id: "constructor", title: "C", text: ["c"] },
      ],
    });
    render({
      model,
      use: Object.fromEntries<Use>([
        ["toString", "a"],
        ["__proto__", "b"],
      ]),
    });
    expect(cellsOf(2)[0]!.innerHTML).toContain("<i>a</i>");
    expect(cellsOf(3)[0]!.innerHTML).toContain("<i>b</i>");
    expect(cellsOf(4)[0]!.textContent).toBe("c");
    expect(cellsOf(4)[0]!.querySelector(".hg-host")).toBeNull();
    expect(reported).toEqual([]);
  });

  it("keep their hosts across vertical scrolling, and let go of every host they leave", async () => {
    const columns = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: `C${i}` }));
    const model = createGridModel({
      data: rowView(services(1000)),
      columns: [{ field: "id" }, ...columns],
    });
    render({ model, use: Object.fromEntries(columns.map(({ id }) => [id, "a" as const])) });
    const hosts = () => new Set(host.querySelectorAll(".hg-host"));
    // Past the first rows, where there are none to mount above.
    model.scrollTo({ top: ROW * 100 });
    await frames();
    const before = hosts();
    // A screen at a time: rows' elements show other rows, and keep their hosts.
    for (let i = 1; i <= 20; i++) {
      model.scrollTo({ top: ROW * (100 + 10 * i) });
      await frame();
    }
    await frames();
    expect(hosts()).toEqual(before);
    // Across: cell elements leave their columns, and their hosts go.
    const refs = [...before].map((one) => new WeakRef(one));
    before.clear();
    model.scrollTo({ left: 120 * 9 });
    await frames();
    const gone = refs.filter((ref) => !ref.deref()?.isConnected).length;
    expect(gone).toBeGreaterThan(0);
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBe(refs.length - gone);
  });

  it("let a cell's setup unmount the component in the first draw: nothing left, nothing heard", async () => {
    let once = true;
    let set = 0;
    let unset = 0;
    const told: number[] = [];
    const snippet = createRawSnippet(() => ({
      render: () => "<i>x</i>",
      setup() {
        set++;
        if (once) {
          once = false;
          unmount(mounted!);
          mounted = undefined;
        }
        return () => {
          unset++;
        };
      },
    }));
    const props = $state({
      model: servicesModel(100),
      ariaLabel: "Services",
      style: "height: 300px",
      cells: { service: snippet },
      grid: null as HercegGrid | null,
      onrender: () => told.push(1),
    });
    mounted = mount(Grid as unknown as Component<typeof props>, { target: host, props });
    flushSync();
    await frames();
    expect(host.innerHTML).toBe("");
    expect(set).toBeGreaterThan(0);
    expect(unset).toBe(set);
    expect(props.grid).toBeNull();
    expect(told).toEqual([]);
  });

  it("hold nothing of the component once it went, though its destroyed grid is kept", async () => {
    const model = servicesModel(100);
    const { grid, context } = (() => {
      const given = { large: new Array(1000).fill("value") };
      const props = render({ model, use: { service: "text" }, context: given });
      const grid = props.grid;
      unmount(mounted!);
      mounted = undefined;
      flushSync();
      return { grid, context: new WeakRef(given) };
    })();
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(grid.root.isConnected).toBe(false);
    expect(context.deref()).toBeUndefined();
  });

  it("are collected with their grids over many mounts and unmounts", async () => {
    const model = servicesModel(1000);
    const refs = (() => {
      const made: WeakRef<object>[] = [];
      for (let i = 0; i < 10; i++) {
        const props = render({ model, use: { service: "text" } });
        for (const one of host.querySelectorAll(".hg-host")) made.push(new WeakRef(one));
        made.push(new WeakRef(props.grid), new WeakRef(props.grid.root));
        unmount(mounted!);
        mounted = undefined;
        flushSync();
      }
      return made;
    })();
    expect(host.innerHTML).toBe("");
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.flatMap((ref, i) => (ref.deref() !== undefined ? [i] : []))).toEqual([]);
  });
});

describe("<RemoteGrid> cells", () => {
  it("draw Svelte cells, asking the source for the fields they read", async () => {
    const memory = memorySource(services(500), { key: "id" });
    const asked: (readonly string[])[] = [];
    const source: GridSource = {
      schema: memory.schema,
      rows(request, signal) {
        asked.push(request.fields);
        return memory.rows(request, signal);
      },
    };
    const model = createRemoteGridModel({
      source,
      columns: [{ field: "id" }, { field: "service" }],
    });
    const props = render({
      model,
      remote: true,
      use: { service: { snippet: "read", fields: ["service", "owner"] } },
      reads: ["service", "owner"],
    });
    await until(() => cellsOf(2)[3]?.querySelector("i") != null);
    expect(asked.at(-1)).toContain("owner");
    expect(cellsOf(2)[3]!.textContent).toBe("svc3 own3");
    expect(props.grid.model).toBe(model);
    model.scrollTo({ top: ROW * 300 });
    await until(() => cellsOf(2).some((cell) => cell.textContent === "svc300 own6"));
    expect(reported).toEqual([]);
    unmount(mounted!);
    mounted = undefined;
    model.dispose();
  });

  it("draw their rows across evicted blocks, and mount anew for a new query's rows", async () => {
    const memory = memorySource(
      table({
        id: Float64Array.from({ length: 2000 }, (_, i) => i),
        v: Float64Array.from({ length: 2000 }, (_, i) => (i * 7919) % 1000),
      }),
      { key: "id" },
    );
    const model = createRemoteGridModel({
      source: memory,
      columns: [{ field: "id" }, { field: "v" }],
      blockSize: 50,
      cachedBlocks: 1,
    });
    // Each query's rows are named in a scope of their own: counted as components mount.
    const scopes = new Set<unknown>();
    const live = new Map<unknown, number>();
    render({
      model,
      remote: true,
      use: { v: "probe" },
      hooks: {
        mounted: ({ row }) => {
          scopes.add(row.ref.scope);
          live.set(row.ref.scope, (live.get(row.ref.scope) ?? 0) + 1);
        },
        destroyed: ({ row }) => live.set(row.ref.scope, live.get(row.ref.scope)! - 1),
      },
    });
    // Loaded rows' cells draw their rows; rows still loading write their text alone.
    const drawn = () => {
      const loaded = cellsOf(2).filter((cell) => shown(cell));
      return (
        loaded.length > 5 &&
        loaded.every((cell) => cell.textContent === String((Number(idOf(cell)) * 7919) % 1000))
      );
    };
    // Its second block too: the cache drops a block only once two are out of
    // view, so with the second still loading the first would stay.
    await until(() => model.row(0).kind === "row" && model.row(50).kind === "row" && drawn());
    // Far away and back: the first block was evicted and loaded again.
    model.scrollTo({ top: ROW * 1500 });
    await until(() => model.row(1500).kind === "row" && model.row(0).kind === "placeholder");
    await until(drawn);
    model.scrollTo({ top: 0 });
    await until(() => model.row(0).kind === "row" && drawn());
    expect(scopes.size).toBe(1);
    // A new query's rows are other rows, though their ids are the same: mounted anew.
    const [first] = scopes;
    model.setQuery({ sort: [{ field: "v", order: "descending" }] });
    await until(() => cellsOf(2)[0]?.textContent === "999" && shown(cellsOf(2)[0]!));
    await frames();
    expect(scopes.size).toBe(2);
    expect(live.get(first)).toBe(0);
    expect(reported).toEqual([]);
    unmount(mounted!);
    mounted = undefined;
    flushSync();
    expect([...live.values()]).toEqual([0, 0]);
    model.dispose();
  });
});
