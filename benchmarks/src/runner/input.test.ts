// The driver's input reaches pages as the browser's own events in every
// engine the suites run in, and the page's arrival record ignores events a
// script made. Launches Chrome, Firefox, and WebKit itself, as the runners do.

import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { build } from "esbuild";
import { type Browser, chromium, firefox, webkit } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirefoxAppData } from "../../../scripts/browser/firefox.ts";
import type { Arrival } from "../page/input.ts";
import { driverFor, type Engine } from "./input.ts";

declare global {
  interface Window {
    arrivals: Arrival[];
    /** Resolves with the next trusted event of `type`, or "none" after `ms`. */
    nextTrusted(type: string, ms: number): Promise<string>;
  }
}

const PAGE = `
import { nextArrival, recordArrivals } from "./src/page/input.ts";
window.arrivals = recordArrivals();
window.nextTrusted = (type, ms) =>
  Promise.race([
    nextArrival((arrival) => arrival.type === type).then(() => "trusted"),
    new Promise((resolve) => setTimeout(() => resolve("none"), ms)),
  ]);
`;

let server: Server;
let origin: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: PAGE, resolveDir: join(import.meta.dirname, "..", ".."), loader: "ts" },
    bundle: true,
    format: "esm",
    write: false,
    logLevel: "warning",
  });
  const script = bundle.outputFiles[0]!.text;
  server = createServer((request, response) => {
    if (request.url === "/page.js") {
      response.writeHead(200, { "content-type": "text/javascript" }).end(script);
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html" })
      .end(
        '<!doctype html><body style="margin:0;width:100vw;height:100vh"><script type="module" src="/page.js"></script></body>',
      );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => server?.close());

const LAUNCH: Record<Engine, () => Promise<Browser>> = {
  chrome: () => chromium.launch({ channel: "chrome", headless: true }),
  firefox: () => firefox.launch({ headless: true, env: createFirefoxAppData().env }),
  webkit: () => webkit.launch({ headless: true }),
};

describe.each(["chrome", "firefox", "webkit"] as const)("trusted input in %s", (engine) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await LAUNCH[engine]();
  }, 60_000);
  afterAll(() => browser?.close());

  it("reaches the page as the browser's own events, where it was sent", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(origin);
    await page.waitForFunction(() => window.arrivals !== undefined);
    const driver = await driverFor(page, engine);
    await driver.step({ type: "move", x: 100, y: 120 });
    await driver.step({ type: "press", x: 100, y: 120 });
    await driver.step({ type: "move", x: 140, y: 120 });
    await driver.step({ type: "release", x: 140, y: 120 });
    await driver.step({ type: "wheel", x: 140, y: 120, deltaX: 0, deltaY: 50 });
    await driver.step({ type: "key", key: "a" });
    const arrivals = await page.evaluate(() => window.arrivals);
    for (const type of ["pointermove", "pointerdown", "pointerup", "wheel", "keydown"])
      expect(
        arrivals.some((a) => a.type === type),
        type,
      ).toBe(true);
    expect(arrivals.every((a) => a.isTrusted)).toBe(true);
    const move = arrivals.find((a) => a.type === "pointermove")!;
    expect([move.x, move.y]).toEqual([100, 120]);
    // The drag's move carried the pressed button.
    expect(arrivals.find((a) => a.type === "pointermove" && a.x === 140)?.buttons).toBe(1);
    expect(arrivals.find((a) => a.type === "keydown")?.key).toBe("a");
    await page.close();
  });

  it("sends moves without waiting, and waits for them all when asked", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(origin);
    await page.waitForFunction(() => window.arrivals !== undefined);
    const driver = await driverFor(page, engine);
    let sent = 0;
    for (let i = 0; i < 20; i++) if (driver.send({ type: "move", x: 10 + i * 5, y: 50 })) sent++;
    // At most four in flight by default: the rest were skipped, not queued.
    expect(sent).toBeGreaterThanOrEqual(4);
    expect(sent).toBeLessThan(20);
    await driver.drain();
    await expect
      .poll(() =>
        page.evaluate(() => window.arrivals.filter((a) => a.type === "pointermove").length),
      )
      .toBeGreaterThan(0);
    await page.close();
  });

  it("does not take an event a script dispatched for input", async () => {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(origin);
    await page.waitForFunction(() => window.arrivals !== undefined);
    const waiting = page.evaluate(() => window.nextTrusted("pointerdown", 500));
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 }),
      ),
    );
    expect(await waiting).toBe("none");
    expect(
      await page.evaluate(() => window.arrivals.find((a) => a.type === "pointerdown")?.isTrusted),
    ).toBe(false);
    const trusted = page.evaluate(() => window.nextTrusted("pointerdown", 5000));
    const driver = await driverFor(page, engine);
    await driver.step({ type: "press", x: 20, y: 20 });
    expect(await trusted).toBe("trusted");
    await page.close();
  });
});
