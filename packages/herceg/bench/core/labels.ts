// Labels: series labels placed as rows arrive, the label solver, and text kept inside the chart.

import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { type Table, table } from "../../src/data/table.ts";
import { type AttachedLabel, placeAttached } from "../../src/layout/attached.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { labelPaint } from "../../src/marks/labels.ts";
import { line } from "../../src/marks/line.ts";
import type { Frame } from "../../src/marks/mark.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import type { LabelsGeometry } from "../../src/scene/scene.ts";
import { LIGHT } from "../../src/theme.ts";
import { measure, pageMeasurer } from "./shared.ts";

export async function run(): Promise<void> {
  /** Checks, before timing, that `model` draws at least `count` labels, and leaders where asked. */
  function drawsLabels(model: ChartModel, count: number, leaders: boolean): void {
    const marks = model.scene(estimateText).panels.flatMap((panel) => panel.marks);
    const labels = marks.reduce(
      (sum, g) => sum + (g.kind === "labels" ? (g as LabelsGeometry).items.length : 0),
      0,
    );
    if (labels < count || leaders !== marks.some((g) => g.kind === "segments"))
      throw new Error(`expected ${count} labels${leaders ? " and leaders" : ""}; drew ${labels}`);
  }

  // Labels a panel places as a row arrives each frame: A6's 30 lines of
  // 3,000 points converging, named outside the plot, moved apart with
  // leaders (against the same lines unlabelled); and 200 event rules whose
  // labels keep apart as one overlap group, with leaders.
  const SERIES_NAMES = Array.from({ length: 30 }, (_, k) => `s${k}`);
  const converging = (k: number, t: number) =>
    500 + (k - 14.5) * 30 * Math.max(0.03, 1 - t / 3000) + 4 * Math.sin(k * 1.7 + t / 3);
  for (const labelled of [false, true]) {
    const ends = table({
      t: Float64Array.from({ length: 3000 }, (_, t) => t),
      ...Object.fromEntries(
        SERIES_NAMES.map((name, k) => [
          name,
          Float64Array.from({ length: 3000 }, (_, t) => converging(k, t)),
        ]),
      ),
    });
    const model = new ChartModel(
      {
        y: { domain: [0, 1000] },
        legend: false,
        marks: [
          line(ends, {
            x: "t",
            // Columns made in a loop: their names are not known to the type.
            y: SERIES_NAMES as never,
            ...(labelled && { labels: { at: "last", place: { outside: true }, leader: true } }),
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.setSize(1100, 640, 1);
    drawsLabels(model, labelled ? 30 : 0, labelled);
    let next = 3000;
    measure(
      `labels: 30 lines, a row arriving${labelled ? ", named with leaders" : ", unlabelled"}`,
      () => {
        ends.appendRow({
          t: next,
          ...Object.fromEntries(SERIES_NAMES.map((name, k) => [name, converging(k, next)])),
        });
        ends.dropFirst(1);
        next++;
        model.scene(estimateText);
      },
    );
  }
  // The same 30 lines under names too long for a room of 64 px, a row
  // arriving each frame: measured, the names whole and their track as wide
  // as the longest; in the room, each shortened as it is drawn.
  const LONG_NAMES = SERIES_NAMES.map((name) => `${name}-checkout-service-eu-west`);
  for (const room of [undefined, 64] as const) {
    const ends = table({
      t: Float64Array.from({ length: 3000 }, (_, t) => t),
      ...Object.fromEntries(
        LONG_NAMES.map((name, k) => [
          name,
          Float64Array.from({ length: 3000 }, (_, t) => converging(k, t)),
        ]),
      ),
    });
    const model = new ChartModel(
      {
        y: { domain: [0, 1000] },
        legend: false,
        marks: [
          line(ends, {
            x: "t",
            y: LONG_NAMES as never,
            labels: { at: "last", place: { outside: true, ...(room && { room }) }, leader: true },
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.setSize(1100, 640, 1);
    drawsLabels(model, 30, true);
    let next = 3000;
    measure(
      `labels: 30 long names, a row arriving${room ? ", shortened to a room" : ", measured"}`,
      () => {
        ends.appendRow({
          t: next,
          ...Object.fromEntries(LONG_NAMES.map((name, k) => [name, converging(k, next)])),
        });
        ends.dropFirst(1);
        next++;
        model.scene(estimateText);
      },
    );
  }
  // Labels at the last observation in view while 30 series stream, and where
  // the lines cross the view's end: one mark, a row arriving and the first
  // dropped each frame, the view following 500 rows behind the newest (panned
  // back while streaming).
  for (const at of ["visible-end", "view-end"] as const) {
    const live = table({
      t: Float64Array.from({ length: 3000 }, (_, t) => t),
      ...Object.fromEntries(
        SERIES_NAMES.map((name, k) => [
          name,
          Float64Array.from({ length: 3000 }, (_, t) => converging(k, t)),
        ]),
      ),
    });
    const model = new ChartModel(
      {
        y: { domain: [0, 1000] },
        legend: false,
        marks: [
          line(live, {
            x: "t",
            y: SERIES_NAMES as never,
            labels: { at, place: { outside: true }, leader: true },
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.setSize(1100, 640, 1);
    let next = 3000;
    model.applyViews(model.viewChanges([next - 2500, next - 500]));
    drawsLabels(model, 30, true);
    const where =
      at === "view-end" ? "where they cross the view's end" : "at their last rows in view";
    measure(`labels: 30 lines ${where}, a row arriving, the view following`, () => {
      live.appendRow({
        t: next,
        ...Object.fromEntries(SERIES_NAMES.map((name, k) => [name, converging(k, next)])),
      });
      live.dropFirst(1);
      next++;
      model.applyViews(model.viewChanges([next - 2500, next - 500]));
      model.scene(estimateText);
    });
  }
  // Labels drawn again on unchanged data, the view moving between two
  // places: a line along y of 1M rows whose points are copied each frame
  // (breaks on its value axis) and `where` keeps one; and a series field's
  // stack under continuity, 1M rows at one position just before the view.
  {
    const n = 1_000_000;
    const rows = table({
      t: time(Float64Array.from({ length: n }, (_, i) => i)),
      p: Float64Array.from({ length: n }, (_, i) => i),
    });
    const model = new ChartModel(
      {
        x: { breaks: timeBreaks([{ from: n / 2, to: n / 2 + 10 }]) },
        legend: false,
        marks: [
          line(rows, {
            x: "t",
            y: "p",
            orient: "y",
            where: col("p").lt(1),
            labels: { at: "last" },
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.setSize(800, 400, 1);
    let moved = false;
    measure("labels: a line along y of 1M copied points, `where` keeping one, drawn again", () => {
      moved = !moved;
      model.applyViews(model.viewChanges({ y: moved ? [0, n] : [0, n - 1] }));
      model.scene(estimateText);
    });
  }
  {
    const n = 1_000_000;
    const rows = table({
      t: Float64Array.from({ length: n + 2 }, (_, i) => (i < n ? 1 : i - n + 2)),
      v: Float64Array.from({ length: n + 2 }, () => 1),
      g: Array.from({ length: n + 2 }, () => "a"),
    });
    const model = new ChartModel(
      {
        y: { domain: [0, 2] },
        legend: false,
        marks: [
          area(rows, {
            x: "t",
            y: "v",
            series: "g",
            stack: true,
            continuity: { maxGap: 100 },
            labels: { at: "visible-start" },
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    model.setSize(800, 400, 1);
    let moved = false;
    measure("labels: a stack's 1M rows at one position before the view, drawn again", () => {
      moved = !moved;
      model.applyViews(model.viewChanges([moved ? 1.5 : 1.6, 2.5]));
      model.scene(estimateText);
    });
  }
  // A6 as its application draws it: a line mark per series, and an update
  // each tick moving the x domain with the window (a new layout, which starts
  // from the room the labels took).
  for (const labelled of [false, true]) {
    const window = table(
      {
        t: Float64Array.from({ length: 360 }, (_, t) => t),
        ...Object.fromEntries(
          SERIES_NAMES.map((name, k) => [
            name,
            Float64Array.from({ length: 360 }, (_, t) => converging(k, t)),
          ]),
        ),
      },
      { maxRows: 360 },
    );
    const marks = SERIES_NAMES.map((name) =>
      line(window, {
        x: "t",
        y: name as never,
        ...(labelled && { labels: { at: "visible-end", place: { outside: true }, leader: true } }),
      }),
    );
    const config = (t: number) => ({
      x: { domain: [t - 359, t] as [number, number] },
      y: { domain: [0, 1000] as [number, number] },
      legend: false as const,
      marks,
    });
    let next = 360;
    const model = new ChartModel(config(next - 1), undefined, staticCompilers());
    model.setSize(1100, 640, 1);
    drawsLabels(model, labelled ? 30 : 0, labelled);
    measure(
      `labels: 30 line marks, the view following a row${labelled ? ", named with leaders" : ", unlabelled"}`,
      () => {
        window.appendRow({
          t: next,
          ...Object.fromEntries(SERIES_NAMES.map((name, k) => [name, converging(k, next)])),
        });
        model.update(config(next++));
        model.scene(estimateText);
      },
    );
  }
  // The series-label solver alone, crowded: 300 labels in one column outside
  // a 600 px plot (half left out), and 48 inside it meeting only some of the
  // others.
  const solverPlot = { x: 40, y: 10, width: 600, height: 600 };
  const solverFrame = {
    plot: solverPlot,
    measure: estimateText,
    theme: LIGHT,
    outside: [30, 650],
  } as unknown as Frame;
  const crowd = (count: number, outside: boolean): AttachedLabel[] => {
    const owner = { key: "labels", leader: undefined, room: [0, 0] as [number, number] };
    return Array.from({ length: count }, (_, k) => ({
      key: `s${k}`,
      at: {
        panel: "",
        mark: 0,
        series: `s${k}`,
        row: 0,
        value: 0,
        x: outside ? 640 : 60 + ((k * 37) % 500),
        y: 300 + ((k * 7919) % 101) / 5,
        visible: true,
      },
      text: `series ${k}`,
      paint: labelPaint(LIGHT, "#333333", undefined),
      place: { outside },
      halo: undefined,
      overlap: "move",
      priority: k % 3,
      owner,
      color: "#333333",
    }));
  };
  const column300 = crowd(300, true);
  const partial48 = crowd(48, false);
  measure("labels: solve 300 series labels in a column, half left out", () =>
    placeAttached(column300, solverFrame, GUIDE_KIT),
  );
  measure("labels: solve 48 series labels meeting only some of the others", () =>
    placeAttached(partial48, solverFrame, GUIDE_KIT),
  );
  // Mixed policies at their worst: 60 shown labels as wide as the plot (walls
  // every group meets) over 120 moving ones in 60 groups of two apart along x.
  const walls = crowd(60, false).map((label, k) => ({
    ...label,
    at: { ...label.at, x: 40, y: 20 + k * 9.5 },
    text: "w".repeat(80),
    overlap: "show" as const,
  }));
  const twos = crowd(120, false).map((label, k) => ({
    ...label,
    at: { ...label.at, x: 44 + Math.floor(k / 2) * 9.5, y: 290 + (k % 2) },
    text: "a",
  }));
  const mixed = [...walls, ...twos];
  measure("labels: solve 120 series labels in 60 groups among 60 wide shown ones", () =>
    placeAttached(mixed, solverFrame, GUIDE_KIT),
  );

  const deploys = table({
    t: Float64Array.from({ length: 200 }, (_, i) => i * 5 + (i % 3)),
    name: Array.from({ length: 200 }, (_, i) => `deploy ${i}`),
  });
  const grouped = new ChartModel(
    {
      x: { domain: [0, 1000] },
      y: { domain: [0, 1] },
      marks: [
        rule(deploys, {
          x: "t",
          label: { field: "name", overlap: "move", overlapGroup: "events", leader: true },
        }),
      ],
    },
    undefined,
    staticCompilers(),
  );
  grouped.setSize(1100, 400, 1);
  drawsLabels(grouped, 1, true);
  measure("labels: 200 rule labels of an overlap group, moved apart", () =>
    grouped.scene(estimateText),
  );

  // Text kept inside the chart measures each label it draws (a page's
  // measurer's hit for a string it measured before): 200 notes at their
  // points, none near the chart's edge, a scene drawn again; and 200 notes
  // streaming, a row with a new string arriving and the first dropped each
  // scene, which measures that string.
  {
    const notesOf = () =>
      table({
        x: Float64Array.from({ length: 200 }, (_, i) => i),
        y: Float64Array.from({ length: 200 }, (_, i) => 20 + ((i * 37) % 60)),
        note: Array.from({ length: 200 }, (_, i) => `note ${i}`),
      });
    const notesChart = (notes: Table, x?: { domain: [number, number] }) => {
      const model = new ChartModel(
        {
          ...(x && { x }),
          y: { domain: [0, 100] },
          marks: [text(notes as never, { x: "x", y: "y", label: { field: "note" } } as never)],
        },
        undefined,
        staticCompilers(),
      );
      model.setSize(1100, 400, 1);
      return model;
    };
    const measureText = pageMeasurer();
    const still = notesChart(notesOf() as unknown as Table, { domain: [-20, 220] });
    measure("text: 200 notes shown, none near the chart's edge", () => still.scene(measureText));
    const live = notesOf();
    const streaming = notesChart(live as unknown as Table);
    let next = 200;
    measure("text: 200 notes streaming, a new string each scene", () => {
      live.appendRow({ x: next, y: 20 + ((next * 37) % 60), note: `note ${next}` });
      live.dropFirst(1);
      next++;
      streaming.scene(measureText);
    });
  }
}
