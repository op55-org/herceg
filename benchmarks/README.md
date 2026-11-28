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
npm run bench:grid-sparklines        # sparkline cells (see "Sparklines") -> tmp/benchmarks/grid-sparklines-<time>.json
npm run bench:grid-export            # grid export and copy (see "Grid export") -> tmp/benchmarks/grid-export-<time>.json
npm run bench:first-hover -- --out results/first-hover.json   # first hover (see "First hover")
npm run bench:interaction -- --baseline "$PWD/../herceg-main/packages/herceg/src"   # pointer moves against another tree (see "Pointer interactions")
npm run bench -- --order-seed 3310985814   # repeat a recorded run's order (see "Run order")
npm run bench:device -- --udid UDID        # the suite on an attached iPhone (see "Device runner")
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
| `src/scenarios/` | Scenario catalog, a file per area (`init.ts`, `update.ts`, `stream.ts`, `interaction.ts`, `dashboard.ts`, `memory.ts`, `three-d.ts`, `sustained.ts`) listed in order by `index.ts`: chart type, size, operation, sample counts. |
| `src/page/` | In-page harness and the adapter contract (`adapter.ts`): what each operation must show (`expect.ts`), verified frames (`verify.ts`, `frames.ts`), the input the page receives (`input.ts`), the screenshot check (`pixels.ts`), timed and paced operations (`timed.ts`, `paced.ts`), page loads (`load.ts`). |
| `src/adapters/` | One adapter per library. Each documents the configuration it uses. |
| `src/runner/` | Node runner: builds pages, serves them (`server.ts`, with the latency case's throttle), drives Chrome, Firefox, or WebKit with trusted input (`input.ts`), in a seeded order (`order.ts`), and records results with memory ratios (`ratios.ts`). |
| `src/device/` | The device runner: the chart suite in Safari through `safaridriver`, on an iPhone or this Mac (see "Device runner"). |
| `src/size/` | Bundle size benchmark and its entry points. JavaScript and required CSS are reported separately. |
| `src/grid/` | The grid suite: fixture, reference, scenarios, harness, runner, report, and one adapter per grid in `src/grid/adapters/`; the remote grid benchmark in `src/grid/remote/`, sparklines in `src/grid/sparklines/`, and export and copy in `src/grid/export/`. |
| `src/first-hover/`, `src/interaction/` | Herceg-only benchmarks: the first hover while the interaction controller loads, and the cost of pointer moves (see "First hover" and "Pointer interactions"). |
| `src/report.ts` | Writes Markdown tables into `docs/comparison.md`. |
| `src/ease/` | The common-task samples of `docs/comparison.md` ("Common tasks"): a directory per task and a file per library, over the data in `data.ts` (and `data.py`). `samples.test.tsx` mounts each in Chrome (`npm run test:browser`; `vitest.config.ts` here), `python/tests/test_ease_samples.py` runs the Python ones, and `lines.ts` counts their lines. |
| `python/express.py` | Timings of `herceg.express` (Python), with Seaborn's and statsmodels' computations beside them; run in the Python package's uv environment. |
| `results/` | Committed results with environment details. |

### Adding a scenario or an engine microbenchmark

A chart scenario is an entry in its area's file in `src/scenarios/` (a new
area is a new file listed in `index.ts`); its `operation` picks what the
page does and checks (`src/page/harness.ts`), and every adapter that has
the chart type runs it, checked before it is timed. A new operation needs
its expectation in `src/page/expect.ts`, so the harness can tell a frame
that shows its result from one that does not, and every adapter's
`drawn()` to report what that expectation reads. Engine microbenchmarks
(`npm run bench:core`) are in `packages/herceg/bench/core/`, a file per
area exporting `run()`; a case goes in its area's file, and a new area is
a file listed in `run.ts`'s `AREAS` (`--area NAME` runs one). The areas
run in one process in `AREAS`' order, which keeps the order the cases had
in one file: a case's figures depend on what ran before it (the JIT's
state, the heap), so add new areas at the end and do not reorder them.

## Methodology

### Builds and pages

Each library gets its own production bundle (esbuild, minified,
`NODE_ENV=production`, Vue's production flags, Svelte components compiled
with `svelte/compiler`) containing the harness and that library's adapter,
so a page never loads two chart libraries. The bundle runs the input
listeners (`src/page/input.ts`) and the WebGL tracking
(`src/page/webgl.ts`) before any library code. Every scenario runs in a
fresh page. Pages are served with `no-store`, their scripts and styles
cacheable for an hour (they do not change within a run).

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

### Run order

Scenarios run in an order shuffled from a seed, and the libraries within
each scenario in a shuffled order of their own, so drift over a session (a
warming machine, other work) falls on every library alike rather than on
whichever runs first, while a scenario's libraries still run close
together in time. The seed is `--order-seed` or, when not given, a new
one; results record it with the order planned and each attempt as it
happened (`order.planned`, `order.attempts`: scenario, library, pass,
status, seconds), and the same seed gives the same order. The grid
runner does the same, attempts included. The remote grid, sparkline,
export, first-hover, interaction, and layout runners shuffle their cases
and libraries (or builds, or shapes) the same way and record the seed and
the order planned; they stop at their first failure, so what ran is the
plan up to it. A scenario's extra passes (the WebGL-done run, first
mounts, page loads) run right after its main run, in the same place of
the order.

### Input

Pointer moves, presses, drags, wheel turns, and keys are the browser's own
(trusted) events, never events a script dispatches: in Chrome through the
DevTools Protocol's `Input` domain, in Firefox and WebKit through
Playwright's mouse and keyboard, which wait until the page received each
one (`src/runner/input.ts`). The page records each event's arrival in a
capture listener on the window, before any library's listener, and timings
of input start there (`src/page/input.ts`); an event a script made
(`isTrusted` false) never starts one. Sustained traces send moves on a
fixed schedule without waiting, at most four unanswered, so a page busy
drawing receives coalesced moves as with a real pointer; moves skipped
because four were unanswered are counted.

### Timing

An operation starts when the harness calls the library (or when its input
arrived in the page) and ends with the first frame that shows its result:
the end of that frame, timed with a `MessageChannel` message posted from
inside `requestAnimationFrame`, after the frame's style, layout, and paint,
so work deferred to `requestAnimationFrame` or `ResizeObserver` counts.

#### Verified frames

Each frame after the start is checked just before it paints (a
`ResizeObserver` callback on a probe the harness resizes every frame,
after the frame's animation callbacks and layout; `src/page/frames.ts`).
The check compares what the library last drew with what the operation
asked (`src/page/expect.ts`), the same comparison for every library; a
frame that does not show it is refused (`rejectedFrames`), and the timing
runs on to the next. The watch is armed before the library is called, so
a frame the library draws in at once is the first one checked. What each
operation asks:

| Operation | A frame shows the result when |
| --- | --- |
| mount (`init`, and every scenario's starting chart) | the library has drawn at the chart's size, series 0 from the new data: its item count, first and last x, first and last value |
| `update`, `stream`, `dashboard` refresh | the library drew after the call, series 0 from the new data (for streams, the new window) |
| `zoom` | the library drew after the call, its x domain the range asked within a CSS pixel |
| `resize` | the library drew after the call, at the new size |
| `rotate` | the library drew after the call, its camera at the angles asked within 0.5° |
| `hover` | the readout (tooltip, or uPlot's live legend) writes an item under the pointer, to the decimals it shows: for lines, series 0's value for series 0 (the number right after its name, with only spaces or a colon between, as every library writes them, or the part the adapter tells apart as series 0's value, which must be that number alone: uPlot's legend cell, TanStack's row in series 0's color or its single point's y where that point is series 0's, Plotly's label of series 0's trace; a readout with neither writes nothing for it), of an item within 1.5 px along x; for points, the y of an item within 4 px both ways as the readout's last number (every library's point readout ends with its y); where a library says which item it reads, that item |

What a library drew is read where it says it has drawn: a snapshot of its
model's state (data, domains, size, camera) taken at that draw boundary,
not after the operation's call returns (each adapter's `drawn()`, its
`verification` recorded with the results). Every library but TanStack
Charts shows its series under the dataset's names (`series 1`, ...),
Herceg's fields too; TanStack's marks carry no names, so its adapter finds
series 0's value by its row's color or the mark its tooltip's point is in:

| Library | Read at |
| --- | --- |
| Herceg | the chart's `render` event after each frame's draw: the size it drew at (its root's style, which each draw sets), the first panel's plot and axis domains, series 0's rows, the camera; the tooltip element's text before paint, and the row from the `hover` event |
| ECharts | the `rendered` event after each frame zrender draws: the grid's rectangle, the axes' extents, series 0's raw data; the tooltip element's text before paint, and the item from `updateAxisPointer` and `mouseover` |
| Chart.js | a plugin's draw hooks: `afterDraw` (size, chart area, scales, series 0's items) and `afterTooltipDraw` (the tooltip's text and series 0's point, as drawn on the canvas) |
| Plotly | at `plotly_afterplot`, or after a call's promise (Plotly has drawn) where that event did not fire during it: the layout's size, plot area, axis ranges, series 0's trace, the 3D camera; the hover layer's text before paint, with series 0's label and the point from `plotly_hover` |
| TanStack Charts | the host's scene (its renderer's output, new on each render) before paint, a new scene counting as a draw: size, plot bounds, scale domains, the first mark's points and their count; the tooltip element's text, and series 0's row by its swatch's color, or a single point's y where `onFocusChange` says the point is in series 0's mark (TanStack names no point index, so any of series 0's items under the pointer counts) |
| uPlot | the `draw` hook after each redraw: size, scales, series 0's data; the plot's place and the live legend's value for series 0 before paint, with the cursor's index |

A library whose progressive rendering reports completion (ECharts' scatter
and heatmap series, Herceg's WebGL painter through `chart.loading`) is
checked once it has completed, so timings cover the complete render. A
frame that shows the result within 120 s of the start (2 s for a hover)
ends the operation; otherwise, or when 15 s after the call returned (and
progressive rendering finished) frames still show something else, the
operation is incorrect. The checks' cost is inside the timing and recorded
as `checkTime`, their total over an operation's frames; frames in which
the pre-paint observer did not run are never credited and are counted as
`unobservedFrames`. What each adapter reads at its library's draw boundary
(a few values: sizes, domain ends, two items of series 0, a tooltip's
text, a binary search for the hovered item; for TanStack, a walk of the
first mark's points in its scene, which has no count to read) is inside
the timings and not in `checkTime`.

These checks read what the library drew with, at the moment it says it
drew: its model's data, domains, size, and camera. They do not read back
pixels in every frame, which would change the timings, nor walk each
library's geometry, which would cost libraries unequally; the screenshot
before timing (below) is where pixels are checked.

#### Checked before timing

Before a scenario is timed for a library, a page of its own mounts the
scenario's charts and runs its operation once (a move to the first target
for hover and traces), each verified as above, then takes a screenshot and
checks that it shows the marks where the drawing says
(`src/page/pixels.ts`): pixels in the marks' colors in at least a 400th of
the plot, and for lines, series 0's color (or its fill's, for areas)
within 3 px of where its points and segments run by the drawn domains, in
a dozen columns across the plot; where other series run within 3 px of
it, the color of one of them counts too, since the one drawn later covers
it and no pixel tells them apart. Series 0 must run through at least 4 of
the columns and show in at least half of them; a pixel in the page's
white never counts as a mark. The check's page collects its garbage
before it closes, and the timed page opens a second after: the screenshot
is decoded in the page, and without that pause its teardown ran into the
first timed samples (small mounts 0.1-0.6 ms slower in Chrome).
A library failing the check, or failing to show any operation's result in
any timed pass (the main run, the WebGL-done run, a first mount, a page
load), is recorded `incorrect` with the reason and no timings, not as a
partial row. An error in an extra pass (a crash, a time-out) keeps the
main run's timings, says why in `fullCostReason`, and drops every sample
of the extra passes, all or none (`withPasses` in `src/runner/results.ts`,
tested in `results.test.ts`). The tests in `src/page/broken.test.ts` hold
the page to it with broken adapters: a chart that never draws, one that
reports a draw it never painted, one that zooms to the wrong range, a
blank heatmap, and one that goes wrong after the check passed.

The pixel check covers lines and areas in detail and other chart types by
their colors only; 3D charts are checked for saturated pixels. Paced
operations (`ingest`, `orbit`, `trace`) record which frames showed which
tick or move rather than refusing frames (a tick shows when every chart's
series 0 keeps the window it leaves: its count, and its first and last x
and value), and each ends with a verified frame showing its last tick,
move, or camera: a run whose last input never shows within 15 s is
incorrect. `orbit`'s frames before its last are not checked.

#### Notes

These frame timings (`timeToFrame`, `tickToFrame`, `pointerToFrame`,
`viewportToFrame`, `resizeToFrame`, `cameraToFrame`, ...) end with the main
thread's frame. GPU work after it (WebGL draws, rasterizing canvases, DOM,
and SVG, compositing) is not in them.

- Animations are disabled in every library; tooltips are enabled unless a
  scenario says otherwise.
- Each scenario discards warmup iterations, then takes measured samples
  (`src/scenarios/`; `--sample-scale` scales both). Reports show the
  median and median absolute deviation; raw samples, p95, and p99 are in
  the JSON.
- Libraries that need another input format (row objects, `[x, y]` pairs)
  convert the shared typed arrays inside their adapter, so timings include
  the conversion, as in an application holding columnar data. The
  conversion is also stored alone as `prepare`, as a diagnostic.
- A pause before a short operation lets an otherwise idle CPU lower its
  clocks, and on machines that do, the operation can take several times
  longer than in a continuous stream of input. Herceg's hover rows here measured
  1.9-2.7 ms on an idle machine and 0.2-0.3 ms with a busy loop running
  beside the browser (Apple M6, Chrome 157). Compare such figures only
  within one session; see "Pointer interactions".

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
| `ingest` | A timer appends data at a fixed rate (10, 60, or 100 Hz) for five seconds of wall-clock time (sixty in `ingest-chart-60hz-60s`) while the display runs at its normal refresh rate. Records frame intervals, dropped frames (each frame interval spanning k refresh periods counts k - 1), long animation frames (over 50 ms), time spent inside append calls, the ingestion rate actually achieved (a library that blocks the main thread receives fewer ticks), and each tick's time to the first frame showing it (`tickToShownFrame`), with the ticks a later one superseded before they showed and those never shown. |
| `hover` | Trusted pointer moves (see "Input"), aimed at data points (mapped to pixels through each library's own coordinate API) so every library has a point to hit, from the move's arrival to the first frame whose readout shows the point (`pointerToFrame`). Moves are spaced 70 ms apart so throttled hover handlers run for every event. |
| `trace` | Trusted moves every 8 ms for sixty seconds, sweeping back and forth over series 0's points, with the display's refresh on: frame intervals, each move's time from its arrival to the first frame whose readout shows its item or a later move's (`moveToShownFrame`), moves superseded and never shown, the share of frames showing the latest move received (`currentFrames`), and the moves sent and skipped. |
| `resize` | Toggle the container between 800x400 and 600x300. |
| `zoom` | Show a sequence of x ranges covering 50%, 10%, and 1% of the data in turn, each centered further along (so ranges both zoom and pan), to the next frame. Each adapter uses the library's documented zoom or axis-range path: ECharts `dataZoom` (an `inside` component, `dispatchAction`), Chart.js scale `min`/`max` with `update('none')`, Plotly `relayout` of `xaxis.range`, uPlot `setScale`, TanStack Charts a new definition whose x scale is bound to the window with visible rows filtered (its zoom guide leaves filtering to the application), Herceg `setViewport`. |
| `dashboard` | Mount ten 600x250 line charts (15 series x 3,000 points each), then refresh all ten in one task. |
| `memory` | See below. |

### Page loads

Five initial-render scenarios (`line-small-init`, `line-medium-init`,
`bar-small-init`, `scatter-medium-init`, `heatmap-medium-init`, flagged
`load`) also time loading the page: from navigation start to the chart's
first verified frame, in a new browser context per sample (five, scaled by
`--sample-scale`), with the time to the script evaluated
(`...Evaluated`), the data made (`...Fixture`), the chart created to its
frame (`...CreateToFrame`), and the bytes transferred (`...TransferBytes`):

- `cold`: nothing cached;
- `warmAsset`: after one earlier visit in the same context cached the
  page's script and styles;
- `latency`: cold, through the server's throttle: 150 ms before each
  response's headers and 1.6 Mbit/s shared by every response body under
  way, sent in 16 KB chunks (Chrome's "Slow 4G" profile, applied by the
  server so it is the same in every browser and on a phone).

The page's bundle holds the harness and the library's whole adapter (every
chart type it draws), so transfer sizes are the benchmark page's, not an
application's; `npm run bench:size` measures the libraries' own bytes.
The scenarios' own timings are the warm case: the page loaded, the
library's code run through the warmup iterations. Where the browser
reports transfer sizes, each load is checked to have been what its case
says (cold and latency loads fetched the scripts and styles, warm-asset
loads took them from the cache) and fails otherwise; each row keeps its
cases' first resources with their bytes on the wire (`loads`).

### Sustained runs

`ingest-chart-60hz-60s` and `hover-trace-line-medium-60s` run for sixty
seconds with the display's refresh on, one trial each (the trace after a
five-second warmup), and keep every frame's interval and every tick's or
move's time to its shown frame as raw samples (p50, p95, p99 in the
summaries). Each also records a histogram of frame intervals by the
refreshes they span (`distributions.frameInterval`: edges at 1.5, 2.5,
3.5, and 4.5 refresh intervals, counts for one refresh, two, three, four,
and five or more), so stalls a five-second run misses show. Frame
intervals cover the offered run; after it, the ledger keeps watching until
no tick or move waits (each is given up as unshown once it has waited
15 s), so a late frame still counts for the input it shows, and the trace
records that wait as `drainTime`. Each ingest trial continues after the
ticks the earlier ones appended, so every window it checks is the data
actually kept.

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

#### Memory amplification

Memory is also given as ratios over the source data's own bytes,
`dataBytes`: the typed arrays' bytes (each byte of a buffer once, however
many arrays view it, so charts sharing an x column count it once) and
strings at two bytes a UTF-16 code unit, as the harness made the data, the
same for every library (`src/runner/ratios.ts`; for grids, the fixture's
column buffers and its categories' labels). Each ratio is computed per
sample and left out where its reading was not taken. What each reading
spans differs between the suites, and the names say so:

| Ratio | Charts | Grids |
| --- | --- | --- |
| `heapRatio` | `retainedBytes / dataBytes`: the median of mounts repeated in one page, from the data prepared (the adapter's conversion included) | `(inputBytes + retainedBytes) / dataBytes`: converting the columns to the grid's input and mounting it, each sample a fresh page; compare with charts' `firstHeapRatio` |
| `firstHeapRatio` | `firstRetainedBytes / dataBytes`: the first mount in a fresh page | — |
| `mountRatio` | — | `retainedBytes / dataBytes`: mounting from the native input alone |
| `processRatio`, `gpuRatio` | `rendererBytes`, `gpuBytes` over `dataBytes`: the first mount in a fresh page, from the data prepared | — |
| `processMountRatio`, `gpuMountRatio` | — | `rendererBytes`, `gpuBytes` over `dataBytes`: the mount from the native input (the conversion not included) |
| `canvasRatio` | `canvasBytes / dataBytes` | `canvasBytes / dataBytes` |

A ratio of 0.06 is a library keeping 6 bytes for every 100 of its data;
one over 1 keeps more than the data itself. The readings overlap as their
numerators do, so the ratios are not added up.

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
  `svelte/compiler`, is measured with it. So do the grid entries of each
  adapter (`herceg-react-grid`, `herceg-vue-grid`, `herceg-svelte-grid`,
  and their `-remote` and `-pivot` entries).
- `herceg-bar`, `herceg-area`, `herceg-scatter`, `herceg-heatmap`,
  `herceg-contour`, and `herceg-segment` (an arrow from each point to the
  next) chart the same data with other marks, to track what each adds. Only the line entries have counterparts among the other libraries.
- `herceg-pdf` is one line chart as PDF, `herceg-pdf-fonts` the same with
  embedded-font support (font bytes excluded), `herceg-spec-pdf` a portable
  spec with its loader, and `herceg-pdf-document` a two-chart A4 report.
- `herceg-grid`, `herceg-grid-pivot`, `herceg-grid-remote`, `herceg-pivot`,
  `herceg-image`, and `herceg-web` measure those subpaths, and
  `herceg-grid-sparklines` a grid with a sparkline column; the other
  libraries have no counterparts.
- `herceg-web` is a page's script with series and annotation marks;
  `herceg-web-heatmap`, `herceg-web-segment`, and `herceg-web-dashboard`
  (a line, a heatmap, and a pie in panels) add the families of marks and
  features those pages load before their first frame, taken from the
  package's source as the page imports them.
- `herceg-lineage` is a bar of row groups highlighting a selection of their
  source's rows: the chart, its row selection, and the lineage reader
  (contributors and coverage), which it takes from the package's source
  until the row-selection binding loads it.

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
of 1,440 minutes) or ten, and 0, 10, 25, 50, or 100 ms after
`createChart` returns it asks the runner for a trusted move onto the first
chart (`sinceMount` records the delay to the move's arrival, the runner's
dispatch included). From the move's arrival, `drawn` runs to the tooltip's
box being shown (a `MutationObserver`), `frame` to the animation frame
after it, and `shown` to the end of the first frame whose pre-paint check
saw the tooltip write series a's value under the pointer. Frames are
checked from when the chart's `loading` settles (its interaction
controller among what it loads), since no frame shows the tooltip before:
checking every frame from the move would draw frames back to back while
the controller's code loads, which delays it (by 13-19 ms at 0 ms, cold or
slow). A sample in which a frame showed the tooltip before the checks
began fails the run. `frame` is a scheduling diagnostic rather than a
latency: after a frame that a trusted move started, Chrome often waits a
display refresh before the next one (about 20 ms after `drawn`), which it
does not after a synthetic event; `shown` is the figure to compare. A
trusted move costs more than a synthetic event dispatched in the page
would: with one chart at 0 ms, while the controller still loads, the
tooltip comes about 13 ms later (cold and warm caches). Caches are
`cold` (HTTP cache off), `warm` (chunks cached), and `slow` (cold, with
100 ms of latency per request and no bandwidth limit, Chrome's network
emulation). `--baseline DIR` builds another herceg source tree into the
same page for comparison; cases, and builds within each, run in a seeded
order (`--order-seed`). Results report the median, p95, and p99 of 15
samples (`--samples`).

### Pointer interactions

`npm run bench:interaction` measures what Herceg's pointer moves cost
(`src/interaction/`), to catch regressions in the engine's input and
drawing path; it compares no libraries. Fifteen fixtures, each move
checked for its effect:

| Fixture | Charts | A move's effect |
| --- | --- | --- |
| `hover-listener` | One chart of 8 series x 2,000 minutes, and a rule a `hover` listener moves to the hovered minute | The rule drawn there |
| `hover-headings` | `hover-listener`'s chart, its lines' tooltip with heading parts, which every point read writes though the tooltip of eight keeps its place | The rule drawn there |
| `hover-totals` | `hover-listener`'s chart, its lines' tooltip totalling the eight (`tooltip: { total: true }`) | The rule drawn there |
| `custom-hover` | One chart of 2,000 custom range items (A2's comets) read `"nearest"`, their tooltip with `content`, `fields`, and a `heading` of the comet's id and category | The tooltip showing the comet under the pointer |
| `segment-hover` | `custom-hover`'s comets as a segment of the same shape (a tail tapering to a point from a dot, one outline a row), read and checked alike; a baseline tree without segments cannot mount it, and the candidate runs it alone | The tooltip showing the comet under the pointer |
| `point-hover` | One SVG chart of many marks: 3,500 translucent points in two series, a circle each (under the automatic renderer's canvas threshold), read along x (`"nearest-x"`) with a crosshair, markers, and a tooltip | The hover reported at the move, once drawn |
| `pan-labels` | One chart of 8 series x 5,000 minutes zoomed to a fifth, labelled at each series' first and last observation in view, dragged 20 px right and back | A frame of the moved view |
| `pan-view-labels` | `pan-labels`' chart labelled where each line crosses the view's start and end (`view-start`, `view-end`) | A frame of the moved view |
| `anchor-pan` | One chart of 3 series x 5,000 minutes zoomed to a fifth, with a button anchored 8 px above the highest observation of each of 20 stretches in and around the view (fitted, so those at the plot's top go below their point), dragged 20 px right and back | A frame of the moved view, its anchors placed with it |
| `cross-filter` | Three histograms of one 50,000-row table sharing a live `rowSelection`, the first brushed | All three drawn after the brush moved |
| `lineage-hover` | A bar of the 40 groups of a 50,000-row table bound to the table's store through `lineage`, a range of the table selected once; the pointer moves over the bars with the selection unchanged, so a move reads the coverage the bars keep and computes none; a baseline tree without `lineage` cannot mount it, and the candidate runs it alone | The hover on the bar under the pointer, its tooltip saying how many of the group's rows are selected, as counted again from the rows |
| `crosshair-dashboard` | Ten 600x250 charts of 15 series x 3,000 minutes sharing `interaction.sync.cursor`, the pointer over the first | The other nine reporting the cursor at the new minute (`hover` with cause `"sync"`, reported once drawn) |
| `crosshair-totals` | `crosshair-dashboard`'s charts, each one's lines totalling their fifteen | As `crosshair-dashboard`'s |
| `pick-crowd` | One chart of 12 crossing lines x 2,160 minutes (A1's crowd) with `select: "series"`, so every move picks for the cursor, and a `hover` listener; each move lands where two lines cross, inside both strokes | The hover reported there, naming the line picked |
| `rule-drag` | `pick-crowd`'s lines, each named at its last minute in view outside the plot, and a rule at a value with `drag` (A1's threshold), pressed and dragged 6 px up and back; an `itemMove` listener gives each preview's value back with `update` in a task of its own, as a React application holding the value in its state does, so each move draws the preview and then the options | A frame of the options with the rule where the move put it |

A block is a fresh page in headless Chrome (the frame rate limit off,
device pixel ratio 2, cross-origin isolated) of a production build:
mounting, 10 warmup moves, and 30 measured, trusted pointer moves through
the DevTools Protocol (see "Input"); fixtures and modes run in a seeded
order (`--order-seed`), blocks within them AB, BA as below. `latency` runs from a move's first `pointermove`
to a `MessageChannel` message posted from the animation frame after its
effect was drawn. An effect counts only from reports made after the
move's input arrived (the hover at the move's position, the view, the
channel, the cursor), and as drawn once a `render` of the revision its
change made has come; a move whose effect is not drawn within 1 s is a
miss, and misses fail the run. After the measured moves, untimed, each
block makes three check moves to places no move went (other minutes,
comets no move read, views, and brushes), waits for each one's effect,
and checks what the page then shows against the fixture's data, never
the SVG export:

- `hover-listener`, `hover-headings`, `hover-totals`: the rule in a
  screenshot, at the pointer's minute and nowhere else; with headings, the
  shared reading headed by its place, its points carrying their headings in
  builds that write them; with totals, the reading's total the sum of its
  points and the tooltip's last row (in the candidate; a baseline may write
  none).
- `custom-hover`, `segment-hover`: the tooltip showing the comet under
  the pointer, headed by its own heading in builds that write headings.
- `point-hover`: the crosshair in a screenshot at the points read and
  nowhere else, over the points at every height clear of the tooltip (and
  its shadow) and the markers, and a marker for each point read. The
  fixture refuses to run unless the chart drew its points in SVG.
- `pan-labels`, `pan-view-labels`: the labels the canvas painted since it was last cleared
  (its `fillText` and halo `strokeText` calls, recorded during check moves
  only) and shown in a screenshot: one naming each series at the view's
  end and one "start" in its color at the view's start. Every label in a
  column, other labels following the series included, stands where the
  layout keeps labels apart (`checks.ts`): from its series' point (its
  first or last minute in view; with `view-*`, the line's value at the
  view's edge, between the minutes around it), each a line of the theme's height and its
  halo below the one before, the sum of squared moves least, within the
  plot.
- `anchor-pan`: each anchor 8 px above or below its place where it is in
  view and hidden where it is not (and, in builds whose anchors fit,
  inside the chart on the side it says, some below their place).
- `cross-filter`: the bars of all three histograms. In the live SVG, each
  across its bin's edges on the x axis and from the y axis' 0 to the bin's
  rows, its parts meeting without gaps or overlaps, opaque to the rows the
  brush holds (counted from the data) and faint above. In a screenshot,
  each part in its fill composited over the plot's white, within rounding,
  outside the tooltip and its shadow and the first chart's brush shading.
- `crosshair-dashboard`, `crosshair-totals`: the crosshair in a screenshot
  of each of the nine other charts, at the first chart's minute and
  nowhere else; with totals, the first chart's total as `hover-totals`'.
- `pick-crowd`: three crossings no move went near, each where one line's
  centre line is the nearest by 0.2 px or more and lines drawn over it
  hold the pointer too. The fixture's `hover` listener selects the series
  the hover names, which the chart draws in a marked color; in a
  screenshot, the line drawn so (in every column where it is 4 px or more
  from the others) is the one whose centre line, through its
  observations on the chart's scales, is nearest the pointer, and the
  pointer cursor shows. Both builds are held to it, so a baseline needs
  strokes ranked by their centre lines.
- `rule-drag`: the rule in a screenshot at the pointer's height, within
  2 px, in two thirds or more of the plot's columns clear of the tooltip,
  and nowhere else in the plot.

The checks fail on engines changed to draw these wrong: the rule not
drawn on the canvas, or left where first drawn; the crosshair 5 px off;
selected bars drawn as plain ones, or 5% too tall; bars not drawn, moved
(in their path or by a transform), invisible, 1 px wide, split into parts
that overlap and leave a gap, or at 65% opacity; labels at the plot's
middle, 3 px off, at another series' points, left at their first view,
drawn twice, or kept apart by half their height; anchors left where first
placed, or 3 px off; the pointer's overlay under the data; a dragged rule 3 px off the pointer; lines picked by
paint order (the topmost stroke holding the pointer). `checks.test.ts`
tests the label and bar models.

`work` is the main thread's task time (`TaskDuration`) between a reading
before each move is armed and one after its latency has resolved: the
move's work and the harness's two small evaluations. It is taken in a
separate pass, since the Performance domain slows the page it watches.
Results name each build's source tree, its commit and whether it had
changes, and a hash of its bundle.

**The CPU's idle state.** On a machine that lowers its clocks while idle,
work that starts after a pause runs slower, and the less work, the more
so. The study's dashboard crosshair took 0.7 ms per move with a busy loop
running beside the browser and 5.5 ms with moves 50 ms apart on the same
build; a fixture's latency is 1.3-2.1 ms in a stream of moves and 6.3-8.4
ms with 70 ms before each (Apple M6, Chrome 157). Figures from different
sessions, or from a session the rest of the machine kept busy, are not
comparable, so the benchmark runs two modes and compares builds only
within one session:

- `sustained` sends each move as soon as the last one's effect has been
  drawn, as a hover or a drag sends them, so the input keeps the CPU
  awake. It is the regression gate.
- `quiet` waits 70 ms before each move, as the suite's hover rows do:
  what a single move costs on an idle machine. Reported, not gated: the
  idle state makes it noisier.

`--baseline DIR` builds the same page against another herceg source tree
(main's, say) and alternates the two in one Chrome session, in blocks
ordered AB, BA, AB, ... (6 blocks by default), after an unrecorded block
of each for every fixture and mode: a session's first pages run slower. Each comparison is the
median, over blocks, of the candidate's block median over the
baseline's. In runs of at least the default size (6 blocks of 30
measured moves), a sustained `latency` or `work` comparison over 1.1 that
is also more than 0.1 ms slower is reported as a regression, and the run
exits with an error. Main against itself, in five sessions, stayed
within 0.93-1.07 in sustained mode (single blocks 0.69-1.30). 0.25 ms of
work added to every scheduler frame gave 1.09-1.27 (latency) and
1.05-1.19 (work) in two sessions of all seven fixtures: the gate flagged
every fixture in one and all but the cross-filter (1.09 and 1.05) in the
other, so a cost that small is at the gate's edge there. The gate's
millisecond test compares the two builds' medians, not paired blocks: the
crosshair's latency, 1.13 by its paired blocks, was 0.04 ms slower by its
medians and not flagged (its work was). `results/interaction.json` is the
last of those sessions, main's engine in both builds: a record of the
noise. Against step 8's engine
(f316bdff), today's crosshair and cross-filter are within 0.94-1.03, and
the hover listener's change draws in the move's frame (22 ms then, 1.4 ms
now).

```sh
npm run bench:interaction                     # this tree alone, both modes
git worktree add ../herceg-main main          # a checkout of the baseline
npm run bench:interaction -- --baseline "$PWD/../herceg-main/packages/herceg/src" --baseline-label main
npm run bench:interaction -- --fixture crosshair-dashboard --mode sustained --blocks 10
npm run bench:interaction -- --out results/interaction.json   # relative to benchmarks/
```

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
grid through `@herceg/react/grid`, `@herceg/vue/grid`, and
`@herceg/svelte/grid`: `herceg-react`, `herceg-vue`, `herceg-svelte`)
with TanStack Table and TanStack Virtual, AG Grid Community, and Glide
Data Grid.

```sh
npm run bench:grid                                   # every scenario -> tmp/benchmarks/grid-<time>.json
npm run bench:grid -- --size 10k,100k --lib herceg,ag-grid --filter sort
npm run bench:grid -- --out results/grid.json        # refresh the committed results
npm run bench:grid -- --lib herceg-react,herceg-vue,herceg-svelte,tanstack-table --filter framework-cells --out results/grid-framework-cells.json   # framework cells (see "Framework cells")
node --experimental-strip-types benchmarks/src/grid/report.ts <results file>   # print the tables
```

Options: `--lib`, `--size` (`10k`, `100k`, `1m`, `1m-wide`), `--scenario`,
`--filter`, `--sample-scale`, `--timeout` (seconds), `--headless`, `--dpr`
(device pixel ratio, 1 by default, which Chrome also draws at), `--seed`
(the fixture's values), and `--order-seed` (the run order, as the chart
suite's: see "Run order"). Every scenario runs in a fresh page; a crash or
timeout is recorded as an error and the browser is restarted.

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
Herceg writes every column through field displays (`fields:
compileFields(rules)` from `herceg/fields`: the Intl options by kind and
the em dash as their missing text), since a grid without displays writes
missing values as empty; the other adapters call the same formatters when
they render a cell. The Herceg grid measured therefore includes
`herceg/fields` and its per-cell display path.

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

### Looks

`looks` scenarios (100,000 x 20 and 1,000,000 x 20: mount, vertical and
diagonal scroll steps and traces, and the rolling append) show conditional
formatting on six presented columns of the first screen
(`src/grid/looks.ts`): two threshold fills (`n0`, `n1`), a gradient along
`n2` over the extent of the rows shown, a fill for the 100 largest `n3`
(ties in), a text color by `c0`'s label, and a row condition (`n4` over
900) filling every cell without a fill of its own; text over a fill is
black or white by WCAG contrast. Each frame's check compares every cell's
background and text color with the reference's (gradients within 3 of 255
per channel, as libraries quantize differently), so a grid that has not
recolored cells after the domain or the 100th value moved is not counted
as showing the frame.

| Grid | How it shows looks |
| --- | --- |
| Herceg | Columns' `encode` (thresholds and the label's colors through field displays, the gradient through a scale of the grid's, a rank test) and the grid's `encode` (the row condition); the grid keeps the domain and the rank as rows stream, and picks the text's ink |
| TanStack Table | Each cell's `style` (background, color) computed while rendering |
| AG Grid | `cellStyle` on every column (styles set empty where a cell has none, as AG Grid keeps a style a cell stops returning); `refreshCells({ force: true })` after an append moved the domain |
| Glide | `themeOverride` (`bgCell`, `textDark`) in `getCellContent` |

The other grids compute looks in adapter code (`LookState`,
`LookTracker`): the extent and the 100 largest values kept as rows arrive
and leave, every live row read again only when a row leaving held an end
or one of the 100, and the contrast computed per fill. Mounts also report
the page's first mount (`coldFromNative`, before warmup) and, after the
warm samples, mounts over the same rows with every dictionary reversed
(`reorderedFromNative`), which a cache of outputs by code must not mistake
for the table before.

### Cells

`cells` scenarios (100,000 x 20 and 1,000,000 x 20: mount, vertical and
diagonal scroll steps and traces, and memory) draw more than text in five
columns of the first screen (`src/grid/cells.ts`): bars from 0 on `n0`
(within 0 to 1,000) and `n4` (within the extent of every row, 0
included), `c0`'s labels in chips filled by label ("active", "blocked"; a
faint default otherwise) with black or white text by contrast, `n1`'s
values as links to a URL made of the value (opening in a new tab), and a
symbol before `n3`'s text (a triangle over 1,000, a circle otherwise).
Every cell still writes its value's text; missing values write only
that. Each frame's check compares what every cell draws (a bar's ends, a
chip's fill, a link's URL, a symbol's shape) with the reference's, read
from the DOM for the DOM grids and from what drawing was given for
Glide's canvas, so a grid still drawing an earlier row's content is not
counted as showing the frame.

| Grid | How it draws cells |
| --- | --- |
| Herceg | Columns' `cell` (`barCell`, `chipCell` with the label's colors through field displays, `symbolCell` with a condition on `encode.symbol`) and `n1`'s field display's `link`; the grid finds `n4`'s extent |
| TanStack Table | Each column's `cell` renders a React component drawing the same DOM as AG Grid's renderers |
| AG Grid | A `cellRenderer` component (`init`, `getGui`, and `refresh` writing the element in place) on each of the five columns |
| Glide | Bubble cells (chips, filled through `themeOverride`), URI cells (links, opened in a new tab through `onClickUri`), and custom cells whose renderers draw bars and symbols with Glide's `drawTextCell` |

The other grids find `n4`'s extent in adapter code when they mount
(the scenarios do not stream), and draw bars, chips, and symbols with the
same styles (`DOM_CELL_CSS`, or the canvas's equivalents).

### Framework cells

`framework-cells` scenarios (the same sizes and operations as `cells`)
draw the same five columns with one component of the grid's framework:
the cells scenarios' DOM under state of its own (whether it was pressed),
as a cell holding a control has, so a grid pays for mounting, recycling,
and tearing down stateful components. React grids draw `ReactCell`
(`src/grid/react-cells.tsx`), the Vue grid `VueCell`
(`src/grid/vue-cells.ts`), and the Svelte grid `SvelteCell`
(`src/grid/svelte-cells/`), each wrapping a `CellView` component. The
checks are the cells scenarios'.

| Grid | How it draws framework cells |
| --- | --- |
| Herceg (`herceg-react`) | `<Grid cells>`: a render function per column from each cell's `value` and `text` (`n1` a control cell), through portals; `n4`'s extent in adapter code, as the others find it |
| Herceg (`herceg-vue`) | `<Grid :cells>`: a render function per column, as `herceg-react`'s, through teleports |
| Herceg (`herceg-svelte`) | `<Grid {cells}>`: one snippet for every column (`n1` a control cell), each cell mounted into its host |
| TanStack Table | Each column's `cell` renders `ReactCell` |
| AG Grid | Not measured: its React cell renderers need `ag-grid-react`, which the suite does not install; its `cellRenderer` components are in the cells scenarios |
| Glide | Not comparable: it draws cells on a canvas, with drawing callbacks rather than components |

Herceg without a framework (`herceg`) draws custom cells with DOM
renderers and is not run in these scenarios.

### Headings and totals

`summary` scenarios (100,000 x 20 and 1,000,000 x 20: mount, vertical and
diagonal scroll steps, the vertical trace, and the plain and rolling
appends) show two levels of headings over the columns and a totals row
under the rows (`src/grid/summary.ts`): "Part g" over each run of 20
fields and "Half h" over each run of 10; `n1`'s sum, `n2`'s minimum, `n3`'s
maximum, the row count under `n4`, `n7`'s mean, and `n9`'s sum, with
"Total" under `c0`. Sums and means are of integers, so every grid's are
exact in any order. Each frame's check compares the totals row's text in
the columns shown with the reference's, so a grid that has not followed an
append is not counted as showing the frame; the header rows push the rows
down, and the check reads rows below them. Headings are configured alike
but their text is not checked per frame.

| Grid | How it shows headings and totals |
| --- | --- |
| Herceg | Columns' `heading` (a path of two); `rowTotals` of the view as the model's `totals`, which follows appends and drops |
| TanStack Table | Nested column definitions (header groups, each row positioned absolutely as the header is); a sticky `tfoot` row whose cells write totals kept in adapter code |
| AG Grid | `ColGroupDef` children two levels deep; a pinned bottom row (`pinnedBottomRowData`, `PinnedRowModule`) of totals kept in adapter code, set again after each transaction |
| Glide | Not run: its column groups are one level (`group`) |

AG Grid Community and TanStack Table have no totals of their own (AG Grid's
grand total row comes with Enterprise row grouping), so their totals are
kept in adapter code (`TotalsTracker`): counts and sums follow each batch
appended and evicted, and an extreme leaving the window is found again
from the rows held, as Herceg's are.

### Memory

Heap readings are the chart suite's, one fresh page per sample. Reserved
growth is the heap V8 committed while mounting, without collecting. The
heap a second after destroying a grid, and after rounds of five more
mounts, shows what a library keeps once destroyed. `rendererBytes` and
`gpuBytes` span mounting the grid, as for charts; a DOM grid's GPU memory
is its cells' compositor tiles, Glide's its canvas. The ratios over the
fixture's bytes are defined in "Memory amplification".

### Configurations

Each adapter documents its configuration at the top of its file.

| Grid | Input | Sorting and filtering | Updates | Rendering |
| --- | --- | --- | --- | --- |
| Herceg | Table over the fixture's arrays; field displays on every column | Row view (`setQuery`): typed-array comparators, filter expressions | `Table.append`, `dropFirst`, `set` | DOM rows and cells, 10 rows and 2 columns of overscan; mounted directly, or by React 19 (flushSync), Vue 3, or Svelte 5 (flushSync) |
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
- Not measured: grouping, aggregation other than the totals row, and
  pivots (AG Grid's are Enterprise), rendering a prepared result on its own, a grid linked to a
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

## Sparklines

`npm run bench:grid-sparklines` (`src/grid/sparklines/`) draws a sparkline
per row of a 1,000-row grid (an id, the key, and a 160 px sparkline
column) from a table of a million series rows: 1,000 keys of 1,000 points
each, interleaved in time order, each key's values a random walk; run
again with every other value of each series missing (`--gaps
none,alternate`), which keeps half the points of an M4 that breaks the
line at every gap. Herceg draws with `sparklineCell` over a Herceg table
of the series. TanStack Table (with TanStack Virtual, its `cell` an SVG
path) and Glide Data Grid (a custom cell on its canvas) draw with adapter
code (`series.ts`): each key's rows kept as rows arrive, M4 per device
pixel with gaps narrower than a pixel joined, and the same path data,
cached per key and data version. AG Grid's sparklines are Enterprise
(Community has none), so it is not compared.

- **Correct frames.** Every row crossing the viewport shows its line
  ending where its last value is (within 0.11 px, path data's rounding),
  read just before the frame paints; Glide's from what its `drawCell` drew.
- **Mount and steps** (frame rate limit off): ten mounts after two, from
  creating the grid (Herceg's table included) to the first correct frame;
  thirty steps of a screen after five.
- **Trace** (vsync on): three seconds at 100 rows a second, the offset set
  every frame, two trials: frame intervals, dropped frames (an interval
  spanning k refreshes misses k − 1), and incomplete frames.
- **Stream** (vsync on): a point for every key (1,000 rows) at 10 Hz for
  five seconds, two trials: each tick's latency to the first frame whose
  check saw it, ticks a later one overtook, and dropped frames, apart.
- **Memory**: CDP heap after forced GC with the grid mounted and ten
  screens visited, over the same fresh page before mounting (code loaded
  once and what a library keeps are counted), and a second after
  destroying it; three pages each. Herceg's grid with the column empty
  measures the sparklines' index and paths apart.

## Grid export

`npm run bench:grid-export` (`src/grid/export/`) exports every row of a
grid of the grid suite's fixture (20 fields: 16 numbers, 2 times, and 2
categories, with missing values), 100,000 and 1,000,000 rows, as CSV,
text and raw (`--size 100k,1m`, `--values text,raw`). Both grids format
cells as the grid suite does (two decimals, en-US, times in UTC, missing
values as an em dash) and are mounted.

- **Herceg**: `exportGrid(model, { values })` with its defaults (titles as
  the header, formulas escaped, values quoted only where needed, chunks
  yielding to the page), to a `Blob`.
- **AG Grid Community**: `api.getDataAsCsv()` turned into a `Blob`, as
  its `exportDataAsCsv` does before downloading. Text goes through the
  columns' `valueFormatter`, which exports use by default; raw through a
  `processCellCallback` writing times as ISO 8601 and missing values
  empty, as Herceg's raw values are. AG Grid quotes every value and
  escapes no formulas, by default.
- **Same output.** At 100,000 rows both CSVs are parsed and compared cell
  by cell: quoting aside, they write the same cells.
- **Time**: from the call to the `Blob`, in the page, garbage collected
  before each export; ten exports after two at 100,000 rows, five after
  one at a million.
- **Tasks**: three traced exports (Chrome's `toplevel` trace): the
  renderer main thread's longest task between the export's marks, and
  their total. A task runs on through the microtasks after it, which
  Chrome traces apart; Herceg's chunks after the first run there.
- **Memory**: three fresh pages with the grid mounted: the renderer's
  peak footprint (macOS `phys_footprint_peak`) over its footprint before
  the export, where the export passed the peak mounting left (else an
  upper bound, listed apart); and, after garbage collection and holding
  the output, the renderer's and the browser process's growth (Blobs are
  stored in the browser process).
- **Copy** (Herceg only; AG Grid's clipboard is Enterprise): Ctrl+C
  (Cmd+C) over every row selected, 100,000 rows with the limits raised
  and with the default ones, and 5,000 rows (100,000 cells, the default
  limit), timed from the copy event reaching the window to a listener
  after the grid's; ten copies after two.

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
(synchronous renders), and 120 trusted pointer moves across the panels
(see "Input"), each the event's handling (from its arrival in the page to
a window listener after the chart's) plus the chart's part of the next
frame (to a callback requested after the chart's, from the frame's
timestamp, or, where Chrome dispatched the move at the start of that
frame, after its timestamp, from the end of the event's handling, so the
event is not counted twice). Thirty further moves to the first targets, apart so the checks
do not add to the work, time each move from its arrival to the first
frame whose pre-paint check saw the tooltip write series s0's value at a
minute under the pointer (`shown`); a move whose tooltip never shows it
fails the run. Each round's two shapes run in a seeded order
(`--order-seed`). Pointer times differ in what a tooltip lists as well: the one panel's tooltip
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

## Device runner

`npm run bench:device` (`src/device/`) runs the chart suite's scenarios in
Safari through `safaridriver` (WebDriver): on an attached iPhone with
`--udid UDID`, or in Safari on this Mac with `--desktop`. Pages, adapters,
verified frames, and the check before timing are the browser suite's; the
runner loads each page afresh through WebDriver, calls the page's harness,
and sends input as WebDriver actions, which Safari dispatches as trusted
events: taps on the phone, which has no hover (a hover scenario times a
tap from its `pointerdown` to the readout, as `tapToFrame`), and mouse
moves on the Mac. Scenarios run in the seeded order of "Run order"; the
default set is initial renders, updates, streaming, 60 Hz ingestion, zoom,
resize, hover, and the dashboard (`--scenario` picks others; memory and
sustained traces need Chrome's protocol and a driver that sends without
waiting, and do not run here). Options: `--lib`, `--scenario`,
`--sample-scale`, `--order-seed`, `--out`, and `--host`, the address the
phone loads pages from (this Mac's first network address otherwise).

```sh
npm run bench:device -- --desktop --sample-scale 0   # a dry run in Safari on this Mac
npm run bench:device -- --udid 00008130-XXXXXXXXXXXXXXXX --out results/device-iphone.json
```

Results record Safari's version, the page's viewport and scale, its
device pixel ratio, whether it is cross-origin isolated, and the timer's
resolution, but not the UDID. Safari runs at the display's refresh (no
flags turn it off), so every timing includes waiting for a frame. The
phone loads the pages over plain HTTP from the Mac's address, which is not
a secure context: pages there are not cross-origin isolated, and
`performance.now()` has Safari's coarser resolution, recorded with the
results. The pages set no viewport, so the phone lays them out 980 CSS px
wide, scaled to fit, as it shows desktop pages.

Set up once, on the Mac:

1. Safari > Settings > Advanced: turn on "Show features for web
   developers".
2. Safari > Develop: turn on "Allow Remote Automation".
3. In a terminal, run `safaridriver --enable` (it asks for an
   administrator password).

and for an iPhone, in addition:

4. On the iPhone, Settings > Apps > Safari > Advanced: turn on "Web
   Inspector" and "Remote Automation".
5. Connect it to the Mac by cable, unlock it, and trust the Mac. Keep it
   unlocked and awake for the run (Settings > Display & Brightness >
   Auto-Lock: Never, while it runs).
6. Find its UDID: in Finder, select the iPhone and click the line under
   its name until the UDID shows, or run `xcrun xctrace list devices`.
7. Keep the iPhone and the Mac on the same network, and let the macOS
   firewall accept connections to Node, which serves the pages.

When a session cannot start, the runner prints these steps and exits with
status 2 without running anything.
