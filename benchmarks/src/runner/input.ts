// Trusted input for every runner: pointer moves, presses, drags, wheel
// turns, and keys dispatched through the browser driver, so pages receive
// them as they receive a person's (`isTrusted`), never as events a script
// made. In Chrome the DevTools Protocol's Input domain sends them; in
// Firefox and WebKit, Playwright's mouse and keyboard.
//
// Two ways to send. `step` sends one input and returns once the page has
// it: Chrome's protocol answers after the page handled the event, while
// Firefox's (and WebKit's on Linux) can answer before, so there the driver
// waits until the page's count of that event type moves (page/input.ts).
// `send` hands a move or a wheel turn to the driver without waiting, for
// sustained traces sent on a fixed schedule: a page busy drawing then
// receives coalesced events, as with a real pointer, rather than slowing
// the schedule down.

import type { CDPSession, Page } from "playwright";

export type Engine = "chrome" | "firefox" | "webkit";

export type Modifier = "Alt" | "Control" | "Meta" | "Shift";

/** One input, at a client position of the page where it has one. */
export type Input =
  | { type: "move"; x: number; y: number }
  | { type: "press"; x: number; y: number }
  | { type: "release"; x: number; y: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers?: Modifier[] }
  | { type: "key"; key: string; modifiers?: Modifier[] };

/** Inputs `send` sends without waiting. */
export type Sent = Extract<Input, { type: "move" | "wheel" }>;

/** The DOM event each input makes, which `step` waits for in Firefox and WebKit. */
const EVENT: Record<Input["type"], string> = {
  move: "pointermove",
  press: "pointerdown",
  release: "pointerup",
  wheel: "wheel",
  key: "keydown",
};

/** The DevTools Protocol's modifier bits. */
const BITS: Record<Modifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

export interface Driver {
  readonly engine: Engine;
  /** Sends `input` and returns once the page has received it. */
  step(input: Input): Promise<void>;
  /** Sends a move or wheel turn without waiting for the page; false when `limit` sent inputs are still unanswered (skipped). */
  send(input: Sent, limit?: number): boolean;
  /** Waits for every input `send` sent; throws when the driver failed to deliver any of them. */
  drain(): Promise<void>;
}

declare global {
  interface Window {
    benchInput?: { count(type: string): number };
  }
}

/**
 * The driver for `page`. Chrome's needs the page's DevTools session (one is
 * made when none is given); the page must load page/input.ts before its
 * library code, as every benchmark page does.
 */
export async function driverFor(page: Page, engine: Engine, session?: CDPSession): Promise<Driver> {
  const cdp =
    engine === "chrome" ? (session ?? (await page.context().newCDPSession(page))) : undefined;
  let pressed = false;
  const outstanding = new Set<Promise<unknown>>();
  let failed: { count: number; first: unknown } | undefined;
  const count = (type: string) => page.evaluate((t) => window.benchInput?.count(t) ?? 0, type);

  const viaCdp = async (input: Input) => {
    const send = (method: string, params: object) => cdp!.send(method as never, params as never);
    const bits =
      "modifiers" in input ? (input.modifiers ?? []).reduce((sum, m) => sum | BITS[m], 0) : 0;
    switch (input.type) {
      case "move":
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: input.x,
          y: input.y,
          button: pressed ? "left" : "none",
          buttons: pressed ? 1 : 0,
        });
        return;
      case "press":
      case "release":
        pressed = input.type === "press";
        await send("Input.dispatchMouseEvent", {
          type: input.type === "press" ? "mousePressed" : "mouseReleased",
          x: input.x,
          y: input.y,
          button: "left",
          buttons: pressed ? 1 : 0,
          clickCount: 1,
        });
        return;
      case "wheel":
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: input.x,
          y: input.y,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
          modifiers: bits,
        });
        return;
      case "key":
        // Playwright's keyboard speaks the same protocol, with each key's codes.
        await withModifiers(page, input.modifiers, () => page.keyboard.press(input.key));
        return;
    }
  };

  const viaPlaywright = async (input: Input) => {
    switch (input.type) {
      case "move":
        await page.mouse.move(input.x, input.y);
        return;
      case "press":
        await page.mouse.move(input.x, input.y);
        await page.mouse.down();
        return;
      case "release":
        await page.mouse.move(input.x, input.y);
        await page.mouse.up();
        return;
      case "wheel":
        await page.mouse.move(input.x, input.y);
        await withModifiers(page, input.modifiers, () =>
          page.mouse.wheel(input.deltaX, input.deltaY),
        );
        return;
      case "key":
        await withModifiers(page, input.modifiers, () => page.keyboard.press(input.key));
        return;
    }
  };

  return {
    engine,
    async step(input) {
      if (cdp) return viaCdp(input);
      const type = EVENT[input.type];
      const before = await count(type);
      await viaPlaywright(input);
      // Ask again and again: a page waiting on the protocol gets no input.
      for (const start = Date.now(); (await count(type)) === before; )
        if (Date.now() - start > 2000)
          throw new Error(`input: no ${type} reached the page for ${JSON.stringify(input)}`);
    },
    send(input, limit = 4) {
      if (outstanding.size >= limit) return false;
      const sent: Promise<unknown> = (cdp ? viaCdp(input) : viaPlaywright(input)).catch((error) => {
        failed ??= { count: 0, first: error };
        failed.count++;
      });
      outstanding.add(sent);
      sent.then(() => outstanding.delete(sent));
      return true;
    },
    async drain() {
      await Promise.all(outstanding);
      if (!failed) return;
      const { count, first } = failed;
      failed = undefined;
      throw new Error(
        `input: ${count} sent inputs were not delivered: ${(first as Error).message}`,
      );
    },
  };
}

async function withModifiers(
  page: Page,
  modifiers: Modifier[] = [],
  body: () => Promise<void>,
): Promise<void> {
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try {
    await body();
  } finally {
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  }
}
