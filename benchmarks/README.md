# Benchmarks

Reproducible comparisons between Herceg and other chart and grid libraries.
Results that back the [comparison](../docs/comparison.md) are committed in
`results/`; other runs go to `tmp/benchmarks/` (gitignored).

```sh
npm run bench                        # full browser suite -> tmp/benchmarks/bench-<time>.json
npm run bench -- --lib echarts,uplot --filter line- --sample-scale 0.5
npm run bench -- --out results/browser.json   # refresh the committed results
npm run bench:size -- --out results/size.json # bundle sizes
npm run bench -- --browser webkit --headless --out results/browser-webkit.json   # the suite in WebKit
npm run bench -- --browser firefox --out results/browser-firefox.json   # the suite in Firefox
npm run bench:react                  # herceg vs herceg through @herceg/react -> results/react.json
npm run bench:grid                   # grid suite (see "Grids") -> tmp/benchmarks/grid-<time>.json
npm run bench:grid-remote            # remote grids (see "Remote grids") -> tmp/benchmarks/grid-remote-<time>.json
npm run bench:first-hover -- --out results/first-hover.json   # first hover (see "First hover")
npm run bench:report                 # regenerate the tables in docs/comparison.md
npm run bench:express -- --out results/express.json   # herceg.express timings (Python)
```

Run these from the repository root. The browser suite drives the installed
Google Chrome through Playwright in a visible window; leave the machine
otherwise idle while it runs.

## Layout

| Path | Contents |
| --- | --- |
| `src/datasets.ts` | Deterministic dataset generators (seeded PRNG). Every library receives identical values. |
| `src/scenarios.ts` | Scenario catalog: chart type, size, operation, sample counts. |
| `src/page/` | In-page harness and the adapter contract. |
| `src/adapters/` | One adapter per library. Each documents the configuration it uses. |
| `src/runner/` | Node runner: builds pages, serves them, drives Chrome, Firefox, or WebKit, records results. |
| `src/size/` | Bundle size benchmark and its entry points. JavaScript and required CSS are reported separately. |
| `src/grid/` | The grid suite: fixture, reference, scenarios, harness, runner, report, and one adapter per grid in `src/grid/adapters/`; the remote grid benchmark in `src/grid/remote/`. |
| `src/report.ts` | Writes Markdown tables into `docs/comparison.md`. |
| `src/ease/` | The common-task samples of `docs/comparison.md` ("Common tasks"): a directory per task and a file per library, over the data in `data.ts` (and `data.py`). `samples.test.tsx` mounts each in Chrome (`npm run test:browser`; `vitest.config.ts` here), `python/tests/test_ease_samples.py` runs the Python ones, and `lines.ts` counts their lines. |
| `python/express.py` | Timings of `herceg.express` (Python), with Seaborn's and statsmodels' computations beside them; run in the Python package's uv environment. |
| `results/` | Committed results with environment details. |

## Methodology

### Builds and pages

Each library gets its own production bundle (esbuild, minified,
`NODE_ENV=production`) containing the harness and that library's adapter, so
a page never loads two chart libraries. Every scenario runs in a fresh page.

### Browser

Google Chrome (the installed stable channel), headed, viewport 1280x1400 CSS
px, device pixel ratio 2, cross-origin isolated pages (COOP/COEP) so
`performance.now()` has 5 µs resolution, and:

- `--js-flags=--expose-gc`;
- `--disable-renderer-backgrounding --disable-background-timer-throttling
  --disable-backgrounding-occluded-windows`, so a covered window is not
  throttled;
- for every scenario but paced ingestion, `--disable-frame-rate-limit
  --disable-gpu-vsync`, so waiting for a frame measures work rather than
  vsync alignment; paced ingestion runs in a second browser with vsync,
  since frame pacing is what it measures;
- `--force-device-scale-factor=2`, the ratio pages emulate, so Chrome
  rasterizes and composites at that ratio as well (emulation alone sizes
  canvases at 2 but rasterizes tiles at the display's own scale).

`--browser webkit` runs the suite in Playwright's WebKit build (the engine
of Safari, not Safari itself) and `--browser firefox` in its Firefox build
(`npx playwright install webkit firefox`).

- **Firefox** runs with `layout.frame_rate` 0, so frames come as soon as
  work allows; paced ingestion and orbit scenarios use a second Firefox at
  the default frame rate. `scripts/browser/firefox.ts` gives it a
  temporary application data folder (`MOZ_APP_DATA`), since macOS 27
  refuses to create `~/Library/Application Support/Firefox`.
- **WebKit** runs headless (Playwright's headed WebKit windows that are not
  frontmost get throttled frames) and has no frame rate setting, so every
  WebKit timing includes waiting for the next frame and differences under a
  frame are noise.
- Neither has Chrome's heap or process measurements, so memory scenarios
  are omitted (the JSON's `method.memory` and `method.processMemory` say
  why), and Firefox reports no long animation frames.
- `--sample-scale 0` gives one sample per scenario without warmups, for a
  smoke check; recorded results use the catalog's full counts.

Results record the Playwright version, the browser build, and the idle
frame cadence.

### Timing

An operation starts when the harness calls the library and ends when the
library reports rendering complete and the next frame has been produced: a
`MessageChannel` message posted from inside `requestAnimationFrame`, after
the frame's style, layout, and paint, so work deferred to
`requestAnimationFrame` or `ResizeObserver` counts. Libraries that render
progressively (ECharts scatter and heatmap series) report completion
through their adapter, so timings cover the complete render; Herceg's large
point series wait for its WebGL painter the same way (`chart.loading`).

These frame timings (`timeToFrame`, `tickToFrame`, `pointerToFrame`,
`viewportToFrame`, `resizeToFrame`, `cameraToFrame`, ...) end with the main
thread's frame. GPU work after it (WebGL draws, rasterizing canvases, DOM,
and SVG, compositing) is not in them.

- Animations are disabled in every library; tooltips are enabled unless a
  scenario says otherwise.
- Each scenario discards warmup iterations, then takes measured samples
  (`src/scenarios.ts`; `--sample-scale` scales both). Reports show the
  median and median absolute deviation; raw samples, p95, and p99 are in
  the JSON.
- Libraries that need another input format (row objects, `[x, y]` pairs)
  convert the shared typed arrays inside their adapter, so timings include
  the conversion, as in an application holding columnar data. The
  conversion is also stored alone as `prepare`, as a diagnostic.

#### WebGL drawing finished

For streaming, hover, zoom, resize, and 3D camera scenarios, a second run
in a fresh page times the same operations until the GPU has also finished
every WebGL context the page created (`tickToWebglDone`,
`pointerToWebglDone`, `viewportToWebglDone`, `resizeToWebglDone`,
`cameraToWebglDone`). The harness wraps `getContext` before library code
loads (`src/page/webgl.ts`) and reads one pixel from each live context's
framebuffer, which blocks until its earlier commands have run, restoring
the library's framebuffer and pixel-pack state. The run fails ("error")
when it creates a different number of contexts than the first or a context
is lost. It is a separate run because waiting for the GPU after each
operation changes how the next one overlaps with it; without waiting,
Plotly's 10M-point zoom steps queued about 12 ms of GPU work each while
taking 0.7 ms to their frames, so its display fell behind with no sign in
the frame timings.

Rasterizing 2D canvases, DOM, and SVG, and compositing, are still counted
for no library: presentation times are quantized to the display's refresh,
reading back a 2D canvas moves Chrome's canvas to software drawing, copying
canvases into WebGL textures costs more than the rasterization it would
show, and waiting a further frame makes every timing a refresh interval.
Paced scenarios with vsync (`ingest`, `orbit`) see GPU and compositor work
only when it delays frames.

### Operations

| Operation | Measures |
| --- | --- |
| `init` | Create a chart and finish rendering it; the chart is destroyed between samples. |
| `update` | Replace the complete dataset with another of the same shape. |
| `stream` | Append points to every series, drop the oldest to keep a fixed window, finish rendering; repeat. Each adapter uses the library's documented live-data API. |
| `ingest` | A timer appends data at a fixed rate (10, 60, or 100 Hz) for five seconds of wall-clock time while the display runs at its normal refresh rate. Records frame intervals, dropped frames (each frame interval spanning k refresh periods counts k - 1), long animation frames (over 50 ms), time spent inside append calls, and the ingestion rate actually achieved: a library that blocks the main thread receives fewer ticks. |
| `hover` | Real pointer moves dispatched through the DevTools Protocol, aimed at data points (mapped to pixels through each library's own coordinate API) so every library has a point to hit, to the next frame. Moves are spaced 70 ms apart so throttled hover handlers run for every event. |
| `resize` | Toggle the container between 800x400 and 600x300. |
| `zoom` | Show a sequence of x ranges covering 50%, 10%, and 1% of the data in turn, each centered further along (so ranges both zoom and pan), to the next frame. Each adapter uses the library's documented zoom or axis-range path: ECharts `dataZoom` (an `inside` component, `dispatchAction`), Chart.js scale `min`/`max` with `update('none')`, Plotly `relayout` of `xaxis.range`, uPlot `setScale`, TanStack Charts a new definition whose x scale is bound to the window with visible rows filtered (its zoom guide leaves filtering to the application), Herceg `setViewport`. |
| `dashboard` | Mount ten 600x250 line charts (15 series x 3,000 points each), then refresh all ten in one task. |
| `memory` | See below. |

### Memory

Memory is read with the Chrome DevTools Protocol after forced garbage
collection (`HeapProfiler.collectGarbage`, `Runtime.getHeapUsage`): the V8
heap, the Blink heap, and ArrayBuffer backing stores, where typed-array
data lives. Each sample: baseline, create source data, mount charts,
measure, destroy charts and data, measure.

| Value | Is |
| --- | --- |
| `retainedBytes` | Heap growth from mounting (source data excluded), the median of mounts repeated in one page |
| `sourceBytes` | The source data itself |
| `canvasBytes` | Estimated canvas backing stores (width × height × 4); not in the heap |
| `domNodes` | Elements under the chart containers |
| `leakedBytes` | Heap after destroying everything, against the baseline |

The median of repeated mounts leaves out what a library pays only once
(compiled code, caches kept after destroying: Plotly's first 1001 x 1001
surface retains about 340 MB that later surfaces reuse), and the heap
misses native objects (`Path2D`, Skia recordings, compositor layers) and
GPU memory. A separate run therefore mounts each memory scenario once per
fresh page and reads:

- `firstRetainedBytes`: the heap growth of that first mount.
- `rendererBytes`: the growth of the renderer process's physical footprint
  (macOS `phys_footprint`, read with `footprint`; the process found through
  the page's trace). Heap and native memory; allocators may keep freed
  pages. macOS only.
- `gpuBytes`: GPU memory Chrome's memory instrumentation lists in the
  page's renderer: WebGL buffers and drawing buffers (`gpuWebglBytes`), 2D
  canvas resources shared with the GPU process (`gpuCanvasBytes`), and
  compositor tiles (`gpuTileBytes`, a whole tile per composited layer
  holding anything, pooled tiles included). WebGL textures and
  renderbuffers are not listed (Plotly's 1001 x 1001 surface makes about
  13 MB of them), nor the GPU process's own copies and caches.
- `gpuProcessBytes`: the GPU process's footprint, which counts all of that
  but moves 10 to 20 MB between samples and depends on what the browser
  drew before; shown, not compared.

Readings come after a forced collection and a 500 ms pause, with one
memory dump taken first (a trace's first dump allocates tracing buffers).
The heap, `canvasBytes`, `rendererBytes`, and `gpuBytes` overlap and are not
added up. Footprints read 0 to 2 s after collection agreed within 0.1 MB
in 39 of 40 readings; first mounts agreed within about 3% between runs. A
failed dump or a restarted GPU process fails the sample. Firefox and
WebKit are not measured: after collection their content processes kept
freed memory that Chrome's does not count, and neither attributes GPU
memory to a page.

### What each metric counts, per browser

| Metric | Counts | Leaves out | Chrome | Firefox | WebKit |
| --- | --- | --- | --- | --- | --- |
| `...ToFrame` | JavaScript, style, layout, and paint recording to the end of the main thread's frame | GPU work, rasterization, compositing | yes | yes | yes, waiting for vsync |
| `...ToWebglDone` | the above, then the GPU executing every WebGL context's commands | rasterizing 2D canvases and DOM, compositing | yes | yes | yes, waiting for vsync |
| `retainedBytes` (and its parts), `leakedBytes` | V8 and Blink heaps and ArrayBuffer backing stores, median of mounts repeated in one page | native and GPU memory, costs paid on the first mount only | yes | no | no |
| `firstRetainedBytes` | the same heaps, first mount in a fresh page | native and GPU memory | yes | no | no |
| `canvasBytes` | canvas width x height x 4, estimated | everything else | yes | no | no |
| `rendererBytes` | the renderer process's physical footprint, first mount: heaps, native memory, freed pages allocators keep | GPU memory, other processes | yes (macOS) | no | no |
| `gpuBytes` | WebGL buffers and drawing buffers, canvas resources shared with the GPU process, compositor tiles, as Chrome lists them for the page | WebGL textures and renderbuffers, the GPU process's own copies and caches | yes | no | no |
| `gpuProcessBytes` | the GPU process's physical footprint, first mount | nothing in the GPU process, but it moves by 10 to 20 MB between samples and depends on what the browser drew before | yes (macOS) | no | no |

### Large-data configurations

Scenarios flagged `large` switch each library to the configuration its
documentation recommends for big data. The adapters record the exact options:

- ECharts: `sampling: "minmax"` for lines, `large: true` for scatter.
- Chart.js: `parsing: false`, `normalized: true`, min-max decimation for
  lines. Scatter keeps default parsing because its x values are unsorted.
- Plotly: `scattergl` (WebGL) traces.
- TanStack Charts: the opt-in Canvas host (`mountCanvasChart`).
- uPlot: no changes.

The sampling options reduce the number of drawn points with different bucket
rules (ECharts buckets by index, Chart.js by pixel). Their visual equivalence
to the full data has not been verified here.

Massive scenarios (10,000,000-point line, 1,000,000-point scatter) use the
same configurations. Libraries that run out of memory or time are recorded as
errors (`Target crashed`, `timed out after N s`) rather than left out; each
massive scenario gives a library 240 seconds (`--timeout` overrides every
scenario's limit). After an error the runner starts a fresh browser, since a
crashed tab can leave the old one unable to open pages.

### Fairness notes

- Libraries without a built-in chart type are reported as `n/a` (Chart.js
  heatmap, uPlot bar/scatter/heatmap) rather than benchmarked through
  third-party plugins.
- uPlot has no tooltip; its cursor and live legend are its hover readout.
- When zooming, Plotly keeps the y range it computed for all data, while the
  other libraries rescale y to the visible points (ECharts, Chart.js,
  TanStack Charts, uPlot, and Herceg recompute it), so Plotly does less work
  per zoom step.
- Canvas and SVG libraries are compared as they are. The renderer used by each
  configuration is recorded with the results.
- Results are from one machine. Compare libraries within a run, not across
  machines.

### Bundle size

`npm run bench:size` bundles each entry in `src/size/entries/` for
production with tree shaking and reports raw, minified, gzip, and brotli
sizes, JavaScript and required CSS apart. Sizes count what a page loads
before the chart renders: the entry chunk and the chunks it imports
statically, each compressed on its own as browsers fetch them. Herceg's
interaction controller (tooltips, the pointer, the wheel, and keys), which
every chart loads right after its first frame, is reported apart. Chunks
reached only through dynamic imports (the WebGL painter, animation,
brushes, crosshair labels, the range navigator, and the controls of maps,
trees, and 3D charts) are reported as optional chunks: the total an entry
could load for some chart, not what its own chart downloads.

- `herceg-react-line`, `herceg-vue-line`, and `herceg-svelte-line` leave
  the framework's runtime out, as an application using the adapter already
  ships it; the Svelte entry's own component, compiled with
  `svelte/compiler`, is measured with it.
- `herceg-bar`, `herceg-area`, `herceg-scatter`, `herceg-heatmap`, and
  `herceg-contour` chart the same data with other marks, to track what each
  adds. Only the line entries have counterparts among the other libraries.
- `herceg-pdf` is one line chart as PDF, `herceg-pdf-fonts` the same with
  embedded-font support (font bytes excluded), `herceg-spec-pdf` a portable
  spec with its loader, and `herceg-pdf-document` a two-chart A4 report.
- `herceg-grid`, `herceg-grid-pivot`, `herceg-grid-remote`, `herceg-pivot`,
  `herceg-image`, and `herceg-web` measure those subpaths; the other
  libraries have no counterparts.

### React integration

`npm run bench:react` runs plain `herceg` and `herceg-react` (the same charts
through `@herceg/react`) in one session and writes `results/react.json`.
Mounting and resizing go through React props, rendered synchronously with
`flushSync`; data replacement and streaming change the table directly, the
adapter's path for live data. Each chart is its own React root, so
per-root setup is counted once per chart.

### First hover

`npm run bench:first-hover` measures how long a chart's first tooltip takes
while its interaction controller may still be loading
(`src/first-hover/`). Each sample is a fresh page load, in headless Chrome
with the frame rate limit off, of a production build split into chunks as
an application's bundler would. The page mounts one line chart (two series
of 1,440 minutes) or ten, then moves the pointer onto the first chart 0,
10, 25, 50, or 100 ms after `createChart` returns. `drawn` runs to the
tooltip's box being shown (a `MutationObserver`), `frame` to the animation
frame after it. Caches are `cold` (HTTP cache off), `warm` (chunks cached),
and `slow` (cold, with 100 ms of latency per request). `--baseline DIR`
builds another herceg source tree into the same page for comparison.
Results report the median, p95, and p99 of 15 samples (`--samples`).

## Statistical charts

`npm run bench:express -- --out results/express.json` times
`herceg.express` in the Python package's uv environment
(`python/express.py`), with Seaborn's and statsmodels' computations beside
it. Each workload is timed over repeated runs after one warmup, with its
peak Python memory (`tracemalloc`) from one more run:

- `compute`: the numerical routine alone;
- `chart`: the express function and `to_spec()`;
- `recompute`: `hx.recompute(chart, data)` and `to_spec()` after rows for
  one more x value are appended;
- `svg`: `to_svg()` of a chart already built.

## Grids

`npm run bench:grid` compares Herceg's grid (`herceg/grid`, and the same
grid through `@herceg/react/grid`) with TanStack Table and TanStack Virtual,
AG Grid Community, and Glide Data Grid.

```sh
npm run bench:grid                                   # every scenario -> tmp/benchmarks/grid-<time>.json
npm run bench:grid -- --size 10k,100k --lib herceg,ag-grid --filter sort
npm run bench:grid -- --out results/grid.json        # refresh the committed results
node --experimental-strip-types benchmarks/src/grid/report.ts <results file>   # print the tables
```

Options: `--lib`, `--size` (`10k`, `100k`, `1m`, `1m-wide`), `--scenario`,
`--filter`, `--sample-scale`, `--timeout` (seconds), `--headless`, `--dpr`
(device pixel ratio, 1 by default, which Chrome also draws at), `--seed` (the fixture's values), and
`--order-seed` (libraries run in a seeded random order within each scenario,
so drift over a run does not favor one of them). Every scenario runs in a fresh page; a crash or timeout is
recorded as an error and the browser is restarted.

### Fixture

One seeded columnar table (`src/grid/fixture.ts`): per group of 20 fields, 16
numbers, 2 times, and 2 categories. Numbers follow different distributions
(uniform, integer with many ties, heavy-tailed, tiny, large, constant), some
with missing values; one time increases with the row and one is random with
missing values; one category has 8 labels with skewed frequencies and one has
1,000, both with missing values and with dictionary codes that do not follow
label order. About 0.5% of rows repeat the previous row in every field.
Sizes: 10,000 x 20 (overhead), 100,000 x 20 (the primary workload), and
1,000,000 x 20 and 1,000,000 x 100 (five independent groups; about 760 MB of
column buffers) as stress cases, which run a smaller set of scenarios once or
a few times. A stress case that fails is recorded as failing.

Numbers and times are `Float64Array` (NaN for missing values) and categories
`Int32Array` codes into a dictionary. Grids that take row objects get them
from `rowObjects` (missing values `undefined`, categories as labels); that
conversion is timed with mounting in "from the columns" and alone as
"conversion". Herceg adopts the arrays without copying them; Glide's adapter
reads them through `getCellContent`.

### Same grid for every library

1200 x 600 CSS pixels, 28 px rows, a 32 px header, 120 px columns, Arial
13 px, no wrapping, autosizing, or animation, and 10 rows of overscan where
it can be set. Cells read the same: `en-US` numbers with two decimals and no
minus sign on values that round to zero, times in UTC as `MM/DD/YYYY,
HH:MM:SS`, and an em dash for missing values (`FORMAT` in the fixture).
Herceg takes these as Intl options on its columns; the other adapters call
the same formatters when they render a cell.

### Verification

`src/grid/reference.ts` computes, independently of the adapters, what each
grid should show: rows filtered (ranges inclusive, missing values never
pass) and sorted (numbers and times numerically, categories by label,
missing values last both ways, ties by row identity), with each cell's
text. Every adapter reports what it shows (`visible()`): from its DOM rows
and cells by geometry, or for Glide, which draws on a canvas, what its
`drawCell` hook last drew where (pixels are not read). Herceg's rows carry
no identity in the DOM, so they are checked by their cells' text alone.

A timed operation ends at the first frame whose row count, rows, columns,
text, and selection match the reference at the grid's scroll offset, so
blank rows, stale cells, or a change not yet applied do not count; a grid
that never shows the right result within 30 s is reported `incorrect` and
not timed. Before timing, each scenario also compares the complete display
order with the reference, and streaming trials compare it after their last
tick. Updates change a field in view, and appends below the viewport change
the row count, so the checks see them.

### Timing

As for charts, an operation starts when the harness calls the adapter. What
the grid shows is checked just before each frame paints (a ResizeObserver
callback, after the frame's animation callbacks and layout), and the time
is taken when that frame has been produced, so work queued after the frame
(a React update scheduled by a scroll event) is not counted as shown. A
frame in which the observer did not run is never counted as correct. Times
include the check, whose cost is recorded as `checkTime`, and `frames`
records how many frames an operation took (Glide, which redraws after a
scroll in a React update, takes two). Between samples the harness collects
garbage and pauses, so measurements start idle; paced scenarios run with
vsync.

| Operation | Measures |
| --- | --- |
| `mount` | Create the grid from prepared native input, and from the shared columns (conversion included), to the first correct frame; destroy it. |
| `scroll` | 40 steps of the scroll offset (a screen down, three columns across, both, or to the last row and back), each to its correct frame. Herceg scales scrolling above 8 million pixels of rows, so at 1M rows a scroll lands within one scaled pixel of the requested offset. |
| `scroll-trace` | Three seconds with vsync of scrolling down at 3,000 px/s (and across at 1,500 px/s for `diagonal`), the offset set every frame; or (`wheel`) 50 px wheel events every 16 ms sent through the DevTools protocol on a fixed schedule. Frame intervals, dropped and long frames, incomplete frames (not showing the rows for the offset just before painting), and for wheel traces the events received and distance scrolled. |
| `sort`, `filter` | From source order to the result, each sample from a reset grid; also the time inside the library's call. |
| `select` | Under a sort, select one displayed row, or the first half of the rows in display order, and read the selection back. |
| `append` | An offered load with vsync: 50 slots over 5 s, one per 100 ms with seeded jitter, each appending 1,000 rows (evicting the oldest 1,000 in `rolling` cases, under a number sort in `sorted` ones). Latency from each call to the frame showing it (the first tick apart), time inside the call, lateness against the schedule, ticks delivered of those offered (a grid blocking the main thread misses slots), ticks overtaken before they showed, and frame intervals, dropped and long frames. Each trial starts from a newly mounted grid. |
| `update` | The same with 100 rows changed per tick, 10 of them on screen: a field no query reads, the sort key, or the filtered field. |
| `memory` | Heap after creating the fixture, after converting it, with the grid mounted, after a sort, a second after destroying the grid, after two rounds of five more mounts, and after releasing everything; renderer footprint and GPU memory before and after mounting; each sample in a fresh page. |

Streaming ticks keep the grid at the top (`scrollTo(0, 0)` after each
change), as a live view of the top of its order does.

### Memory

Heap readings are the chart suite's, one fresh page per sample. Reserved
growth is the heap V8 committed while mounting, without collecting. The
heap a second after destroying a grid, and after rounds of five more
mounts, shows what a library keeps once destroyed. `rendererBytes` and
`gpuBytes` span mounting the grid, as for charts; a DOM grid's GPU memory
is its cells' compositor tiles, Glide's its canvas.

### Configurations

Each adapter documents its configuration at the top of its file.

| Grid | Input | Sorting and filtering | Updates | Rendering |
| --- | --- | --- | --- | --- |
| Herceg | Table over the fixture's arrays | Row view (`setQuery`): typed-array comparators, filter expressions | `Table.append`, `dropFirst`, `set` | DOM rows and cells, 10 rows and 2 columns of overscan |
| TanStack Table 9 + Virtual 3 | Row objects | Native sorted and filtered row models (`basic` comparator, `sortUndefined: "last"`, `inNumberRange`, a membership filter function) | A new data array keeping unchanged row objects | React 19 DOM table, flushSync, 10 rows and 3 columns of overscan |
| AG Grid Community 36 | Row objects, `getRowId` | Native sorting with a comparator keeping missing values last, `deltaSort`; native number filter; the external filter for membership (Community has no set filter) | Synchronous transactions (`applyTransaction`) | DOM rows and cells, `rowBuffer` 10, animations off |
| Glide Data Grid 6 | The fixture's arrays through `getCellContent` | External: adapter code, labeled as such | Writes to the arrays; `updateCells` when order is unchanged | Canvas 2D, React 19 |

### Fairness notes

- Glide has no row model: its sort and filter rows measure Glide drawing
  the result of adapter code, labeled external. It draws on a canvas, so
  DOM node counts and memory are not comparable one to one.
- Glide is 6.0.4-alpha24, a prerelease: the stable 6.0.3 declares React 16
  to 18 as peers, and the suite uses React 19 throughout.
- AG Grid's async transactions batch for 50 ms; the scenarios use the
  synchronous path, one batch per tick.
- Herceg is measured from source at the current commit; competitors are
  pinned in `package.json`.
- Not measured: grouping, aggregation, and pivots (AG Grid's are
  Enterprise), rendering a prepared result on its own, a grid linked to a
  chart, a high-cardinality category stress case, keyboard and screen
  reader behavior, and grid bundle sizes against other grids. Committed
  results use one data seed (`--seed`) and device pixel ratio 1 (`--dpr`).

## Remote grids

`npm run bench:grid-remote` compares Herceg's remote grid
(`herceg/grid/remote`) with AG Grid Community's infinite row model (its
server-side model is Enterprise; TanStack Table and Glide leave remote data
to the application). Both read one synthetic source in the page: ten
million rows computed from their place when asked, nothing stored, each
answer after 0, 20, or 100 ms (`--latency`).

- **Settings.** Blocks of 128 rows, two requests in flight, 16 blocks
  cached, and 50 ms for scrolling to settle, also run with 0 (`--settle
  50,0`). Herceg's `settleDelay` delays only jumps, AG Grid's
  `blockLoadDebounceMillis` every block. AG Grid's datasource cannot abort
  requests; Herceg's are aborted when not needed. Herceg prefetches a block
  ahead in the scroll direction; AG Grid asks for the rows it renders.
- **Jumps** (frame rate limit off): 40 jumps to seeded random rows, each
  after a pause, from the grid's own call to put a row at the top to the
  first frame in which every row covering the viewport is mounted and shows
  its id; with the requests each started.
- **Traces** (vsync on): two seconds of the top row moving every frame at
  100 or 1,000 rows a second, three trials each: requests per second and
  the share of frames with a row in view not loaded.
- **Memory**: a grid mounted and jumped to 50 places, then destroyed and
  mounted again for four more rounds; the median round's leftover is what a
  round leaks.

These are a client's costs: the synthetic source answers any offset at
once; a database paging by offset can take much longer to reach row nine
million.

## Layouts of panels

`node --experimental-strip-types benchmarks/src/layouts/run.ts --out PATH`
measures what a dashboard layout costs over one panel drawing the same
marks: five tables of three series of 2,000 points each, drawn either as
five lines in one panel, or in columns `[2, 1]` of rows `[2, 1]` and `[1,
1]` (four titled panels) with an inset over the first, showing a part of
its x range with an indicator. It uses a production build, a 1000 × 600 px
Canvas chart, and headless Chrome at DPR 2, in five fresh pages per shape,
alternating: 19 mounts per page after the first (`createChart` and a
synchronous `render()`), 40 resizes alternating 900 and 1000 px wide
(synchronous renders), and 120 pointer moves across the panels, each the
event's synchronous handling plus the chart's part of the next frame (from
the frame's timestamp to a callback requested after the chart's). Pointer
times differ in what a tooltip lists as well: the one panel's tooltip
lists fifteen series, a dashboard panel's three. This is a Herceg workload
measurement; competitors' layouts have not been measured. Results are in
`benchmarks/results/layouts.json`.

## 3D subplots

`node --experimental-strip-types benchmarks/src/three-panels/run.ts --out PATH`
measures two separate 50,000-point CPU 3D subplots while turning one.
It uses a production build, a 1000 × 500 px chart, Chrome at DPR 1, 30
warmup turns, and five samples of 120 turns paced by requestAnimationFrame.
Synchronous `render()` times isolate JavaScript and Canvas painting from
frame pacing. A separate instrumented turn counts projection, sorting, and
point tracing; 600 further turns check retained memory after forced GC.
CDP reports JavaScript heap and backing storage separately; canvas raster
storage is estimated from panel device-pixel area. The JSON keeps every
frame time and the environment. This is a Herceg workload measurement;
competitor 3D subplot timings have not been measured.
