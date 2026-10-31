// The chart's revision and the causes its events carry: every change of
// options, data, or state applies, counts, and reports itself with the
// count; frames say which revision they drew, and input events the
// revision of the frame they acted on.

import "./interactive.ts";
import { describe, expect, it } from "vitest";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore, selectRows } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { grid } from "../../src/layout.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { panels } from "../../src/model/panels.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { frame, heard, key, mount, mountNow, pointer, within } from "./interaction/helpers.ts";

function sales() {
  return table({
    region: ["Europe", "Europe", "Asia"],
    country: ["France", "Spain", "Japan"],
    sales: [3, 2, 4],
  });
}

function data() {
  return table({
    t: Float64Array.from({ length: 10 }, (_, i) => i),
    a: Float64Array.from({ length: 10 }, (_, i) => i * 2),
    b: Float64Array.from({ length: 10 }, (_, i) => 20 - i),
  });
}

describe("chart revision", () => {
  it("counts changes of options, data, and state, each reported with the count", async () => {
    const rows = data();
    const marks = [line(rows, { x: "t", y: ["a", "b"] })];
    const chart = await mount({ marks, interaction: { brush: "x" } });
    const renders = heard(chart, "render");
    const selects = heard(chart, "select");
    const views = heard(chart, "viewport");
    const shown = heard(chart, "visibility");
    let at = chart.revision;

    chart.select([2, 4]);
    expect(chart.revision).toBe(++at);
    expect(selects.at(-1)).toMatchObject({ cause: "api", revision: at });

    chart.setViewport({ x: [1, 6] });
    expect(chart.revision).toBe(++at);
    expect(views.at(-1)).toMatchObject({ cause: "api", revision: at });

    const [series] = chart.getLegend();
    chart.setVisibility(series!.key, false);
    expect(chart.revision).toBe(++at);
    expect(shown.at(-1)).toMatchObject({ cause: "api", revision: at });
    // The same state again changes nothing, and counts nothing.
    chart.setVisibility(series!.key, false);
    expect(chart.revision).toBe(at);

    rows.append({ t: [10], a: [1], b: [2] });
    expect(chart.revision).toBe(++at);
    chart.update({ marks, title: "Rows" });
    expect(chart.revision).toBe(++at);

    // The frame draws everything so far, and says so.
    chart.render();
    expect(renders.at(-1)).toEqual({ revision: at });
  });

  it("renders a selection drawn over the last frame with its revision", async () => {
    const chart = await mount({
      marks: [line(data(), { x: "t", y: ["a", "b"] })],
      interaction: { brush: "x" },
    });
    const renders = heard(chart, "render");
    chart.select([2, 4]);
    await chart.loading;
    await frame();
    await frame();
    expect(renders.at(-1)).toEqual({ revision: chart.revision });
    // Nothing changed since: no frame renders again.
    const count = renders.length;
    await frame();
    expect(renders).toHaveLength(count);
  });

  it("says which revision is on screen: none until a frame draws, then what render reported", async () => {
    const refused = mountNow({
      marks: [line(data(), { x: "t", y: "a" })],
      animation: { duration: -1 },
      onError: () => {},
    });
    expect(refused.drawnRevision).toBeUndefined();
    const chart = mountNow({
      marks: [line(data(), { x: "t", y: "a" })],
      interaction: { brush: "x" },
    });
    expect(chart.drawnRevision).toBe(chart.revision);
    const renders = heard(chart, "render");
    chart.select([2, 4]);
    // Selected, not yet drawn.
    expect(chart.drawnRevision).toBe(chart.revision - 1);
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    await frame();
    await frame();
    expect(chart.drawnRevision).toBe(chart.revision);
    expect(renders.at(-1)).toEqual({ revision: chart.drawnRevision });
  });

  it("says a frame that failed to draw new data is not on screen, whatever frames follow", async () => {
    const rows = table({ t: [0, 1], v: [1, 2], kind: ["a", "a"], g: ["p", "p"] });
    const chart = await mount({
      marks: [
        line(rows, { x: "t", y: "v", series: "g", style: { by: { field: "kind", map: {} } } }),
      ],
      onError: () => {},
    });
    await frame();
    const drawn = chart.drawnRevision;
    const renders = heard(chart, "render");
    // A row of another kind in series "p", which a style map refuses.
    rows.append({ t: [2], v: [3], kind: ["b"], g: ["p"] });
    chart.render();
    // The frame scheduled with the append draws nothing new.
    await frame();
    await frame();
    expect(chart.drawnRevision).toBe(drawn);
    expect(renders).toEqual([]);
  });

  it("renders selections again once a frame draws after a failure, with no change of data", async () => {
    // A mark that cannot draw a view starting past 5.
    const picky = custom({
      draw({ domain }) {
        if (domain.x[0] > 5) throw new Error("not past 5");
      },
    });
    const chart = await mount({
      marks: [line(data(), { x: "t", y: "a" }), picky],
      interaction: { brush: "x" },
      onError: () => {},
    });
    chart.select([1, 2]);
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    await frame();
    chart.setViewport({ x: [6, 9] });
    await frame();
    chart.setViewport({ x: [0, 9] });
    await frame();
    expect(chart.drawnRevision).toBe(chart.revision);
    // A selection drawn over that frame renders with its revision.
    chart.select([2, 4]);
    await frame();
    await frame();
    expect(chart.drawnRevision).toBe(chart.revision);
    // Refused options keep the chart as it was: selections still render.
    chart.update({ animation: { duration: -1 } });
    chart.select([3, 5]);
    await frame();
    await frame();
    expect(chart.drawnRevision).toBe(chart.revision);
  });

  it("counts another writer's row selection once, and the chart's own with its selection", async () => {
    const rows = data();
    const store = selectionStore(rows);
    const chart = await mount({
      marks: [line(rows, { x: "t", y: "a" })],
      interaction: { brush: "x" },
      rowSelection: rowSelection({ store, channel: "focus" }),
    });
    const changes = heard(chart, "rowSelection");
    const selects = heard(chart, "select");
    const renders = heard(chart, "render");
    let at = chart.revision;
    store.set("focus", selectRows(new RowSet(rows).add(1)));
    expect(chart.revision).toBe(++at);
    expect(changes.at(-1)).toMatchObject({ cause: "sync", revision: at });
    await frame();
    await frame();
    expect(renders.at(-1)).toEqual({ revision: at });
    // The chart's selection writes the rows it covers: one count for both.
    chart.select([2, 4]);
    expect(chart.revision).toBe(++at);
    expect(changes.at(-1)).toMatchObject({ cause: "api", revision: at });
    expect(selects.at(-1)).toMatchObject({ cause: "api", revision: at });
    // Another writer's rows in place of the brush's: the brush goes as that change.
    store.set("focus", selectRows(new RowSet(rows).add(1)));
    expect(changes.at(-1)).toMatchObject({ cause: "sync", revision: ++at });
    await Promise.resolve();
    expect(chart.selection).toBeNull();
    expect(selects.at(-1)).toMatchObject({ x: null, cause: "sync", revision: ++at });
  });

  it("counts options it applies, not options it refuses", async () => {
    const chart = await mount({ marks: [line(data(), { x: "t", y: "a" })], errorMode: "inline" });
    const at = chart.revision;
    chart.update({ animation: { duration: -1 } });
    expect(chart.revision).toBe(at);
    chart.update({ title: "Applied" });
    expect(chart.revision).toBe(at + 1);
  });

  it("reports what a gesture changed with its cause, and frames before and after", async () => {
    const chart = await mount({
      marks: [line(data(), { x: "t", y: ["a", "b"] })],
      interaction: { brush: "x" },
    });
    const selects = heard(chart, "select");
    const shown = heard(chart, "visibility");
    const [x0, y] = within(chart, "", 0.2, 0.5);
    const [x1] = within(chart, "", 0.6, 0.5);
    pointer(chart, "pointerdown", x0, y);
    pointer(chart, "pointermove", x1, y);
    pointer(chart, "pointerup", x1, y);
    expect(selects.at(-1)).toMatchObject({ cause: "pointer", revision: chart.revision });
    key(chart, "Escape");
    expect(selects.at(-1)).toMatchObject({ x: null, cause: "keyboard" });
    const button = chart.root.querySelector<HTMLButtonElement>("[aria-label=Legend] button");
    // A button pressed from the keyboard clicks with no count; the mouse's counts one.
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(shown.at(-1)).toMatchObject({ cause: "keyboard" });
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(shown.at(-1)).toMatchObject({ cause: "pointer" });
  });

  it("gives input events the revision of the frame they acted on", async () => {
    const rows = data();
    const chart = await mount({ marks: [line(rows, { x: "t", y: "a" })] });
    const hovers = heard(chart, "hover");
    const clicks = heard(chart, "click");
    const drawn = chart.revision;
    const [x, y] = within(chart, "", 0.5, 0.5);
    pointer(chart, "pointermove", x, y);
    await frame();
    expect(hovers.at(-1)).toMatchObject({ cause: "pointer", revision: drawn });
    expect(hovers.at(-1)?.inspection).toBeDefined();
    // Data changed since the frame: a click draws the change first, and acts on that frame.
    rows.append({ t: [10], a: [3], b: [0] });
    expect(chart.revision).toBe(drawn + 1);
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointerup", x, y);
    expect(clicks.at(-1)).toMatchObject({ cause: "pointer", revision: drawn + 1 });
    pointer(chart, "pointerleave", x, y);
    chart.showCursor({ x: 3 });
    await frame();
    expect(hovers.at(-1)).toMatchObject({ cause: "api" });
  });

  it("reports drills with their cause: a click's, a key's, a method's", async () => {
    const tree = table({
      region: ["Europe", "Europe", "Asia"],
      country: ["France", "Spain", "Japan"],
      sales: [3, 2, 4],
    });
    const chart = await mount({
      marks: [treemap(tree, { path: ["region", "country"], value: "sales" })],
      interaction: { zoom: true },
    });
    const drills = heard(chart, "drill");
    chart.setDrillRoot(["Europe"]);
    expect(drills.at(-1)).toMatchObject({ cause: "api", revision: chart.revision });
    key(chart, "0");
    expect(drills.at(-1)).toMatchObject({ key: null, cause: "keyboard" });
    expect(drills.at(-1)?.revision).toBe(chart.revision);
  });

  it("reports roots a frame takes back with the change it drew, whatever listeners drill", async () => {
    const tree = () =>
      table({
        region: ["Europe", "Europe", "Asia"],
        country: ["France", "Spain", "Japan"],
        sales: [3, 2, 4],
      });
    const data = tree();
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: ["a", "b"].map((panel) =>
        treemap(data, { path: ["region", "country"], value: "sales", panel }),
      ),
    });
    const drills: {
      panel: string | undefined;
      key: string | null;
      cause: string;
      revision: number;
    }[] = [];
    let drilled = false;
    chart.on("drill", ({ panels: named, key, cause, revision }) => {
      drills.push({ panel: named?.[0], key, cause, revision });
      // A's listener drills A again, before B's root is reported.
      if (named?.[0] === "a" && cause === "data" && !drilled) {
        drilled = true;
        chart.setDrillRoot(["Asia"], { panel: "a" });
      }
    });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "b" });
    chart.render();
    drills.length = 0;
    // Spain goes: both trees show Europe again, as the data's change.
    data.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    const reset = chart.revision;
    chart.render();
    expect(drills).toEqual([
      { panel: "a", key: '[0,"Europe"]', cause: "data", revision: reset },
      { panel: "a", key: '[0,"Asia"]', cause: "api", revision: reset + 1 },
      { panel: "b", key: '[1,"Europe"]', cause: "data", revision: reset },
    ]);
    // Options replacing the tree's table without the node: as the options, counted once.
    chart.setDrillRoot(["Europe", "France"], { panel: "b" });
    chart.render();
    chart.update({
      marks: ["a", "b"].map((panel) =>
        treemap(table({ region: ["Asia"], country: ["Japan"], sales: [4] }), {
          path: ["region", "country"],
          value: "sales",
          panel,
        }),
      ),
    });
    const options = chart.revision;
    chart.render();
    expect(drills.at(-1)).toMatchObject({
      panel: "b",
      key: null,
      cause: "options",
      revision: options,
    });
    expect(chart.revision).toBe(options);
  });

  it("reports the camera a frame drew before a drill's listener moves it for the next", async () => {
    const data = sales();
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: [
        treemap(data, { path: ["region", "country"], value: "sales", panel: "a" }),
        point3d(table({ x: [0, 1], y: [0, 1], z: [0, 1] }), { x: "x", y: "y", z: "z", panel: "b" }),
      ],
    });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.render();
    const cameras: [number, number][] = [];
    chart.on("camera", ({ camera, revision }) => cameras.push([camera.azimuth, revision]));
    chart.on("drill", () => chart.setCamera({ azimuth: 30 }, { panel: "b" }));
    chart.setCamera({ azimuth: 90 }, { panel: "b" });
    const turned = chart.revision;
    data.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    const reset = chart.revision;
    chart.render();
    expect(cameras).toEqual([[90, turned]]);
    chart.render();
    expect(cameras).toEqual([
      [90, turned],
      [30, reset + 1],
    ]);
  });

  it("reports the camera a frame drew before what a drill's listener draws at once", async () => {
    const data = sales();
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: [
        treemap(data, { path: ["region", "country"], value: "sales", panel: "a" }),
        point3d(table({ x: [0, 1], y: [0, 1], z: [0, 1] }), { x: "x", y: "y", z: "z", panel: "b" }),
      ],
    });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.render();
    const cameras: [number, number][] = [];
    chart.on("camera", ({ camera, revision }) => cameras.push([camera.azimuth, revision]));
    const renders = heard(chart, "render");
    chart.on("drill", () => {
      chart.setCamera({ azimuth: 30 }, { panel: "b" });
      chart.render();
    });
    chart.setCamera({ azimuth: 90 }, { panel: "b" });
    const turned = chart.revision;
    data.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    const reset = chart.revision;
    chart.render();
    expect(cameras).toEqual([
      [90, turned],
      [30, reset + 1],
    ]);
    expect(renders).toEqual([{ revision: reset }, { revision: reset + 1 }]);
    expect(chart.getCamera({ panel: "b" })?.azimuth).toBe(30);
  });

  it("gives a hover the revision of the frame a drill's listener draws at once", async () => {
    const tree = sales();
    const rows = data();
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: [
        treemap(tree, { path: ["region", "country"], value: "sales", panel: "a" }),
        line(rows, { x: "t", y: "a", panel: "b" }),
      ],
    });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.render();
    const hovers = heard(chart, "hover");
    const [x, y] = within(chart, "b", 0.5, 0.5);
    pointer(chart, "pointermove", x, y);
    await frame();
    await frame();
    // New values under the resting pointer, drawn by the drill's listener.
    chart.on("drill", ({ cause }) => {
      if (cause !== "data") return;
      rows.reset({
        t: rows.numbers("t").slice(),
        a: rows.numbers("a").map((v) => v + 1),
        b: rows.numbers("b").slice(),
      });
      chart.render();
    });
    tree.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    const reset = chart.revision;
    chart.render();
    expect(hovers.at(-1)).toMatchObject({ cause: "pointer", revision: reset + 1 });
  });

  it("says the frame a drill's listener fails to draw is not on screen, the one before it is", async () => {
    const data = sales();
    const rows = table({ t: [0, 1], v: [1, 2], kind: ["a", "a"], g: ["p", "p"] });
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: [
        treemap(data, { path: ["region", "country"], value: "sales", panel: "a" }),
        line(rows, {
          x: "t",
          y: "v",
          series: "g",
          style: { by: { field: "kind", map: {} } },
          panel: "b",
        }),
      ],
      onError: () => {},
    });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.render();
    const renders = heard(chart, "render");
    chart.on("drill", ({ cause }) => {
      if (cause !== "data") return;
      // A row of another kind in series "p", which the style map refuses.
      rows.append({ t: [2], v: [3], kind: ["b"], g: ["p"] });
      chart.render();
    });
    data.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    const reset = chart.revision;
    chart.render();
    expect(renders).toEqual([{ revision: reset }]);
    expect(chart.drawnRevision).toBe(reset);
  });

  it("reports what an update retires with its revision, whatever drill listeners change first", async () => {
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: [
        treemap(sales(), { path: ["region", "country"], value: "sales", panel: "a" }),
        line(data(), { x: "t", y: "a", panel: "b" }),
      ],
    });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.setViewport({ x: [2, 5] }, { panel: "b" });
    chart.select([3, 4], { panel: "b" });
    chart.render();
    await frame();
    const views = heard(chart, "viewport");
    const selects = heard(chart, "select");
    chart.on("drill", ({ cause }) => {
      if (cause === "options") chart.setDrillRoot(["Asia"], { panel: "a" });
    });
    // Subplot b goes with its view and selection; a's tree loses Spain.
    chart.update({
      panels: panels([{ id: "a" }], grid({ columns: 1 })),
      marks: [
        treemap(
          table({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] }),
          { path: ["region", "country"], value: "sales", panel: "a" },
        ),
      ],
    });
    const options = chart.revision;
    chart.render();
    expect(views.at(-1)).toMatchObject({ cause: "options", revision: options });
    expect(selects.at(-1)).toMatchObject({ x: null, cause: "options", revision: options });
    expect(chart.revision).toBe(options + 1);
  });

  it("keeps a selection a listener makes as an update retires the brush that wrote rows", async () => {
    const rows = data();
    const store = selectionStore(rows);
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: ["a", "b"].map((panel) => line(rows, { x: "t", y: "a", panel })),
      interaction: { brush: "x" },
      rowSelection: rowSelection({ store, channel: "focus" }),
    });
    chart.setViewport({ x: [2, 8] }, { panel: "b" });
    chart.select([3, 5], { panel: "b" });
    chart.render();
    await frame();
    const fromB = store.get("focus");
    expect(fromB).not.toBeNull();
    const selects = heard(chart, "select");
    // As b goes, its view's listener selects in a.
    chart.on("viewport", () => {
      if (chart.selection === null) chart.select([1, 2], { panel: "a" });
    });
    chart.update({
      panels: panels([{ id: "a" }], grid({ columns: 1 })),
      marks: [line(rows, { x: "t", y: "a", panel: "a" })],
    });
    chart.render();
    expect(chart.selectionOwner?.panels).toEqual(["a"]);
    // What a's brush wrote, not cleared with what b's did.
    const held = store.get("focus");
    expect(held).not.toBeNull();
    expect(held).not.toBe(fromB);
    // The selection in a took the place of b's going.
    expect(selects.map(({ x }) => x)).toEqual([[1, 2]]);
  });

  it("reports no selection an update retires once a listener selected and cleared since", async () => {
    const rows = data();
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: ["a", "b"].map((panel) => line(rows, { x: "t", y: "a", panel })),
      interaction: { brush: "x" },
    });
    chart.setViewport({ x: [2, 8] }, { panel: "b" });
    chart.select([3, 5], { panel: "b" });
    chart.render();
    await frame();
    const selects = heard(chart, "select");
    let once = false;
    chart.on("viewport", () => {
      if (once) return;
      once = true;
      chart.select([1, 2], { panel: "a" });
      chart.select(null);
    });
    chart.update({
      panels: panels([{ id: "a" }], grid({ columns: 1 })),
      marks: [line(rows, { x: "t", y: "a", panel: "a" })],
    });
    chart.render();
    expect(selects.map(({ x, cause }) => [x, cause])).toEqual([
      [[1, 2], "api"],
      [null, "api"],
    ]);
  });

  it("reports a root the data takes away as the data's, also a reset a drill's listener makes", async () => {
    const data = sales();
    const chart = await mount({
      marks: [treemap(data, { path: ["region", "country"], value: "sales" })],
    });
    chart.setDrillRoot(["Europe", "Spain"]);
    chart.render();
    const drills = heard(chart, "drill");
    chart.on("drill", ({ key }) => {
      if (key === '[0,"Europe"]') data.reset({ region: ["Asia"], country: ["Japan"], sales: [4] });
    });
    data.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    chart.render();
    chart.render();
    expect(drills.map(({ key, cause }) => [key, cause])).toEqual([
      ['[0,"Europe"]', "data"],
      [null, "data"],
    ]);
  });

  it("reports no root a frame took back once a listener drilled it away and back", async () => {
    const tree = sales();
    const chart = await mount({
      width: 800,
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: ["a", "b"].map((panel) =>
        treemap(tree, { path: ["region", "country"], value: "sales", panel }),
      ),
    });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "b" });
    chart.render();
    const drills: [string | undefined, string | null, string][] = [];
    chart.on("drill", ({ panels: named, key, cause }) => {
      drills.push([named?.[0], key, cause]);
      // A's listener drills b away and back, before b's own root is reported.
      if (named?.[0] === "a" && cause === "data") {
        chart.setDrillRoot(["Asia"], { panel: "b" });
        chart.setDrillRoot(["Europe"], { panel: "b" });
      }
    });
    tree.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    chart.render();
    expect(drills).toEqual([
      ["a", '[0,"Europe"]', "data"],
      ["b", '[1,"Asia"]', "api"],
      ["b", '[1,"Europe"]', "api"],
    ]);
  });

  it("reports no root a frame took back of a tree a listener removed and drew again", async () => {
    const tree = sales();
    const both = {
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: 2 })),
      marks: ["a", "b"].map((panel) =>
        treemap(tree, { path: ["region", "country"], value: "sales", panel }),
      ),
    };
    const chart = await mount({ width: 800, legend: false, ...both });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "a" });
    chart.setDrillRoot(["Europe", "Spain"], { panel: "b" });
    chart.render();
    const drills: [string | undefined, string | null, string][] = [];
    chart.on("drill", ({ panels: named, key, cause }) => {
      drills.push([named?.[0], key, cause]);
      // A's listener removes b and draws, then brings b back, a new tree, and draws.
      if (named?.[0] === "a" && cause === "data") {
        chart.update({
          panels: panels([{ id: "a" }], grid({ columns: 1 })),
          marks: [treemap(tree, { path: ["region", "country"], value: "sales", panel: "a" })],
        });
        chart.render();
        chart.update(both);
        chart.render();
      }
    });
    tree.reset({ region: ["Europe", "Asia"], country: ["France", "Japan"], sales: [3, 4] });
    chart.render();
    expect(drills).toEqual([["a", '[0,"Europe"]', "data"]]);
    expect(chart.getDrillRoot({ panel: "b" })?.key).toBeNull();
  });

  it("gives presses of controls' buttons the cause that pressed them", async () => {
    const tree = table({
      region: ["Europe", "Europe", "Asia"],
      country: ["France", "Spain", "Japan"],
      sales: [3, 2, 4],
    });
    const chart = await mount({
      marks: [treemap(tree, { path: ["region", "country"], value: "sales" })],
      interaction: { zoom: true },
    });
    const drills = heard(chart, "drill");
    const press = async (selector: string, detail: number) => {
      chart.setDrillRoot(["Europe"]);
      chart.render();
      await frame();
      chart.root
        .querySelector(selector)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
      return drills.at(-1);
    };
    // A key clicks with no count; the mouse with one.
    expect(await press('[aria-label="Up one level"]', 0)).toMatchObject({ cause: "keyboard" });
    expect(await press('[aria-label="Show the whole tree"]', 1)).toMatchObject({
      cause: "pointer",
    });
    expect(await press("nav[aria-label=Path] button", 0)).toMatchObject({
      key: null,
      cause: "keyboard",
    });
  });

  it("gives a hover the keyboard clears the keyboard's cause", async () => {
    const chart = await mount({ marks: [line(data(), { x: "t", y: "a" })] });
    const hovers = heard(chart, "hover");
    chart.root.focus();
    key(chart, "Home");
    expect(hovers.at(-1)).toMatchObject({ cause: "keyboard" });
    key(chart, "Escape");
    await frame();
    expect(hovers.at(-1)).toMatchObject({ inspection: undefined, cause: "keyboard" });
  });

  it("counts a write once, however many of its views show it, and a view's own change", async () => {
    const rows = data();
    const low = rowView(rows, { filter: ["<", ["field", "a"], 10] });
    const high = rowView(rows, { filter: [">=", ["field", "a"], 10] });
    const chart = await mount({
      marks: [point(low, { x: "t", y: "a" }), point(high, { x: "t", y: "b" })],
    });
    const at = chart.revision;
    rows.append({ t: [10], a: [1], b: [2] });
    expect(chart.revision).toBe(at + 1);
    low.setQuery({ filter: ["<", ["field", "a"], 5] });
    expect(chart.revision).toBe(at + 2);
  });

  it("counts a write a listener makes during another once, whatever views heard both late", async () => {
    const rows = data();
    // Heard before the views are made: its write lands before they hear the first.
    let nested = false;
    rows.subscribe(() => {
      if (nested) return;
      nested = true;
      rows.append({ t: [11], a: [3], b: [4] });
    });
    const low = rowView(rows, { filter: ["<", ["field", "a"], 10] });
    const high = rowView(rows, { filter: [">=", ["field", "a"], 10] });
    const chart = await mount({
      marks: [point(low, { x: "t", y: "a" }), point(high, { x: "t", y: "b" })],
    });
    const at = chart.revision;
    rows.append({ t: [10], a: [1], b: [2] });
    expect(chart.revision).toBe(at + 2);
    // Its own changes, one inside another's report, count each.
    let inner = false;
    const stop = low.subscribe(() => {
      if (inner) return;
      inner = true;
      low.setQuery({ filter: ["<", ["field", "a"], 3] });
    });
    low.setQuery({ filter: ["<", ["field", "a"], 5] });
    expect(chart.revision).toBe(at + 4);
    stop();
  });

  it("gives what listeners change in turn their own cause and count", async () => {
    const tree = table({
      region: ["Europe", "Europe", "Asia"],
      country: ["France", "Spain", "Japan"],
      sales: [3, 2, 4],
    });
    const chart = await mount({
      marks: [treemap(tree, { path: ["region", "country"], value: "sales" })],
      interaction: { zoom: true },
    });
    chart.setDrillRoot(["Europe"]);
    const drills = heard(chart, "drill");
    // The data takes Europe away; a listener drills into Asia instead.
    chart.on("drill", ({ cause }) => {
      if (cause === "data") chart.setDrillRoot(["Asia"]);
    });
    tree.reset({ region: ["Asia"], country: ["Japan"], sales: [4] });
    chart.render();
    await frame();
    const counted = chart.revision;
    expect(drills.map(({ cause }) => cause)).toEqual(["data", "api"]);
    expect(drills.at(-1)).toMatchObject({
      key: expect.stringContaining("Asia"),
      revision: counted,
    });
  });

  it("gives hovers after a change the revision of the frame drawing it", async () => {
    const rows = data();
    const chart = await mount({ marks: [line(rows, { x: "t", y: "a" })] });
    const hovers = heard(chart, "hover");
    const [x, y] = within(chart, "", 0.5, 0.5);
    pointer(chart, "pointermove", x, y);
    await frame();
    // New values under the pointer, which stays: the tooltip reads them in the next frame.
    rows.reset({
      t: rows.numbers("t").slice(),
      a: rows.numbers("a").map((v) => v + 1),
      b: rows.numbers("b").slice(),
    });
    const changed = chart.revision;
    await frame();
    await frame();
    expect(hovers.at(-1)).toMatchObject({ cause: "pointer", revision: changed });
  });
});
