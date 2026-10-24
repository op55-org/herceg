// Payloads as herceg.streamlit builds them, and Streamlit's side of a run,
// for the Streamlit component's tests.

import { encodePayload } from "herceg/web";
import herceg, { type Component, type Header } from "../streamlit.ts";

/**
 * A payload as Python builds it, placed `offset` bytes into a larger buffer
 * as protobuf hands it over.
 */
export function payload(
  spec: Header["spec"],
  buffers: ArrayBufferView[],
  events: Header["events"],
  offset = 3,
  epoch?: string,
  itemEpoch?: string,
): Uint8Array {
  const bytes = encodePayload(spec, buffers, {
    events,
    ...(epoch && { epoch }),
    ...(itemEpoch && { itemEpoch }),
  });
  const out = new Uint8Array(offset + bytes.length).subarray(offset);
  out.set(bytes);
  return out;
}

/** Streamlit's side of one script run: the payload and the value setters. */
export function run(parentElement: HTMLElement | ShadowRoot, data: Uint8Array) {
  const state: [string, unknown][] = [];
  const triggers: [string, unknown][] = [];
  const component: Component = {
    data,
    parentElement,
    setStateValue: (name, value) => state.push([name, value]),
    setTriggerValue: (name, value) => triggers.push([name, value]),
  };
  return { cleanup: herceg(component), state, triggers };
}
