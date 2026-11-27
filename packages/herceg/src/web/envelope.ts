// The update envelope a stream sends after a notice: the payload codec's
// binary layout (web/payload.ts), its header saying with `kind` what
// follows. A snapshot establishes a stream's epoch and revision; an update
// applies once, to its exact base revision, staged whole before anything
// changes (data/numbering.ts `stage`). Each response is bounded: its header,
// operations, and buffer descriptors are checked before the header is
// decoded or any buffer viewed, so staging's own allocations are bounded by
// them; a stream sends a revision past them as a snapshot.

import type { Expression } from "../data/expression.ts";
import { ChartError } from "../spec/errors.ts";
import type { ChartSpec, ColumnsSpec } from "../spec/spec.ts";
import type { PAYLOAD_PROTOCOL } from "./payload.ts";

/** What one update response carries at most. */
export const UPDATE_LIMITS = {
  /** The JSON header's UTF-8 bytes. */
  headerBytes: 2 ** 20,
  operations: 4096,
  /** Buffer descriptors, `[offset, length]` pairs. */
  buffers: 8192,
  /** The buffers' bytes, which staging materializes. */
  bufferBytes: 2 ** 26,
} as const;

type Columns = ColumnsSpec["columns"];
type ChartSettings = Partial<Omit<ChartSpec, "data" | "marks" | "version">>;

/** A channel's value in JSON: ordinals are a float64 buffer of the payload, ascending and distinct. */
export type ChannelValueSpec =
  | null
  | { kind: "predicate"; expression: Expression }
  | { kind: "rows"; ordinals: { buffer: number } };

/**
 * One operation of an update. `data` names a table of the stream's spec,
 * whose `id` is the history it is of. Each mutation (`append`, `replace`,
 * `reset`) carries the copy's revision after it: its owner's count of that
 * copy's mutations, one more than the last.
 */
export type UpdateOperation =
  | {
      op: "append";
      data: string;
      columns: Columns;
      /** The ordinal of the batch's first row: every row is sent, the window drops them as it applies. */
      first: number;
      maxRows?: number;
      revision: number;
    }
  | { op: "replace"; data: string; start: number; columns: Columns; revision: number }
  | {
      op: "reset";
      data: string;
      columns: Columns;
      /** Newer than the copy's; not necessarily the next. Its rows are numbered from 0. */
      generation: number;
      revision: number;
    }
  | { op: "options"; options: ChartSettings }
  | { op: "rule"; id: string; x?: number | string | null; y?: number | string | null }
  | {
      op: "select";
      data: string;
      generation: number;
      namespace: string;
      channel: string;
      selection: ChannelValueSpec;
      /** The revision and index it was written at, kept when a response merges revisions. */
      write: { revision: number; index: number };
    };

/** A channel's state in a snapshot, with the write that made it in the snapshot's epoch. */
export interface SnapshotChannelSpec {
  data: string;
  generation: number;
  namespace: string;
  channel: string;
  selection: ChannelValueSpec;
  write: { revision: number; index: number };
}

interface Envelope {
  readonly protocol: typeof PAYLOAD_PROTOCOL;
  readonly stream: string;
  /** `<allocator id>:<counter>`: a restarted owner starts another. */
  readonly epoch: string;
  readonly revision: number;
  /** Each buffer's byte offset from the first buffer's, and its length. */
  readonly buffers: readonly (readonly [offset: number, length: number])[];
}

/** Establishes an epoch and a revision; its tables' columns entries carry their numbering. */
export interface SnapshotHeader extends Envelope {
  readonly kind: "snapshot";
  readonly spec: ChartSpec;
  /** The stream's channel states, which a page restores unless a later gesture changed one. */
  readonly channels: readonly SnapshotChannelSpec[];
}

/** Applies once, to its exact base revision, staged whole before anything changes. */
export interface UpdateHeader extends Envelope {
  readonly kind: "update";
  readonly baseRevision: number;
  readonly operations: readonly UpdateOperation[];
  /** More revisions follow from `revision` (a bounded answer). */
  readonly more?: boolean;
}

/** Checks an update's header length, as its payload's prefix gives it, before the header is decoded. */
export function checkUpdateLength(bytes: number, at = "update"): void {
  if (bytes > UPDATE_LIMITS.headerBytes)
    throw tooLarge(
      at,
      `its header is ${shown(bytes)} bytes, more than an update's ${shown(UPDATE_LIMITS.headerBytes)}`,
    );
}

/**
 * Checks an update header's operations, buffer descriptors, and their bytes
 * (each descriptor's length, as staging materializes it), before staging or
 * any buffer is viewed.
 */
export function checkUpdateCounts(
  header: { readonly operations?: unknown; readonly buffers?: unknown },
  at = "update",
): void {
  const { operations, buffers } = header;
  if (Array.isArray(operations) && operations.length > UPDATE_LIMITS.operations)
    throw tooLarge(
      `${at} operations`,
      `${shown(operations.length)}, more than an update's ${shown(UPDATE_LIMITS.operations)}`,
    );
  if (Array.isArray(buffers) && buffers.length > UPDATE_LIMITS.buffers)
    throw tooLarge(
      `${at} buffers`,
      `${shown(buffers.length)} descriptors, more than an update's ${shown(UPDATE_LIMITS.buffers)}`,
    );
  let bytes = 0;
  if (Array.isArray(buffers))
    for (const descriptor of buffers)
      if (Array.isArray(descriptor) && typeof descriptor[1] === "number") bytes += descriptor[1];
  if (bytes > UPDATE_LIMITS.bufferBytes)
    throw tooLarge(
      `${at} buffers`,
      `${shown(bytes)} bytes, more than an update's ${shown(UPDATE_LIMITS.bufferBytes)}`,
    );
}

function tooLarge(location: string, problem: string): ChartError {
  return new ChartError({
    code: "load-failed",
    phase: "load",
    message: `${location}: ${problem}; send a revision this large as a snapshot, as herceg.web.Stream does`,
  });
}

function shown(value: number): string {
  return value.toLocaleString("en-US");
}
