// What tests read of a scene's guides.
import {
  type AxisGuide,
  guidesOf,
  type HeaderGuide,
  type KeyGuide,
  type LegendItem,
  type RampGuide,
  type Scene,
  type TitleGuide,
} from "../../src/scene/scene.ts";

/** The series legend's entries; none without a legend. */
export function legendOf(scene: Pick<Scene, "guides">): LegendItem[] {
  return [...(guidesOf(scene, "legend")[0]?.entries ?? [])];
}

/**
 * An axis' tick marks in order along it: the pixel each stands on (its
 * stroke runs down that pixel's middle) and its length across the axis.
 */
export function tickMarksOf(guide: AxisGuide): { at: number; length: number }[] {
  const across = guide.side === "top" || guide.side === "bottom";
  const marks: { at: number; length: number }[] = [];
  for (const item of guide.items)
    if (item.type === "segments")
      for (let k = 0; k + 3 < item.coords.length; k += 4) {
        const [x1, y1, x2, y2] = item.coords.slice(k, k + 4) as [number, number, number, number];
        // The axis' line runs along it; tick marks cross it.
        if (across ? x1 === x2 : y1 === y2)
          marks.push({
            at: (across ? x1 : y1) - 0.5,
            length: Math.abs(across ? y2 - y1 : x2 - x1),
          });
      }
  return marks.sort((a, b) => a.at - b.at);
}

/** The chart's title, if drawn. */
export function titleOf(scene: Pick<Scene, "guides">): TitleGuide | undefined {
  return guidesOf(scene, "title")[0];
}

/** Panels' titles and facets' headers. */
export function headersOf(scene: Pick<Scene, "guides">): HeaderGuide[] {
  return guidesOf(scene, "header");
}

/** Legends of color ramps. */
export function rampsOf(scene: Pick<Scene, "guides">): RampGuide[] {
  return guidesOf(scene, "ramp");
}

/** Keys of sizes, shapes, and colors. */
export function keysOf(scene: Pick<Scene, "guides">): KeyGuide[] {
  return guidesOf(scene, "key");
}

/**
 * Unturned text items as their lines are drawn: a line each as "\n" breaks
 * an item's text, each a line height below the last (see `textElement`).
 */
export function drawnLines<T extends { text: string; y: number; paint: { lineHeight: number } }>(
  items: readonly T[],
): T[] {
  return items.flatMap((item) =>
    item.text
      .split("\n")
      .map((text, i) => ({ ...item, text, y: item.y + i * item.paint.lineHeight })),
  );
}
