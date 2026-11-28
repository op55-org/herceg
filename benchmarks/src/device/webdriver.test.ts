// The WebDriver client against a stub driver: the requests it makes, and
// the errors it reports. A real session needs Safari's remote automation
// (see benchmarks/README.md, "Device runner").

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newSession, WebDriverError } from "./webdriver.ts";

const requests: { method: string; path: string; body: unknown }[] = [];
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => {
      const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: request.method!, path: request.url!, body });
      const answer = (status: number, value: unknown) =>
        response
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify({ value }));
      if (request.url === "/session" && body.capabilities.alwaysMatch.platformName === "iOS")
        return answer(500, {
          error: "session not created",
          message: "You must enable 'Allow remote automation'",
        });
      if (request.url === "/session")
        return answer(200, {
          sessionId: "s1",
          capabilities: { browserName: "Safari", browserVersion: "26.0" },
        });
      if (request.url === "/session/s1/execute/async") return answer(200, { echoed: body.args });
      if (request.url === "/session/s1/screenshot") return answer(200, "iVBORw0KGgo=");
      return answer(200, null);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  endpoint = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => server.close());

describe("WebDriver client", () => {
  it("starts a session and sends each command to it", async () => {
    const session = await newSession(endpoint, { browserName: "safari" });
    expect(session.id).toBe("s1");
    expect(session.capabilities.browserVersion).toBe("26.0");
    await session.navigate("http://192.168.1.20:5000/herceg.html");
    expect(await session.executeAsync("arguments[1](arguments[0])", [{ a: 1 }])).toEqual({
      echoed: [{ a: 1 }],
    });
    await session.perform([
      {
        type: "pointer",
        id: "finger",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", x: 10, y: 20, duration: 0, origin: "viewport" },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    expect(await session.screenshot()).toBe("iVBORw0KGgo=");
    await session.close();
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /session",
      "POST /session/s1/url",
      "POST /session/s1/execute/async",
      "POST /session/s1/actions",
      "GET /session/s1/screenshot",
      "DELETE /session/s1",
    ]);
    expect(requests[0]!.body).toEqual({ capabilities: { alwaysMatch: { browserName: "safari" } } });
    expect(requests[1]!.body).toEqual({ url: "http://192.168.1.20:5000/herceg.html" });
    // A tap: a touch pointer moved to the point, pressed, and lifted, in viewport coordinates.
    expect(requests[3]!.body).toEqual({
      actions: [
        {
          type: "pointer",
          id: "finger",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", x: 10, y: 20, duration: 0, origin: "viewport" },
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  });

  it("reports a refused session with the driver's error code and message", async () => {
    const refused = newSession(endpoint, { browserName: "safari", platformName: "iOS" });
    await expect(refused).rejects.toBeInstanceOf(WebDriverError);
    await expect(refused).rejects.toMatchObject({ code: "session not created" });
    await expect(refused).rejects.toThrow(/Allow remote automation/);
  });
});
