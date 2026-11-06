// React cells in herceg grids: portals keeping the app's context and each
// row's state, the first draw's cells committed before paint and later
// frames' in the grid's frame (never a frame of another row's content),
// `onRender` after the commit, boundaries for throwing and suspending cells,
// focus into React controls (after scrolling, and as a suspended cell
// reveals), effects changing the model or unmounting the grid, StrictMode,
// new models and props, remote and pivot grids, and what is left behind.
import { count, rowView, type Table, table } from "herceg";
import { createGridModel, type Grid as HercegGrid } from "herceg/grid";
import { memorySource } from "herceg/grid/memory";
import { createPivotGridModel } from "herceg/grid/pivot";
import { createRemoteGridModel, type GridSource } from "herceg/grid/remote";
import { pivotRows } from "herceg/pivot";
import {
  act,
  createContext,
  type ReactNode,
  StrictMode,
  Suspense,
  use,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { collectGarbage } from "../../herceg/test/browser/helpers.ts";
import { PivotGrid } from "../src/grid/pivot.tsx";
import { RemoteGrid } from "../src/grid/remote.tsx";
import { Grid, type ReactGridCells } from "../src/grid.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROW = 28;
let host: HTMLDivElement;
let root: Root;
/** Errors reported (`reportError`) during the test. */
let reported: string[];
const report = (event: ErrorEvent) => {
  reported.push((event.error as Error).message);
  event.preventDefault();
};
const quiet = console.error;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px";
  document.body.append(host);
  root = createRoot(host);
  reported = [];
  window.addEventListener("error", report);
  // React logs the errors its boundaries catch; the boundaries report them.
  console.error = () => {};
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener("error", report);
  console.error = quiet;
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
/** Whether a cell's React content is in its host, shown. */
const shown = (cell: HTMLElement) => {
  const held = cell.querySelector<HTMLElement>(".hg-host");
  return !!held && !held.hidden && held.childNodes.length > 0;
};

const Theme = createContext("plain");

describe("<Grid> cells", () => {
  it("draw the first frame's cells before paint, in the app's context, then tell onRender", () => {
    const model = servicesModel(100);
    function Badge({ name }: { name: string }) {
      return <b className={useContext(Theme)}>{name}</b>;
    }
    const told: boolean[] = [];
    act(() =>
      root.render(
        <Theme.Provider value="loud">
          <Grid
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={{ service: (cell) => <Badge name={cell.text} /> }}
            onRender={() => told.push(cellsOf(2).every(shown))}
          />
        </Theme.Provider>,
      ),
    );
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
    act(() =>
      root.render(
        <Grid
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{ service: (cell) => <span data-row={cell.row.ref.id}>{cell.text}</span> }}
          onRender={() => told.push(cellsOf(2).every(shown))}
        />,
      ),
    );
    for (const top of [ROW * 300, ROW * 310, ROW * 900, 0]) {
      model.scrollTo({ top });
      // The grid draws in its frame; a callback after it, in that frame, sees what paints.
      const painted = await new Promise<{ id: string; row: string | null; text: string }[]>(
        (resolve) =>
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
  });

  it("keep each cell's state its row's: kept while it shows the row, new for another row", async () => {
    const model = servicesModel(1000);
    const mounted: string[] = [];
    function Counter({ name }: { name: string }) {
      const [count, setCount] = useState(0);
      useState(() => mounted.push(name));
      return (
        <button type="button" onClick={() => setCount(count + 1)}>
          {name} {count}
        </button>
      );
    }
    act(() =>
      root.render(
        <Grid
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: {
              render: (cell) => <Counter name={cell.text} />,
              interaction: "control",
            },
          }}
        />,
      ),
    );
    const button = () => cellsOf(2)[0]!.querySelector("button")!;
    act(() => button().click());
    expect(button().textContent).toBe("svc0 1");
    // The row's selection changes: the cell draws again, its state the same.
    model.select(0, "only");
    await frames();
    expect(button().textContent).toBe("svc0 1");
    expect(mounted.filter((name) => name === "svc0")).toHaveLength(1);
    model.scrollTo({ top: ROW * 500 });
    await frames();
    for (const cell of cellsOf(2))
      expect(cell.querySelector("button")!.textContent).toBe(`svc${idOf(cell)} 0`);
    model.scrollTo({ top: 0 });
    await frames();
    expect(button().textContent).toBe("svc0 0");
  });

  it("draw with the latest render function and props, without a new grid or host", () => {
    const model = servicesModel(100);
    const view = (suffix: string) => (
      <Grid
        model={model}
        ariaLabel="Services"
        style={{ height: 300 }}
        cells={{ service: (cell) => <i>{`${cell.text}${suffix}`}</i> }}
      />
    );
    act(() => root.render(view("!")));
    const grid = host.querySelector("[role=grid]");
    const held = cellsOf(2)[0]!.querySelector(".hg-host");
    expect(cellsOf(2)[0]!.textContent).toBe("svc0!");
    act(() => root.render(view("?")));
    expect(cellsOf(2)[0]!.textContent).toBe("svc0?");
    expect(host.querySelector("[role=grid]")).toBe(grid);
    expect(cellsOf(2)[0]!.querySelector(".hg-host")).toBe(held);
  });

  it("read the fields a column's cells name; new fields replace that column's hosts alone", () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const view = (fields: ("owner" | "id")[]) => (
      <Grid
        model={model}
        ariaLabel="Services"
        style={{ height: 300 }}
        cells={{
          service: (cell) => <i>{cell.text}</i>,
          who: { fields, render: (cell) => <i>{fields.map((one) => cell.read(one)).join(" ")}</i> },
        }}
      />
    );
    act(() => root.render(view(["owner"])));
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
    const service = cellsOf(2)[0]!.querySelector(".hg-host");
    const who = cellsOf(3)[0]!.querySelector(".hg-host");
    act(() => root.render(view(["owner", "id"])));
    // Drawn again in the grid's next frame; the old hosts went before this paints.
    expect(cellsOf(3)[1]!.querySelector(".hg-host")).not.toBe(who);
    expect(cellsOf(2)[0]!.querySelector(".hg-host")).toBe(service);
    expect(reported).toEqual([]);
  });

  it("draw a throwing cell's text, reported once a mount, the rest of the grid drawn", async () => {
    const model = servicesModel(1000);
    act(() =>
      root.render(
        <Grid
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: (cell) => {
              if (cell.rowIndex === 2) throw new Error("no svc2");
              return <i>{cell.text}</i>;
            },
          }}
        />,
      ),
    );
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

  describe("that suspend", () => {
    // React reveals a boundary that suspended inside act() only within an
    // act() scope; these render as an application does.
    beforeEach(() => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    });
    afterEach(() => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    });

    function suspending() {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      function Late({ name }: { name: string }) {
        use(promise);
        return <button type="button">{name}</button>;
      }
      const cells: ReactGridCells<Services> = {
        service: { interaction: "control", render: (cell) => <Late name={cell.text} /> },
      };
      return { cells, resolve };
    }

    it("draw their text until they reveal, and take the focus in as they do", async () => {
      const model = servicesModel(100);
      const { cells, resolve } = suspending();
      const grid = { current: null as HercegGrid | null };
      flushSync(() =>
        root.render(
          <Grid
            ref={grid as never}
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={cells}
          />,
        ),
      );
      const cell = () => cellsOf(2)[0]!;
      expect(cell().textContent).toBe("svc0");
      expect(cell().querySelector("button")).toBeNull();
      grid.current!.focusCell(0, "service");
      expect(document.activeElement).toBe(cell());
      resolve();
      await until(() => cell().querySelector("button") !== null);
      await frames();
      expect(document.activeElement).toBe(cell().querySelector("button"));
      expect(cell().querySelector("button")!.tabIndex).toBe(0);
    });

    it("follow a boundary of their own revealing: the focus moves in, one tab stop", async () => {
      const model = servicesModel(100);
      const { cells, resolve } = suspending();
      const late = cells.service as { render: (cell: { text: string }) => ReactNode };
      const grid = { current: null as HercegGrid | null };
      flushSync(() =>
        root.render(
          <Grid
            ref={grid as never}
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={{
              service: {
                interaction: "control",
                // The cell's content commits at once; a boundary inside it reveals later.
                render: (cell) => (
                  <Suspense fallback={<span>…</span>}>{late.render(cell)}</Suspense>
                ),
              },
            }}
          />,
        ),
      );
      grid.current!.focusCell(0, "service");
      const cell = () => cellsOf(2)[0]!;
      expect(document.activeElement).toBe(cell());
      resolve();
      await until(() => cell().querySelector("button") !== null);
      await frames();
      expect(document.activeElement).toBe(cell().querySelector("button"));
      expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      // The other cells' revealed buttons are out of the tab order.
      expect(cellsOf(2)[1]!.querySelector("button")!.tabIndex).toBe(-1);
    });

    it("keep the focus in the grid as a focused control suspends again, and take it back in", async () => {
      const model = servicesModel(100);
      let resolve!: () => void;
      const again = new Promise<void>((done) => {
        resolve = done;
      });
      let suspend!: () => void;
      function Flip({ text }: { text: string }) {
        const [late, setLate] = useState(false);
        if (text === "svc0") suspend = () => setLate(true);
        if (late) use(again);
        return <button type="button">{text}</button>;
      }
      const grid = { current: null as HercegGrid | null };
      flushSync(() =>
        root.render(
          <Grid
            ref={grid as never}
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={{
              service: { interaction: "control", render: (cell) => <Flip text={cell.text} /> },
            }}
          />,
        ),
      );
      grid.current!.focusCell(0, "service");
      const cell = () => cellsOf(2)[0]!;
      expect(document.activeElement).toBe(cell().querySelector("button"));
      flushSync(() => suspend());
      await frames();
      // Its control hidden as it suspends, the cell holds the focus.
      expect(document.activeElement).toBe(cell());
      resolve();
      await until(() => document.activeElement === cell().querySelector("button"));
      expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it("leave the focus where the user took it as they reveal", async () => {
      const model = servicesModel(100);
      const { cells, resolve } = suspending();
      const grid = { current: null as HercegGrid | null };
      flushSync(() =>
        root.render(
          <>
            <button type="button" id="away">
              Away
            </button>
            <Grid
              ref={grid as never}
              model={model}
              ariaLabel="Services"
              style={{ height: 300 }}
              cells={cells}
            />
          </>,
        ),
      );
      grid.current!.focusCell(0, "service");
      const away = host.querySelector<HTMLElement>("#away")!;
      away.focus();
      resolve();
      await until(() => cellsOf(2)[0]!.querySelector("button") !== null);
      await frames();
      expect(document.activeElement).toBe(away);
      // The grid's tab stop is the revealed control.
      expect(cellsOf(2)[0]!.querySelector("button")!.tabIndex).toBe(0);
    });
  });

  it("take the focus into a React control, and into the next one after scrolling", async () => {
    const model = servicesModel(1000);
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: {
              interaction: "control",
              render: (cell) => <button type="button">{cell.text}</button>,
            },
          }}
        />,
      ),
    );
    act(() => grid.current!.focusCell(0, "service"));
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
    function Toggle({ text }: { text: string }) {
      const [editing, setEditing] = useState(false);
      return editing ? (
        <input aria-label="Service" defaultValue={text} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          {text}
        </button>
      );
    }
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: { interaction: "control", render: (cell) => <Toggle text={cell.text} /> },
          }}
        />,
      ),
    );
    act(() => grid.current!.focusCell(2, "service"));
    const cell = cellsOf(2)[2]!;
    expect(document.activeElement).toBe(cell.querySelector("button"));
    await userEvent.keyboard("{Enter}");
    await until(() => document.activeElement === cell.querySelector("input"));
    expect(cell.querySelector("input")!.tabIndex).toBe(0);
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("follow a control enabled on its own: the focus moves in, one tab stop", async () => {
    const model = servicesModel(100);
    let enable!: () => void;
    function Gate({ text }: { text: string }) {
      const [on, setOn] = useState(false);
      if (text === "svc0") enable = () => setOn(true);
      return (
        <button type="button" disabled={!on}>
          {text}
        </button>
      );
    }
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: { interaction: "control", render: (cell) => <Gate text={cell.text} /> },
          }}
        />,
      ),
    );
    act(() => grid.current!.focusCell(0, "service"));
    const cell = cellsOf(2)[0]!;
    // A disabled control is passed over: the cell takes the focus.
    expect(document.activeElement).toBe(cell);
    act(() => enable());
    await until(() => document.activeElement === cell.querySelector("button"));
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("give the focus back to a control cell whose control can no longer hold it", async () => {
    const model = servicesModel(100);
    let off!: (how: "disabled" | "hidden" | "inert") => void;
    function Fade({ text }: { text: string }) {
      const [how, setHow] = useState<"disabled" | "hidden" | "inert" | null>(null);
      if (text === "svc0") off = setHow;
      return (
        <span inert={how === "inert"}>
          <button
            type="button"
            disabled={how === "disabled"}
            style={how === "hidden" ? { visibility: "hidden" } : {}}
          >
            {text}
          </button>
        </span>
      );
    }
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: { interaction: "control", render: (cell) => <Fade text={cell.text} /> },
          }}
        />,
      ),
    );
    const cell = cellsOf(2)[0]!;
    for (const how of ["disabled", "hidden", "inert"] as const) {
      act(() => grid.current!.focusCell(0, "service"));
      act(() => off(null as never));
      await until(() => document.activeElement === cell.querySelector("button"));
      act(() => off(how));
      await until(() => document.activeElement === cell);
      expect(cell.tabIndex).toBe(0);
    }
  });

  it("keep one tab stop as a cell's component makes an element focusable on its own", async () => {
    const model = servicesModel(100);
    const focusable: (() => void)[] = [];
    function Stop({ text }: { text: string }) {
      const [on, setOn] = useState(false);
      if (text === "svc0" || text === "svc1") focusable.push(() => setOn(true));
      return <span tabIndex={on ? 0 : undefined}>{text}</span>;
    }
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: { interaction: "control", render: (cell) => <Stop text={cell.text} /> },
          }}
        />,
      ),
    );
    act(() => grid.current!.focusCell(1, "service"));
    const focused = cellsOf(2)[1]!;
    expect(document.activeElement).toBe(focused);
    act(() => {
      for (const set of focusable) set();
    });
    // The focused cell's element takes its focus in; the other's leaves the tab order.
    await until(() => document.activeElement === focused.querySelector("span"));
    await frames();
    expect(cellsOf(2)[0]!.querySelector("span")!.tabIndex).toBe(-1);
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("give the focus back to a composite cell whose focused control goes", async () => {
    const model = servicesModel(100);
    function Edit({ text }: { text: string }) {
      const [editing, setEditing] = useState(false);
      return editing ? (
        <input aria-label="Service" defaultValue={text} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          {text}
        </button>
      );
    }
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: { interaction: "composite", render: (cell) => <Edit text={cell.text} /> },
          }}
        />,
      ),
    );
    act(() => grid.current!.focusCell(1, "service"));
    const cell = cellsOf(2)[1]!;
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(cell.querySelector("button"));
    // The control's own Enter replaces it with an input.
    await userEvent.keyboard("{Enter}");
    await until(() => cell.querySelector("input") !== null);
    await frames();
    expect(document.activeElement).toBe(cell);
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(cell.querySelector("input"));
  });

  it("enter a composite cell's controls with Enter, and leave with Escape", async () => {
    const model = servicesModel(100);
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: {
              interaction: "composite",
              render: (cell) => <input aria-label="Service" defaultValue={cell.text} />,
            },
          }}
        />,
      ),
    );
    act(() => grid.current!.focusCell(1, "service"));
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

  it("keep one tab stop as a composite cell's focused control makes itself focusable", async () => {
    const model = servicesModel(100);
    function Field({ text }: { text: string }) {
      const [focused, setFocused] = useState(false);
      return (
        <input
          aria-label="Service"
          defaultValue={text}
          tabIndex={focused ? 0 : undefined}
          onFocus={() => setFocused(true)}
        />
      );
    }
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <>
          <Grid
            ref={grid as never}
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={{
              service: { interaction: "composite", render: (cell) => <Field text={cell.text} /> },
            }}
          />
          <input aria-label="After" />
        </>,
      ),
    );
    act(() => grid.current!.focusCell(1, "service"));
    const cell = cellsOf(2)[1]!;
    await userEvent.keyboard("{Enter}");
    const input = cell.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    await frames();
    expect(document.activeElement).toBe(input);
    expect(host.querySelectorAll('.herceg-grid [tabindex="0"]')).toHaveLength(1);
    // Tab leaves the grid as from the cell, not into the input again (to a
    // text field: WebKit tabs to no button by default).
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement!.ariaLabel).toBe("After");
  });

  it("hold grids in composite cells: one tab stop, Enter moves in, Tab leaves", async () => {
    function Inner() {
      const [model] = useState(() => servicesModel(20));
      const grid = useRef<HercegGrid<Services> | null>(null);
      useEffect(() => {
        model.focusCell(0, "service");
        grid.current!.render();
      }, [model]);
      return (
        <Grid
          ref={grid}
          model={model}
          ariaLabel="Inner"
          style={{ height: 200 }}
          cells={{
            service: {
              interaction: "control",
              render: (cell) => <button type="button">{cell.text}</button>,
            },
          }}
        />
      );
    }
    const model = servicesModel(3);
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <>
          <Grid
            ref={grid as never}
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={{ service: { interaction: "composite", render: () => <Inner /> } }}
          />
          <input aria-label="After" />
        </>,
      ),
    );
    await until(() => host.querySelectorAll(".herceg-grid .herceg-grid button").length > 0);
    await frames();
    act(() => grid.current!.focusCell(1, "service"));
    const outer = host.querySelector(".herceg-grid")!;
    const cell = [...outer.querySelectorAll<HTMLElement>('[aria-colindex="2"]')].find(
      (one) =>
        one.closest(".herceg-grid") === outer && one.role === "gridcell" && idOf(one) === "1",
    )!;
    expect(document.activeElement).toBe(cell);
    // The inner grids' tab stops are out of the page's order: the outer grid has one.
    expect([...host.querySelectorAll('[tabindex="0"]')]).toEqual([cell]);
    await userEvent.keyboard("{Enter}");
    const inner = cell.querySelector(".herceg-grid")!;
    await until(() => inner.contains(document.activeElement));
    expect(document.activeElement!.textContent).toBe("svc0");
    await frames();
    expect([...host.querySelectorAll('[tabindex="0"]')]).toEqual([cell]);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement!.ariaLabel).toBe("After");
  });

  it("leave the focus where a cell's effect moves it out of the grid in the grid's frame", async () => {
    const model = servicesModel(1000);
    const grid = { current: null as HercegGrid | null };
    const dialog = { current: null as HTMLButtonElement | null };
    let opened = false;
    function Opener({ index }: { index: number }) {
      useLayoutEffect(() => {
        if (index !== 300 || opened) return;
        opened = true;
        dialog.current!.focus();
      }, [index]);
      return <i>{index}</i>;
    }
    act(() =>
      root.render(
        <>
          <Grid
            ref={grid as never}
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={{ service: (cell) => <Opener index={cell.rowIndex} /> }}
          />
          <button type="button" ref={dialog}>
            Dialog
          </button>
        </>,
      ),
    );
    act(() => grid.current!.focusCell(1, "id"));
    expect(idOf(document.activeElement as HTMLElement)).toBe("1");
    model.scrollTo({ top: ROW * 300 });
    await until(() => opened);
    await frames();
    expect(document.activeElement).toBe(dialog.current);
  });

  it("let cells' effects change the model, and a parent's effects call the grid", async () => {
    const data = services(1000);
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    function Sorter({ id, text }: { id: number | null; text: string }) {
      useEffect(() => {
        if (id === 0) model.setSort([{ field: "id", order: "descending" }]);
      }, [id]);
      return <i>{text}</i>;
    }
    function App() {
      const grid = useRef<HercegGrid<Services> | null>(null);
      useLayoutEffect(() => {
        grid.current!.model.scrollTo({ top: ROW * 200 });
        grid.current!.render();
      }, []);
      useEffect(() => grid.current!.focusCell(5, "service"), []);
      return (
        <Grid
          ref={grid}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: {
              fields: ["id"],
              render: (cell) => <Sorter id={cell.read("id")} text={cell.text} />,
            },
          }}
        />
      );
    }
    act(() => root.render(<App />));
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
    const grid = { current: null as HercegGrid | null };
    let asked = false;
    function Asker({ index }: { index: number }) {
      useLayoutEffect(() => {
        if (index !== 300 || asked) return;
        asked = true;
        grid.current!.focusCell(301, "id");
      }, [index]);
      return <i>{index}</i>;
    }
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{ service: (cell) => <Asker index={cell.rowIndex} /> }}
        />,
      ),
    );
    expect(document.activeElement).toBe(document.body);
    model.scrollTo({ top: ROW * 300 });
    await until(() => asked);
    await frames();
    expect(model.focus).toMatchObject({ rowIndex: 301, column: "id" });
    expect(idOf(document.activeElement as HTMLElement)).toBe("301");
  });

  it("tell onRender of the first frame once current cells commit, a parent's effect having drawn again", async () => {
    const model = servicesModel(1000);
    const told: boolean[] = [];
    function App() {
      const grid = useRef<HercegGrid<Services> | null>(null);
      useLayoutEffect(() => grid.current!.focusCell(400, "service"), []);
      return (
        <Grid
          ref={grid}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{ service: (cell) => <i>{cell.text}</i> }}
          onRender={() => told.push(cellsOf(2).every(shown))}
        />
      );
    }
    act(() => root.render(<App />));
    await frames();
    // The draw the effect called is heard at once, its cells committed in the next frame.
    expect(told[0]).toBe(false);
    expect(told.slice(1).length).toBeGreaterThan(0);
    expect(told.slice(1).every(Boolean)).toBe(true);
  });

  it("draw their text, never nothing, as a cell's effect removes cells in the grid's frame", async () => {
    const model = servicesModel(1000);
    function Remover({ index, remove }: { index: number; remove: () => void }) {
      useLayoutEffect(() => {
        if (index === 300) remove();
      }, [index, remove]);
      return <i>{index}</i>;
    }
    function App() {
      const [on, setOn] = useState(true);
      const remove = () => setOn(false);
      return (
        <Grid
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={
            on
              ? { service: (cell) => <Remover index={cell.rowIndex} remove={remove} /> }
              : undefined
          }
        />
      );
    }
    act(() => root.render(<App />));
    model.scrollTo({ top: ROW * 300 });
    // What paints in the frame the cells went in: each cell its row's text.
    const painted = await new Promise<string[][]>((resolve) =>
      requestAnimationFrame(() =>
        resolve(cellsOf(2).map((cell) => [idOf(cell), (cell as HTMLElement).innerText])),
      ),
    );
    for (const [id, text] of painted) expect(text).toBe(`svc${id}`);
    await frames();
    expect(host.querySelectorAll(".hg-host")).toHaveLength(0);
    expect(cellsOf(2)[0]!.textContent).toBe(`svc${idOf(cellsOf(2)[0]!)}`);
  });

  it("let a cell's effect unmount the grid in the grid's frame", async () => {
    const model = servicesModel(1000);
    function Gone({ index, gone }: { index: number; gone: () => void }) {
      useLayoutEffect(() => {
        if (index >= 300) gone();
      }, [index, gone]);
      return <i>{index}</i>;
    }
    function App() {
      const [mounted, setMounted] = useState(true);
      const gone = () => setMounted(false);
      return mounted ? (
        <Grid
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{ service: (cell) => <Gone index={cell.rowIndex} gone={gone} /> }}
        />
      ) : (
        <p>Gone</p>
      );
    }
    act(() => root.render(<App />));
    model.scrollTo({ top: ROW * 300 });
    await until(() => host.querySelector("p") !== null);
    await frames();
    expect(host.innerHTML).toBe("<p>Gone</p>");
    expect(reported).toEqual([]);
  });

  it("let a cell's first effect destroy the grid: no onRender of it", async () => {
    const model = servicesModel(100);
    const grid = { current: null as HercegGrid | null };
    function Destroyer({ text }: { text: string }) {
      useLayoutEffect(() => grid.current?.destroy(), []);
      return <i>{text}</i>;
    }
    const told: number[] = [];
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{ service: (cell) => <Destroyer text={cell.text} /> }}
          onRender={({ revision }) => told.push(revision)}
        />,
      ),
    );
    await frames();
    expect(host.querySelector("[role=grid]")).toBeNull();
    expect(told).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("mount once under StrictMode's double effects, and leave nothing on unmount", async () => {
    const model = servicesModel(1000);
    const renders: number[] = [];
    const mounts: string[] = [];
    function Cell({ text }: { text: string }) {
      useEffect(() => {
        mounts.push(`+${text}`);
        return () => void mounts.push(`-${text}`);
      }, [text]);
      return <i>{text}</i>;
    }
    act(() =>
      root.render(
        <StrictMode>
          <Grid
            model={model}
            ariaLabel="Services"
            style={{ height: 300 }}
            cells={{ service: (cell) => <Cell text={cell.text} /> }}
            onRender={({ revision }) => renders.push(revision)}
          />
        </StrictMode>,
      ),
    );
    expect(host.querySelectorAll("[role=grid]")).toHaveLength(1);
    expect(cellsOf(2).every(shown)).toBe(true);
    expect(renders).toEqual([model.revision]);
    model.scrollTo({ top: ROW * 400 });
    await frames();
    expect(cellsOf(2).every((cell) => cell.textContent === `svc${idOf(cell)}`)).toBe(true);
    act(() => root.render(null));
    expect(host.innerHTML).toBe("");
    // Every cell mounted was unmounted.
    const live = new Map<string, number>();
    for (const entry of mounts) {
      const name = entry.slice(1);
      live.set(name, (live.get(name) ?? 0) + (entry[0] === "+" ? 1 : -1));
    }
    expect([...live.values()].every((n) => n === 0)).toBe(true);
  });

  it("make a new grid with its cells for a new model", () => {
    const first = servicesModel(10);
    const second = createGridModel({
      data: rowView(services(20)),
      columns: [{ field: "service" }, { field: "id" }],
    });
    const view = (model: typeof first) => (
      <Grid
        model={model}
        ariaLabel="Services"
        style={{ height: 300 }}
        cells={{ service: (cell) => <i>{cell.text}</i> }}
      />
    );
    act(() => root.render(view(first)));
    const hosts = [...host.querySelectorAll(".hg-host")];
    act(() => root.render(view(second)));
    expect(host.querySelectorAll("[role=grid]")).toHaveLength(1);
    expect(cellsOf(1)[3]!.querySelector("i")!.textContent).toBe("svc3");
    expect(hosts.some((one) => one.isConnected)).toBe(false);
  });

  it("let go of their hosts when cells go, and tell onRender of later grids' first frames", async () => {
    const told: string[] = [];
    const view = (model: ReturnType<typeof servicesModel>, cells?: ReactGridCells<Services>) => (
      <Grid
        model={model}
        ariaLabel="Services"
        style={{ height: 300 }}
        cells={cells}
        onRender={() =>
          told.push(host.querySelector("[role=grid]")!.getAttribute("aria-rowcount")!)
        }
      />
    );
    const first = servicesModel(100);
    const refs = (() => {
      act(() => root.render(view(first, { service: (cell) => <i>{cell.text}</i> })));
      return [...host.querySelectorAll(".hg-host")].map((one) => new WeakRef(one));
    })();
    act(() => root.render(view(first)));
    await frames();
    for (const rows of [50, 20]) {
      act(() => root.render(view(servicesModel(rows))));
      expect(told.at(-1)).toBe(String(rows + 1));
    }
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
  });

  it("let go of replaced hosts while the grid is out of view, and draw as it comes back", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const grid = { current: null as HercegGrid | null };
    const view = (fields: ("owner" | "id")[]) => (
      <Grid
        ref={grid as never}
        model={model}
        ariaLabel="Services"
        style={{ height: 300 }}
        cells={{
          who: { fields, render: (cell) => <i>{fields.map((one) => cell.read(one)).join(" ")}</i> },
        }}
      />
    );
    act(() => root.render(view(["owner"])));
    host.style.cssText = "width:600px;position:fixed;top:20000px";
    await until(() => !grid.current!.visible);
    const refs = [...host.querySelectorAll(".hg-host")].map((one) => new WeakRef(one));
    act(() => root.render(view(["owner", "id"])));
    act(() => root.render(view(["id"])));
    await frames();
    act(() => root.render(view(["owner"])));
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
    host.style.cssText = "width:600px";
    await until(() => grid.current!.visible && cellsOf(3).every(shown));
    expect(cellsOf(3)[1]!.textContent).toBe("own1");
  });

  it("let go of hosts a hidden grid's interrupted draw releases", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const grid = { current: null as HercegGrid | null };
    const view = (fields: ("owner" | "id")[]) => (
      <Grid
        ref={grid as never}
        model={model}
        ariaLabel="Services"
        style={{ height: 300 }}
        cells={{
          who: {
            fields,
            render: (cell) => {
              // The first row's update, superseded, sorts the rows: the draw letting go of it stops.
              if (cell.rowIndex === 0)
                cell.signal.addEventListener("abort", () =>
                  model.setSort([{ field: "id", order: "descending" }]),
                );
              return <i>{fields.map((one) => cell.read(one)).join(" ")}</i>;
            },
          },
        }}
      />
    );
    act(() => root.render(view(["owner"])));
    host.style.cssText = "width:600px;position:fixed;top:20000px";
    await until(() => !grid.current!.visible);
    const refs = [...host.querySelectorAll(".hg-host")].map((one) => new WeakRef(one));
    act(() => root.render(view(["owner", "id"])));
    expect(model.sort).toEqual([{ field: "id", order: "descending" }]);
    const released = refs.filter((ref) => !ref.deref()!.isConnected);
    expect(released.length).toBeGreaterThan(0);
    // React keeps a component's previous state until its next commit.
    act(() => root.render(view(["owner", "id"])));
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(released.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
  });

  it("draw cells handed over inside the grid's update, the grid out of view", async () => {
    const model = createGridModel({
      data: rowView(services(100)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    const grid = { current: null as HercegGrid | null };
    const view = (fields: ("owner" | "id")[], headerHeight: number) => (
      <Grid
        ref={grid as never}
        model={model}
        ariaLabel="Services"
        style={{ height: 300 }}
        headerHeight={headerHeight}
        cells={{
          who: {
            fields,
            render: (cell) => <i>{fields.map((one) => cell.read(one)).join(" ")}</i>,
          },
        }}
      />
    );
    act(() => root.render(view(["owner"], 32)));
    // A model change draws at once: inside the update the component makes.
    const off = model.subscribe(() => grid.current?.render());
    host.style.cssText = "width:600px;position:fixed;top:20000px";
    await until(() => !grid.current!.visible);
    act(() => root.render(view(["owner", "id"], 40)));
    host.style.cssText = "width:600px";
    await until(() => grid.current!.visible);
    await frames();
    off();
    for (const cell of cellsOf(3)) {
      const id = Number(idOf(cell));
      expect(shown(cell)).toBe(true);
      expect(cell.textContent).toBe(`own${id % 7} ${id}`);
    }
    expect(reported).toEqual([]);
  });

  it("draw each cell as its renderer when an abort listener replaces cells in the grid's frame", async () => {
    const model = createGridModel({
      data: rowView(services(1000)),
      columns: [{ field: "id" }, { field: "service" }, { id: "who", title: "Who" }],
    });
    let change: (() => void) | null = null;
    function App() {
      const [fields, setFields] = useState<("owner" | "id")[]>(["owner"]);
      if (fields.length === 1) change = () => flushSync(() => setFields(["owner", "id"]));
      return (
        <Grid
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            who: {
              fields,
              render: (cell) => {
                // Superseded as the first row scrolls away: the cells change then and there.
                if (fields.length === 1 && cell.rowIndex === 0)
                  cell.signal.addEventListener("abort", () => {
                    const now = change;
                    change = null;
                    now?.();
                  });
                return <i>{fields.map((one) => cell.read(one)).join(" ")}</i>;
              },
            },
          }}
        />
      );
    }
    act(() => root.render(<App />));
    model.scrollTo({ top: ROW * 50 });
    await until(() => change === null);
    await frames();
    expect(reported).toEqual([]);
    for (const cell of cellsOf(3)) {
      const id = Number(idOf(cell));
      expect(cell.textContent).toBe(`own${id % 7} ${id}`);
    }
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
    act(() =>
      root.render(
        <Grid
          model={model}
          ariaLabel="Services"
          style={{ height: 300, width: 600 }}
          cells={{ toString: () => <i>a</i>, ["__proto__"]: () => <i>b</i> }}
        />,
      ),
    );
    expect(cellsOf(2)[0]!.innerHTML).toContain("<i>a</i>");
    expect(cellsOf(3)[0]!.innerHTML).toContain("<i>b</i>");
    expect(cellsOf(4)[0]!.textContent).toBe("c");
    expect(cellsOf(4)[0]!.querySelector(".hg-host")).toBeNull();
    expect(reported).toEqual([]);
  });

  it("give columns their own cells back when cells go, before paint", () => {
    const model = servicesModel(100);
    const view = (cells?: ReactGridCells<Services>) => (
      <Grid model={model} ariaLabel="Services" style={{ height: 300 }} cells={cells} />
    );
    act(() => root.render(view({ service: (cell) => <i>{cell.text}</i> })));
    expect(host.querySelectorAll(".hg-host").length).toBeGreaterThan(0);
    act(() => root.render(view()));
    expect(host.querySelectorAll(".hg-host")).toHaveLength(0);
    expect(cellsOf(2)[4]!.textContent).toBe("svc4");
  });

  it("keep their hosts across vertical scrolling, and let go of every host they leave", async () => {
    const columns = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: `C${i}` }));
    const model = createGridModel({
      data: rowView(services(1000)),
      columns: [{ field: "id" }, ...columns],
    });
    const cells = Object.fromEntries(columns.map(({ id }) => [id, () => <i>{id}</i>]));
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <Grid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={cells}
        />,
      ),
    );
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
    // React keeps a component's previous state until its next commit.
    model.scrollTo({ top: ROW * 400 });
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBe(refs.length - gone);
  });

  it("are collected with their grids over many mounts and unmounts", async () => {
    const model = servicesModel(1000);
    const refs = (() => {
      const made: WeakRef<object>[] = [];
      for (let i = 0; i < 10; i++) {
        const grid = { current: null as HercegGrid | null };
        act(() =>
          root.render(
            <Grid
              key={i}
              ref={grid as never}
              model={model}
              ariaLabel="Services"
              style={{ height: 300 }}
              cells={{ service: (cell) => <i>{cell.text}</i> }}
            />,
          ),
        );
        for (const one of host.querySelectorAll(".hg-host")) made.push(new WeakRef(one));
        made.push(new WeakRef(grid.current!), new WeakRef(grid.current!.root));
      }
      act(() => root.render(null));
      return made;
    })();
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.flatMap((ref, i) => (ref.deref() !== undefined ? [i] : []))).toEqual([]);
  });
});

describe("<RemoteGrid>", () => {
  it("draws React cells, asking the source for the fields they read", async () => {
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
    const grid = { current: null as HercegGrid | null };
    act(() =>
      root.render(
        <RemoteGrid
          ref={grid as never}
          model={model}
          ariaLabel="Services"
          style={{ height: 300 }}
          cells={{
            service: {
              fields: ["owner"],
              render: (cell) => <i>{`${cell.text} ${cell.read("owner")}`}</i>,
            },
          }}
        />,
      ),
    );
    await until(() => cellsOf(2)[3]?.querySelector("i") != null);
    expect(asked.at(-1)).toContain("owner");
    expect(cellsOf(2)[3]!.textContent).toBe("svc3 own3");
    expect(grid.current!.model).toBe(model);
    model.scrollTo({ top: ROW * 300 });
    await until(() => cellsOf(2).some((cell) => cell.textContent === "svc300 own6"));
    expect(reported).toEqual([]);
    act(() => root.render(null));
    model.dispose();
  });
});

describe("<PivotGrid>", () => {
  it("draws a pivot's grid, as of its model", () => {
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
    const grid = { current: null as { model: unknown } | null };
    const element: ReactNode = (
      <PivotGrid ref={grid as never} model={model} ariaLabel="By region" style={{ height: 300 }} />
    );
    act(() => root.render(element));
    expect(host.querySelector("[role=grid]")!.getAttribute("aria-label")).toBe("By region");
    expect(cellsOf(1).map((cell) => cell.textContent)).toEqual(["eu", "us"]);
    expect(grid.current!.model).toBe(model);
  });
});
