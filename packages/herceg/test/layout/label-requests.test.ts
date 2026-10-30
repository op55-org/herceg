// Rule and region labels as requests to a panel's placer (layout/place.ts),
// which places each as today: at the place reaching least past its bounds,
// then moved inside them.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import {
  type LabelledMark,
  type LabelRequest,
  mirrorPlaces,
  placeLabels,
} from "../../src/layout/place.ts";
import { estimateText } from "../../src/layout/text.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import type { LabelsGeometry, TextGeometry } from "../../src/scene/scene.ts";

const plot = { x: 0, y: 0, width: 100, height: 50 };

function request(fields: Partial<LabelRequest>): LabelRequest {
  return {
    mark: 0,
    index: 0,
    group: undefined,
    overlap: "show",
    priority: 0,
    anchor: { x: 10, y: 10 },
    block: { width: 20, height: 10 },
    places: [{ dx: 0, dy: 0 }],
    leader: false,
    bounds: plot,
    ...fields,
  };
}

describe("the label placer", () => {
  it("leaves a block inside its bounds where it is", () => {
    expect(placeLabels([request({})], [])).toEqual([{ dx: 0, dy: 0, moved: false }]);
  });

  it("moves a block in by as much as it reaches past each edge", () => {
    const [placed] = placeLabels([request({ anchor: { x: 90, y: -4 } })], []);
    expect(placed).toEqual({ dx: -10, dy: 4, moved: true });
  });

  it("takes the place reaching least past its bounds, the earlier of equals", () => {
    // A vertical rule at x = 95 with its label to its right: its image is to its left.
    const box = { x: 96, y: 10, width: 20, height: 10 };
    const places = mirrorPlaces(box, { axis: "x", at: 95 });
    expect(places).toEqual([
      { dx: 0, dy: 0 },
      { dx: -22, dy: 0 },
    ]);
    const [mirrored] = placeLabels([request({ anchor: box, places })], []);
    expect(mirrored).toEqual({ dx: -22, dy: 0, moved: true });
    // Inside, the label stays on its own side.
    const inside = { ...box, x: 40 };
    const [kept] = placeLabels(
      [request({ anchor: inside, places: mirrorPlaces(inside, { axis: "x", at: 39 }) })],
      [],
    );
    expect(kept).toEqual({ dx: 0, dy: 0, moved: false });
  });

  it("keeps the left and top edges of a block larger than its bounds in them", () => {
    const [placed] = placeLabels(
      [request({ anchor: { x: 5, y: 5 }, block: { width: 200, height: 80 } })],
      [],
    );
    expect(placed).toEqual({ dx: -5, dy: -5, moved: true });
  });

  it("leaves a block without bounds where it is", () => {
    const [placed] = placeLabels([request({ anchor: { x: -50, y: 0 }, bounds: null })], []);
    expect(placed).toEqual({ dx: 0, dy: 0, moved: false });
  });
});

describe("rule and region labels", () => {
  function build(config: ChartConfig) {
    const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
    model.setSize(400, 200, 1);
    const scene = model.scene(estimateText);
    const [panel] = model.panels();
    const frame = model.drawnMarks()[0]!.frame!;
    return { scene, frame, panel: panel! };
  }

  it("draw as the placer places their requests, and where another placer puts them", () => {
    // Labels of several lines are placed apart from their rules.
    const events = table({ at: [1, 9], end: [3, 10], name: ["launch\nday", "a long\nlate label"] });
    const marks = [
      rule(events, { x: "at", label: { field: "name" } }),
      region(events, { x1: "at", x2: "end", label: { field: "name" } }),
    ];
    const { frame } = build({ marks, x: { domain: [0, 10] } });
    for (const [index, mark] of marks.entries()) {
      const labelled = mark as unknown as Mark & LabelledMark;
      const requests = labelled.labelRequests(frame, index);
      expect(requests).toHaveLength(2);
      expect(requests.map((r) => [r.mark, r.index, r.overlap, r.priority])).toEqual([
        [index, 0, "show", 0],
        [index, 1, "show", 0],
      ]);
      // Drawn from the placer's placements, they are what the mark draws.
      const drawn = labelled.drawLabels(frame, index, undefined, placeLabels(requests, []));
      const own = labelled.geometry([], frame, index).slice(-1);
      expect(drawn).toEqual(own);
      // Moved by another placer, or left out.
      const draw = (dy: number) =>
        labelled.drawLabels(frame, index, undefined, [{ dx: 0, dy, moved: dy !== 0 }, null])[0] as
          | LabelsGeometry
          | TextGeometry;
      const firstY = (g: LabelsGeometry | TextGeometry) =>
        g.kind === "labels" ? g.items.find((i) => i.type === "text")!.y : g.coords[1]!;
      expect(firstY(draw(7))).toBeCloseTo(firstY(draw(0)) + 7);
    }
  });

  it("measure labels outside the plot too, kept at their one place", () => {
    const levels = table({ at: [5], name: ["target\nline"] });
    const mark = rule(levels, {
      y: "at",
      label: { field: "name", place: { outside: true, attachment: "end" } },
    });
    const { frame } = build({ marks: [mark], y: { domain: [0, 10] } });
    const labelled = mark as unknown as Mark & LabelledMark;
    const [request] = labelled.labelRequests(frame, 0);
    expect(request!.block.width).toBeGreaterThan(0);
    expect(request!.block.height).toBeGreaterThan(0);
    expect(request!.places).toEqual([{ dx: 0, dy: 0 }]);
    expect(request!.bounds).toBeNull();
    // Its block where it is drawn: the label's text starts at its corner.
    const own = labelled.geometry([], frame, 0).slice(-1)[0] as LabelsGeometry | TextGeometry;
    const drawn = labelled.drawLabels(frame, 0, undefined, placeLabels([request!], []));
    expect(drawn).toEqual([own]);
  });
});
