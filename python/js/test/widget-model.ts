// A stand-in for anywidget's model, and the snapshot Python sends of a
// line chart, for the notebook widget's tests.

import type { Model, Snapshot, Update, ViewsPayload } from "../widget.ts";

type Handler = (...args: never[]) => void;

/** anywidget's model as the widget sees it: state, custom messages, and events. */
export class MockModel implements Model {
  readonly sent: Record<string, unknown>[] = [];
  readonly #state: Record<string, unknown>;
  readonly #handlers = new Map<string, Handler[]>();

  constructor(state: Record<string, unknown>) {
    this.#state = state;
  }

  get(name: string): unknown {
    return this.#state[name];
  }

  set(name: string, value: unknown) {
    this.#state[name] = value;
    this.#emit(`change:${name}`);
  }

  send(content: object, _callbacks?: unknown, buffers?: ArrayBuffer[] | ArrayBufferView[]) {
    this.sent.push({ ...(content as Record<string, unknown>), ...(buffers && { buffers }) });
  }

  on(event: string, callback: Handler) {
    this.#handlers.set(event, [...(this.#handlers.get(event) ?? []), callback]);
  }

  /** A custom message from Python, with its buffers as the comm delivers them. */
  receive(message: Update, buffers: ArrayBufferView[] = []) {
    this.#emit(
      "msg:custom",
      message,
      buffers.map((b) => new DataView(b.buffer)),
    );
  }

  #emit(event: string, ...args: unknown[]) {
    for (const handler of this.#handlers.get(event) ?? [])
      (handler as (...a: unknown[]) => void)(...args);
  }

  /** Messages of one type sent to Python. */
  messages(type: string) {
    return this.sent.filter((message) => message.type === type);
  }
}

export const number = (buffer: number) => ({
  type: "number" as const,
  dtype: "float64" as const,
  buffer,
});

export function snapshot(options: Record<string, unknown> = {}): Snapshot {
  return {
    revision: 0,
    spec: {
      title: "Live",
      width: 400,
      height: 200,
      renderer: "svg",
      ...options,
      data: {
        data: {
          columns: {
            t: number(0),
            v: number(1),
            host: { type: "category", codes: 2, dictionary: ["a"] },
          },
        },
      },
      marks: [{ type: "line", x: "t", y: "v", data: "data" }],
    },
    buffers: [
      new DataView(new Float64Array([0, 1, 2]).buffer),
      new DataView(new Float64Array([1, 3, 2]).buffer),
      new DataView(new Int32Array([0, 0, 0]).buffer),
    ],
    selection: null,
    viewport: null,
    drill_root: null,
    item_positions: {},
  };
}

type Ends = [number, number] | null;
type Axis = "x" | "y" | "yRight";

/**
 * The views of a chart as a display reports them (`ViewsPayload`): each
 * scale instance's view (`instances`, by axis and the panels drawing it;
 * shared by every panel unless `own`), each panel's whole view, and the
 * planes of subplots' maps and networks. A chart of one panel is panel "".
 */
export function views(
  instances: { scale: Axis; panels: string[]; view: Ends; own?: boolean; type?: string }[],
  planes: Record<string, { x: Ends; y: Ends }> = {},
): ViewsPayload {
  const scales = instances.map(({ scale, panels, view, own = false, type = "linear" }) => {
    const instance = own ? JSON.stringify(panels) : "";
    return {
      scale,
      instance,
      time: type === "time",
      panels,
      view,
      identity: JSON.stringify([scale, type, instance]),
    };
  });
  const keys = [...new Set(scales.flatMap(({ panels }) => panels))];
  const shown = (of: (axis: Axis) => (typeof scales)[number] | undefined) => {
    const time = (["x", "y", "yRight"] as const).filter((axis) => of(axis)?.time);
    return {
      x: of("x")?.view ?? null,
      y: of("y")?.view ?? null,
      yRight: of("yRight")?.view ?? null,
      time,
    };
  };
  const along = (axis: Axis) => scales.filter(({ scale }) => scale === axis);
  return {
    axes: {
      viewRevision: 1,
      scales,
      views: keys.map((panel) => ({
        panel,
        ...shown((axis) => along(axis).find(({ panels }) => panels.includes(panel))),
      })),
      ...(scales.length && {
        view: shown((axis) => {
          const of = along(axis);
          return (
            of.find(({ instance }) => instance === "") ?? (of.length === 1 ? of[0] : undefined)
          );
        }),
      }),
    },
    planes: Object.fromEntries(
      Object.entries(planes).map(([panel, view]) => [panel, { ...view, yRight: null, time: [] }]),
    ),
  };
}

/** The views of a chart of one panel, x and y shared, as a display reports them. */
export const oneView = (x: Ends, y: Ends = null): ViewsPayload =>
  views([
    { scale: "x", panels: [""], view: x },
    { scale: "y", panels: [""], view: y },
  ]);
