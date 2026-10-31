// How labels keep apart across a panel (layout/placer.ts): annotation
// labels of marks naming one overlap group, by priority; series labels of
// every mark together, which annotation labels keep off; and the parts of
// the vocabulary each kind of label refuses.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type {
  LabelsGeometry,
  Rect,
  RectGeometry,
  Scene,
  SegmentGeometry,
  TextGeometry,
} from "../../src/scene/scene.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";

function build(config: ChartConfig, width = 400, height = 240) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(width, height, 1);
  return model.scene(estimateText);
}

/** Every label drawn in the scene's first panel: its text and box. */
function labelBoxes(scene: Scene): { text: string; box: Rect }[] {
  const out: { text: string; box: Rect }[] = [];
  for (const g of scene.panels[0]!.marks) {
    if (g.kind !== "labels") continue;
    for (const item of (g as LabelsGeometry).items) {
      const width = estimateText(item.text, item.paint.css);
      const x = item.anchor === "start" ? item.x : item.x - width / (item.anchor === "end" ? 1 : 2);
      const box = item.box ?? {
        x,
        y: item.y - item.paint.lineHeight / 2,
        width,
        height: item.paint.lineHeight,
      };
      out.push({ text: item.text, box });
    }
  }
  return out;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("annotation labels of an overlap group", () => {
  const events = (overlapGroup: string | undefined, priorities: [number, number] = [0, 0]) => [
    rule({
      x: 5,
      dash: "--",
      label: {
        text: "Black Friday",
        overlap: "move",
        priority: priorities[0],
        ...(overlapGroup && { overlapGroup }),
      },
    }),
    rule({
      x: 5.2,
      dash: "--",
      label: {
        text: "Outage",
        overlap: "move",
        priority: priorities[1],
        ...(overlapGroup && { overlapGroup }),
      },
    }),
  ];

  contractTest("label.group.apart", () => {
    // b-dash.06: event labels of separate rules, kept apart as one group.
    const grouped = labelBoxes(build({ marks: events("events"), x: { domain: [0, 10] } }));
    expect(grouped.map(({ text }) => text)).toEqual(["Black Friday", "Outage"]);
    expect(overlaps(grouped[0]!.box, grouped[1]!.box)).toBe(false);
    // Without a group, each mark's labels keep apart from its own only.
    const alone = labelBoxes(build({ marks: events(undefined), x: { domain: [0, 10] } }));
    expect(overlaps(alone[0]!.box, alone[1]!.box)).toBe(true);
  });

  contractTest("label.group.priority", () => {
    // The higher priority keeps its first place, whichever mark comes first;
    // the other goes to its mirror image across its rule, the nearest place free.
    const by = (priorities: [number, number]) => {
      const boxes = labelBoxes(
        build({ marks: events("events", priorities), x: { domain: [0, 10] } }),
      );
      return (name: string) => boxes.find(({ text }) => text === name)!.box;
    };
    const plain = by([0, 0]);
    const ranked = by([0, 1]);
    const alone = labelBoxes(build({ marks: events(undefined), x: { domain: [0, 10] } }));
    const own = (name: string) => alone.find(({ text }) => text === name)!.box;
    // By default the earlier mark's label stays; with priority, the later one's.
    expect(plain("Black Friday")).toEqual(own("Black Friday"));
    expect(plain("Outage").x).toBeLessThan(own("Outage").x);
    expect(ranked("Outage")).toEqual(own("Outage"));
    expect(ranked("Black Friday").x).toBeLessThan(own("Black Friday").x);
    expect(overlaps(ranked("Outage"), ranked("Black Friday"))).toBe(false);
  });

  it("slide labels along their rule where both sides are taken, with leaders when asked", () => {
    // At the plot's left edge, the second label's mirror image lands on the first.
    const marks = (leader: boolean) => [
      rule({ x: 0.2, label: { text: "Black Friday", overlap: "move", overlapGroup: "events" } }),
      rule({ x: 0, label: { text: "Outage", overlap: "move", overlapGroup: "events", leader } }),
    ];
    const scene = build({ marks: marks(true), x: { domain: [0, 10] } });
    const boxes = labelBoxes(scene);
    const [first, second] = boxes.map(({ box }) => box);
    expect(overlaps(first!, second!)).toBe(false);
    expect(second!.y).toBeGreaterThan(first!.y);
    const leaders = scene.panels[0]!.marks.filter((g) => g.kind === "segments");
    expect(leaders).toHaveLength(1);
    const plain = build({ marks: marks(false), x: { domain: [0, 10] } });
    expect(plain.panels[0]!.marks.filter((g) => g.kind === "segments")).toHaveLength(0);
  });

  it("leave out a label that moves where no place of it fits its bounds", () => {
    const drawn = (text: string) =>
      labelBoxes(
        build({ marks: [rule({ x: 0.5, label: { text, overlap: "move" } })] }, 200, 200),
      ).map((label) => label.text);
    // Wider than the plot, it has no place inside it.
    expect(drawn("A".repeat(100))).toEqual([]);
    expect(drawn("A")).toEqual(["A"]);
  });

  it("keep labels apart as painted, outlines too", () => {
    const outlined = (text: string) =>
      rule({
        x: 5,
        label: {
          text,
          overlap: "move",
          overlapGroup: "events",
          style: { background: { fill: "#eee", stroke: "#999", strokeWidth: 20 }, padding: 2 },
        },
      });
    const boxes = labelBoxes(
      build({ marks: [outlined("one"), outlined("two")], x: { domain: [0, 10] } }),
    ).map(({ box }) => ({
      x: box.x - 10,
      y: box.y - 10,
      width: box.width + 20,
      height: box.height + 20,
    }));
    expect(boxes).toHaveLength(2);
    expect(overlaps(boxes[0]!, boxes[1]!)).toBe(false);
  });

  it("slide regions' labels along their side", () => {
    const rows = table({ a: [2, 2], b: [8, 8], name: ["Freeze", "Launch"] });
    const scene = build({
      marks: [region(rows, { x1: "a", x2: "b", label: { field: "name", overlap: "move" } })],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const text = scene.panels[0]!.marks.find((g): g is TextGeometry => g.kind === "text")!;
    expect(text.labels).toEqual(["Freeze", "Launch"]);
    // The second slid right along the top, past the first.
    expect(text.coords[3]).toBeCloseTo(text.coords[1]!, 6);
    expect(text.coords[2]! - text.coords[0]!).toBeGreaterThan(
      estimateText("Freeze", `${scene.theme.fontSize}px ${scene.theme.font}`),
    );
    // Four over a region narrower than two of them: those that fit along
    // its top stay within it; the others are left out.
    const narrow = table({ a: [4, 4, 4, 4], b: [5, 5, 5, 5], name: ["A", "B", "C", "D"] });
    const crowded = build({
      marks: [region(narrow, { x1: "a", x2: "b", label: { field: "name", overlap: "move" } })],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const fill = crowded.panels[0]!.marks.find((g) => g.kind === "rect") as RectGeometry;
    const [left, width] = [fill.rects[0]!, fill.rects[2]!];
    const font = `${crowded.theme.fontSize}px ${crowded.theme.font}`;
    const placed = crowded.panels[0]!.marks.find((g): g is TextGeometry => g.kind === "text")!;
    expect(placed.labels.length).toBeGreaterThan(0);
    expect(placed.labels.length).toBeLessThan(4);
    placed.labels.forEach((label, k) => {
      const x = placed.coords[2 * k]!;
      expect(x).toBeGreaterThanOrEqual(left - 1e-6);
      expect(x + estimateText(label, font)).toBeLessThanOrEqual(left + width + 1e-6);
    });
  });

  it("draw leaders from text moved more than 6 pixels, near its point or far", () => {
    // Points 10 pixels apart: the second label moves below its point, its leader clear.
    const rows = table({ x: [5, 5], y: [5, 4.5], name: ["alpha", "beta"] });
    const scene = build({
      marks: [
        text(rows, { x: "x", y: "y", label: { field: "name", overlap: "move", leader: true } }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const leaders = scene.panels[0]!.marks.filter(
      (g): g is SegmentGeometry => g.kind === "segments",
    );
    const drawn = scene.panels[0]!.marks.find((g): g is TextGeometry => g.kind === "text")!;
    expect(drawn.labels).toEqual(["alpha", "beta"]);
    expect(leaders.reduce((sum, g) => sum + g.count, 0)).toBe(1);
  });

  it("hold text of the group off rules' labels, and hide it where it would cover one", () => {
    const marks = [
      rule({ x: 5, label: { text: "Release", overlap: "show", overlapGroup: "notes" } }),
      text({
        x: 5.1,
        y: { fraction: 1, offset: -6 },
        label: { text: "Note", overlap: "hide", overlapGroup: "notes" },
      }),
    ];
    const scene = build({ marks, x: { domain: [0, 10] }, y: { domain: [0, 10] } });
    const drawn = scene.panels[0]!.marks.filter((g) => g.kind === "text") as TextGeometry[];
    expect(drawn.flatMap((g) => g.labels)).toEqual([]);
    // In a group of its own, it shows.
    const apart = build({
      marks: [
        marks[0]!,
        text({ x: 5.1, y: { fraction: 1, offset: -6 }, label: { text: "Note", overlap: "hide" } }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const shown = apart.panels[0]!.marks.filter((g) => g.kind === "text") as TextGeometry[];
    expect(shown.flatMap((g) => g.labels)).toEqual(["Note"]);
  });

  it("keep annotation labels off series labels", () => {
    const rows = table({ t: [0, 10], v: [5, 5] });
    const marks = [
      line(rows, { x: "t", y: "v", labels: { at: "last", content: ["series end"] } }),
      text({ x: 9.6, y: 5, label: { text: "note", overlap: "hide" } }),
    ];
    const scene = build({ marks, x: { domain: [0, 10] }, y: { domain: [0, 10] } });
    const notes = scene.panels[0]!.marks.filter((g) => g.kind === "text") as TextGeometry[];
    expect(notes.flatMap((g) => g.labels)).toEqual([]);
  });
});

describe("series labels of a panel", () => {
  it("keep apart across marks", () => {
    const rows = table({ t: [0, 10], a: [5, 5], b: [5.05, 5.05] });
    const marks = [
      line(rows, { x: "t", y: "a", labels: { at: "last", place: { outside: true } } }),
      line(rows, { x: "t", y: "b", labels: { at: "last", place: { outside: true } } }),
    ];
    const boxes = labelBoxes(build({ marks, y: { domain: [0, 10] } }));
    expect(boxes).toHaveLength(2);
    expect(overlaps(boxes[0]!.box, boxes[1]!.box)).toBe(false);
  });

  it("follow text from a series as series labels do", () => {
    const rows = table({ t: [0, 10], a: [5, 5], b: [5.05, 5.05] });
    const marks = [
      line(rows, { id: "lines", x: "t", y: ["a", "b"] }),
      text({ from: { mark: "lines", at: "last" }, label: { content: [{ series: true }] } }),
    ];
    const boxes = labelBoxes(build({ marks, y: { domain: [0, 10] } }));
    expect(boxes).toHaveLength(2);
    expect(overlaps(boxes[0]!.box, boxes[1]!.box)).toBe(false);
    // "show" keeps them at their points.
    const shown = labelBoxes(
      build({
        marks: [
          marks[0]!,
          text({
            from: { mark: "lines", at: "last" },
            label: { content: [{ series: true }], overlap: "show" },
          }),
        ],
        y: { domain: [0, 10] },
      }),
    );
    expect(overlaps(shown[0]!.box, shown[1]!.box)).toBe(true);
  });
});

describe("30 series labels with leaders while streaming", () => {
  contractTest("label.series.streaming", () => {
    // A6: thirty lines converging on their ends, named outside the plot in
    // their ends' order, kept apart, with leaders from those moved, as rows
    // stream in and old ones drop.
    const names = Array.from({ length: 30 }, (_, k) => `s${k}`);
    const at = (k: number, t: number) =>
      500 + (k - 14.5) * 30 * Math.max(0.03, 1 - t / 100) + 4 * Math.sin(k * 1.7 + t / 3);
    const rows = table({
      t: Float64Array.from({ length: 100 }, (_, t) => t),
      ...Object.fromEntries(
        names.map((name, k) => [name, Float64Array.from({ length: 100 }, (_, t) => at(k, t))]),
      ),
    });
    const model = new ChartModel(
      {
        locale: "en-US",
        legend: false,
        y: { domain: [0, 1000] },
        marks: [
          line(rows, {
            x: "t",
            y: names as never,
            labels: { at: "last", place: { outside: true }, leader: true },
          }),
        ],
      },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(700, 640, 1);
    for (let tick = 0; tick <= 30; tick++) {
      if (tick > 0) {
        const t = 99 + tick;
        rows.appendRow({ t, ...Object.fromEntries(names.map((name, k) => [name, at(k, t)])) });
        rows.dropFirst(1);
      }
      const scene = model.scene(estimateText);
      const { plot } = scene.panels[0]!;
      const marks = scene.panels[0]!.marks;
      const items = marks
        .flatMap((g) => (g.kind === "labels" ? (g as LabelsGeometry).items : []))
        .sort((a, b) => a.y - b.y);
      // Every name shows, in the order of the ends, a line apart.
      expect(items).toHaveLength(30);
      const end = (name: string) => {
        const value = rows.value(name as never, rows.length - 1) as number;
        return plot.y + plot.height * (1 - value / 1000);
      };
      const order = [...names].sort((a, b) => end(a) - end(b));
      expect(items.map(({ text }) => text)).toEqual(order);
      const height = items[0]!.paint.lineHeight;
      for (let k = 1; k < items.length; k++)
        expect(items[k]!.y - items[k - 1]!.y).toBeGreaterThanOrEqual(height - 1e-6);
      // Inside the plot's height, and a leader from each name moved more than 6 pixels.
      for (const item of items) {
        expect(item.y - height / 2).toBeGreaterThanOrEqual(plot.y - 1e-6);
        expect(item.y + height / 2).toBeLessThanOrEqual(plot.y + plot.height + 1e-6);
      }
      const moved = items.filter((item) => Math.abs(item.y - end(item.text)) > 6);
      const leaders = marks.find((g) => g.kind === "segments") as SegmentGeometry | undefined;
      expect(leaders?.count ?? 0).toBe(moved.length);
      expect(moved.length).toBeGreaterThan(0);
    }
  });
});

describe("what each kind of label takes", () => {
  const rows = table({ t: [0, 10], v: [1, 2], g: ["a", "b"] });
  const throwsOn = (config: ChartConfig, message: string | RegExp) =>
    expect(() => build(config)).toThrow(message);

  contractTest("label.refused.series", () => {
    throwsOn(
      {
        marks: [
          line(rows, { x: "t", y: "v", labels: { at: "last", overlapGroup: "ends" } as never }),
        ],
      },
      /labels\.overlapGroup: series labels already keep apart across marks; drop overlapGroup/,
    );
    throwsOn(
      {
        marks: [
          line(rows, { x: "t", y: "v", labels: { at: "last", overlap: "stagger" } as never }),
        ],
      },
      /labels\.overlap: "stagger" is for tick labels; use "show", "hide", or "move"/,
    );
    throwsOn(
      {
        marks: [
          line(rows, { x: "t", y: "v", labels: { at: "last", overlap: "show", leader: true } }),
        ],
      },
      /labels\.leader: labels that show stay at their points and draw none; use overlap "move"/,
    );
    throwsOn(
      {
        marks: [
          line(rows, { id: "l", x: "t", y: "v" }),
          text({
            from: { mark: "l", at: "last" },
            label: { text: "x", overlapGroup: "g" } as never,
          }),
        ],
      },
      /label\.overlapGroup: series labels already keep apart across marks; drop overlapGroup/,
    );
  });

  contractTest("label.refused.annotation", () => {
    expect(() => rule({ y: 1, label: { text: "x", overlap: "hide", leader: true } })).toThrow(
      'rule label.leader: labels that hide are drawn at their place and draw none; use overlap "move"',
    );
    expect(() => text({ x: 1, y: 1, label: { text: "x", overlap: "allow" as never } })).toThrow(
      'text label.overlap: expected "show", "hide", or "move"; received "allow"',
    );
    expect(() =>
      // @ts-expect-error: region labels slide along their side and draw no leaders.
      region({ y1: 1, y2: 2, label: { text: "x", overlap: "move", leader: true } }),
    ).toThrow(
      "region label.leader: region labels slide along their side and draw none; drop leader",
    );
  });

  contractTest("label.refused.bar", () => {
    const bars = (labels: object) => ({
      marks: [bar(rows, { x: "g", y: "v", labels: labels as never })],
    });
    throwsOn(
      bars({ overlapGroup: "x" }),
      /labels\.overlapGroup: bar labels keep apart within their mark; drop overlapGroup/,
    );
    throwsOn(
      bars({ leader: true }),
      /labels\.leader: bar labels stay at their bars and draw none; drop leader/,
    );
    throwsOn(
      bars({ overlap: "move" }),
      /labels\.overlap: bar labels fit at their bar or are left out; use "show" or "hide"/,
    );
    throwsOn(
      bars({ priority: 2 }),
      /labels\.priority: bar labels that would cover an earlier one are left out, the later in series and row order; drop priority/,
    );
  });

  contractTest("label.refused.spec", () => {
    const spec = (mark: object) =>
      ({
        data: { t: { columns: { t: [0, 10], v: [1, 2] } } },
        marks: [{ data: "t", x: "t", ...mark }],
      }) as unknown as ChartSpec;
    expect(() =>
      validateSpec(spec({ type: "line", y: "v", labels: { at: "last", overlapGroup: "g" } })),
    ).toThrow(
      "marks[0].labels.overlapGroup: series labels already keep apart across marks; drop overlapGroup",
    );
    expect(() =>
      validateSpec(spec({ type: "rule", label: { text: "x", overlap: "hide", leader: true } })),
    ).toThrow(
      'marks[0].label.leader: labels that hide are drawn at their place and draw none; use overlap "move"',
    );
    expect(() =>
      validateSpec(spec({ type: "region", y1: 1, y2: 2, label: { text: "x", leader: true } })),
    ).toThrow(
      "marks[0].label.leader: region labels slide along their side and draw none; drop leader",
    );
    expect(() =>
      validateSpec(spec({ type: "bar", y: "v", labels: { overlapGroup: "g" } })),
    ).toThrow(
      "marks[0].labels.overlapGroup: bar labels keep apart within their mark; drop overlapGroup",
    );
    expect(() =>
      validateSpec(spec({ type: "line", y: "v", labels: { at: "last", overlap: "allow" } })),
    ).toThrow(/marks\[0\]\.labels\.overlap: expected "show", "hide", or "move"/);
    // Text following series moves by default, as series labels do, and joins no group.
    const following = (label: object) =>
      ({
        marks: [{ type: "text", from: { mark: "m", at: "last" }, label }],
      }) as unknown as ChartSpec;
    expect(() => validateSpec(following({ text: "now", leader: true }))).not.toThrow();
    expect(() => validateSpec(following({ text: "now", overlapGroup: "g" }))).toThrow(
      "marks[0].label.overlapGroup: series labels already keep apart across marks; drop overlapGroup",
    );
    expect(() => validateSpec(following({ text: "now", overlap: "show", leader: true }))).toThrow(
      'marks[0].label.leader: labels that show are drawn at their place and draw none; use overlap "move"',
    );
  });
});

describe("bar labels", () => {
  contractTest("label.bar.hide", () => {
    // Two series drawn over each other: their labels meet at nearly one place.
    const rows = table({
      g: ["a", "a", "b", "b"],
      v: [10, 10.2, 20, 20.1],
      s: ["x", "y", "x", "y"],
    });
    const boxes = (overlap?: "show" | "hide") => {
      const scene = build({
        marks: [
          bar(rows, {
            x: "g",
            y: "v",
            series: "s",
            dodge: false,
            labels: overlap ? { overlap } : true,
          }),
        ],
      });
      const font = `${scene.theme.fontSize}px ${scene.theme.font}`;
      return scene.panels[0]!.marks.filter((g): g is TextGeometry => g.kind === "text").flatMap(
        (g) =>
          g.labels.map((label, k) => {
            const width = estimateText(label, font);
            const [x, y] = [g.coords[k * 2]!, g.coords[k * 2 + 1]!];
            const size = scene.theme.fontSize;
            return { x: x - width / 2, y: y - size / 2, width, height: size };
          }),
      );
    };
    const crossing = (list: Rect[]) =>
      list.some((a, i) => list.some((b, j) => j > i && overlaps(a, b)));
    expect(crossing(boxes())).toBe(true);
    expect(crossing(boxes("show"))).toBe(true);
    // The later labels that would cover earlier ones go inside their bars, or are left out.
    expect(crossing(boxes("hide"))).toBe(false);
  });

  it("keep labels that hide apart as painted, box outlines too", () => {
    // Three thin bars whose labels' boxes, with wide outlines, would meet.
    const rows = table({ name: ["a", "b", "c"], value: [60, 61, 62] });
    const scene = build(
      {
        marks: [
          bar(rows, {
            x: "value",
            y: "name",
            labels: {
              overlap: "hide",
              style: { background: { fill: "#eee", stroke: "#999", strokeWidth: 20 }, padding: 2 },
            },
          }),
        ],
        x: { domain: [0, 100] },
      },
      400,
      120,
    );
    const painted = labelBoxes(scene).map(({ box }) => ({
      x: box.x - 10,
      y: box.y - 10,
      width: box.width + 20,
      height: box.height + 20,
    }));
    // The middle one, whose outline would meet both others', is left out.
    expect(labelBoxes(scene).map(({ text }) => text)).toEqual(["60", "62"]);
    expect(painted.some((a, i) => painted.some((b, j) => j > i && overlaps(a, b)))).toBe(false);
  });

  it("leave out labels that write nothing, which hide no others", () => {
    /** The text each label drawn in the first panel writes. */
    const written = (scene: Scene) =>
      scene.panels[0]!.marks.flatMap((g) =>
        g.kind === "labels"
          ? (g as LabelsGeometry).items
              // Halos drawn as items of their own, under their text.
              .filter((item) => item.paint.color !== "transparent")
              .map((item) => item.text)
          : g.kind === "text"
            ? (g as TextGeometry).labels.slice(0, (g as TextGeometry).count)
            : [],
      );
    // Bars, regions, text, and rules drawn over each other, the first two
    // labels writing nothing (none, or only a break): unstyled, in a
    // style, and of parts.
    const rows = table({
      name: ["a", "a", "a"],
      value: [50, 50, 50],
      a: [2, 2, 2],
      b: [6, 6, 6],
      note: ["", "\n", "visible"],
    });
    for (const label of [
      { field: "note" },
      { field: "note", style: { fontWeight: 700 } },
      { content: [{ field: "note", style: { fontWeight: 700 } }] },
    ] as const) {
      const bars = build({
        marks: [
          bar(rows, {
            x: "value",
            y: "name",
            labels: { ...label, overlap: "hide", place: { outside: false, attachment: "center" } },
          }),
        ],
        x: { domain: [0, 100] },
      });
      expect(written(bars).filter((text) => text !== "")).toEqual(["visible"]);
      const regions = build({
        marks: [region(rows, { x1: "a", x2: "b", label: { ...label, overlap: "hide" } })],
        x: { domain: [0, 10] },
      });
      expect(written(regions).filter((text) => text !== "")).toEqual(["visible"]);
      const notes = build({
        marks: [text(rows, { x: "a", y: "b", label: { ...label, overlap: "hide" } })],
        x: { domain: [0, 10] },
        y: { domain: [0, 10] },
      });
      expect(written(notes).filter((text) => text !== "")).toEqual(["visible"]);
      const rules = build({
        marks: [rule(rows, { y: "b", label: { ...label, overlap: "hide" } })],
        y: { domain: [0, 10] },
      });
      expect(written(rules).filter((text) => text !== "")).toEqual(["visible"]);
    }
  });
});
