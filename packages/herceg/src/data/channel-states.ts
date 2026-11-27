// What a selection store's channel holds as copies of one data object share
// it: whole states, never deltas, each with a stamp that orders writers
// (a Lamport counter and the writer's id), so a state arriving by two paths
// applies once and an older one is dropped, and realms that received the
// same states hold the same one. A server's write (a stream's `select`) is
// one logical write with an identity of its own; the realm that stamps the
// stream's writes keeps the newest it accepted per stream and epoch, drops
// any at or below it, and stamps a newer one on arrival. Plain data and
// functions over it; `Page` is one realm's registry, as page sharing keeps it.

import type { Expression } from "./expression.ts";
import { type DataId, MAX_ORDINAL, type NumberedRows, selectedPositions } from "./numbering.ts";

/** The most rows a channel shares between copies: 2^21 ordinals, 16 MiB of float64s. */
export const MAX_CHANNEL_ROWS = 2 ** 21;

/**
 * Orders writers of a channel: a Lamport counter, then the writer's id
 * (ASCII), compared as strings. A writer's id is its realm's alone, so two
 * states never share a stamp: a gesture's copy, or the realm that stamped
 * a server's write.
 */
export type Stamp = readonly [counter: number, writer: string];

/** What a channel holds, as copies share it: a clear, a predicate, or the ordinals of its rows, ascending and distinct. */
export type ChannelValue =
  | null
  | { readonly kind: "predicate"; readonly expression: Expression }
  | { readonly kind: "rows"; readonly ordinals: Float64Array };

/** One channel of one history's generation, in a namespace. */
export interface ChannelKey {
  readonly namespace: string;
  readonly data: DataId;
  readonly generation: number;
  readonly channel: string;
}

/** A server's logical write (a stream's `select`): applied once, whatever path brings it. */
export interface WriteId {
  readonly stream: string;
  /** `<allocator id>:<counter>`: a restarted owner starts another. */
  readonly epoch: string;
  readonly revision: number;
  /** The operation's index in its revision. */
  readonly index: number;
}

/** A channel's complete state, as it travels between copies and realms. */
export interface ChannelState extends ChannelKey {
  /** Given where the write was made (a gesture's realm), or on arrival for a server's write. */
  readonly stamp: Stamp;
  readonly value: ChannelValue;
  /** The server's write that made this state. */
  readonly write?: WriteId;
  /**
   * The newest server write accepted for this channel, per stream and
   * epoch, where the state was made: a realm joining later learns from it
   * to drop writes older than one it never saw.
   */
  readonly writes?: readonly WriteId[];
}

/**
 * What a registry keeps of one channel: its newest state, and the newest
 * server write accepted per stream and epoch, which may be newer than the
 * state's own (a later gesture from a realm that had not seen it).
 */
export interface ChannelSlot {
  readonly state?: ChannelState;
  readonly writes: readonly WriteId[];
}

/**
 * One realm's registry: its id (the writer of the server writes it
 * stamps), its Lamport clock, its channels, and each stream's epoch as of
 * the snapshot it restored last.
 */
export interface Page {
  readonly writer: string;
  readonly clock: number;
  readonly slots: ReadonlyMap<string, ChannelSlot>;
  readonly epochs: ReadonlyMap<string, string>;
  /** Whether it took over stamping from another realm (`pageTakeOver`). */
  readonly takenOver: boolean;
}

/** A snapshot's channel state, with the position in its epoch of the write that made it. */
export interface SnapshotChannel {
  readonly key: ChannelKey;
  readonly value: ChannelValue;
  readonly revision: number;
  readonly index: number;
}

/** What a copy holds of a channel's state: nothing, a predicate to test its rows with, or its rows among the ordinals. */
export type Resolved =
  | { readonly kind: "none" }
  | { readonly kind: "predicate"; readonly expression: Expression }
  | { readonly kind: "rows"; readonly positions: Uint32Array };

/** A realm's registry as it starts; `writer` is the realm's id, unique among the realms it shares with. */
export function newPage(writer: string): Page {
  return { writer, clock: 0, slots: new Map(), epochs: new Map(), takenOver: false };
}

/** Negative, zero, or positive as `a` was written before, as, or after `b`. */
export function compareStamps(a: Stamp, b: Stamp): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/**
 * Checks a channel value received from another copy: its ordinals
 * ascending, distinct, whole, JS-safe, and at most `MAX_CHANNEL_ROWS`.
 * Refusals are RangeErrors located at `at`.
 */
export function checkChannelValue(value: ChannelValue, at: string): void {
  if (value?.kind !== "rows") return;
  const { ordinals } = value;
  if (ordinals.length > MAX_CHANNEL_ROWS)
    throw new RangeError(
      `${at}: ${ordinals.length.toLocaleString("en-US")} rows (${(ordinals.byteLength / 2 ** 20).toFixed(1)} MiB) are more than a page channel carries (16 MiB); select them by a condition (a brush), or keep the binding's scope "chart"`,
    );
  for (let i = 0; i < ordinals.length; i++) {
    const ordinal = ordinals[i]!;
    if (!(Number.isInteger(ordinal) && ordinal >= 0 && ordinal <= MAX_ORDINAL))
      throw new RangeError(
        `${at}: ordinals[${i}] is ${ordinal}, not an ordinal; send whole numbers from 0 to 2^53 - 1`,
      );
    if (i > 0 && ordinal <= ordinals[i - 1]!)
      throw new RangeError(
        `${at}: ordinals[${i}] (${ordinal}) does not follow ${ordinals[i - 1]}; send a channel's rows ascending and each once, as ordinalsOf gives them`,
      );
  }
}

/** Whether `write` is at or below the newest write its registry accepted of its stream and epoch. */
export function isObsolete(writes: readonly WriteId[], write: WriteId): boolean {
  const newest = writes.find((w) => w.stream === write.stream && w.epoch === write.epoch);
  return newest !== undefined && !after(write, newest);
}

/** `writes` with `write` in place of an older one of its stream and epoch. */
export function withWrite(writes: readonly WriteId[], write: WriteId): readonly WriteId[] {
  const at = writes.findIndex((w) => w.stream === write.stream && w.epoch === write.epoch);
  if (at < 0) return [...writes, write];
  if (!after(write, writes[at]!)) return writes;
  return writes.map((w, i) => (i === at ? write : w));
}

/**
 * The slot after a state arrives from another realm (by a relay or the
 * kernel): applied when its stamp is newer than the state held, so realms
 * that received the same states hold the same one, whatever the order.
 * What the state says of accepted writes is kept either way. Stamps alone
 * decide: while the stamping realm's stamps follow every one before them
 * (`pageTakeOver`), a state a newer write made is stamped later than one an
 * older write made, so stamps drop the older.
 */
export function receive(
  slot: ChannelSlot,
  state: ChannelState,
): { slot: ChannelSlot; applied: boolean } {
  let writes = slot.writes;
  for (const write of state.writes ?? []) writes = withWrite(writes, write);
  if (state.write) writes = withWrite(writes, state.write);
  if (slot.state && compareStamps(state.stamp, slot.state.stamp) <= 0)
    return { slot: { ...slot, writes }, applied: false };
  return { slot: { state, writes }, applied: true };
}

/**
 * The slot after a server's write, applied unless obsolete and then
 * stamped by the realm (`writer`) after everything it applied (`clock`),
 * so it wins over earlier gestures and a later gesture wins over it.
 */
export function serverWrite(
  slot: ChannelSlot,
  key: ChannelKey,
  write: WriteId,
  value: ChannelValue,
  clock: number,
  writer: string,
): { slot: ChannelSlot; state?: ChannelState } {
  if (isObsolete(slot.writes, write)) return { slot };
  const writes = withWrite(slot.writes, write);
  const state: ChannelState = { ...key, stamp: [clock + 1, writer], value, write, writes };
  return { slot: { state, writes }, state };
}

/**
 * The slot's state as a realm sends it to another (a join, a relay): its
 * stamp and value as they are, with every write the slot accepted.
 */
export function shared(slot: ChannelSlot): ChannelState | undefined {
  const { state, writes } = slot;
  if (!state) return undefined;
  const { writes: _, ...rest } = state;
  return writes.length > 0 ? { ...rest, writes } : rest;
}

/** The slot after a gesture of `writer` in this realm, stamped after everything it applied. */
export function gesture(
  slot: ChannelSlot,
  key: ChannelKey,
  writer: string,
  value: ChannelValue,
  clock: number,
): { slot: ChannelSlot; state: ChannelState } {
  const state: ChannelState = {
    ...key,
    stamp: [clock + 1, writer],
    value,
    ...(slot.writes.length > 0 ? { writes: slot.writes } : {}),
  };
  return { slot: { ...slot, state }, state };
}

/** What a copy of `rows` holds of a state of its generation. */
export function resolve(rows: NumberedRows, state: ChannelState | undefined): Resolved {
  const value = state?.value ?? null;
  if (value === null) return { kind: "none" };
  if (value.kind === "predicate") return value;
  return { kind: "rows", positions: selectedPositions(rows, value.ordinals) };
}

/** The key a registry keeps a channel under. */
export function channelKey(key: ChannelKey): string {
  return JSON.stringify([key.namespace, key.data, key.generation, key.channel]);
}

/** The state a registry holds for `key`. */
export function channelOf(page: Page, key: ChannelKey): ChannelState | undefined {
  return page.slots.get(channelKey(key))?.state;
}

/** A gesture in a realm: its state, which the realm sends to every other member. */
export function pageGesture(
  page: Page,
  key: ChannelKey,
  writer: string,
  value: ChannelValue,
): { page: Page; state: ChannelState } {
  const { slot, state } = gesture(slotOf(page, key), key, writer, value, page.clock);
  return { page: withSlot(page, key, slot, state.stamp[0]), state };
}

/**
 * A state from another realm; the clock moves past its stamp, applied or
 * not. Stamps order states whatever their epochs. The realm's epochs stay
 * as they were, since only the stream says which is current (see
 * `pageTakeOver`).
 */
export function pageReceive(page: Page, state: ChannelState): { page: Page; applied: boolean } {
  const { slot, applied } = receive(slotOf(page, state), state);
  return { page: withSlot(page, state, slot, Math.max(page.clock, state.stamp[0])), applied };
}

/**
 * The realm as it takes over stamping server writes from another (the
 * host left, or this realm stamped before and does again), with `handed`,
 * the states of the realm that stamped before, which stopped stamping
 * first (`pageStates`): received before anything is stamped, they put the
 * clock past every stamp the other made, so a newer write's state wins
 * over theirs everywhere. A realm that left hands nothing; then a state it
 * stamped that reached other realms can win over a newer write's until
 * the next write or gesture (realms still agree).
 *
 * Any epoch the realm kept may have ended meanwhile, and one it heard of
 * through others' states it never confirmed, so it trusts none: until the
 * snapshot it asks for restores a stream, the stream's writes and every
 * snapshot it did not ask for answer `reconcile`.
 */
export function pageTakeOver(page: Page, handed: Iterable<ChannelState>): Page {
  let next = page;
  for (const state of handed) next = pageReceive(next, state).page;
  return { ...next, epochs: new Map(), takenOver: true };
}

/** Every channel state a realm holds, as it sends them to a realm joining it (see `shared`). */
export function pageStates(page: Page): ChannelState[] {
  return [...page.slots.values()].flatMap((slot) => shared(slot) ?? []);
}

/**
 * A server's write through one of the realm's fragments: dropped when its
 * epoch is not the one the realm restored its stream at, or when obsolete.
 * A realm stamps a stream's writes only once it restored the stream's
 * snapshot: one that took the role from another (a reloaded host, or see
 * `pageTakeOver`) may not know the stream's current epoch, so it asks the
 * stream for its state (`reconcile`) before taking any.
 */
export function pageWrite(
  page: Page,
  key: ChannelKey,
  write: WriteId,
  value: ChannelValue,
): {
  page: Page;
  state?: ChannelState;
  outcome: "applied" | "obsolete" | "other epoch" | "reconcile";
} {
  const epoch = page.epochs.get(write.stream);
  if (epoch === undefined) return { page, outcome: "reconcile" };
  if (epoch !== write.epoch) return { page, outcome: "other epoch" };
  const { slot, state } = serverWrite(
    slotOf(page, key),
    key,
    write,
    value,
    page.clock,
    page.writer,
  );
  if (!state) return { page, outcome: "obsolete" };
  return { page: withSlot(page, key, slot, state.stamp[0]), state, outcome: "applied" };
}

/**
 * A stream's snapshot through one of the realm's fragments: each channel
 * state it carries passes the test a server's write does, so one a later
 * gesture changed after its write was accepted keeps the gesture. A
 * snapshot of another epoch than the realm's for the stream switches it
 * only when `requested` (the answer to the realm's own request for the
 * stream's state, after a notice named the epoch): then writes of the old
 * epoch are forgotten. Otherwise it may be a fragment loaded before the
 * owner restarted, and the realm asks the stream for its state
 * (`reconcile`) instead of guessing which epoch is current. A realm that
 * took over stamping does so for every stream it has not restored since,
 * whatever the snapshot's epoch; one that never did restores an
 * unrequested snapshot of a stream it does not know (a fragment's first).
 */
export function pageSnapshot(
  page: Page,
  snapshot: {
    readonly stream: string;
    readonly epoch: string;
    readonly requested?: boolean;
    readonly channels: readonly SnapshotChannel[];
  },
): { page: Page; outcome: "restored" | "reconcile"; states: ChannelState[] } {
  const { stream, epoch } = snapshot;
  const current = page.epochs.get(stream);
  const trusted =
    snapshot.requested || (current === undefined ? !page.takenOver : current === epoch);
  if (!trusted) return { page, outcome: "reconcile", states: [] };
  let next: Page = page;
  if (current !== epoch) next = withEpoch(page, stream, epoch);
  const states: ChannelState[] = [];
  for (const { key, value, revision, index } of snapshot.channels) {
    const written = pageWrite(next, key, { stream, epoch, revision, index }, value);
    next = written.page;
    if (written.state) states.push(written.state);
  }
  return { page: next, outcome: "restored", states };
}

/** The realm with `epoch` for `stream`, forgetting the write positions of its other epochs. */
function withEpoch(page: Page, stream: string, epoch: string): Page {
  const slots = new Map<string, ChannelSlot>();
  for (const [name, slot] of page.slots)
    slots.set(name, {
      ...slot,
      writes: slot.writes.filter((write) => write.stream !== stream || write.epoch === epoch),
    });
  return { ...page, slots, epochs: new Map(page.epochs).set(stream, epoch) };
}

function slotOf(page: Page, key: ChannelKey): ChannelSlot {
  return page.slots.get(channelKey(key)) ?? { writes: [] };
}

function withSlot(page: Page, key: ChannelKey, slot: ChannelSlot, clock: number): Page {
  return {
    ...page,
    clock: Math.max(page.clock, clock),
    slots: new Map(page.slots).set(channelKey(key), slot),
  };
}

/** Whether `a` was written after `b` in their stream's epoch. */
function after(a: WriteId, b: WriteId): boolean {
  return a.revision > b.revision || (a.revision === b.revision && a.index > b.index);
}
