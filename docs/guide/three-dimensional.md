# 3D charts

3D charts draw points (`point3d`), lines (`line3d`), and surfaces
(`surface`) in one box, turned by dragging, keys, and buttons. 3D marks
share a chart with each other, not with other marks.

- [A first 3D chart](#a-first-3d-chart)
- [Points, lines, and surfaces](#points-lines-and-surfaces)
- [The box and its axes](#the-box-and-its-axes)
- [The camera](#the-camera)
- [3D subplots](#3d-subplots)
- [Rendering: GPU and CPU](#rendering-gpu-and-cpu)
- [Readings](#readings)

## A first 3D chart

```ts
import { createChart, line3d, point3d, surface } from "herceg";

createChart(element, {
  camera: { azimuth: -60, elevation: 25 },
  z: { title: "Yield" },
  marks: [
    surface(fit, { x: "nitrogen", y: "rain", z: "yield" }),
    point3d(trials, { x: "nitrogen", y: "rain", z: "yield", series: "field" }),
    line3d(runs, { x: "nitrogen", y: "rain", z: "yield", series: "run" }),
  ],
});
```

```python
hg.scatter_3d(iris, x="sepal_length", y="sepal_width", z="petal_length", series="species")
hg.line_3d(flights, x="east", y="north", z="altitude", series="flight")
hg.surface(terrain, x="east", y="north", z="height")
hg.surface(z=heights, x=eastings, y=northings)  # a 2D array: row i, column j at y[i], x[j]
```

## Points, lines, and surfaces

| Mark | Draws |
| --- | --- |
| `point3d` | Points at number or time `x`, `y`, `z` (z is vertical). Colored by `series`, or `color` (a number field on a continuous scale, or a category naming series). `radius` 3.5 px; `labelField` names points in tooltips. |
| `line3d` | A path per `series` category through its rows in table order, so a path may turn back on any axis. A missing value breaks the path. `strokeWidth` (2 px) stays constant with depth. A one-row run draws nothing (add `point3d` for markers). |
| `surface` | A height field over a grid: each row's `x` and `y` (numbers, times, or categories) pick a grid point and `z` is its height (the last row with a value wins). Cells of four grid points are two triangles, cells of three one, so missing values leave holes. |

**Surfaces**

- Grid spacing may be irregular. Rows not on a grid (scattered samples)
  are not triangulated: bin or aggregate them first. A
  [matrix table](data.md#matrices) gives a surface its grid directly.
- Cells are colored by the mean of their corners' `z` (or `color`) on the
  sequential ramp or `colors`, and shaded by a light above and to the left
  (`shading: false` shows colors as the legend reads them).
- `wireframe: true` draws the grid's lines; `fillOpacity` makes the surface
  translucent.
- **Limits.** At most 1,048,576 grid points (`MAX_GRID_POINTS`), and
  250,000 (`MAX_CPU_GRID_POINTS`) where the CPU draws (exports, SVG, no
  WebGL2, wireframe or translucent surfaces, subplots). Larger ones throw.

## The box and its axes

- Each axis spans every mark's data, rounded to ticks. The chart's `x`, `y`,
  and `z` options set them as other axes are set (`type` `"linear"`,
  `"log"`, `"time"`, `domain`, `nice`, `zero`, `title`, `grid`, `ticks`,
  `format`).
- The box is a cube unless `boxAspect` gives relative side lengths
  (`[2, 2, 1]` for a flat box; Python `box_aspect=(2, 2, 1)`).
- Grid lines are on the three walls behind the data. Data outside a given
  `domain` is left out; surfaces and lines are cut at the walls.

## The camera

| `camera` setting | Means |
| --- | --- |
| `azimuth` | Degrees counterclockwise around z from +x, seen from above (-60). |
| `elevation` | Degrees above the floor, -90 to 90 (25). |
| `zoom` | 1 fits the box; 0.5 to 10. |
| `perspective` | `false` (default): orthographic, so equal lengths look equal anywhere. |

- Dragging turns the box (`interaction: { rotate: false }` turns that off);
  the wheel with Ctrl or ⌘ zooms with `interaction: { zoom: true }`;
  double-click returns to the configured camera.
- Buttons in the corner (shown while the pointer or focus is in the chart)
  turn, tilt, zoom, and reset; Shift+arrows turn and plus and minus zoom.
  Touch drags turn sideways and leave vertical drags to scroll the page.
- `chart.getCamera()`, `chart.setCamera({ ... })` (null returns to the
  configured camera), and a `camera` event once a frame at most.
- Updating with the same `camera` keeps the view the user turned to; a
  different one shows it.

## 3D subplots

A 3D subplot names its panel on every layer, beside panels of other marks:

```ts
import { createChart, line, panels, point3d, surface } from "herceg";
import { grid } from "herceg/layout";

const chart = createChart(element, {
  panels: panels([
    { id: "trend", title: "Trend" },
    { id: "cloud", title: "Observations", camera: { azimuth: 30 } },
    { id: "fit", title: "Fit", camera: { azimuth: 90 } },
  ], grid({ columns: 3 })),
  marks: [
    line(history, { x: "time", y: "yield", panel: "trend" }),
    point3d(trials, { x: "nitrogen", y: "rain", z: "yield", panel: "cloud" }),
    surface(fit, { x: "nitrogen", y: "rain", z: "yield", panel: "fit" }),
  ],
  interaction: { zoom: true },
});
chart.setCamera({ elevation: 40 }, { panel: "cloud" });
chart.on("camera", ({ camera, panels }) => console.log(camera, panels));
```

```python
(
    hg.Chart(data, panels=["trend", hg.Panel("cloud", camera={"azimuth": 30})],
             layout=hg.Grid(columns=2), zoom=True)
    .line("time", "value", panel="trend")
    .point_3d("x", "y", "z", panel="cloud")
)
```

- A panel's camera overrides the chart's. With several 3D panels, name the
  panel in `getCamera` and `setCamera`; camera events carry `panels: [id]`.
- Each 3D panel has its own toolbar; dragging and wheel act in the panel
  under the pointer, keys in the panel the keyboard reads.
- Subplots draw on the CPU (surfaces keep the 250,000-point limit). Each
  panel keeps its latest geometry and, on Canvas, a panel-sized raster
  (about 4 bytes per device pixel), so turning one panel does not redraw
  unchanged neighbors.
- **Limits.** 3D facets are refused (a shared camera does not define how
  surface grids split); use subplot marks. 3D marks refuse `zIndex`, row
  selections, and value animation.

## Rendering: GPU and CPU

**GPU.** A standalone chart is drawn with WebGL2 and one depth test when
every mark can be (opaque points, lines, and surfaces without a wireframe)
and the CPU would draw at least 20,000 faces (20,000 points, 10,000 surface
cells, 20,000 line segments, or a mix). Whatever is nearer shows, crossings
included. Lines are ribbons of constant screen width. Turning the camera
uploads nothing; a 1001 × 1001 surface (a million cells) turns in under
half a millisecond of JavaScript a frame. Edges are not antialiased.

**CPU** (SVG, Canvas, PDF, PNG, and every export) draws back to front:

- points alone by depth;
- one surface with points in an order exact for a height field, so points
  under a surface are hidden and those above show;
- lines cut at the walls and sorted by depth among the faces. This is
  approximate: a line piercing a cell, or two lines crossing, can be drawn
  in the wrong order near the crossing;
- several surfaces by their cells' depth, which can be wrong where they
  come close or cross.

A 317 × 317 surface (100,000 cells) takes about 92 ms a turn on the CPU.
Exports show the starting camera of a standalone chart, or the current one
of a mounted chart.

## Readings

- Tooltips, events, and the keyboard report a point's, a line point's, or
  a grid point's `x`, `y`, and `z` (and `color`).
- The pointer finds what shows on top: a point within 3 px, a line within
  3 px (the nearer segment end), or a surface cell (its nearest corner).
- The arrow keys read points in row order, lines path by path, and a
  surface's grid row by row; the description summarizes each layer, the
  axes' ranges, and the camera, reading the data, never what is drawn.
