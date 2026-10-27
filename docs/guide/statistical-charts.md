# Statistical charts

Marks that summarize rows: histograms (one and two dimensions), box plots,
letter-value plots, violins, error bars, rugs, contours, and dendrograms.
Python's `herceg.express` computes Seaborn-style statistics in one call and
returns ordinary charts of these marks (see [Express](python/express.md)).

- [Histograms](#histograms)
- [2D histograms](#2d-histograms)
- [Box plots](#box-plots)
- [Letter-value plots](#letter-value-plots)
- [Violins](#violins)
- [Error bars](#error-bars)
- [Rugs](#rugs)
- [Contours](#contours)
- [Dendrograms](#dendrograms)
- [Summaries and selections](#summaries-and-selections)

## Histograms

```ts
histogram(requests, { x: "latency" }); // counts in round bins
histogram(requests, { y: "latency", bins: [0, 10, 25, 100] }); // horizontal, exact edges
histogram(requests, { x: "latency", series: "region", bins: { step: 10 }, normalize: "percent" });
histogram(requests, { x: "latency", series: "region", stack: "fill", element: "step" });
histogram(requests, {
  x: "latency", series: "region", normalize: "probability", commonNorm: true, cumulative: true, dodge: true,
});
```

```python
hg.histogram(requests, x="latency", series="region", bins={"step": 10})
hg.histogram(requests, x="latency", series="region", stack="fill", element="step")
hg.histogram(df, x="y", bins=20, normalize="density")
```

A histogram bins a number or time field: `x` for vertical bars, `y` for
horizontal ones (lengths from x = 0), or both for a
[2D histogram](#2d-histograms).

| Option | Means |
| --- | --- |
| `bins` | An approximate count (default about log2(n) + 1, at most 1,000), `{ step, start }` (milliseconds for times), or exact edges (2 to 1,001, finite, strictly increasing; a `RangeError` otherwise). |
| `weight` | A number field each row counts as, in place of 1. Missing or negative weights are not counted. |
| `normalize` | `"count"` (default), `"frequency"` (per unit of the axis), `"probability"`, `"percent"`, `"density"` (each series' area is 1). |
| `commonNorm` | Multiplies probability, percent, or density by the series' share of all values, hidden series included. |
| `cumulative` | Accumulates through each bin; cumulative density ends at 1 (or the series' share). |
| `stack` | `true`, or `"fill"`: shares of each bin, reaching 1. |
| `dodge` | Visible series side by side in each bin (excludes `stack`). |
| `element` | `"bars"` (default), `"step"` (an area stepping across bins), `"poly"` (through the bins' centers). |

- **Bins** are shared by every series. Default edges are round numbers or
  calendar intervals in the chart's time zone. Each bin holds
  `edges[i] <= value < edges[i + 1]`, the last its right edge too, as in
  NumPy. Values outside the edges, or below a fixed `start`, are left out.
- **Overlay.** Several series overlay translucently by default; dodged bars
  are opaque; steps and polygons are 0.75 opaque (0.25 overlaid).
- **Facets.** Each panel counts its own rows, in bins chosen from the
  panels sharing the binned axis. Normalization is per panel. A series
  absent from a panel keeps its dodge slot.
- **Tooltips** report a bin's edges, measure, and count; bins whose center
  is out of view have none. Bins are chosen again only when data changes,
  never on zoom.
- **Limits.** Horizontal histograms refuse `axis: "right"`. Histograms take
  no `tooltip.fields` (a bin is no one row).

## 2D histograms

With `x` and `y` both, a histogram counts pairs into cells, as NumPy's
`histogram2d` does, and draws them as one image, like a heatmap.

```ts
histogram(penguins, { x: "flipper", y: "mass", bins: { x: 30, y: [2500, 3500, 4500, 6500] },
  normalize: "density", colors: viridis });
```

```python
hg.histogram(penguins, x="flipper", y="mass", bins={"x": 30, "y": 20})
```

- `bins` bins both axes alike, or each with `{ x, y }`.
- Cells are colored from 0 to the fullest cell (`colors`, `colorDomain`,
  `colorMidpoint` as for heatmaps). `"frequency"` and `"density"` are per
  unit of bin area.
- Empty cells are not drawn and have no tooltip, as in Seaborn.
- Counting a million pairs into 50 × 50 bins and drawing them takes about
  12 ms (Node); static SVG holds the image (about 18 KB for those bins).
- **Limits.** One distribution: no `series` (facet instead), stacks,
  dodges, cumulative counts, or elements. No log axes or time breaks.

## Box plots

Box plots take raw values per category, or precomputed statistics.

```ts
boxplot(requests, { x: "region", y: "latency", series: "version" });
boxplot(requests, { x: "latency", y: "region" }); // a category y lays boxes along y
boxplot(requests, { x: "region", y: "latency", whiskers: 2, notch: true });
boxplot(stats, { x: "region", low: "min", q1: "p25", median: "p50", q3: "p75", high: "max", count: "n" });
```

```python
hg.boxplot(requests, x="region", y="latency", series="version")
```

| Option | Means |
| --- | --- |
| `whiskers` | Tukey's 1.5 × IQR (default), another nonnegative multiple, or `"range"` (minimum to maximum, no outliers). Default whiskers end at the most extreme observations within the fences. |
| `outliers` | `false` hides values beyond the whiskers: not drawn, not in the axis' extent, still counted in tooltips. |
| `notch` | Narrows the box at the median to median ± 1.57 × IQR / √count (not clamped, so small samples can flip). |
| `low`, `q1`, `median`, `q3`, `high`, `count` | Precomputed statistics, one row per box, with exactly one category field. Rows must satisfy `low ≤ q1 ≤ median ≤ q3 ≤ high`; notches need `count`. |
| `fill`, `fillOpacity` | One color for every box; 0.25 by default. |

Quartiles interpolate linearly, as NumPy and pandas compute them. `series`
(or a category `color`) puts boxes side by side. Raw input costs a pass and
a sort per group when the table changes; precomputed input reads columns.
On log axes, parts that cannot be placed are left out.

## Letter-value plots

`boxen` draws Hofmann, Wickham, and Kafadar's letter values, as Seaborn's
`boxenplot`: the quartiles' box, then a box out to each eighth, sixteenth,
and so on, each narrower and lighter, a median line, and dots beyond.

```ts
boxen(requests, { x: "region", y: "latency", series: "version", depth: "trustworthy" });
boxen(requests, { x: "latency", y: "region", depth: 4, widthMethod: "area", outliers: false });
```

| Option | Means |
| --- | --- |
| `depth` | `"tukey"` (default, about 5 to 8 values left per tail), `"proportion"` (about `outlierProportion` beyond, 0.007 by default), `"trustworthy"` (until confidence intervals at `trustAlpha`, 0.05, overlap), `"full"`, or a number of levels. |
| `widthMethod` | `"exponential"` (halving, default), `"linear"`, or `"area"` (area proportional to the share of values). |
| `fillOpacity` | The quartile box's (0.7 by default); each level outwards is lighter. |

## Violins

Violins draw each group's Gaussian kernel density, mirrored about the
category's center, every violin as wide at its densest, reaching two
bandwidths past the extremes (Plotly's "soft" span).

```ts
violin(requests, { x: "region", y: "latency" });
violin(requests, { x: "region", y: "latency", series: "version", split: true, inner: "quartiles" });
```

```python
hg.violin(requests, x="region", y="latency", series="version", split=True, inner="quartiles")
```

| Option | Means |
| --- | --- |
| `bandwidth` | In data units for all groups. Default: each group's Silverman rule, 0.9 min(sd, IQR / 1.34) n^-1/5. |
| `inner` | `"box"` (default: whisker line, quartile box, median dot), `"quartiles"` (dashed Q1 and Q3, solid median), `"none"`. |
| `split` | Two series as halves, first left (or below), second right (or above). Needs a `series` with at most two observed values; more is an error naming the field. |

A group whose values do not vary is a line across the violin. Densities
are of the values, not their logarithms: on a log axis the same density is
drawn on a stretched axis and the part at zero or below is left out.

## Error bars

```ts
errorbar(stats, { x: "group", y1: "low", y2: "high" }); // y, x1, x2 for horizontal ones
errorbar(stats, { x: "group", y: "mean", yError: "se" }); // mean ± se
bar(stats, { x: "day", y: "mean", series: "sex" });
errorbar(stats, { x: "day", y1: "low", y2: "high", series: "sex", dodge: true }); // on the grouped bars
```

```python
hg.Chart(stats).bar(x="group", y="mean").errorbar(x="group", y="mean", y_error="se")
```

Marks whose series stand for the same values share them: one color, one
legend entry, one visibility. Error bars dodged with grouped bars of the
same series field stand on their bars, and hiding a series regroups both.

## Rugs

A rug draws each observation of one number or time field as a short tick
at the plot's edge.

```ts
rug(requests, { x: "latency", series: "service" });
rug(requests, { y: "latency", side: "right", length: 12, label: "Requests" });
```

```python
hg.Chart(requests).point(x="latency", y="duration").rug(x="latency")
```

- Exactly one of `x` (ticks at the bottom or `side: "top"`) or `y` (left or
  right).
- `length` in pixels (8 by default), clipped to the plot; ticks stay at the
  edge through zoom and pan.
- A rug counts only toward its value axis' domain. Repeated values stay
  separate observations; the keyboard visits them in value order.
- A y rug uses only the left value axis.

## Contours

`contour` draws a field sampled on a rectilinear grid (every distinct x
crossed with every distinct y, evenly spaced or not), from a table of grid
points or a [matrix](data.md#matrices).

```ts
const field = fromMatrix({ x: xs, y: ys, density: values }, { x: "x", y: "y" });
contour(field, { x: "x", y: "y", color: "density" }); // lines at about 10 round values
contour(field, { x: "x", y: "y", color: "density", thresholds: [0.01, 0.05, 0.1, 0.2],
  variant: "bands", colors: viridis });
```

```python
hg.contour(field, x="x", y="y", color="density", variant="bands", colors="viridis")
hg.contour(color=grid, x=xs, y=ys, thresholds=[0.1, 0.5, 0.9])  # lines of a 2D array
```

| Option | Means |
| --- | --- |
| `variant` | `"lines"` (default): a line where the field crosses each threshold. `"bands"`: regions from each threshold to the next, values outside left unfilled. |
| `thresholds` | About how many round values (10 by default), or the values themselves, increasing. The same in every facet panel. |
| `colors`, `colorDomain`, `stroke`, `strokeWidth` | Bands and lines take the field's color at their value, as a heatmap would; one `stroke` for every line. |

- **Tracing.** Marching squares with linear interpolation along cell edges;
  saddles are resolved by the bilinear interpolant (the asymptotic decider),
  so contours never cross and rings always close. A grid point without a
  value leaves its four cells out as a hole. Bands are disjoint polygons
  with holes, sharing their boundaries.
- **Readings.** Each band (or line) is a series: tooltips name the band's
  range or the line's level; the keyboard reads bands in order and their
  regions one by one; the legend keys each band.
- **Cost.** Tracing runs once per grid and thresholds; zooming projects it
  again. A smooth 1,000 × 1,000 grid traces ten thresholds in about 14 ms;
  uniform noise is the worst case (about 550 ms and 81 MiB).
- **Limits.** Rows scattered rather than on a grid (values at under a
  quarter of the grid's points) are refused: bin them with a 2D histogram
  or estimate a density. No log axes, time breaks, or labels along lines.
  Regions are not rows: clicks and brushes select none of them.

## Dendrograms

`dendrogram` draws a hierarchical clustering linkage (SciPy's layout) on
category bands. Each merge row names its two child clusters and a height.

```ts
import { dendrogram, table } from "herceg";

const linkage = table({ first: [0, 2, 5], second: [1, 3, 4], height: [1, 2, 4] });
dendrogram(linkage, {
  first: "first", second: "second", height: "height",
  leaves: ["a", "b", "c", "d"], // labels indexed by leaf id
  side: "bottom", label: "Column clustering",
});
```

```python
hg.Chart(linkage).dendrogram("first", "second", "height", leaves=["a", "b", "c", "d"], side="bottom")
```

- For n leaves, ids 0 to n−1 are leaves and merge row k makes cluster
  n + k. Children must be leaves or earlier merges; heights finite and
  nonnegative. Invalid rows are named in the error.
- `side` is the plot edge at height zero: `"bottom"` (default) or `"top"`
  places leaves along x; `"left"` or `"right"` along y. With `"top"` or
  `"right"` the height axis descends.
- Leaves take bands in SciPy's `leaves_list` order; bands from earlier
  marks keep theirs, so a heatmap already in that order aligns.
- Over another mark's categories in the same panel, heights run from the
  leaves' edge to the opposite plot edge and stay fixed as the plot zooms.
- **Limits.** No series, legend entry, tooltip, keyboard stops, or value
  animation. Facets need `facet: "repeat"`.

A clustered heatmap is four subplots sharing column and row categories:

```ts
createChart(element, {
  marks: [
    heatmap(matrix, { x: "column", y: "row", color: "value", panel: "matrix" }),
    dendrogram(columnLinkage, {
      first: "first", second: "second", height: "height", leaves: columnLabels,
      side: "bottom", panel: "top",
    }),
    dendrogram(rowLinkage, {
      first: "first", second: "second", height: "height", leaves: rowLabels,
      side: "right", panel: "left",
    }),
  ],
  panels: panels([
    { id: "corner", x: { show: false }, y: { show: false } },
    { id: "top", y: { show: false } },
    { id: "left", x: { show: false } },
    { id: "matrix" },
  ], grid({ rows: [1, 4], columns: [1, 4] })), // grid from "herceg/layout"
  x: { scope: "column" },
  y: { scope: "row" },
});
```

Python's `herceg.express.clustermap` computes the clustering and builds
this chart (see [Express](python/express.md)).

## Summaries and selections

Summary marks take part in [selected rows](interaction.md#selected-rows):
a histogram bin's selected part, the selected values' own box or density
over the whole one, a cell's selected share. Histograms are brushed along
their bins, box plots and violins along their categories, and lassos
select none of their rows. Box plots, boxen, violins, rugs, contours, and
dendrograms refuse value animation; histograms animate their bars.
