// The Vue grid components: events by row identity, props applied without
// a new grid, no Vue render for data changes or scrolling, a new grid for a
// new model, pivot grids, totals rows, headings, and copy through the
// components, and the grid v2 acceptance: a link, a chip, a bar, and an
// action in one grid, focus and cleanup under scrolling and streaming.
import { category, count, rowTotals, rowView, sum, table } from "herceg";
import { barCell, chipCell, createGridModel, type Grid as HercegGrid } from "herceg/grid";
import { createPivotGridModel } from "herceg/grid/pivot";
import { pivotRows } from "herceg/pivot";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import {
  type App,
  createApp,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  type ShallowRef,
  shallowRef,
} from "vue";
import { PivotGrid } from "../src/grid/pivot.ts";
import { Grid } from "../src/grid.ts";

let host: HTMLDivElement;
let app: App | undefined;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px";
  document.body.append(host);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  host.remove();
});

const ROW = 28;
const COMMAND = navigator.platform.startsWith("Mac") ? "Meta" : "Control";
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const frames = async () => {
  await frame();
  await frame();
};

function requests(rows: number) {
  return table({
    id: Float64Array.from({ length: rows }, (_, i) => i),
    ms: Float64Array.from({ length: rows }, (_, i) => (i * 37) % 500),
  });
}

const grid = () => host.querySelector<HTMLElement>("[role=grid], [role=treegrid]")!;
const firstCells = () =>
  [...host.querySelectorAll(".hg-body [role=row]")].map(
    (row) => row.querySelector("[role=gridcell]")!.textContent,
  );

/** Mounts a template; `setup` returns what it reads, and `grid()` gives the grid `<Grid ref="grid">` exposes. */
function mount(
  template: string,
  setup: () => object = () => ({}),
  components: object = {},
): { grid: () => HercegGrid } {
  const ref: ShallowRef<{ grid: HercegGrid } | null> = shallowRef(null);
  app = createApp(
    defineComponent({
      components: { Grid, PivotGrid, ...components },
      setup: () => ({ ...setup(), grid: ref }),
      template,
    }),
  );
  app.mount(host);
  return { grid: () => ref.value!.grid };
}

describe("<Grid>", () => {
  it("hears clicks by row identity and frames drawn, calling the latest handlers", async () => {
    const t = requests(10);
    const model = createGridModel({
      data: rowView(t),
      columns: [{ field: "id" }, { field: "ms" }],
    });
    const heard: string[] = [];
    const revisions: number[] = [];
    const tag = shallowRef("first");
    mount(
      `<Grid :model="model" aria-label="Requests" style="height: 300px"
        @row-click="({ ref, column }) => heard.push(tag + ' row ' + ref.id + ' ' + column)"
        @cell-click="({ rowIndex }) => heard.push(tag + ' cell ' + rowIndex)"
        @render="({ revision }) => revisions.push(revision)" />`,
      () => ({ model, heard, revisions, tag }),
    );
    // The first frame, drawn as the grid was made, once.
    expect(revisions).toEqual([model.revision]);
    const cell = () => host.querySelector('.hg-body [aria-rowindex="4"] [aria-colindex="2"]')!;
    await userEvent.click(cell());
    tag.value = "second";
    await nextTick();
    await userEvent.click(cell());
    expect(heard).toEqual([
      `first row ${t.identity(2)} ms`,
      "first cell 2",
      `second row ${t.identity(2)} ms`,
      "second cell 2",
    ]);
    expect(revisions.at(-1)).toBe(model.revision);
  });

  it("draws its model, and applies changed props without a new grid", async () => {
    const model = createGridModel({
      data: rowView(requests(100)),
      columns: [{ field: "id" }, { field: "ms" }],
    });
    const props = shallowRef<Record<string, unknown>>({ ariaLabel: "Requests" });
    mount(`<Grid :model="model" v-bind="props" style="height: 300px" />`, () => ({ model, props }));
    expect(grid().getAttribute("aria-label")).toBe("Requests");
    expect(grid().getAttribute("aria-rowcount")).toBe("101");
    expect(firstCells().slice(0, 3)).toEqual(["0", "1", "2"]);
    const element = grid();
    props.value = { ariaLabel: "Latest", theme: "dark" };
    await nextTick();
    expect(grid()).toBe(element);
    expect(grid().getAttribute("aria-label")).toBe("Latest");
    const surface = () =>
      host.querySelector<HTMLElement>(".herceg-grid")!.style.getPropertyValue("--hg-surface");
    expect(surface()).toBe("#12151c");
    // A theme no longer passed is the default again.
    props.value = { ariaLabel: "Latest" };
    await nextTick();
    expect(surface()).toBe("#ffffff");
    // Copy is on by default; `:copy="false"` leaves Ctrl+C to the page, and its instructions go.
    const keys = () => host.querySelector("[id$=-keys]")!.textContent;
    expect(keys()).toContain("Control C copies");
    props.value = { ariaLabel: "Latest", copy: false };
    await nextTick();
    await frames();
    expect(grid()).toBe(element);
    expect(keys()).not.toContain("Control C copies");
  });

  it("never renders Vue for data changes, scrolling, focus, selection, or column layout", async () => {
    const data = requests(1000);
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "ms" }],
    });
    let updates = 0;
    mount(
      `<Grid :model="model" aria-label="Requests" style="height: 300px" @vue:updated="updated" />`,
      () => ({ model, updated: () => updates++ }),
    );
    data.append({ id: [1000], ms: [1] });
    grid().scrollTop = ROW * 500;
    await frames();
    expect(grid().getAttribute("aria-rowcount")).toBe("1002");
    expect(firstCells()).toContain("500");
    await userEvent.click(host.querySelector(".hg-body [role=gridcell]")!);
    await userEvent.keyboard("{ArrowDown} ");
    await userEvent.click(host.querySelector("[role=columnheader]")!);
    model.pinColumn("ms", "left");
    await frames();
    expect(model.selectedCount).toBe(2);
    expect(model.sort).toEqual([{ field: "id", order: "ascending" }]);
    expect(updates).toBe(0);
  });

  it("makes a new grid for a new model and exposes it, leaving nothing on unmount", async () => {
    const first = createGridModel({ data: rowView(requests(5)), columns: [{ field: "id" }] });
    const second = createGridModel({ data: rowView(requests(7)), columns: [{ field: "ms" }] });
    const model = shallowRef(first);
    const exposed = mount(`<Grid ref="grid" :model="model" aria-label="Requests" />`, () => ({
      model,
    }));
    const before = exposed.grid();
    expect(before.model).toBe(first);
    model.value = second;
    await nextTick();
    expect(exposed.grid()).not.toBe(before);
    expect(exposed.grid().model).toBe(second);
    expect(host.querySelectorAll(".herceg-grid")).toHaveLength(1);
    expect(grid().getAttribute("aria-rowcount")).toBe("8");
    app!.unmount();
    app = undefined;
    expect(host.innerHTML).toBe("");
  });

  it("draws totals rows and headings, and copies, as its model says", async () => {
    const data = table({
      service: category(["auth", "=1+2", "billing"]),
      latency: [120, 5, 85],
    });
    const view = rowView(data);
    const model = createGridModel({
      data: view,
      totals: rowTotals(view, { ops: { n: count(), total: sum("latency") } }),
      columns: [
        { field: "service", heading: "Who" },
        { field: "latency", heading: ["Speed", { id: "p", title: "Latency" }], aggregate: "total" },
      ],
    });
    const { grid: exposed } = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" />`,
      () => ({ model }),
    );
    const totals = host.querySelector(".hg-totals")!;
    expect(totals.getAttribute("aria-label")).toBe("Total");
    expect(totals.textContent).toContain("210");
    const headers = [...host.querySelectorAll("[role=columnheader]")].map((one) => one.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Who", "Speed", "Latency"]));
    // Ctrl+C on a cell copies it, formulas escaped.
    exposed().focusCell(1, "service");
    let copied: string | null = null;
    const listen = (event: ClipboardEvent) => {
      copied = event.clipboardData!.getData("text/plain");
    };
    document.addEventListener("copy", listen);
    try {
      await userEvent.keyboard(`{${COMMAND}>}c{/${COMMAND}}`);
    } finally {
      document.removeEventListener("copy", listen);
    }
    expect(copied).toBe("'=1+2");
  });
});

describe("<PivotGrid>", () => {
  it("draws a pivot's grid, as of its model, and exposes it", () => {
    const view = rowView(
      table({
        region: ["eu", "us", "eu", "us"],
        service: ["api", "api", "web", "web"],
        ms: Float64Array.from([1, 2, 3, 4]),
      }),
    );
    const model = createPivotGridModel({
      data: pivotRows(view, { rows: "region", pivot: "service", ops: { n: count() } }),
    });
    const exposed = mount(
      `<PivotGrid ref="grid" :model="model" aria-label="By region" style="height: 300px" />`,
      () => ({ model }),
    );
    expect(grid().getAttribute("aria-label")).toBe("By region");
    expect(firstCells()).toEqual(["eu", "us"]);
    expect(exposed.grid().model).toBe(model);
    expect(host.querySelector(".hg-host")).toBeNull();
  });
});

describe("the grid v2 acceptance", () => {
  it("draws a link, a chip, a bar, and an action, the focus following its row as the grid scrolls and streams, and leaves nothing", async () => {
    const rows = 1000;
    const data = table({
      id: Float64Array.from({ length: rows }, (_, i) => i),
      service: Array.from({ length: rows }, (_, i) => `svc${i}`),
      status: category(Array.from({ length: rows }, (_, i) => (i % 3 === 0 ? "degraded" : "ok"))),
      latency: Float64Array.from({ length: rows }, (_, i) => (i * 37) % 500),
    });
    const view = rowView(data);
    view.setQuery({ sort: [{ field: "id", order: "descending" }] });
    const model = createGridModel({
      data: view,
      fields: {
        service: { link: { url: ["https://services.example.com/", { value: true }] } },
        status: { mappings: [{ value: "degraded", text: "Degraded", color: "#c62828" }] },
      },
      columns: [
        { field: "id", width: 80 },
        { field: "service" },
        { field: "status", cell: chipCell(), encode: { color: { field: "status" } } },
        { field: "latency", cell: barCell() },
        { id: "open", title: "", width: 80, text: ["Open ", { field: "service" }] },
      ],
    });
    const opened: string[] = [];
    const live = new Map<string, number>();
    const Action = defineComponent({
      props: { service: { type: String, required: true } },
      setup(props) {
        onMounted(() => live.set(props.service, (live.get(props.service) ?? 0) + 1));
        onBeforeUnmount(() => live.set(props.service, live.get(props.service)! - 1));
        return () =>
          h("button", { type: "button", onClick: () => opened.push(props.service) }, "Open");
      },
    });
    const exposed = mount(
      `<Grid ref="grid" :model="model" aria-label="Services" style="height: 300px" :cells="{ open: { fields: ['service'], interaction: 'control' } }">
        <template #cell-open="{ cell }"><Action :service="cell.read('service')" /></template>
      </Grid>`,
      () => ({ model }),
      { Action },
    );
    await nextTick();
    const row = (id: number) =>
      [...host.querySelectorAll<HTMLElement>(".hg-body [role=row]")].find(
        (one) => one.querySelector('[aria-colindex="1"]')!.textContent === String(id),
      )!;
    const top = row(999);
    expect(top.querySelector<HTMLAnchorElement>('[aria-colindex="2"] a')!.href).toBe(
      "https://services.example.com/svc999",
    );
    expect(top.querySelector('[aria-colindex="3"] .hg-chip')!.textContent).toBe("Degraded");
    expect(top.querySelector('[aria-colindex="4"] .hg-bar')).not.toBeNull();
    expect(top.querySelector('[aria-colindex="5"] button')!.textContent).toBe("Open");
    // The link takes the cell's focus; arrows move through the chip and the bar to the action.
    exposed.grid().focusCell(0, "service");
    expect(document.activeElement).toBe(top.querySelector('[aria-colindex="2"] a'));
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(top.querySelector('[aria-colindex="5"] button'));
    // Its press is its own: no row selected.
    await userEvent.keyboard("{Enter}");
    expect(opened).toEqual(["svc999"]);
    expect(model.selectedCount).toBe(0);
    // Scrolled by the keyboard, the focus goes into the next row's action.
    await userEvent.keyboard("{PageDown}{PageDown}");
    await frames();
    const at = model.focus!;
    expect(at.rowIndex).toBeGreaterThan(10);
    const id = 999 - at.rowIndex;
    expect(document.activeElement).toBe(row(id).querySelector('[aria-colindex="5"] button'));
    // Streaming: rows arrive above it, and the focus stays in its row's action.
    for (let tick = 0; tick < 5; tick++) {
      data.append({
        id: [rows + tick],
        service: [`svc${rows + tick}`],
        status: ["ok"],
        latency: [tick],
      });
      await frames();
      expect(model.focus!.rowIndex).toBe(at.rowIndex + tick + 1);
      expect(document.activeElement).toBe(row(id).querySelector('[aria-colindex="5"] button'));
    }
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    // Every action mounted is unmounted with the grid, which leaves nothing.
    app!.unmount();
    app = undefined;
    expect(host.innerHTML).toBe("");
    expect([...live.values()].every((n) => n === 0)).toBe(true);
    expect(live.size).toBeGreaterThan(20);
  });
});
