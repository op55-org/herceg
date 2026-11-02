import { describe, expect, it } from "vitest";
import { selectionPayload } from "../../src/web/events.ts";

describe("selection payloads", () => {
  it("mark a y range of a right axis of times as times", () => {
    const owner = {
      scales: [{ scale: "yRight" as const, instance: "", type: "time" as const, panels: ["b"] }],
      panels: ["b"],
    };
    const payload = selectionPayload(
      { kind: "brush", x: null, y: [0, 86_400_000], lasso: null },
      owner,
    );
    expect(payload).toMatchObject({ kind: "brush", y: [0, 86_400_000], time: ["y"] });
  });
});
