# Statistical charts with herceg.express

`herceg.express` makes Seaborn's statistical charts in one call. It
computes their statistics with NumPy and returns an ordinary `hg.Chart` of
Herceg's marks, so the result displays, saves, and runs in notebooks and
Streamlit like any other chart.

- [Functions](#functions)
- [Arguments](#arguments)
- [Estimates and intervals](#estimates-and-intervals)
- [Regression](#regression)
- [What was computed](#what-was-computed)
- [Plots in panels](#plots-in-panels)
- [New data](#new-data)
- [Differences from Seaborn](#differences-from-seaborn)

```python
import numpy as np
import herceg.express as hx

hx.barplot(tips, x="day", y="total_bill", series="sex", estimator=np.median)
hx.lineplot(fmri, x="timepoint", y="signal", series="event", errorbar=("se", 1))
hx.pointplot(fmri, x="timepoint", y="signal", units="subject")  # repeated measures
hx.regplot(tips, x="total_bill", y="tip", order=2, facet_column="smoker")
hx.regplot(titanic, x="age", y="survived", logistic=True)
hx.histplot(penguins, x="flipper_length_mm", series="species", kde=True)
hx.kdeplot(geyser, x="waiting", y="duration", levels=5, thresh=0.1, filled=True)
hx.jointplot(penguins, x="bill_length_mm", y="bill_depth_mm", kind="hist")
hx.swarmplot(tips, x="day", y="total_bill", series="sex", dodge=True)
hx.boxenplot(diamonds, x="clarity", y="carat")
hx.pairplot(penguins, series="species")
hx.clustermap(flights_wide, z_score=1)
```

## Functions

| Function | Computes | Draws |
| --- | --- | --- |
| `barplot`, `pointplot` | An `estimator` per category, and an interval | Bars, or points joined by lines, with error bars dodged by `series` |
| `lineplot` | The estimate and interval at each x, or a line per unit | Lines with bands (`error_style="band"`) or error bars |
| `regplot`, `lmplot` | Polynomial, logistic, robust, log-x, or lowess fits with bootstrap bands | Points (or binned estimates), fit lines, bands |
| `residplot` | Residuals of a polynomial or robust fit, optionally a lowess line | Points around a rule at 0 |
| `histplot` | Seaborn's bin edges; KDE overlays scaled to them | The [histogram mark](../statistical-charts.md#histograms) as bars, steps, or polygons; 2D cells for x and y |
| `kdeplot` | Gaussian kernel densities, 1D or 2D; Seaborn's contour levels | Lines or filled areas; contour lines or bands |
| `ecdfplot` | The empirical distribution | Step lines |
| `rugplot`, `stripplot`, `swarmplot` | Swarm packing | Rug ticks; jittered points; packed swarms |
| `boxplot`, `boxenplot`, `violinplot` | Quartiles, letter values, densities | The box plot, boxen, and violin marks |
| `pairplot`, `jointplot` | Bins, densities, fits | Subplots of scatter plots, contours, or 2D histograms, with marginals |
| `clustermap` | Hierarchical clustering of rows and columns | A reordered heatmap with [dendrograms](../statistical-charts.md#dendrograms) |

SciPy is optional (`pip install 'herceg[stats]'`): `clustermap` uses its
clustering when installed and the same agglomeration in NumPy otherwise.
Logistic and robust fits run in NumPy; statsmodels is not needed. Results
are checked against Seaborn, SciPy, and statsmodels in the test suite.

## Arguments

Arguments are keyword-only after the data. What express shares with
Herceg takes Herceg's names:

| Argument | Means |
| --- | --- |
| `x`, `y` | Columns. Densities and ECDFs of `y` alone run along y. |
| `series` | A category column splitting the plot's marks into series in one legend group, so a series' bars and error bars share an entry. |
| `order`, `series_order` | Which levels, in which order; other rows are left out. |
| `palette` | A list of colors. |
| `facet_row`, `facet_column` | Facet the chart, each panel with statistics of its own. Not for `pairplot`, `jointplot`, `clustermap`, `residplot`. |
| `weight` | A column of weights from 0 up, in histplot, kdeplot, ecdfplot, regplot, barplot, pointplot, and lineplot. |
| `normalize`, `element`, `common_norm` | histplot's, as the histogram mark takes them. |
| `whiskers`, `outliers`, `depth`, `inner`, ... | The box plot, boxen, and violin marks' options. |
| `jitter` | stripplot's spread as a fraction of the band (`True` is 0.5; `hg.Jitter` brings a seed). |
| `z_index`, `encode`, `labels` | Passed to the mark drawing the plot's result (barplot's bars, lineplot's lines, ...). |
| Chart options | `title`, `width`, `height`, `theme`, `x_axis`, `scales`, `legend`, `inspection`, `tooltip`, ... as the one-call helpers take them. |

Statistical options keep Seaborn's names: `estimator`, `errorbar`,
`n_boot`, `bw_method`, `bw_adjust`, `ci`, `multiple`, `linestyles`,
`warn_thresh`, and so on.

```python
groups = {"groups": hg.OrdinalScale(map={"control": "#7f7f7f", "treated": "#d62728"})}
hx.lineplot(fmri, x="timepoint", y="signal", series="subject", scales=groups,
            encode=hg.Encodings(color=hg.Channel(field="group", scale="groups")))
hx.barplot(tips, x="day", y="tip", labels=True, z_index=1)
```

- `encode` reads the data's columns and the plot's x, y, and series as
  drawn, never a value it computes. Where the plot summarizes groups, a
  column it reads must have one value per group; otherwise it is refused
  with what to do instead.
- Rows missing a value the chart uses are left out, and the chart's
  description says how many.
- `swarmplot` packs points in the browser at the drawn size, and warns as
  Seaborn does when more than `warn_thresh` (5%) of a category's points
  cannot be placed, from the same layout run at the chart's `width` and
  `height`.

## Estimates and intervals

| Option | Values |
| --- | --- |
| `estimator` | `"mean"`, `"median"`, `"sum"`, `"min"`, `"max"`, or a function of a group's values returning one number |
| `errorbar` | `("ci", 95)` bootstrap percentile interval; `("pi", 50)` percentiles of the values; `("se", 1)`, `("sd", 1)` multiples about the estimate; a function returning `(low, high)`; `None` |
| `n_boot` | Resamples (1,000) |
| `seed` | 0 by default; `None` draws one and records it |
| `units` | Sampling units of repeated measures: `("ci", ...)` resamples units then rows in barplot, pointplot, and regplot; lineplot draws a line per unit |

Each group's resampling draws indices as Seaborn's `bootstrap` does, so a
seed gives Seaborn's intervals exactly. Groups of one value have no
interval. Resampling, densities, and fits work in chunks of about 8 MiB,
so 1,000 resamples of 100,000 values peak at about 3 MiB.

## Regression

`regplot` fits per series and panel:

| Option | Fit |
| --- | --- |
| `order` | Least-squares polynomial (weighted by `weight`) |
| `logistic=True` | Logistic regression of outcomes from 0 to 1 (as statsmodels' GLM, IRLS) |
| `robust=True` | Huber's T line, the scale re-estimated by the MAD each pass (as statsmodels' RLM) |
| `logx=True` | A line in log x |
| `lowess=True` | Locally weighted line, no band; `delta` speeds it up (10,000 rows: about 0.8 s at `delta=0`, 10 ms at 1% of the x range) |

- `x_estimator` and `x_bins` draw estimates of y at each x or bin instead
  of points, with intervals per `x_ci`; the fit uses every row.
- `x_partial` and `y_partial` remove the linear effect of other columns.
- `fit_reg=False`, `scatter=False`, and `truncate=False` (fit over the
  whole x range) as in Seaborn. `x_jitter` and `y_jitter` are refused:
  they would move points off the values tooltips read.

## What was computed

The chart's description ends with what was computed: the estimator and
method, resamples and seed, bandwidth rule, and rows left out.
`hx.statistics(chart)` returns the same, with the computed tables as NumPy
arrays:

```python
chart = hx.barplot(tips, x="day", y="tip", seed=3)
stats = hx.statistics(chart)
stats.seed, stats.tables["estimates"]["low"]
```

## Plots in panels

Functions that draw one plot (all but `pairplot`, `jointplot`, and
`clustermap`) take `panel=`, a panel of another chart's
[layout](../layout.md#subplots), and draw there. A panel holds one express
plot; options of the whole chart are refused there.

```python
dashboard = hg.Chart(tips, height=500)
left, right = dashboard.columns([2, 1])
hx.barplot(tips, x="day", y="tip", seed=3, panel=left.panel("tips"))
hx.histplot(tips, x="total_bill", panel=right.panel("bills"))
hx.statistics(dashboard, panel="tips").seed
```

## New data

An express chart remembers its call. `hx.recompute(chart, data)` makes the
chart again from new rows with the same arguments and seed, and adds again
marks added afterwards (`.rule(y=0)`). Bootstrap work of groups whose
values and options did not change is reused: appending one timepoint to a
lineplot of 1,000 timepoints resamples one group.

```python
chart = hx.lineplot(signals, x="time", y="value", series="sensor")
chart = hx.recompute(chart, signals_now)
```

- **Widgets.** `chart.widget()` of an express chart takes the function's
  data: `live.append(rows, max_rows=...)` and `live.replace(rows)` compute
  the chart again, keeping zoom, selection, legend state, and
  `live.update(...)` changes. Pair, joint, and cluster maps refuse widgets.
  See [Notebooks](notebooks-and-streamlit.md#live-charts).
- **Streamlit.** A rerun with the same data and seed makes the same chart,
  which Streamlit leaves alone; new data remounts it with its zoom and
  brush. Keep the chart in `st.session_state` and refresh it with
  `hx.recompute` to reuse bootstrap results across reruns.

Timings of express charts against Seaborn are in the
[comparison](../../comparison.md#statistical-charts).

## Differences from Seaborn

| Seaborn | herceg.express |
| --- | --- |
| `hue`, `hue_order`, `row`, `col` | `series`, `series_order`, `facet_row`, `facet_column` |
| `stat` (`"proportion"`) | `normalize` (`"probability"`) |
| `weights`, `whis`, `showfliers`, `k_depth`, `outlier_prop`, `fill`, `kde_kws`, `err_style`, `gridsize` | `weight`, `whiskers`, `outliers`, `depth`, `outlier_proportion`, `filled`, `kde_options`, `error_style`, `grid_size` |
| Swarm `size` in points | `radius` in pixels |
| Strip `jitter` as half-width in category spacing | A fraction of the band |
| A new random seed each call | Seed 0 unless given |
| Any pandas aggregation by name | `"mean"`, `"median"`, `"sum"`, `"min"`, `"max"`, or a function (given NumPy arrays) |
| `common_norm` on | Off unless asked for |
| `violinplot` with Scott's bandwidth; `inner="stick"`, `"point"` | Silverman's rule per violin, or one `bandwidth`; `inner="box"`, `"quartiles"`, `"none"`; `split=True` |
| `jointplot(kind="hex")` | Not available; `"scatter"`, `"reg"`, `"kde"`, `"hist"` |
| `x_jitter`, `y_jitter` | Refused |

Also: `("se", k)` takes the mean only; weights take the mean and `("ci",
...)` only; weights and units together are refused (Seaborn ignores
units). `pointplot` dodges with grouped bars' arithmetic and takes no
`markers`. Swarms pack about as tightly, not point for point alike.
`histplot` draws densities over layered series only, its 2D form takes no
`series`, `thresh`, `pthresh`, `pmax`, or `cbar`, and its steps and
polygons are always filled. Bivariate `kdeplot`s take no `series`, and
with facets resolve levels over every panel together. `pairplot` gives the
diagonal its own y scales. Boxen levels are shaded by fill opacity.
