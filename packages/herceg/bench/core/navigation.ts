// Maps, trees, and networks as they are navigated, and network layouts from scratch.

import { fromGeoJSON } from "../../src/data/geojson.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { grid } from "../../src/layout.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { geoshape } from "../../src/marks/geoshape.ts";
import { graph } from "../../src/marks/graph.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { facet } from "../../src/model/facet.ts";
import { ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { measure, seeded } from "./shared.ts";

export async function run(): Promise<void> {
  // Maps, trees, and networks as they are navigated: a map of 200 regions of
  // 1,000 vertices panned (pixels reused, moved) and zoomed a step (projected
  // at a new level), a treemap of 10,000 leaves drilled into and back out, and
  // a network of 5,000 nodes and 20,000 links with a node dragged. Each is the
  // scene the frame draws, not its painting (see benchmarks for that).
  const regions = fromGeoJSON({
    type: "FeatureCollection",
    features: Array.from({ length: 200 }, (_, i) => {
      const [cx, cy] = [-171 + (i % 20) * 18, -54 + Math.floor(i / 20) * 12];
      const ring = Array.from({ length: 1000 }, (_, k) => {
        const a = (k / 1000) * 2 * Math.PI;
        const r = 5 + Math.sin(a * 7 + i);
        return [cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.8];
      });
      ring.push(ring[0]!);
      return {
        type: "Feature" as const,
        properties: { value: i },
        geometry: { type: "Polygon" as const, coordinates: [ring] },
      };
    }),
  });
  const map = new ChartModel({ marks: [geoshape(regions, { color: "value" })] });
  map.setSize(1200, 700, 1);
  map.scene(estimateText);
  const { x: planeX, y: planeY } = map.items!.result()!.plane!;
  /** Shows the plane's middle at `zoom` times the fitted scale, moved `shift` of its width. */
  const showMap = (zoom: number, shift: number) => {
    const [x0, x1] = planeX.domain;
    const [y0, y1] = planeY.domain;
    const [cx, cy] = [(x0 + x1) / 2 + (x1 - x0) * shift, (y0 + y1) / 2];
    const [w, h] = [(x1 - x0) / zoom / 2, (y1 - y0) / zoom / 2];
    map.items!.setView({ x: [cx - w, cx + w], y: [cy - h, cy + h] }, undefined);
    return map.scene(estimateText);
  };
  let panned = 0;
  measure("maps: pan 200 regions of 1,000 vertices, zoomed 2x", () => {
    showMap(2, (panned++ % 10) / 100);
  });
  let level = 0;
  measure(
    "maps: zoom 200 regions a step to a new projection level",
    () => {
      // Six levels, more than the shapes' cache keeps: every step projects again.
      showMap(1.2 ** (1 + (level++ % 6)), 0);
    },
    { warmup: 6, samples: 30 },
  );

  const leafRows = 10_000;
  const sales10k = table({
    region: Array.from({ length: leafRows }, (_, i) => `region ${i % 20}`),
    country: Array.from({ length: leafRows }, (_, i) => `country ${i % 1000}`),
    city: Array.from({ length: leafRows }, (_, i) => `city ${i}`),
    revenue: Float64Array.from({ length: leafRows }, (_, i) => 1 + (i % 13)),
  });
  const tree10k = new ChartModel({
    marks: [treemap(sales10k, { path: ["region", "country", "city"], value: "revenue" })],
    interaction: { zoom: true },
  });
  tree10k.setSize(1200, 800, 1);
  tree10k.scene(estimateText);
  let drilled = 0;
  measure("treemap: drill into a region of 10,000 leaves", () => {
    tree10k.items!.setDrillRoot([`region ${drilled++ % 20}`]);
    tree10k.scene(estimateText);
  });
  measure("treemap: drill into a region and back out, 10,000 leaves", () => {
    tree10k.items!.setDrillRoot([`region ${drilled++ % 20}`]);
    tree10k.scene(estimateText);
    tree10k.items!.setDrillRoot(null);
    tree10k.scene(estimateText);
  });

  // The same leaves in 12 facet panels by month, which share the drill root:
  // each region has rows in 3 months, so a drill leaves 9 panels empty.
  const monthly = table({
    month: Array.from({ length: leafRows }, (_, i) => `month ${i % 12}`),
    region: Array.from({ length: leafRows }, (_, i) => `region ${i % 20}`),
    country: Array.from({ length: leafRows }, (_, i) => `country ${i % 1000}`),
    city: Array.from({ length: leafRows }, (_, i) => `city ${i}`),
    revenue: Float64Array.from({ length: leafRows }, (_, i) => 1 + (i % 13)),
  });
  const facetTrees = new ChartModel({
    marks: [treemap(monthly, { path: ["region", "country", "city"], value: "revenue" })],
    facet: facet("month", { columns: 4 }),
    interaction: { zoom: true },
  });
  facetTrees.setSize(1600, 1200, 1);
  facetTrees.scene(estimateText);
  measure("treemap: drill 12 facet panels of 10,000 leaves", () => {
    facetTrees.items!.setDrillRoot([`region ${drilled++ % 20}`]);
    facetTrees.scene(estimateText);
  });
  measure("treemap: redraw 12 facet panels drilled", () => facetTrees.scene(estimateText));

  // The 10,000 leaves drawn whole, as a treemap and as a sunburst, and the
  // sunburst drilled into a region.
  const flat10k = new ChartModel({
    marks: [treemap(sales10k, { path: ["region", "country", "city"], value: "revenue" })],
  });
  flat10k.setSize(1200, 800, 1);
  flat10k.scene(estimateText);
  measure("treemap: redraw 10,000 leaves", () => flat10k.scene(estimateText));
  const rings10k = new ChartModel({
    marks: [sunburst(sales10k, { path: ["region", "country", "city"], value: "revenue" })],
    interaction: { zoom: true },
  });
  rings10k.setSize(1200, 800, 1);
  rings10k.scene(estimateText);
  measure("sunburst: redraw 10,000 leaves", () => rings10k.scene(estimateText));
  measure("sunburst: drill into a region of 10,000 leaves", () => {
    rings10k.items!.setDrillRoot([`region ${drilled++ % 20}`]);
    rings10k.scene(estimateText);
  });

  // Six subplots of the 200 regions, one panned while the other five keep their view.
  const sixMaps = new ChartModel({
    marks: ["a", "b", "c", "d", "e", "f"].map((panel) =>
      geoshape(regions, { color: "value", panel }),
    ),
    panels: panels(
      ["a", "b", "c", "d", "e", "f"].map((id) => ({ id })),
      grid({ columns: 3 }),
    ),
  });
  sixMaps.setSize(1800, 900, 1);
  sixMaps.scene(estimateText);
  const sixPlane = sixMaps.items!.result("a")!.plane!;
  let sixPanned = 0;
  measure("maps: pan one of 6 subplots of 200 regions, zoomed 2x", () => {
    const [x0, x1] = sixPlane.x.domain;
    const [y0, y1] = sixPlane.y.domain;
    const shift = ((sixPanned++ % 10) / 100) * (x1 - x0);
    const [w, h] = [(x1 - x0) / 4, (y1 - y0) / 4];
    const [cx, cy] = [(x0 + x1) / 2 + shift, (y0 + y1) / 2];
    sixMaps.items!.setView({ x: [cx - w, cx + w], y: [cy - h, cy + h] }, "a");
    sixMaps.scene(estimateText);
  });
  // Six facet panels of a base map of the 200 regions, under a city per region
  // split by six values, sharing one view: a pan moves them all.
  const sixFacets = new ChartModel({
    marks: [
      geoshape(regions, { color: "value", facet: "repeat" }),
      geopoint(
        table({
          lon: Float64Array.from({ length: 200 }, (_, i) => -171 + (i % 20) * 18),
          lat: Float64Array.from({ length: 200 }, (_, i) => -54 + Math.floor(i / 20) * 12),
          group: Array.from({ length: 200 }, (_, i) => `group ${i % 6}`),
        }),
        { longitude: "lon", latitude: "lat" },
      ),
    ],
    facet: facet("group", { columns: 3 }),
  });
  sixFacets.setSize(1800, 900, 1);
  sixFacets.scene(estimateText);
  const facetPlane = sixFacets.items!.result("group 0")!.plane!;
  let facetPanned = 0;
  measure("maps: pan 6 facet panels of 200 regions, zoomed 2x", () => {
    const [x0, x1] = facetPlane.x.domain;
    const [y0, y1] = facetPlane.y.domain;
    const shift = ((facetPanned++ % 10) / 100) * (x1 - x0);
    const [w, h] = [(x1 - x0) / 4, (y1 - y0) / 4];
    const [cx, cy] = [(x0 + x1) / 2 + shift, (y0 + y1) / 2];
    sixFacets.items!.setView({ x: [cx - w, cx + w], y: [cy - h, cy + h] }, undefined);
    sixFacets.scene(estimateText);
  });

  const random = seeded(7);
  const linkFrom: string[] = [];
  const linkTo: string[] = [];
  const paired = new Set<string>();
  while (linkFrom.length < 20_000) {
    const a = Math.floor(random() * 5000);
    // Mostly near neighbors, some far.
    const b =
      random() < 0.8 ? (a + 1 + Math.floor(random() * 20)) % 5000 : Math.floor(random() * 5000);
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (a === b || paired.has(key)) continue;
    paired.add(key);
    linkFrom.push(`n${a}`);
    linkTo.push(`n${b}`);
  }
  const network = new ChartModel({
    marks: [graph(table({ from: linkFrom, to: linkTo }), { source: "from", target: "to" })],
    interaction: { drag: true },
  });
  network.setSize(1200, 900, 1);
  network.scene(estimateText);
  const moves = network.items!.result()!.moves!;
  const [hubX, hubY] = moves.pixelOf('[0,"n0"]')!;
  let dragged = 0;
  measure("graph: drag a node of 5,000 nodes and 20,000 links", () => {
    const step = dragged++ % 40;
    network.items!.drag('[0,"n0"]', moves.toLayout('[0,"n0"]', hubX + step, hubY + step / 2));
    network.scene(estimateText);
  });

  // A move dropped in that network: the nodes near it settle (the scene that
  // works the settle out, and the one after, eased, at once without a clock).
  let settled = 0;
  measure(
    "graph: settle a move in 5,000 nodes and 20,000 links",
    () => {
      const step = settled++ % 40;
      const [x, y] = moves.toLayout('[0,"n0"]', hubX + step, hubY);
      network.items!.setItemPosition('[0,"n0"]', { x, y });
      network.scene(estimateText);
    },
    { warmup: 5, samples: 20 },
  );
  network.items!.setItemPosition('[0,"n0"]', null);
  // Layouts of 50,000 nodes from scratch: a circle, and layers of a tree.
  const bigFrom = Array.from({ length: 49_999 }, (_, i) => `t${Math.floor(i / 4)}`);
  const bigTo = Array.from({ length: 49_999 }, (_, i) => `t${i + 1}`);
  for (const layout of ["circular", "layered"] as const) {
    const big = table({ from: bigFrom, to: bigTo });
    measure(
      `graph: ${layout} layout of 50,000 nodes`,
      () => {
        const model = new ChartModel({
          marks: [graph(big, { source: "from", target: "to", layout, labels: false })],
        });
        model.setSize(1200, 900, 1);
        model.scene(estimateText);
      },
      { warmup: 2, samples: 8 },
    );
  }
}
