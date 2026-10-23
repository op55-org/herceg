// What tests read of a scene's guides.
import {
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
