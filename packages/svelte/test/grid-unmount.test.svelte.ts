// A cell's teardown that unmounts its component while the grid is replaced
// for a new model. Svelte drops errors from a destroyed component's effects,
// so the test counts the grids made instead: alone in its file, because
// `herceg/grid` is spied on.
import { rowView, table } from "herceg";
import { createGrid, createGridModel, type GridCellContext } from "herceg/grid";
import { type Component, createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Grid } from "../src/grid.js";

vi.mock("herceg/grid", async (original) => {
  const grid = await original<typeof import("herceg/grid")>();
  return { ...grid, createGrid: vi.fn(grid.createGrid) };
});

let host: HTMLDivElement;
let mounted: Record<string, unknown> | undefined;
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

function servicesModel(rows: number) {
  return createGridModel({
    data: rowView(
      table({
        id: Float64Array.from({ length: rows }, (_, i) => i),
        service: Array.from({ length: rows }, (_, i) => `svc${i}`),
      }),
    ),
    columns: [{ field: "id" }, { field: "service" }],
  });
}

it("makes no grid for a new model when destroying the old one unmounts the component", async () => {
  let armed = false;
  let ran = false;
  const snippet = createRawSnippet((cell: () => GridCellContext) => ({
    render: () => {
      cell().signal.addEventListener(
        "abort",
        () => {
          if (!armed) return;
          armed = false;
          ran = true;
          unmount(mounted!);
          mounted = undefined;
        },
        { once: true },
      );
      return `<i>${cell().text}</i>`;
    },
  }));
  const props = $state({
    model: servicesModel(100),
    ariaLabel: "Services",
    style: "height: 300px",
    cells: { service: snippet },
  });
  mounted = mount(Grid as unknown as Component<typeof props>, { target: host, props });
  flushSync();
  await frames();
  expect(vi.mocked(createGrid)).toHaveBeenCalledTimes(1);
  armed = true;
  props.model = servicesModel(50);
  flushSync();
  await frames();
  expect(ran).toBe(true);
  expect(host.innerHTML).toBe("");
  expect(vi.mocked(createGrid)).toHaveBeenCalledTimes(1);
  expect(reported).toEqual([]);
});
