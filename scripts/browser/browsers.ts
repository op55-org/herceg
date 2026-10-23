/// <reference types="node" />
// The engines every browser test suite runs in: the installed Google Chrome,
// and Playwright's Firefox and WebKit builds (`npx playwright install firefox
// webkit`). `HERCEG_BROWSERS=chromium` (or a list, `firefox,webkit`) runs
// only those.

import { join } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserInstanceOption } from "vitest/node";
import { createFirefoxAppData } from "./firefox.ts";

const firefoxData = createFirefoxAppData();

/** Where Firefox's remote debugging protocol listens, for what Juggler does not offer. */
export const firefoxDevTools = join(firefoxData.directory, "devtools.sock");

const engines: BrowserInstanceOption[] = [
  { browser: "chromium", provider: playwright({ launchOptions: { channel: "chrome" } }) },
  {
    browser: "firefox",
    // Its pages share one mouse: real input in test files running at once
    // lands in each other's drags.
    fileParallelism: false,
    provider: playwright({
      launchOptions: {
        env: firefoxData.env,
        args: ["-start-debugger-server", firefoxDevTools],
        firefoxUserPrefs: {
          "devtools.debugger.remote-enabled": true,
          "devtools.chrome.enabled": true,
          "devtools.debugger.prompt-connection": false,
        },
      },
    }),
  },
  { browser: "webkit", provider: playwright() },
];

const chosen = process.env.HERCEG_BROWSERS?.split(",").map((name) => name.trim());
for (const name of chosen ?? [])
  if (!engines.some(({ browser }) => browser === name))
    throw new Error(
      `HERCEG_BROWSERS: no browser "${name}"; name chromium, firefox, or webkit, comma-separated`,
    );

/**
 * The test server's address, for every config's browser project (`api`).
 * Bound to "localhost", Vite takes ::1 alone when another program holds
 * 127.0.0.1 on its port (Android's adb can take Vitest's default, 63315),
 * and Firefox, which reaches localhost over IPv4, then connects to that
 * program and never starts. Bound to IPv4, Vite sees the clash and moves on.
 */
export const browserServer = { host: "127.0.0.1" };

export const browsers = engines.filter(({ browser }) => !chosen || chosen.includes(browser));
