// Compile-time tests of <Grid>: checked by `npm run typecheck`, never executed.
import { count, rowTotals, rowView, table } from "herceg";
import { createGridModel, type Grid as HercegGrid } from "herceg/grid";
import { createPivotGridModel, type PivotGrid as PivotGridHandle } from "herceg/grid/pivot";
import {
  createRemoteGridModel,
  type GridSource,
  type RemoteGrid as RemoteGridHandle,
} from "herceg/grid/remote";
import { pivotRows } from "herceg/pivot";
import { useMemo, useRef } from "react";
import { PivotGrid } from "../src/grid/pivot.tsx";
import { RemoteGrid } from "../src/grid/remote.tsx";
import { Grid } from "../src/grid.tsx";

const requests = table({ latency: new Float64Array(3), host: ["a", "b", "c"] });
type Requests = { latency: "number"; host: "category" };

export function Requests() {
  const model = useMemo(
    () =>
      createGridModel({
        data: rowView(requests),
        columns: [{ field: "host" }, { field: "latency" }],
      }),
    [],
  );
  const ref = useRef<HercegGrid<Requests> | null>(null);
  return <Grid model={model} ariaLabel="Requests" theme="dark" headerHeight={36} ref={ref} />;
}

export function Unnamed() {
  const model = useMemo(() => createGridModel({ data: rowView(requests), columns: [] }), []);
  // @ts-expect-error grids need an accessible name
  return <Grid model={model} />;
}

export function Cells() {
  const model = useMemo(
    () =>
      createGridModel({
        data: rowView(requests),
        columns: [{ field: "host" }, { field: "latency" }, { id: "open", title: "" }],
      }),
    [],
  );
  const ref = useRef<HercegGrid<Requests> | null>(null);
  return (
    <Grid
      model={model}
      ariaLabel="Requests"
      ref={ref}
      cells={{
        host: (cell) => cell.text,
        latency: (cell) => {
          // Read as the row holds it: null where missing.
          const value: number | string | null | undefined = cell.value;
          return <span>{value}</span>;
        },
        open: {
          fields: ["host", "latency"],
          interaction: "control",
          render: (cell) => {
            const host: string | null = cell.read("host");
            const latency: number | null = cell.read("latency");
            // @ts-expect-error read gives a field's own kind
            const wrong: string = cell.read("latency");
            // @ts-expect-error a field the grid's table lacks
            cell.read("hots");
            return <button type="button">{`${host} ${latency} ${wrong}`}</button>;
          },
        },
      }}
    />
  );
}

export function WrongCells() {
  const model = useMemo(
    () => createGridModel({ data: rowView(requests), columns: [{ field: "host" }] }),
    [],
  );
  return (
    <Grid
      model={model}
      ariaLabel="Requests"
      cells={{
        host: {
          // @ts-expect-error a field the grid's table lacks
          fields: ["hots"],
          render: () => null,
        },
        latency: {
          // @ts-expect-error the three ways a cell takes the keyboard
          interaction: "button",
          render: () => null,
        },
      }}
    />
  );
}

export function WrongRef() {
  const model = useMemo(
    () => createGridModel({ data: rowView(requests), columns: [{ field: "host" }] }),
    [],
  );
  const ref = useRef<HercegGrid<{ other: "number" }> | null>(null);
  // @ts-expect-error the ref's grid is of the model's schema
  return <Grid model={model} ariaLabel="Requests" ref={ref} />;
}

export function Remote({ source }: { source: GridSource<Requests> }) {
  const model = useMemo(
    () => createRemoteGridModel({ source, columns: [{ field: "host" }] }),
    [source],
  );
  const ref = useRef<RemoteGridHandle<Requests> | null>(null);
  return (
    <RemoteGrid
      model={model}
      ariaLabel="Requests"
      ref={ref}
      cells={{ host: { fields: ["latency"], render: (cell) => cell.read("latency") } }}
    />
  );
}

export function Pivot() {
  const model = useMemo(
    () =>
      createPivotGridModel({
        data: pivotRows(rowView(requests), { rows: "host", pivot: "host", ops: { n: count() } }),
      }),
    [],
  );
  const ref = useRef<PivotGridHandle<Requests> | null>(null);
  return (
    <>
      <PivotGrid model={model} ariaLabel="Requests by host" ref={ref} />
      {/* @ts-expect-error pivot grids take no React cells */}
      <PivotGrid model={model} ariaLabel="Requests by host" cells={{}} />
    </>
  );
}

// Totals rows and headings are the model's: <Grid> draws what the model holds.
export function Totals() {
  const view = useMemo(() => rowView(requests), []);
  const totals = useMemo(() => rowTotals(view, { ops: { n: count() } }), [view]);
  const model = useMemo(
    () =>
      createGridModel({
        data: view,
        totals,
        columns: [
          { field: "host", heading: "Who" },
          { field: "latency", heading: ["Speed", { id: "p", title: "Latency" }], aggregate: "n" },
        ],
      }),
    [view, totals],
  );
  return <Grid model={model} ariaLabel="Requests" />;
}

export function WrongTotal() {
  const view = useMemo(() => rowView(requests), []);
  const totals = useMemo(() => rowTotals(view, { ops: { n: count() } }), [view]);
  const model = useMemo(
    () =>
      createGridModel({
        data: view,
        totals,
        // @ts-expect-error the totals have no "p95"
        columns: [{ field: "latency", aggregate: "p95" }],
      }),
    [view, totals],
  );
  return <Grid model={model} ariaLabel="Requests" />;
}
