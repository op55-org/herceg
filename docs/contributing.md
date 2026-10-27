# Contributing

How Herceg is built and tested: the commands, the test suites and the
browsers they run in, the contract checks that keep every surface in step,
and the generated parts of the documentation.

- [Setup](#setup)
- [Repository](#repository)
- [Tests](#tests)
- [Browser tests](#browser-tests)
- [Contracts](#contracts)
- [Documentation](#documentation)
- [Benchmarks and releases](#benchmarks-and-releases)

## Setup

Node.js 22.12 or newer (TypeScript scripts run with
`--experimental-strip-types`), Google Chrome for browser tests and
benchmarks, Playwright's Firefox and WebKit (`npx playwright install
firefox webkit`), and [uv](https://docs.astral.sh/uv/) for Python. On
Linux, Firefox's WebGL needs a display and Mesa's GL: run browser tests
under `xvfb-run` with `xvfb libgl1-mesa-dri libglx-mesa0 libegl-mesa0`
installed, as CI does. From the repository root:

```sh
npm ci                   # workspace dependencies
npm run build            # herceg and the React, Vue, and Svelte adapters
npm run lint             # Biome lint and format check (npm run format applies fixes)
npm run typecheck        # all TypeScript, including compile-time tests
npm test                 # unit tests (Vitest, Node)
npm run test:browser     # browser tests in Chrome, Firefox, and WebKit
npm run test:python      # bundle the engine for Python, then pytest
npm run lint:python      # ruff and mypy
```

[AGENTS.md](../AGENTS.md#commands) lists every command, including package,
release, contract, and benchmark ones.

## Repository

| Path | Holds |
| --- | --- |
| `packages/herceg` | The engine: data, scales, marks, level of detail, scenes, renderers, the DOM runtime, grids, and subpath entries |
| `packages/react`, `packages/vue`, `packages/svelte` | The framework adapters |
| `python/` | The Python package, its JavaScript bundles (`python/js`), tests, and example apps |
| `benchmarks/` | The benchmark harness, competitor adapters, and committed results |
| `test/contracts/` | Capability and API contract declarations |
| `scripts/` | Package, release, contract, and browser-test tooling |
| `docs/` | The guides, architecture, comparison, and generated capability docs |
| `tmp/` | Ignored scratch space |

Architecture and vocabulary: [architecture.md](architecture.md).

## Tests

| Suite | Command | Covers |
| --- | --- | --- |
| Unit | `npm test` | The engine's unit tests in Node (adapters are tested in the browser suite) |
| Types | `npm run typecheck` | Compile-time tests (`test/types/`, adapters' `props` and `readme` tests), including the documentation's examples |
| Browser | `npm run test:browser` | The engine, adapters, and `python/js` in three engines; the ease-of-use samples in Chrome |
| Packages | `npm run test:package` (after `build`) | The packed npm tarballs installed in a fresh project |
| Python | `npm run test:python`, `npm run test:python-package`, `npm run test:python-web` | pytest; the built wheel installed and smoke-tested; web pages through a Flask app in three engines |
| Release | `npm run test:release` | Version, registry recovery, and publish guards (offline) |
| Contracts | `npm run test:contracts`, `npm run contracts` | The contract tooling, and the declarations against the code and the last runs ([below](#contracts)) |

**Package tests.** `test:package` installs the built npm tarballs in a
fresh consumer and checks packaged files, exports, licenses (byte for byte
against the root LICENSE), Node imports, static SVG, and every entry
point's declarations under NodeNext and bundler resolution with
`skipLibCheck: false`; public API fixtures catch missing or redirected
subpaths, and browser bundles of the engine and adapters must take every
input from inside the consumer. Vue template checking runs when `vue-tsc`
is in npm's offline cache. `test:python-package` builds the bundles,
sdist, and wheel, checks their JavaScript and licenses, then installs the
wheel and renders HTML in a fresh virtual environment, trying uv offline
first. Both remove their temporary projects; `-- --keep-on-failure` keeps
a failed one.

Visual and behavior tests live beside the code they test. Leak tests
collect garbage through each engine's protocol and fail when an
unreferenced object survives.

## Browser tests

The engine's, adapters', and Python's browser suites run headless in the
installed Google Chrome and Playwright's Firefox and WebKit; the
ease-of-use samples run in Chrome only. `HERCEG_BROWSERS=chromium` runs one
engine. `scripts/browser/` holds the engines (`browsers.ts`) and the
commands tests run in Node where Playwright has nothing for all three:

- **Accessibility trees** come from Chrome's DevTools protocol, Firefox's
  remote debugging protocol, and WebKit's inspector protocol, written alike
  by `accessibility.ts` (ARIA role names, no text under presentational
  roles, no description repeating the name). The engines still differ, and
  the tests say how: WebKit's tables have no row groups; Firefox makes
  every grid row and cell selectable and drops grouped rows' levels.
- **Real mouse input** is Playwright's mouse. Outside Chrome the command
  waits for each input's event, and Firefox's test files run one at a time
  because its pages share one mouse. Multi-finger touch runs in Chrome only.
- **Garbage collection** is Chrome's HeapProfiler, Firefox's memory actor,
  and WebKit's `Heap.gc`. Leak tests read weak references only after
  collecting.
- **Firefox** gets an application data folder of its own (`MOZ_APP_DATA`).
- **Linux CI** runs browser tests under `xvfb-run` so Firefox has WebGL
  (Mesa's llvmpipe through `libegl-mesa0`); Chrome uses SwiftShader.
  Firefox and WebKit deliver the mouse at whole CSS pixels at a ratio of 1,
  so tests read values from where a press lands.

Browser tests may fail while collecting when several runs share Vite's
cache; run them again.

## Contracts

A contract is a promise an option, mark, or surface makes, named by an ID
of lowercase words joined by dots (`mark.z-index.order.spec`). Tests prove
one by naming it: `contractTest(id, fn, name)` in TypeScript
(`test/helpers/contracts.ts`) and `@pytest.mark.contract(id)` in Python
(`tests/conftest.py`), each ID proved once.

**Spec contracts.** `packages/herceg/test/fixtures/contracts.json` holds
cases both languages read: a chart's spec and the same chart made in
Python, either drawn alike or refused with the same code, path, and message
in each language's spelling, and export settings with the plan they make.
Each drawn case is made again through the mark functions, each adapter's
components, Python's helpers, the widget, Streamlit, and web pages.

**The capability matrix** (`test/contracts/`) declares what every mark
supports:

| File | Declares |
| --- | --- |
| `capabilities.json` | Capability groups, each capability's meaning, and the suite that proves it |
| `marks.json` | A row per mark and variant, its name on every surface, and a state per capability: works, unproved (declared, no proof yet), refused (with its `ChartError` and a proved alternative), or not applicable (with a reason) |
| `express.json` | Express recipes and utilities |
| `interaction.json`, `behaviors.json` | Interaction in panels, facets, and insets; other contracts |
| `api.json` | Known differences between surfaces' APIs, each with its reason |
| `fixtures/` | Each row's chart and the documented defaults |

A cell is proved by the test with ID `<row>.<capability>`
(`bar-stack.legend.toggle`), which reads its row's declared state to choose
what it asserts.

**`npm run contracts`** (`scripts/check-contracts.mjs`) fails unless the
declarations are complete and well formed; they name what exists, both
ways (found with TypeScript's compiler API and Python's `inspect`); the
API audit passes; and every proof they oblige passed in its suite's last
complete run of this exact source, in every browser engine. Suites run
through `scripts/contracts/run.mjs`, which records reports under
`tmp/contracts/<revision>-<hash>/`, so a report proves only the source it
ran on.

**The API audit** (`scripts/contracts/api.mjs`) compares every option,
choice, event, and handle member of the spec with each surface's: the mark
functions, Python's methods, helpers, and keywords, the adapters' props and
events, the notebook widget's members, and Express against Seaborn. Each
surface's naming convention spells a spec name (`strokeWidth`,
`stroke_width`; `onSelect`, `@select`, `on_select`); every other difference
must be listed in `api.json` with its reason.

**Acceptance fixtures** are whole workloads from users' reports, such as
the React dashboard (`packages/react/test/fixtures/Dashboard.tsx`), tested
in every engine.

## Documentation

- **One home per fact.** Topic guides in `docs/guide/` say how to use a
  feature, in TypeScript and Python; `docs/architecture/` says how it is
  built. Package READMEs are short entry points for npm and PyPI, linking
  with absolute URLs.
- **Examples compile.** `packages/herceg/test/types/readme.types.ts`,
  `packages/react/test/readme.types.tsx`, and
  `packages/svelte/test/Readme.svelte` compile the documentation's
  examples in `npm run typecheck`.
- **Generated sections.** `docs/capabilities.md` and `.json` are written by
  `npm run contracts:docs` from a complete passing check; CI fails when
  they are stale (`-- --check`). Result tables in `docs/comparison.md`
  between `<!-- results:NAME -->` markers are written by
  `npm run bench:report` from `benchmarks/results/*.json`; edit the text
  around them, not the tables.
- **Present tense.** Documentation describes the repository as it is; what
  is planned goes in the [roadmap](roadmap.md).

## Benchmarks and releases

- Benchmark methodology, scenarios, and commands:
  [benchmarks/README.md](../benchmarks/README.md). Results:
  [comparison.md](comparison.md).
- Releases: [AGENTS.md](../AGENTS.md#releasing).
