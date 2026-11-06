// In-page side of the sparkline benchmark (run.ts drives it): a grid of
// 1,000 keys whose third column draws each key's series from a million-row
// table (series.ts), in three grids.
//
// Herceg: a column of `sparklineCell` over a Herceg table of the series,
// which the grid indexes by key as it first draws and again as the table
// changes. TanStack Table (v9, with TanStack Virtual, in production React):
// the column's `cell` renders an SVG path the adapter works out (an index
// of each key's rows kept as rows arrive, M4 with the same gap rule,
// series.ts), memoized per key and data version. Glide Data Grid: a custom
// cell drawing the same points on its canvas, cached per key and version.
// AG Grid's sparklines are Enterprise, so it is not compared.
//
// A frame is correct when every row in view shows its own series as the
// data is now: its line ends where the row's last value does (checked just
// before the frame paints, as in the grid suite).

import "@glideapps/glide-data-grid/dist/index.css";
import {
  type CustomCell,
  type CustomRenderer,
  DataEditor,
  type DataEditorRef,
  type DrawCellCallback,
  type GridCell,
  GridCellKind,
  type GridColumn,
  type Item,
} from "@glideapps/glide-data-grid";
import {
  createColumnHelper,
  type ReactTable,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { encodedCategory, rowView, table } from "herceg";
import { createGrid, createGridModel, sparklineCell } from "herceg/grid";
import {
  createContext,
  memo,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { checkedFrame, droppedFrames, nextFrame, refreshInterval, settle } from "../frames.ts";
import {
  BOX,
  COLUMN,
  ends,
  KEYS,
  KeyIndex,
  lastOfPath,
  lastOfPoints,
  makeSeries,
  POINTS,
  type Series,
  svgPath,
  tick,
} from "./series.ts";

const WIDTH = 1200;
const HEIGHT = 600;
const HEADER = 32;
const ROW = 28;
const OVERSCAN = 10;

/** A mounted grid, as the harness drives it. */
interface Mounted {
  readonly element: HTMLElement;
  /** False for Herceg's grid with the trend column empty, whose frames are not checked. */
  readonly sparklines: boolean;
  scrollTo(top: number): void;
  /** Each row in view at offset `top`'s line's last point as drawn, by row; undefined for a row not drawn there. */
  drawn(top: number, rows: readonly number[]): ((readonly [number, number] | null) | undefined)[];
  /** Takes in the series' rows from `from` on (a tick's). */
  append(from: number): void;
  destroy(): void;
}

let series: Series | null = null;
/** What frames are checked against: the series' keys, kept by the harness. */
let reference: KeyIndex | null = null;
let mounted: Mounted | null = null;
let ratio = 1;

function box(): HTMLElement {
  const element = document.createElement("div");
  element.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;position:relative;font:13px Arial,sans-serif`;
  document.body.append(element);
  return element;
}

// Herceg

function mountHerceg(element: HTMLElement, data: Series, sparklines = true): Mounted {
  const length = data.length;
  // Read in place: the table copies them as it is first appended to.
  const points = table({
    service: encodedCategory(data.key.subarray(0, length), data.names),
    time: data.x.subarray(0, length),
    latency: data.y.subarray(0, length),
  });
  const model = createGridModel({
    data: rowView(
      table({
        id: Float64Array.from({ length: KEYS }, (_, k) => k),
        service: encodedCategory(
          Int32Array.from({ length: KEYS }, (_, k) => k),
          data.names,
        ),
      }),
    ),
    columns: [
      { field: "id", width: 80 },
      { field: "service", width: 120 },
      sparklines
        ? {
            id: "trend",
            width: COLUMN,
            cell: sparklineCell({ data: points, key: "service", x: "time", y: "latency" }),
          }
        : { id: "trend", width: COLUMN, text: [""] },
    ],
  });
  const grid = createGrid(element, { model, ariaLabel: "Series" });
  const scroller = grid.root.querySelector<HTMLElement>(".hg-scroller")!;
  return {
    element,
    sparklines,
    scrollTo: (top) => {
      scroller.scrollTop = top;
    },
    drawn(_top, rows) {
      const shown = new Map<number, HTMLElement>();
      for (const row of grid.root.querySelectorAll<HTMLElement>(".hg-body [role=row]"))
        shown.set(Number(row.getAttribute("aria-rowindex")) - 2, row);
      return rows.map((row) => {
        const cell = shown.get(row)?.querySelector('[aria-colindex="3"] .hg-spark-line');
        return cell ? lastOfPath(cell.getAttribute("d")) : undefined;
      });
    },
    append(from) {
      const to = data.length;
      points.append({
        service: Array.from(data.key.subarray(from, to), (k) => data.names[k]!),
        time: data.x.slice(from, to),
        latency: data.y.slice(from, to),
      });
    },
    destroy() {
      grid.destroy();
      model.dispose();
    },
  };
}

// TanStack Table

interface KeyRow {
  readonly id: number;
  readonly service: string;
}

const features = tableFeatures({});
type Table = ReactTable<typeof features, KeyRow>;
const helper = createColumnHelper<typeof features, KeyRow>();
const WIDTHS = [80, 120, COLUMN];
/** The series' version: a key's sparkline draws again as it moves. */
const Version = createContext(0);

/** A key's sparkline, worked out by the adapter: memoized per key and data version. */
const Spark = memo(function Spark({ index, k }: { index: KeyIndex; k: number }) {
  const version = useContext(Version);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the version says the index changed.
  const d = useMemo(() => svgPath(index.points(k, ratio)), [index, k, version]);
  return (
    <svg className="tt-spark" width={BOX.width} height={BOX.height} aria-hidden="true">
      <path d={d} />
    </svg>
  );
});

const TT_CSS = `
.tt-grid{background:#fff;color:#181d1f}
.tt-grid table{display:grid;border-collapse:collapse}
.tt-grid thead{display:grid;position:sticky;top:0;z-index:1;background:#f8f8f8}
.tt-grid tr{display:flex}
.tt-grid th,.tt-grid td{display:flex;flex:none;box-sizing:border-box;padding:0 8px;overflow:hidden;white-space:nowrap;align-items:center;position:relative}
.tt-grid th{height:${HEADER}px;font-weight:600;border-bottom:1px solid #ddd}
.tt-grid td{height:${ROW}px;border-bottom:1px solid #eee}
.tt-spark{position:absolute;left:8px;top:4px;overflow:hidden}
.tt-spark path{fill:none;stroke:#2196f3;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
`;

function TanStackGrid({
  rows,
  index,
  scroller,
}: {
  rows: KeyRow[];
  index: KeyIndex;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("id", { header: "id", cell: (info) => String(info.getValue()) }),
        helper.accessor("service", { header: "service", cell: (info) => info.getValue() }),
        helper.display({
          id: "trend",
          header: "trend",
          cell: (info) => <Spark index={index} k={info.row.original.id} />,
        }),
      ]),
    [index],
  );
  const table: Table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (row) => String(row.id),
  });
  const shown = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: OVERSCAN,
  });
  return (
    <div
      ref={scroller}
      className="tt-grid"
      style={{ width: WIDTH, height: HEIGHT, overflow: "auto", position: "relative" }}
    >
      <table>
        <thead>
          <tr>
            {table.getHeaderGroups()[0]!.headers.map((header, c) => (
              <th key={header.id} style={{ width: WIDTHS[c] }}>
                <table.FlexRender header={header} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          style={{ display: "grid", height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = shown[item.index]!;
            return (
              <tr
                key={row.id}
                data-id={row.id}
                style={{ position: "absolute", transform: `translateY(${item.start}px)` }}
              >
                {row.getAllCells().map((cell, c) => (
                  <td key={cell.id} data-field={c} style={{ width: WIDTHS[c] }}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function mountTanStack(element: HTMLElement, data: Series): Mounted {
  if (!document.getElementById("tt-spark-style")) {
    const style = document.createElement("style");
    style.id = "tt-spark-style";
    style.textContent = TT_CSS;
    document.head.append(style);
  }
  // The adapter's index of each key's rows, made as the grid mounts.
  const index = new KeyIndex(data);
  const rows: KeyRow[] = data.names.map((service, id) => ({ id, service }));
  const scroller: RefObject<HTMLDivElement | null> = { current: null };
  const root = createRoot(element);
  let version = 0;
  const render = () =>
    flushSync(() =>
      root.render(
        <Version.Provider value={version}>
          <TanStackGrid rows={rows} index={index} scroller={scroller} />
        </Version.Provider>,
      ),
    );
  render();
  return {
    element,
    sparklines: true,
    scrollTo: (top) => {
      scroller.current!.scrollTop = top;
    },
    drawn(_top, wanted) {
      const shown = new Map<number, Element>();
      for (const row of element.querySelectorAll("tbody tr[data-id]"))
        shown.set(Number(row.getAttribute("data-id")), row);
      return wanted.map((row) => {
        const path = shown.get(row)?.querySelector('td[data-field="2"] path');
        return path ? lastOfPath(path.getAttribute("d")) : undefined;
      });
    },
    append() {
      index.update();
      version++;
      render();
    },
    destroy: () => root.unmount(),
  };
}

// Glide Data Grid

type SparkCell = CustomCell<{ kind: "spark"; points: readonly number[] }>;
type KeyCell = GridCell & {
  readonly rowId: number;
  /** The data's version its points are of. */
  readonly version?: number;
  readonly last?: readonly [number, number] | null;
};

const SPARK: CustomRenderer<SparkCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell): cell is SparkCell => (cell.data as { kind?: string }).kind === "spark",
  draw(args, cell) {
    const { ctx, rect } = args;
    const points = cell.data.points;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + 8, rect.y + 4, BOX.width, BOX.height);
    ctx.clip();
    ctx.beginPath();
    let run = 0;
    for (let i = 0; i < points.length; i += 2) {
      const px = points[i]!;
      if (Number.isNaN(px)) {
        run = 0;
        continue;
      }
      const x = rect.x + 8 + px;
      const y = rect.y + 4 + points[i + 1]!;
      if (run === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      // A lone point, as a dot its round caps paint.
      if (run === 0 && (i + 2 >= points.length || Number.isNaN(points[i + 2]!)))
        ctx.lineTo(x + 0.02, y);
      run++;
    }
    ctx.strokeStyle = "#2196f3";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  },
};
const RENDERERS = [SPARK] as unknown as readonly CustomRenderer[];

interface Region {
  version: number;
  y: number;
  ty: number;
}

function GlideGrid({
  version,
  getCellContent,
  editor,
  region,
  drawCell,
}: {
  version: number;
  getCellContent: (cell: Item) => GridCell;
  editor: RefObject<DataEditorRef | null>;
  region: RefObject<Region | null>;
  drawCell: DrawCellCallback;
}) {
  const [shown, setShown] = useState<{ y: number; ty: number } | null>(null);
  // Runs after Glide's own layout effects, in which it draws this commit.
  useLayoutEffect(() => {
    if (shown) region.current = { version, ...shown };
  });
  const columns: GridColumn[] = useMemo(
    () => [
      { id: "id", title: "id", width: 80 },
      { id: "service", title: "service", width: 120 },
      { id: "trend", title: "trend", width: COLUMN },
    ],
    [],
  );
  return (
    <DataEditor
      ref={editor}
      width={WIDTH}
      height={HEIGHT}
      columns={columns}
      rows={KEYS}
      getCellContent={getCellContent}
      rowHeight={ROW}
      headerHeight={HEADER}
      customRenderers={RENDERERS}
      smoothScrollY
      rowMarkers="none"
      drawCell={drawCell}
      onVisibleRegionChanged={(range, _tx, ty) => setShown({ y: range.y, ty })}
    />
  );
}

function mountGlide(element: HTMLElement, data: Series): Mounted {
  const index = new KeyIndex(data);
  const editor: RefObject<DataEditorRef | null> = { current: null };
  const region: RefObject<Region | null> = { current: null };
  let version = 0;
  /** Each key's points as of a version: Glide asks for cells whenever it draws them. */
  const cached = new Map<number, { version: number; points: readonly number[] }>();
  /** What Glide last drew in each row's sparkline: its key, the data's version, and its line's last point. */
  const painted = new Map<
    number,
    { id: number; version: number; last: readonly [number, number] | null }
  >();
  const drawCell: DrawCellCallback = (args, drawContent) => {
    const cell = args.cell as KeyCell;
    if (args.col === 2)
      painted.set(args.row, {
        id: cell.rowId,
        version: cell.version ?? -1,
        last: cell.last ?? null,
      });
    drawContent();
  };
  const root = createRoot(element);
  const render = () => {
    const at = version;
    const getCellContent = ([col, row]: Item): GridCell => {
      if (col < 2) {
        const text = col === 0 ? String(row) : data.names[row]!;
        return {
          kind: GridCellKind.Text,
          data: text,
          displayData: text,
          allowOverlay: false,
          readonly: true,
        };
      }
      let held = cached.get(row);
      if (held?.version !== at) {
        held = { version: at, points: index.points(row, ratio) };
        cached.set(row, held);
      }
      const cell: SparkCell & KeyCell = {
        kind: GridCellKind.Custom,
        data: { kind: "spark", points: held.points },
        copyData: "",
        allowOverlay: false,
        readonly: true,
        rowId: row,
        version: at,
        last: lastOfPoints(held.points),
      };
      return cell;
    };
    flushSync(() =>
      root.render(
        <GlideGrid
          version={at}
          getCellContent={getCellContent}
          editor={editor}
          region={region}
          drawCell={drawCell}
        />,
      ),
    );
  };
  render();
  const scroller = () => element.querySelector<HTMLElement>(".dvn-scroller")!;
  return {
    element,
    sparklines: true,
    scrollTo: (top) => {
      scroller().scrollTop = top;
    },
    drawn(top, rows) {
      const shown = region.current;
      // Not drawn yet, drawn before the latest change, or drawn at another offset
      // (the region Glide last drew starts at row `y`, `ty` pixels in, as the grid suite reads it).
      if (!shown || shown.version !== version || Math.abs(shown.y * ROW - shown.ty - top) > 0.5)
        return rows.map(() => undefined);
      return rows.map((row) => {
        const cell = painted.get(row);
        return cell?.id === row && cell.version === version ? cell.last : undefined;
      });
    },
    append() {
      index.update();
      version++;
      cached.clear();
      render();
    },
    destroy: () => root.unmount(),
  };
}

const MOUNTS: Record<string, (element: HTMLElement, data: Series) => Mounted> = {
  herceg: mountHerceg,
  // For memory alone: Herceg's grid with the trend column empty.
  "herceg-empty": (element, data) => mountHerceg(element, data, false),
  "tanstack-table": mountTanStack,
  glide: mountGlide,
};

/** Rows whose cells cross the body's viewport at offset `top`. */
function rowsAt(top: number): number[] {
  const first = Math.floor(top / ROW);
  const last = Math.min(KEYS - 1, Math.ceil((top + HEIGHT - HEADER) / ROW) - 1);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** "" when every row in view at `top` shows its series as it is now, else what does not. */
function check(top: number): string {
  const rows = rowsAt(top);
  const drawn = mounted!.drawn(top, rows);
  for (let i = 0; i < rows.length; i++) {
    const got = drawn[i];
    if (got === undefined) return `row ${rows[i]} not drawn`;
    const want = reference!.expected(rows[i]!);
    if (!ends(got, want))
      return `row ${rows[i]} ends at ${JSON.stringify(got)}, not ${JSON.stringify(want)}`;
  }
  return "";
}

/** Milliseconds from `start` to the first frame in which `top` is shown correctly. */
async function correct(top: number, start: number): Promise<number> {
  if (!mounted!.sparklines) return (await nextFrame()) - start;
  let problem = "";
  for (;;) {
    const frame = await checkedFrame(() => check(top));
    if (frame.observed && frame.value === "") return frame.time - start;
    problem = frame.value ?? problem;
    if (performance.now() - start > 30_000) throw new Error(`incorrect: ${problem}`);
  }
}

let top = 0;
/** The next tick's time: ticks go on from the series' last point. */
let next = POINTS;

export const sparkBench = {
  /** Makes the series (untimed). */
  prepare(gaps: boolean, seed = 1) {
    series = makeSeries(seed, gaps);
    reference = new KeyIndex(series);
    ratio = window.devicePixelRatio || 1;
    next = POINTS;
  },

  /** Mounts `library`'s grid: milliseconds to the first correct frame. */
  async mount(library: string): Promise<number> {
    await settle();
    const element = box();
    top = 0;
    const start = performance.now();
    mounted = MOUNTS[library]!(element, series!);
    return correct(0, start);
  },

  /** Scrolls to `to` (px): milliseconds to the first correct frame. */
  async step(to: number): Promise<number> {
    await settle();
    top = to;
    const start = performance.now();
    mounted!.scrollTo(to);
    return correct(to, start);
  },

  /**
   * Scrolls down `speed` rows a second for `ms`, the offset set every frame
   * (vsync on): frames, those not showing every row in view as it is
   * (incomplete), and those missed (dropped).
   */
  async trace(speed: number, ms: number) {
    await settle();
    const refresh = await refreshInterval();
    const from = top;
    const times: number[] = [];
    let incomplete = 0;
    const start = performance.now();
    for (;;) {
      const elapsed = performance.now() - start;
      if (elapsed >= ms) break;
      const at = Math.min((KEYS - 21) * ROW, from + (elapsed / 1000) * speed * ROW);
      mounted!.scrollTo(at);
      const frame = await checkedFrame(() => check(at));
      times.push(frame.time);
      if (!frame.observed || frame.value !== "") incomplete++;
    }
    const intervals = times.slice(1).map((time, i) => time - times[i]!);
    top = 0;
    mounted!.scrollTo(0);
    await correct(0, performance.now());
    return {
      frames: times.length,
      incomplete,
      dropped: droppedFrames(intervals, refresh),
      intervals,
      refresh,
    };
  },

  /**
   * Appends a point to every key at `rateHz` for `ms`, the grid at the top
   * (vsync on): each tick's latency to the first frame showing it, ticks a
   * later one overtook before they showed, and frames missed.
   */
  async stream(rateHz: number, ms: number) {
    await settle();
    const refresh = await refreshInterval();
    const latencies: number[] = [];
    const times: number[] = [];
    let overtaken = 0;
    let pending: number | null = null;
    let ticks = 0;
    const data = series!;
    let running = true;
    const start = performance.now();
    const timer = setInterval(() => {
      if (!running) return;
      const from = data.length;
      tick(data, next++);
      reference!.update();
      if (pending !== null) overtaken++;
      pending = performance.now();
      mounted!.append(from);
      ticks++;
    }, 1000 / rateHz);
    try {
      while (performance.now() - start < ms) {
        // With the ticks the check saw: one landing after it is not in this frame.
        const frame = await checkedFrame(() => [check(0), ticks] as const);
        times.push(frame.time);
        if (pending !== null && frame.value?.[0] === "" && frame.value[1] === ticks) {
          latencies.push(frame.time - pending);
          pending = null;
        }
      }
    } finally {
      running = false;
      clearInterval(timer);
    }
    if (pending !== null) latencies.push(await correct(0, pending));
    const intervals = times.slice(1).map((t, i) => t - times[i]!);
    return {
      ticks,
      latencies,
      overtaken,
      frames: times.length,
      dropped: droppedFrames(intervals, refresh),
      refresh,
    };
  },

  /** Scrolls to `screens` places down the grid and back, each shown correctly (for memory). */
  async visit(screens: number) {
    for (let i = 1; i <= screens; i++)
      await sparkBench.step(Math.min(i * (HEIGHT - HEADER), (KEYS - 21) * ROW));
    await sparkBench.step(0);
  },

  domNodes: () => mounted!.element.querySelectorAll("*").length,

  destroy() {
    mounted?.destroy();
    mounted?.element.remove();
    mounted = null;
  },

  /** Lets go of the series, for a heap without it. */
  drop() {
    series = null;
    reference = null;
  },
};

declare global {
  interface Window {
    sparkBench: typeof sparkBench;
  }
}
window.sparkBench = sparkBench;
