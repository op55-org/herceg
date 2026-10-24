// Charts in web pages, imported as `herceg/web`: the binary payload a
// server sends a chart as, page fragments that mount themselves and tell the
// page what the user does as DOM events, and the JSON those events carry.
// Importing it changes nothing on the page: `observe` starts mounting.

export type { InspectionPayload, SelectionPayload, ViewportPayload } from "./web/events.ts";
export { inspectionPayload, selectionPayload, viewportPayload } from "./web/events.ts";
export { loadPayload, type PayloadSource } from "./web/load.ts";
export { getChart, type HercegEventMap, mount, unmount } from "./web/mount.ts";
export { observe } from "./web/observe.ts";
export {
  type DecodedPayload,
  decodePayload,
  encodePayload,
  PAYLOAD_PROTOCOL,
  type PayloadHeader,
} from "./web/payload.ts";
