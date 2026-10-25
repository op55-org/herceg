// The viewport events fixture (test/fixtures/viewport-events.json), which
// the engine's and Python's tests read: each case's spec loads and draws,
// and its actions and events have the payloads' shapes and agree with the
// panels the chart draws and the scales they share. These check the
// fixture; the engine's proofs of its cases are its contract tests.
import { describe, expect, it } from "vitest";
import { estimateText } from "../../src/layout/text.ts";
import { ChartModel, type DrawnPanel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import type {
  PanelViewportPayload,
  ScaleViewPayload,
  ViewportEventPayload,
} from "../../src/web/events.ts";
import fixture from "../fixtures/viewport-events.json";
import { CONTRACT_ID } from "../helpers/contracts.ts";

type Range = [number, number] | null;

interface Action {
  do: "setViewport" | "getViewport" | "update" | "load" | "remount";
  view?: unknown;
  panel?: string;
  spec?: object;
  data?: object;
  events?: ViewportEventPayload[];
  error?: { code: string; path: string; panel?: string; message: string };
  returns?: { x: Range; y: Range; yRight: Range };
}

interface Case {
  contract: string;
  name: string;
  scopes: Record<string, string>;
  spec: object;
  actions: Action[];
}

const AXES = ["x", "y", "yRight"] as const;
const CAUSES = ["pointer", "wheel", "keyboard", "api", "sync", "data", "options"];
const PLACEMENTS = ["chart", "subplots", "facets", "insets"];
const groupOf = (panel: DrawnPanel, axis: (typeof AXES)[number]) =>
  axis === "x" ? panel.xGroup : axis === "y" ? panel.yGroup : panel.yRightGroup;
const keys = (value: object) => Object.keys(value).sort();
const isRange = (value: unknown) =>
  value === null ||
  (Array.isArray(value) &&
    value.length === 2 &&
    value.every((end) => typeof end === "number") &&
    value[0]! <= value[1]!);

/** The panels the case's chart draws over `data`, in reading order. */
function drawn({ spec }: Case, data: object = fixture.data): readonly DrawnPanel[] {
  const full = { data: { data: { columns: data } }, ...spec } as unknown as ChartSpec;
  const model = new ChartModel(loadSpec(full).config, undefined, ...staticCompilers());
  model.setSize(640, 400, 1);
  model.scene(estimateText);
  return model.panels();
}

/** A view as setViewport takes it: an x pair, ranges of some axes, or null. */
function checkView(view: unknown) {
  if (view === null || Array.isArray(view)) return expect(isRange(view)).toBe(true);
  for (const [axis, range] of Object.entries(view as object)) {
    expect(AXES).toContain(axis);
    expect(isRange(range)).toBe(true);
  }
}

describe("the viewport events fixture", () => {
  const cases = fixture.cases as Case[];

  it("names each case by a contract ID of its own, a capability and a placement", () => {
    const ids = cases.map(({ contract }) => contract);
    for (const id of ids) {
      expect(id).toMatch(CONTRACT_ID);
      const [area, , placement] = id.split(".");
      expect(area).toBe("interaction");
      expect(PLACEMENTS).toContain(placement);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const testCase of cases)
    it(`${testCase.contract}: ${testCase.name}`, () => {
      for (const [axis, scope] of Object.entries(testCase.scopes)) {
        expect(AXES).toContain(axis);
        expect(["chart", "panel", "row", "column"]).toContain(scope);
      }
      let panels = drawn(testCase);
      // The chart actions act on: a remount's, after one.
      let mounted: Case = testCase;
      let data: object = fixture.data;
      // Placeholders name one instance each among their scale's.
      const named = new Map<string, string>();
      let revision = 0;
      for (const action of testCase.actions) {
        const order = panels.map(({ key }) => key);
        if (action.do === "getViewport") {
          expect(keys(action)).toEqual(
            keys({ do: 0, returns: 0, ...(action.panel !== undefined && { panel: 0 }) }),
          );
          if (action.panel !== undefined) expect(order).toContain(action.panel);
          expect(keys(action.returns!)).toEqual(["x", "y", "yRight"]);
          for (const axis of AXES) expect(isRange(action.returns![axis])).toBe(true);
          continue;
        }
        let before = panels;
        if (action.do === "update" || action.do === "load") {
          expect(keys(action)).toEqual(["data", "do", "events"]);
          data = action.data!;
          panels = drawn(mounted, data);
        } else if (action.do === "remount") {
          for (const key of keys(action)) expect(["do", "spec", "data", "events"]).toContain(key);
          mounted = { ...mounted, spec: action.spec ?? mounted.spec };
          data = action.data ?? data;
          // Another chart: its instances, named afresh, and its revisions.
          panels = before = drawn(mounted, data);
          named.clear();
          revision = 0;
        } else {
          expect(action.do).toBe("setViewport");
          for (const key of keys(action))
            expect(["do", "view", "panel", "events", "error"]).toContain(key);
          checkView(action.view);
          expect("events" in action !== "error" in action).toBe(true);
        }
        if (action.error) {
          const { code, path, panel, message } = action.error;
          expect(keys(action.error)).toEqual(
            keys({ code, path, message, ...(panel !== undefined && { panel }) }),
          );
          expect(["invalid-option", "unknown-reference", "unsupported"]).toContain(code);
          expect(["panel", ...AXES]).toContain(path);
          expect(panel).toBe(action.panel);
          expect(message).toMatch(/^setViewport[^:]*: .+; .+/);
          continue;
        }
        for (const event of action.events!) {
          expect(event.viewRevision).toBe(++revision);
          expect(CAUSES).toContain(event.cause);
          expect(event.cause).toBe(
            { update: "data", load: "options", remount: "options", setViewport: "api" }[
              action.do as string
            ],
          );
          expect(keys(event)).toEqual(
            keys({
              viewRevision: 0,
              cause: 0,
              scales: 0,
              views: 0,
              ...(event.panel !== undefined && { panel: 0 }),
            }),
          );
          if (event.panel !== undefined) {
            expect(panels.map(({ key }) => key)).toContain(event.panel);
            expect(event.panel).toBe(action.panel);
          }
          checkScales(event.scales, panels, before, named);
          checkViews(event, panels);
        }
      }
    });
});

/**
 * The panels drawing each instance of a scale, by the name the engine
 * gives it (`DrawnPanel.xGroup` and the others), in reading order.
 */
function instancesOf(panels: readonly DrawnPanel[], axis: (typeof AXES)[number]) {
  const found = new Map<string, string[]>();
  for (const panel of panels) {
    if (axis === "yRight" && !panel.yRight) continue;
    const group = groupOf(panel, axis);
    found.set(group, [...(found.get(group) ?? []), panel.key]);
  }
  return found;
}

/**
 * Each instance once, by scale and then first panel, with the panels
 * drawing it, in order: now, or for an instance no longer drawn (another
 * now has its name, or none), before, and fitted.
 */
function checkScales(
  scales: readonly ScaleViewPayload[],
  panels: readonly DrawnPanel[],
  before: readonly DrawnPanel[],
  named: Map<string, string>,
) {
  const order = [...new Set([...before, ...panels].map(({ key }) => key))];
  const place = ({ scale, panels: of }: ScaleViewPayload) =>
    AXES.indexOf(scale) * order.length + order.indexOf(of[0]!);
  expect(scales.map(place)).toEqual(scales.map(place).sort((a, b) => a - b));
  for (const entry of scales) {
    expect(keys(entry)).toEqual(["instance", "panels", "scale", "time", "view"]);
    expect(AXES).toContain(entry.scale);
    expect(entry.instance).toMatch(/^\$[a-zA-Z]+$/);
    expect(isRange(entry.view)).toBe(true);
    const same = (members: readonly string[] | undefined) =>
      JSON.stringify(members) === JSON.stringify(entry.panels);
    const current = instancesOf(panels, entry.scale);
    const previous = instancesOf(before, entry.scale);
    // A placeholder named before is that instance; else the instance drawing
    // the panels now, unless one they drew before is gone and is reported
    // fitted (an instance new since is never reported: it had no view).
    const placeholder = `${entry.scale} ${entry.instance}`;
    const bound = named.get(placeholder)?.slice(entry.scale.length + 1);
    const was = [...previous].find(([, members]) => same(members))?.[0];
    const group =
      bound ??
      (entry.view === null && was !== undefined && !current.has(was)
        ? was
        : [...current].find(([, members]) => same(members))?.[0]);
    expect(group).toBeDefined();
    const now = current.has(group!);
    expect(same(now ? current.get(group!) : previous.get(group!))).toBe(true);
    // An instance no longer drawn is reported fitted, with the panels it had.
    if (!now) expect(entry.view).toBeNull();
    const among = now ? panels : before;
    for (const key of entry.panels) {
      const panel = among.find((drawn) => drawn.key === key)!;
      expect(panel[entry.scale]?.type === "time").toBe(entry.time);
    }
    // A placeholder of a scale names one of its instances, and another placeholder another.
    const identity = `${entry.scale} ${group}`;
    expect(named.get(placeholder) ?? identity).toBe(identity);
    named.set(placeholder, identity);
    expect([...named.values()].filter((other) => other === identity)).toHaveLength(1);
  }
  expect(new Set(scales.map(({ scale, instance }) => `${scale} ${instance}`)).size).toBe(
    scales.length,
  );
}

/** Every panel of the changed instances still drawn, once, in order, each with its whole view. */
function checkViews(event: ViewportEventPayload, panels: readonly DrawnPanel[]) {
  const order = panels.map(({ key }) => key);
  const affected = order.filter((key) => event.scales.some(({ panels: of }) => of.includes(key)));
  expect(event.views.map(({ panel }) => panel)).toEqual(affected);
  for (const view of event.views as PanelViewportPayload[]) {
    expect(keys(view)).toEqual(["panel", "time", "x", "y", "yRight"]);
    const panel = panels.find(({ key }) => key === view.panel)!;
    expect(view.time).toEqual(AXES.filter((axis) => panel[axis]?.type === "time"));
    for (const axis of AXES) {
      expect(isRange(view[axis])).toBe(true);
      if (axis === "yRight" && !panel.yRight) expect(view.yRight).toBeNull();
      const changed = event.scales.find(
        ({ scale, panels: of }) => scale === axis && of.includes(view.panel),
      );
      if (changed) expect(view[axis]).toEqual(changed.view);
    }
  }
}
