// Vue cells in herceg grids: slots and render functions teleported into the
// grid's hosts, keeping what the app provides and each row's state; the
// first draw's cells and later frames' committed before paint (Vue's flush
// in the microtask after the grid's frame), never a frame of another row's
// content; `render` after the commit; boundaries for throwing cells (event
// handlers' errors left to the app); focus into Vue controls; hooks
// changing the model, the cells, or unmounting the grid; new models and
// props; remote grids across queries and evicted blocks; and what is left
// behind.
import { rowView, type Table, table } from "herceg";
import { createGridModel, type GridCellContext, type Grid as HercegGrid } from "herceg/grid";
import { memorySource } from "herceg/grid/memory";
import { createRemoteGridModel, type GridSource } from "herceg/grid/remote";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import {
  type App,
  type Component,
  createApp,
  defineComponent,
  h,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  provide,
  reactive,
  type ShallowRef,
  shallowRef,
} from "vue";
import { collectGarbage } from "../../herceg/test/browser/helpers.ts";
import { RemoteGrid } from "../src/grid/remote.ts";
import { Grid, type VueGridCells } from "../src/grid.ts";

const ROW = 28;
let host: HTMLDivElement;
let app: App | undefined;
/** Errors reported (`reportError`) during the test. */
let reported: string[];
const report = (event: ErrorEvent) => {
  reported.push((event.error as Error).message);
  event.preventDefault();
};
/** Errors Vue's own handler heard (the app's `errorHandler`). */
let handled: string[];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px";
  document.body.append(host);
  reported = [];
  handled = [];
  window.addEventListener("error", report);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
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

function services(rows: number) {
  return table({
    id: Float64Array.from({ length: rows }, (_, i) => i),
    service: Array.from({ length: rows }, (_, i) => `svc${i}`),
    owner: Array.from({ length: rows }, (_, i) => `own${i % 7}`),
  });
}

type Services = ReturnType<typeof services> extends Table<infer S> ? S : never;
type Cell = GridCellContext<Services>;

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
/** A row's id, as its first cell writes it. */
const idOf = (cell: HTMLElement) =>
  cell.parentElement!.querySelector('[aria-colindex="1"]')!.textContent!;
/** Whether a cell's Vue content is in its host, shown. */
const shown = (cell: HTMLElement) => {
  const held = cell.querySelector<HTMLElement>(".hg-host");
  return !!held && !held.hidden && held.children.length > 0;
};

/**
 * Mounts a template; `setup` returns what it reads. `grid`, a ref the
 * template's `<Grid ref="grid">` sets, gives the grid it exposes.
 */
function mount(
  template: string,
  setup: () => object = () => ({}),
  components: object = {},
): { grid: () => HercegGrid } {
  const ref: ShallowRef<{ grid: HercegGrid } | null> = shallowRef(null);
  app = createApp(
    defineComponent({
      components: { Grid, RemoteGrid, ...components },
      setup: () => ({ ...setup(), grid: ref }),
      template,
    }),
  );
  app.config.errorHandler = (error) => {
    handled.push((error as Error).message);
  };
  app.mount(host);
  return { grid: () => ref.value!.grid };
}

/** A cell's component: what its hooks do, by test. */
function probe(hooks: {
  mounted?: (cell: Cell) => void;
  updated?: (cell: Cell) => void;
  unmounted?: (cell: Cell) => void;
}) {
  return defineComponent({
    props: { cell: { type: Object, required: true } },
    setup(props) {
      const cell = () => props.cell as Cell;
      onMounted(() => hooks.mounted?.(cell()));
      onUpdated(() => hooks.updated?.(cell()));
      onBeforeUnmount(() => hooks.unmounted?.(cell()));
      return () => h("i", cell().text);
    },
  });
}

describe("<Grid> cells", () => {
  it("draw the first frame's cells before paint, with what the app provides, then tell render", async () => {
    const model = servicesModel(100);
    const Badge = defineComponent({
      props: { name: { type: String, required: true } },
      setup(props) {
        const theme = inject("theme", "plain");
        return () => h("b", { class: theme }, props.name);
      },
    });
    const told: boolean[] = [];
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" @render="rendered">
        <template #cell-service="{ cell }"><Badge :name="cell.text" /></template>
      </Grid>`,
      () => {
        provide("theme", "loud");
        return { model, rendered: () => told.push(cellsOf(2).every(shown)) };
      },
      { Badge },
    );
    // Vue commits in its flush, the microtask after mounting: before paint.
    await nextTick();
    const cells = cellsOf(2);
    expect(cells.length).toBeGreaterThan(5);
    expect(cells.every(shown)).toBe(true);
    expect(cells[0]!.querySelector("b")!.outerHTML).toBe('<b class="loud">svc0</b>');
    // Text cells are named by their text, and their content is not read.
    expect(cells[0]!.getAttribute("aria-label")).toBe("svc0");
    expect(cells[0]!.querySelector<HTMLElement>(".hg-host")!.inert).toBe(true);
    // Once, after the first frame's cells were committed.
    expect(told).toEqual([true]);
  });

  it("commit a frame's cells in the grid's frame, before it paints: never another row's content", async () => {
    const model = servicesModel(1000);
    const told: boolean[] = [];
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" :cells="cells" @render="rendered" />`,
      () => ({
        model,
        cells: {
          service: (cell: Cell) => h("span", { "data-row": cell.row.ref.id }, cell.text),
        } satisfies VueGridCells<Services>,
        rendered: () => told.push(cellsOf(2).every(shown)),
      }),
    );
    await frames();
    for (const top of [ROW * 300, ROW * 310, ROW * 900, 0]) {
      model.scrollTo({ top });
      const painted = await new Promise<{ id: string; row: string | null; text: string }[]>(
        (resolve) =>
          // A callback after the grid's, in its frame: Vue committed in between, before paint.
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
    // Each frame heard once its cells were committed.
    expect(told.every(Boolean)).toBe(true);
  });

  it("keep each cell's state its row's: kept while it shows the row, new for another row", async () => {
    const model = servicesModel(1000);
    const mounted: string[] = [];
    const Counter = defineComponent({
      props: { name: { type: String, required: true } },
      setup(props) {
        const count = shallowRef(0);
        mounted.push(props.name);
        return () =>
          h(
            "button",
            { type: "button", onClick: () => count.value++ },
            `${props.name} ${count.value}`,
          );
      },
    });
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { interaction: 'control' } }">
        <template #cell-service="{ cell }"><Counter :name="cell.text" /></template>
      </Grid>`,
      () => ({ model }),
      { Counter },
    );
    await nextTick();
    const button = () => cellsOf(2)[0]!.querySelector("button")!;
    button().click();
    await nextTick();
    expect(button().textContent).toBe("svc0 1");
    // The row's selection changes: the cell draws again, its state the same.
    model.select(0, "only");
    await frames();
    expect(button().textContent).toBe("svc0 1");
    expect(mounted.filter((name) => name === "svc0")).toHaveLength(1);
    // Its element shows another row: a new component, of that row.
    model.scrollTo({ top: ROW * 500 });
    await frames();
    for (const cell of cellsOf(2))
      expect(cell.querySelector("button")!.textContent).toBe(`svc${idOf(cell)} 0`);
    model.scrollTo({ top: 0 });
    await frames();
    expect(button().textContent).toBe("svc0 0");
  });

  it("keep what a cell drew, and its state, as it renders again between a call's draw and the next frame", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const mounted: string[] = [];
    const Counter = defineComponent({
      props: { name: { type: String, required: true } },
      setup(props) {
        const count = shallowRef(0);
        mounted.push(props.name);
        return () =>
          h(
            "button",
            { type: "button", onClick: () => count.value++ },
            `${props.name} ${count.value}`,
          );
      },
    });
    const suffix = shallowRef("");
    const reads = shallowRef(["id"]);
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px"
        :cells="{ service: { fields: ['id', 'owner'], interaction: 'control' } }">
        <template #cell-service="{ cell }">
          <Counter :name="reads.map((field) => cell.read(field)).join(' ') + suffix" />
        </template>
      </Grid>`,
      () => ({ model, suffix, reads }),
      { Counter },
    );
    await nextTick();
    const button = () => cellsOf(2)[0]!.querySelector("button")!;
    button().click();
    await nextTick();
    expect(button().textContent).toBe("0 1");
    // A call's draw supersedes the cell's update and hands the next over in
    // the grid's next frame; the slot renders again before that on its own,
    // reading a field it had not read.
    model.select(0, "only");
    grid().render();
    suffix.value = "!";
    reads.value = ["id", "owner"];
    await nextTick();
    expect(button().textContent).toBe("0 own0! 1");
    await frames();
    expect(button().textContent).toBe("0 own0! 1");
    expect(mounted).toHaveLength(cellsOf(2).length);
    expect(reported).toEqual([]);
  });

  it("keep the values content last read, not those handed over, once the update is superseded", async () => {
    const data = services(100);
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const suffix = shallowRef("");
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { fields: ['owner'] } }">
        <template #cell-service="{ cell }"><i>{{ cell.read("owner") }}{{ suffix }}</i></template>
      </Grid>`,
      () => ({ model, suffix }),
    );
    await frames();
    // The value changes; the slot renders again before the grid's next frame.
    data.set("owner", 0, "new");
    suffix.value = "!";
    await nextTick();
    expect(cellsOf(2)[0]!.querySelector("i")!.textContent).toBe("new!");
    grid().render();
    suffix.value = "!!";
    await nextTick();
    expect(cellsOf(2)[0]!.querySelector("i")!.textContent).toBe("new!!");
    expect(reported).toEqual([]);
  });

  it("follow a reactive `cells` changed in place: a column's new fields replace its hosts", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const cells = reactive({ who: { fields: ["owner"] } });
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" :cells="cells">
        <template #cell-who="{ cell }"><i>{{ cell.read("owner") }}</i></template>
      </Grid>`,
      () => ({ model, cells }),
    );
    await nextTick();
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
    const who = cellsOf(3)[1]!.querySelector(".hg-host");
    cells.who.fields.push("id");
    await nextTick();
    await frames();
    // New fields: a new renderer, whose cells draw in new hosts.
    expect(cellsOf(3)[1]!.querySelector(".hg-host")).not.toBe(who);
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
    expect(reported).toEqual([]);
  });

  it("draw with the latest slot and props, without a new grid or host", async () => {
    const model = servicesModel(100);
    const suffix = shallowRef("!");
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px">
        <template #cell-service="{ cell }"><i>{{ cell.text }}{{ suffix }}</i></template>
      </Grid>`,
      () => ({ model, suffix }),
    );
    await nextTick();
    const grid = host.querySelector("[role=grid]");
    const held = cellsOf(2)[0]!.querySelector(".hg-host");
    expect(cellsOf(2)[0]!.textContent).toBe("svc0!");
    suffix.value = "?";
    await nextTick();
    expect(cellsOf(2)[0]!.textContent).toBe("svc0?");
    expect(host.querySelector("[role=grid]")).toBe(grid);
    expect(cellsOf(2)[0]!.querySelector(".hg-host")).toBe(held);
  });

  it("read the fields a column's cells name; new fields replace that column's hosts alone", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const fields = shallowRef<("owner" | "id")[]>(["owner"]);
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" :cells="{ who: { fields } }">
        <template #cell-service="{ cell }"><i>{{ cell.text }}</i></template>
        <template #cell-who="{ cell }"><i>{{ fields.map((one) => cell.read(one)).join(" ") }}</i></template>
      </Grid>`,
      () => ({ model, fields }),
    );
    await nextTick();
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
    const service = cellsOf(2)[0]!.querySelector(".hg-host");
    const who = cellsOf(3)[0]!.querySelector(".hg-host");
    fields.value = ["owner", "id"];
    await nextTick();
    // The old hosts went before this paints; drawn again in the grid's next frame.
    expect(cellsOf(3)[1]!.querySelector(".hg-host")).not.toBe(who);
    expect(cellsOf(2)[0]!.querySelector(".hg-host")).toBe(service);
    await frames();
    expect(cellsOf(3)[1]!.textContent).toBe("own1 1");
    expect(reported).toEqual([]);
  });

  it("draw a throwing cell's text, reported once a mount, the rest of the grid drawn", async () => {
    const model = servicesModel(1000);
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" :cells="cells" />`,
      () => ({
        model,
        cells: {
          service: (cell: Cell) => {
            if (cell.rowIndex === 2) throw new Error("no svc2");
            return h("i", cell.text);
          },
        },
      }),
    );
    await frames();
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
    expect(handled).toEqual([]);
  });

  it("leave errors of event handlers in cells to the app, the cell drawn on", async () => {
    const model = servicesModel(100);
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { interaction: 'control' } }">
        <template #cell-service="{ cell }"><button type="button" @click="fail">{{ cell.text }}</button></template>
      </Grid>`,
      () => ({
        model,
        fail: () => {
          throw new Error("clicked");
        },
      }),
    );
    await nextTick();
    cellsOf(2)[1]!.querySelector("button")!.click();
    await nextTick();
    expect(handled).toEqual(["clicked"]);
    expect(reported).toEqual([]);
    expect(cellsOf(2)[1]!.querySelector("button")!.textContent).toBe("svc1");
  });

  it("take the focus into a Vue control, and into the next one after scrolling", async () => {
    const model = servicesModel(1000);
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { interaction: 'control' } }">
        <template #cell-service="{ cell }"><button type="button">{{ cell.text }}</button></template>
      </Grid>`,
      () => ({ model }),
    );
    await nextTick();
    grid().focusCell(0, "service");
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
    const Toggle = defineComponent({
      props: { text: { type: String, required: true } },
      setup(props) {
        const editing = shallowRef(false);
        return () =>
          editing.value
            ? h("input", { "aria-label": "Service", value: props.text })
            : h("button", { type: "button", onClick: () => (editing.value = true) }, props.text);
      },
    });
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { interaction: 'control' } }">
        <template #cell-service="{ cell }"><Toggle :text="cell.text" /></template>
      </Grid>`,
      () => ({ model }),
      { Toggle },
    );
    await nextTick();
    grid().focusCell(2, "service");
    const cell = cellsOf(2)[2]!;
    expect(document.activeElement).toBe(cell.querySelector("button"));
    await userEvent.keyboard("{Enter}");
    await until(() => document.activeElement === cell.querySelector("input"));
    expect(cell.querySelector("input")!.tabIndex).toBe(0);
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("enter a composite cell's controls with Enter, and leave with Escape", async () => {
    const model = servicesModel(100);
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { interaction: 'composite' } }">
        <template #cell-service="{ cell }"><input aria-label="Service" :value="cell.text" /></template>
      </Grid>`,
      () => ({ model }),
    );
    await nextTick();
    grid().focusCell(1, "service");
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

  it("leave the focus where a cell's hook moves it out of the grid in the grid's frame", async () => {
    const model = servicesModel(1000);
    const dialog = shallowRef<HTMLButtonElement | null>(null);
    let opened = false;
    const Opener = probe({
      mounted: (cell) => {
        if (cell.rowIndex !== 300 || opened) return;
        opened = true;
        dialog.value!.focus();
      },
    });
    const { grid } = mount(
      `<div><Grid ref="grid" :model="model" aria-label="Services" style="height: 300px">
        <template #cell-service="{ cell }"><Opener :cell="cell" /></template>
      </Grid><button type="button" ref="dialog">Dialog</button></div>`,
      () => ({ model, dialog }),
      { Opener },
    );
    await nextTick();
    grid().focusCell(1, "id");
    expect(idOf(document.activeElement as HTMLElement)).toBe("1");
    model.scrollTo({ top: ROW * 300 });
    await until(() => opened);
    await frames();
    expect(document.activeElement).toBe(dialog.value);
  });

  it("let cells' hooks change the model, and a parent's hooks call the grid", async () => {
    const data = services(1000);
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const Sorter = probe({
      mounted: (cell) => {
        if (cell.read("id") === 0) model.setSort([{ field: "id", order: "descending" }]);
      },
    });
    const ref = shallowRef<{ grid: HercegGrid } | null>(null);
    app = createApp(
      defineComponent({
        components: { Grid, Sorter },
        setup() {
          onMounted(() => {
            ref.value!.grid.model.scrollTo({ top: ROW * 200 });
            ref.value!.grid.render();
            ref.value!.grid.focusCell(5, "service");
          });
          return { model, grid: ref };
        },
        template: `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { fields: ['id'] } }">
          <template #cell-service="{ cell }"><Sorter :cell="cell" /></template>
        </Grid>`,
      }),
    );
    app.mount(host);
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

  it("let a cell's hook move the focus into the grid during the grid's frame", async () => {
    const model = servicesModel(1000);
    let asked = false;
    let focus = (_row: number) => {};
    const Asker = probe({
      mounted: (cell) => {
        if (cell.rowIndex !== 300 || asked) return;
        asked = true;
        focus(301);
      },
    });
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px">
        <template #cell-service="{ cell }"><Asker :cell="cell" /></template>
      </Grid>`,
      () => ({ model }),
      { Asker },
    );
    focus = (row) => grid().focusCell(row, "id");
    await nextTick();
    expect(document.activeElement).toBe(document.body);
    model.scrollTo({ top: ROW * 300 });
    await until(() => asked);
    await frames();
    expect(model.focus).toMatchObject({ rowIndex: 301, column: "id" });
    expect(idOf(document.activeElement as HTMLElement)).toBe("301");
  });

  it("let a cell's hook scroll the grid in the grid's frame: the next frame draws where it went", async () => {
    const model = servicesModel(1000);
    let scrolled = false;
    const Scroller = probe({
      mounted: (cell) => {
        if (cell.rowIndex !== 300 || scrolled) return;
        scrolled = true;
        model.scrollTo({ top: ROW * 600 });
      },
    });
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px">
        <template #cell-service="{ cell }"><Scroller :cell="cell" /></template>
      </Grid>`,
      () => ({ model }),
      { Scroller },
    );
    await nextTick();
    model.scrollTo({ top: ROW * 300 });
    await until(() => scrolled);
    await until(() => cellsOf(2).some((cell) => idOf(cell) === "600"));
    await frames();
    for (const cell of cellsOf(2))
      expect([shown(cell), cell.textContent]).toEqual([true, `svc${idOf(cell)}`]);
    expect(reported).toEqual([]);
  });

  it("draw their text, never nothing, as a cell's hook removes cells in the grid's frame", async () => {
    const model = servicesModel(1000);
    const on = shallowRef(true);
    const Remover = probe({
      mounted: (cell) => {
        if (cell.rowIndex === 300) on.value = false;
      },
    });
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px">
        <template v-if="on" #cell-service="{ cell }"><Remover :cell="cell" /></template>
      </Grid>`,
      () => ({ model, on }),
      { Remover },
    );
    await nextTick();
    model.scrollTo({ top: ROW * 300 });
    // What paints in the frame the cells went in: each cell its row's text.
    const painted = await new Promise<string[][]>((resolve) =>
      requestAnimationFrame(() =>
        resolve(cellsOf(2).map((cell) => [idOf(cell), (cell as HTMLElement).innerText])),
      ),
    );
    for (const [id, text] of painted) expect(text).toBe(`svc${id}`);
    await frames();
    expect(on.value).toBe(false);
    expect(host.querySelectorAll(".hg-host")).toHaveLength(0);
    expect(cellsOf(2)[0]!.textContent).toBe(`svc${idOf(cellsOf(2)[0]!)}`);
  });

  it("let a cell's hook unmount the grid in the grid's frame", async () => {
    const model = servicesModel(1000);
    const mounted = shallowRef(true);
    const Gone = probe({
      mounted: (cell) => {
        if (cell.rowIndex >= 300) mounted.value = false;
      },
    });
    mount(
      `<Grid v-if="mounted" :model="model" aria-label="Services" style="height: 300px">
        <template #cell-service="{ cell }"><Gone :cell="cell" /></template>
      </Grid><p v-else>Gone</p>`,
      () => ({ model, mounted }),
      { Gone },
    );
    await nextTick();
    model.scrollTo({ top: ROW * 300 });
    await until(() => host.querySelector("p") !== null);
    await frames();
    expect(host.innerHTML).toBe("<p>Gone</p>");
    expect(reported).toEqual([]);
    expect(handled).toEqual([]);
  });

  it("make no grid for a new model when destroying the old one unmounts the component", async () => {
    const first = servicesModel(100);
    const model = shallowRef(first);
    let armed = false;
    let ran = false;
    const service = (cell: Cell) => {
      cell.signal.addEventListener(
        "abort",
        () => {
          if (!armed) return;
          armed = false;
          ran = true;
          app!.unmount();
          app = undefined;
        },
        { once: true },
      );
      return h("i", cell.text);
    };
    app = createApp({
      render: () =>
        h(Grid as Component, {
          model: model.value,
          ariaLabel: "Services",
          style: "height: 300px",
          cells: { service },
        }),
    });
    app.config.errorHandler = (error) => {
      handled.push((error as Error).message);
    };
    app.mount(host);
    await frames();
    armed = true;
    model.value = servicesModel(50);
    await nextTick();
    await frames();
    expect(ran).toBe(true);
    expect(handled).toEqual([]);
    expect(host.innerHTML).toBe("");
  });

  it("keep no grid when the component unmounts as its grid is made (a model's listener)", async () => {
    const model = servicesModel(100);
    const show = shallowRef(false);
    let exposed: { grid: HercegGrid | null } | undefined;
    app = createApp({
      render: () =>
        show.value
          ? h(Grid as Component, {
              model,
              ariaLabel: "Services",
              style: "height: 300px",
              ref: (value: unknown) => {
                if (value) exposed = value as typeof exposed;
              },
            })
          : h("p", "Waiting"),
    });
    app.mount(host);
    const stop = model.subscribe(() => {
      stop();
      app!.unmount();
      app = undefined;
    });
    show.value = true;
    await nextTick();
    await frames();
    expect(exposed).toBeDefined();
    expect(exposed!.grid).toBeNull();
    expect(host.innerHTML).toBe("");
  });

  it("let a cell's first hook destroy the grid: no render of it", async () => {
    const model = servicesModel(100);
    let destroy = () => {};
    const Destroyer = probe({ mounted: () => destroy() });
    const told: number[] = [];
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" @render="told.push($event.revision)">
        <template #cell-service="{ cell }"><Destroyer :cell="cell" /></template>
      </Grid>`,
      () => ({ model, told }),
      { Destroyer },
    );
    destroy = () => grid().destroy();
    await frames();
    expect(host.querySelector("[role=grid]")).toBeNull();
    expect(told).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("let a cell's hook destroy the grid in the grid's frame: no render of that frame", async () => {
    const model = servicesModel(100);
    let armed = false;
    const Destroyer = probe({ updated: () => armed && grid().destroy() });
    const told: number[] = [];
    const { grid } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" @render="told.push($event.revision)">
        <template #cell-service="{ cell }"><Destroyer :cell="cell" /></template>
      </Grid>`,
      () => ({ model, told }),
      { Destroyer },
    );
    await frames();
    told.length = 0;
    armed = true;
    model.select(0, "only");
    await frames();
    expect(host.querySelector("[role=grid]")).toBeNull();
    expect(told).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("unmount every cell they mounted, and leave nothing, as the component unmounts", async () => {
    const model = servicesModel(1000);
    const mounts: string[] = [];
    const Cell = probe({
      mounted: (cell) => mounts.push(`+${cell.text}`),
      unmounted: (cell) => mounts.push(`-${cell.text}`),
    });
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px">
        <template #cell-service="{ cell }"><Cell :cell="cell" /></template>
      </Grid>`,
      () => ({ model }),
      { Cell },
    );
    await nextTick();
    model.scrollTo({ top: ROW * 400 });
    await frames();
    expect(cellsOf(2).every((cell) => cell.textContent === `svc${idOf(cell)}`)).toBe(true);
    app!.unmount();
    app = undefined;
    expect(host.innerHTML).toBe("");
    const live = new Map<string, number>();
    for (const entry of mounts) {
      const name = entry.slice(1);
      live.set(name, (live.get(name) ?? 0) + (entry[0] === "+" ? 1 : -1));
    }
    expect([...live.values()].every((n) => n === 0)).toBe(true);
    expect(mounts.length).toBeGreaterThan(20);
  });

  it("make a new grid with its cells for a new model", async () => {
    const first = servicesModel(10);
    const second = createGridModel({
      data: rowView(services(20)),
      columns: [{ field: "service" }, { field: "id" }],
    });
    const model = shallowRef(first);
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px">
        <template #cell-service="{ cell }"><i>{{ cell.text }}</i></template>
      </Grid>`,
      () => ({ model }),
    );
    await nextTick();
    const hosts = [...host.querySelectorAll(".hg-host")];
    model.value = second;
    await nextTick();
    await nextTick();
    expect(host.querySelectorAll("[role=grid]")).toHaveLength(1);
    expect(cellsOf(1)[3]!.querySelector("i")!.textContent).toBe("svc3");
    expect(hosts.some((one) => one.isConnected)).toBe(false);
  });

  it("let go of their hosts when cells go, and tell render of later grids' first frames", async () => {
    const told: string[] = [];
    const model = shallowRef(servicesModel(100));
    const on = shallowRef(true);
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" @render="rendered">
        <template v-if="on" #cell-service="{ cell }"><i>{{ cell.text }}</i></template>
      </Grid>`,
      () => ({
        model,
        on,
        rendered: () =>
          told.push(host.querySelector("[role=grid]")!.getAttribute("aria-rowcount")!),
      }),
    );
    await nextTick();
    const refs = [...host.querySelectorAll(".hg-host")].map((one) => new WeakRef(one));
    on.value = false;
    await nextTick();
    await frames();
    for (const rows of [50, 20]) {
      model.value = servicesModel(rows);
      await nextTick();
      await nextTick();
      expect(told.at(-1)).toBe(String(rows + 1));
    }
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
  });

  it("draw columns of any id, those Object's prototype names too", async () => {
    const model = createGridModel({
      data: rowView(services(10)),
      columns: [
        { field: "id" },
        { id: "toString", title: "A" },
        { id: "__proto__", title: "B" },
        { id: "constructor", title: "C", text: ["c"] },
      ],
    });
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px; width: 600px" :cells="cells" />`,
      () => ({
        model,
        cells: Object.fromEntries([
          ["toString", () => h("i", "a")],
          ["__proto__", () => h("i", "b")],
        ]),
      }),
    );
    await nextTick();
    expect(cellsOf(2)[0]!.innerHTML).toContain("<i>a</i>");
    expect(cellsOf(3)[0]!.innerHTML).toContain("<i>b</i>");
    expect(cellsOf(4)[0]!.textContent).toBe("c");
    expect(cellsOf(4)[0]!.querySelector(".hg-host")).toBeNull();
    expect(reported).toEqual([]);
  });

  it("refuse a column drawn twice, drawn by nothing, or a slot of no column", async () => {
    const model = servicesModel(10);
    const errors = [
      [
        `<Grid :model="model" aria-label="S" :cells="{ service: () => 'x' }"><template #cell-service>y</template></Grid>`,
        "<Grid> cells.service: a render function and the #cell-service slot both draw it; drop one",
      ],
      [
        `<Grid :model="model" aria-label="S" :cells="{ service: { interaction: 'control' } }" />`,
        "<Grid> cells.service: nothing draws its cells; give render, or a #cell-service slot",
      ],
      [
        `<Grid :model="model" aria-label="S"><template #cell-servce>y</template></Grid>`,
        '<Grid> #cell-servce: no column "servce"; the columns are "id", "service"',
      ],
    ];
    for (const [template, message] of errors) {
      handled = [];
      mount(template!, () => ({ model }));
      await nextTick();
      expect(handled).toEqual([message]);
      app!.unmount();
      app = undefined;
    }
  });

  it("keep their hosts across vertical scrolling, and let go of every host they leave", async () => {
    const columns = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: `C${i}` }));
    const model = createGridModel({
      data: rowView(services(1000)),
      columns: [{ field: "id" }, ...columns],
    });
    const cells = Object.fromEntries(columns.map(({ id }) => [id, () => h("i", id)]));
    mount(
      `<Grid :model="model" aria-label="Services" style="height: 300px" :cells="cells" />`,
      () => ({
        model,
        cells,
      }),
    );
    await nextTick();
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
    const gone = refs.filter((ref) => !ref.deref()!.isConnected).length;
    expect(gone).toBeGreaterThan(0);
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBe(refs.length - gone);
  });

  it("are collected with their grids over many mounts and unmounts", async () => {
    const model = servicesModel(1000);
    const refs = await (async () => {
      const made: WeakRef<object>[] = [];
      for (let i = 0; i < 10; i++) {
        const { grid } = mount(
          `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px">
            <template #cell-service="{ cell }"><i>{{ cell.text }}</i></template>
          </Grid>`,
          () => ({ model }),
        );
        await nextTick();
        for (const one of host.querySelectorAll(".hg-host")) made.push(new WeakRef(one));
        made.push(new WeakRef(grid()), new WeakRef(grid().root));
        app!.unmount();
        app = undefined;
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
  it("draw Vue cells, asking the source for the fields they read", async () => {
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
    const { grid } = mount(
      `<RemoteGrid ref="grid" :model="model" aria-label="Services" style="height: 300px" :cells="{ service: { fields: ['owner'] } }">
        <template #cell-service="{ cell }"><i>{{ cell.text }} {{ cell.read("owner") }}</i></template>
      </RemoteGrid>`,
      () => ({ model }),
    );
    await until(() => cellsOf(2)[3]?.querySelector("i") != null);
    expect(asked.at(-1)).toContain("owner");
    expect(cellsOf(2)[3]!.textContent).toBe("svc3 own3");
    expect(grid().model).toBe(model);
    model.scrollTo({ top: ROW * 300 });
    await until(() => cellsOf(2).some((cell) => cell.textContent === "svc300 own6"));
    expect(reported).toEqual([]);
    app!.unmount();
    app = undefined;
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
    // Each query's rows are named in a scope of their own: numbered here as components mount.
    const scopes = new Map<unknown, number>();
    const Row = defineComponent({
      props: { cell: { type: Object, required: true } },
      setup(props) {
        const { scope } = (props.cell as GridCellContext).row.ref;
        if (!scopes.has(scope)) scopes.set(scope, scopes.size);
        const mounted = scopes.get(scope);
        return () => h("i", { "data-scope": mounted }, (props.cell as GridCellContext).text);
      },
    });
    mount(
      `<RemoteGrid :model="model" aria-label="Values" style="height: 300px">
        <template #cell-v="{ cell }"><Row :cell="cell" /></template>
      </RemoteGrid>`,
      () => ({ model }),
      { Row },
    );
    // Loaded rows' cells draw their rows; rows still loading write their text alone.
    const drawn = () => {
      const loaded = cellsOf(2).filter((cell) => shown(cell));
      return (
        loaded.length > 5 &&
        loaded.every(
          // Ids are written with separators ("1,500").
          (cell) =>
            cell.textContent === String((Number(idOf(cell).replace(/,/g, "")) * 7919) % 1000),
        )
      );
    };
    await until(() => model.row(0).kind === "row" && drawn());
    // Far away and back: the first block was evicted and loaded again.
    model.scrollTo({ top: ROW * 1500 });
    await until(() => model.row(1500).kind === "row" && model.row(0).kind === "placeholder");
    await until(drawn);
    model.scrollTo({ top: 0 });
    await until(() => model.row(0).kind === "row" && drawn());
    expect(scopes.size).toBe(1);
    // A new query's rows are other rows, though their ids are the same: mounted anew.
    model.setQuery({ sort: [{ field: "v", order: "descending" }] });
    await until(() => cellsOf(2)[0]?.textContent === "999" && shown(cellsOf(2)[0]!));
    await frames();
    expect(scopes.size).toBe(2);
    for (const cell of cellsOf(2))
      if (shown(cell)) expect(cell.querySelector("i")!.dataset.scope).toBe("1");
    expect(reported).toEqual([]);
    app!.unmount();
    app = undefined;
    model.dispose();
  });
});
