// Herceg's web pages as a Flask app serves them (app.py, around the example
// app), in real browsers: fragments without the engine, its files fetched
// once and cached, charts inserted and removed as HTMX does, sync between
// fragments, DOM events, strict Content Security Policies, failures shown
// in place, large data from a route, and labels that try to escape.

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { type Browser, chromium, firefox, type Page, webkit } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirefoxAppData } from "../../scripts/browser/firefox.ts";

declare global {
  interface Window {
    events: { type: string; detail: { id: string } & Record<string, unknown> }[];
    violations: string[];
    posted: string[];
    pwned?: number;
    web: typeof import("../../packages/herceg/src/web.ts");
  }
}

const PYTHON = new URL("..", import.meta.url).pathname;
const STATIC = new URL("../src/herceg/static/web/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", STATIC), "utf8")) as {
  entry: string;
  preload: string[];
  files: string[];
};
const ENTRY = `/_herceg/${manifest.entry}`;

const ENGINES: Record<string, () => Promise<Browser>> = {
  chromium: () => chromium.launch({ channel: "chrome" }),
  firefox: () => firefox.launch({ env: createFirefoxAppData().env }),
  webkit: () => webkit.launch(),
};
const chosen = process.env.HERCEG_BROWSERS?.split(",").map((name) => name.trim());
const engines = Object.keys(ENGINES).filter((name) => !chosen || chosen.includes(name));

const KINDS = [
  "line",
  "bar",
  "area",
  "scatter",
  "heatmap",
  "facets",
  "layout",
  "inset",
  "map",
  "network",
  "sankey",
  "treemap",
  "three",
];

let server: ChildProcess;
let origin = "";

beforeAll(async () => {
  server = spawn("uv", ["run", "--extra", "dev", "python", "web-test/app.py"], {
    cwd: PYTHON,
    stdio: ["ignore", "pipe", "inherit"],
  });
  origin = await new Promise((resolve, reject) => {
    createInterface({ input: server.stdout! }).on("line", (line) => {
      const ready = /^ready (\d+)$/.exec(line);
      if (ready) resolve(`http://127.0.0.1:${ready[1]}`);
    });
    server.once("exit", (code) => reject(new Error(`the test app exited with ${code}`)));
  });
});

afterAll(() => {
  server?.kill();
});

/** Requests the app answered, by path, since the last reset. */
async function hits(): Promise<Record<string, number>> {
  return (await fetch(`${origin}/test/hits`)).json() as Promise<Record<string, number>>;
}

async function reset() {
  await fetch(`${origin}/test/hits/reset`, { method: "POST" });
}

/** A page of a new browser context, which records the policy's violations. */
async function open(browser: Browser, options: { javaScriptEnabled?: boolean } = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.violations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.violations.push(`${event.violatedDirective} ${event.blockedURI} ${event.sample}`),
    );
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    // The browser logs failed requests, which some tests make on purpose.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
      errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

/** Waits for `count` events of `type` (for host `id`, if given). */
async function events(page: Page, type: string, count: number, id?: string) {
  await page.waitForFunction(
    ([type, count, id]) =>
      window.events.filter((event) => event.type === type && (!id || event.detail.id === id))
        .length >= (count as number),
    [type, count, id] as const,
  );
  return page.evaluate(
    ([type, id]) =>
      window.events.filter((event) => event.type === type && (!id || event.detail.id === id)),
    [type, id] as const,
  );
}

/**
 * herceg/web in the page, as its modules import it (on pages without a
 * policy): from the URL of the script herceg.web.assets() loads.
 */
async function withWeb(page: Page) {
  await page.addScriptTag({
    type: "module",
    content: `import * as web from "${ENTRY}"; window.web = web;`,
  });
  await page.waitForFunction(() => window.web !== undefined);
}

const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))));

describe.each(engines)("web pages in %s", (engine) => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await ENGINES[engine]!();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("carry the engine once for ten charts, its files cached from page to page", async () => {
    await reset();
    const { context, page } = await open(browser);
    const response = await page.goto(`${origin}/test/page?n=10&kinds=line`);
    const html = await response!.text();
    await events(page, "herceg:ready", 10);
    // Ten charts' data, without a byte of the engine.
    const engineCode = readFileSync(new URL(manifest.entry, STATIC), "utf8");
    expect(html.length).toBeLessThan(80_000);
    expect(html).not.toContain(engineCode.slice(2000, 2200));
    expect(html.match(/<template data-herceg-payload>/g)).toHaveLength(10);
    const first = await hits();
    expect(first[ENTRY]).toBe(1);
    for (const chunk of manifest.preload) expect(first[`/_herceg/${chunk}`]).toBe(1);
    // Files of the engine never change under their names: another page
    // takes them from the cache, without asking.
    await page.goto(`${origin}/test/page?n=10&kinds=bar`);
    await events(page, "herceg:ready", 10);
    const second = await hits();
    for (const [path, count] of Object.entries(second))
      if (path.startsWith("/_herceg/")) expect(count, path).toBe(1);
    const cached = await page.request.get(`${origin}${ENTRY}`);
    expect(cached.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(cached.headers()["content-type"]).toMatch(/^text\/javascript/);
    expect((await page.request.get(`${origin}/_herceg/manifest.json`)).status()).toBe(404);
    expect((await page.request.get(`${origin}/_herceg/../web.py`)).status()).toBe(404);
    expect(await page.evaluate(() => window.violations)).toEqual([]);
    await context.close();
  });

  it("mount every kind of chart, from the page or from a route", async () => {
    for (const data of ["page", "url"]) {
      const { context, page, errors } = await open(browser);
      await page.goto(`${origin}/test/page?kinds=${KINDS.join(",")}&data=${data}`);
      const ready = await events(page, "herceg:ready", KINDS.length);
      expect(ready.map(({ detail }) => detail.id).sort()).toEqual(
        KINDS.map((kind) => `${kind}-0`).sort(),
      );
      expect(
        await page.evaluate(() => window.events.filter((e) => e.type === "herceg:error")),
      ).toEqual([]);
      for (const kind of KINDS) {
        const host = page.locator(`#${kind}-0`);
        expect(await host.locator("[data-herceg-fallback]").isHidden()).toBe(true);
        expect(
          await host.locator("[data-herceg-runtime] svg, [data-herceg-runtime] canvas").count(),
        ).toBeGreaterThan(0);
      }
      expect(errors).toEqual([]);
      await context.close();
    }
  });

  it.each(["nonce", "dynamic"])(
    "run under a strict policy of scripts by nonce (%s), lazy modules included",
    async (csp) => {
      await reset();
      const { context, page } = await open(browser);
      await page.goto(`${origin}/test/page?kinds=line,map,network,three&csp=${csp}`);
      await events(page, "herceg:ready", 4);
      // The interaction controller is a module the charts import later.
      const controller = manifest.files.find((name) => name.startsWith("interaction-"))!;
      await expect.poll(async () => (await hits())[`/_herceg/${controller}`]).toBe(1);
      await page.hover("#line-0 [data-herceg-runtime]");
      await nextFrame(page);
      expect(await page.evaluate(() => window.violations)).toEqual([]);
      await context.close();
    },
  );

  it("draw under a policy of styles by nonce, saying what it refuses", async () => {
    const { context, page } = await open(browser);
    await page.goto(`${origin}/test/page?kinds=line,bar,layout&csp=styles`);
    await events(page, "herceg:ready", 3);
    await page.hover("#line-0 [data-herceg-runtime]");
    await nextFrame(page);
    const violations = await page.evaluate(() => window.violations);
    console.log(`${engine} style-src violations:`, violations);
    // Hosts are sized through the CSSOM, which a policy does not restrict.
    expect(
      await page.locator("#line-0").evaluate((host) => host.getBoundingClientRect().height),
    ).toBe(320);
    await context.close();
  });

  it("say where a chart goes without JavaScript, or without herceg's script", async () => {
    for (const [options, path] of [
      [{ javaScriptEnabled: false }, "/test/page?kinds=line"],
      [{}, "/test/page?kinds=line&assets=0"],
    ] as const) {
      const { context, page } = await open(browser, options);
      await page.goto(`${origin}${path}`);
      const fallback = page.locator("#line-0 [data-herceg-fallback]");
      expect(await fallback.isVisible()).toBe(true);
      expect(await fallback.textContent()).toBe(
        "Chart not loaded yet: Line. It needs JavaScript, and herceg.web.assets() once in the page.",
      );
      expect(
        await page.locator("#line-0").evaluate((host) => host.getBoundingClientRect().height),
      ).toBe(320);
      await context.close();
    }
  });

  it("mount fragments inserted later once, and destroy those removed", async () => {
    const { context, page } = await open(browser);
    await page.goto(`${origin}/test/page?kinds=synced&csp=none`);
    await events(page, "herceg:ready", 1);
    const insert = (path: string) =>
      page.evaluate(async (path) => {
        const html = await (await fetch(path)).text();
        document.querySelector("#more")!.insertAdjacentHTML("beforeend", html);
      }, path);
    await insert("/test/fragment/synced?id=late");
    await events(page, "herceg:ready", 1, "late");
    await withWeb(page);
    const moved = await page.evaluate(async () => {
      const { web } = window;
      const host = document.getElementById("late")!;
      const chart = web.getChart(host);
      // A host moved stays mounted.
      document.body.prepend(host);
      await new Promise((resolve) => setTimeout(resolve));
      const kept = web.getChart(host) === chart;
      // A host removed is unmounted: its chart destroyed, what mounting added gone.
      host.remove();
      await new Promise((resolve) => setTimeout(resolve));
      return {
        kept,
        gone: web.getChart(host) === undefined && !host.querySelector("[data-herceg-runtime]"),
      };
    });
    expect(moved).toEqual({ kept: true, gone: true });

    // HTMX's outerHTML swap: a new element of the same id replaces the host.
    await insert("/test/fragment/synced?id=swapped");
    await events(page, "herceg:ready", 1, "swapped");
    const swapped = await page.evaluate(async () => {
      const { web } = window;
      const old = document.getElementById("swapped")!;
      const html = await (await fetch("/test/fragment/bar?id=swapped")).text();
      old.outerHTML = html;
      await new Promise((resolve) => setTimeout(resolve));
      return web.getChart(old) === undefined;
    });
    expect(swapped).toBe(true);
    await events(page, "herceg:ready", 2, "swapped");

    // A page restored from history (HTMX sets saved markup back): the stale
    // drawing goes, and the chart is mounted afresh, once.
    const runtimes = await page.evaluate(async () => {
      const more = document.querySelector("#more")!;
      const saved = more.innerHTML;
      more.innerHTML = saved;
      await new Promise((resolve) => setTimeout(resolve));
      return document.querySelectorAll("#swapped > [data-herceg-runtime]").length;
    });
    expect(runtimes).toBe(1);
    await events(page, "herceg:ready", 3, "swapped");
    // HTMX's innerHTML swap of the host itself, or a restore with it as the
    // history element: the host stays, its content replaced.
    await page.evaluate(() => {
      const host = document.getElementById("swapped")!;
      const content = host.innerHTML;
      host.innerHTML = content;
    });
    await events(page, "herceg:ready", 4, "swapped");
    expect(await page.locator("#swapped > [data-herceg-runtime]").count()).toBe(1);

    // Removed while its data is still coming: the fetch is aborted, and the
    // chart neither shows nor tells of anything.
    await insert(`/test/fragment/line?id=slow&src=/test/bad/slow.bin`);
    await page.evaluate(() => document.getElementById("slow")!.remove());
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => window.events.filter((e) => e.detail.id === "slow"))).toEqual(
      [],
    );
    await context.close();
  });

  it("sync the charts of separate fragments", async () => {
    const { context, page } = await open(browser);
    await page.goto(`${origin}/test/page?kinds=synced&n=2&csp=none`);
    await events(page, "herceg:ready", 2);
    const start = Date.UTC(2026, 0, 1, 0, 30);
    const end = Date.UTC(2026, 0, 1, 1, 30);
    await withWeb(page);
    const view = await page.evaluate(
      async ([start, end]) => {
        const { web } = window;
        web.getChart(document.getElementById("synced-0")!)!.setViewport({ x: [start, end] });
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
        return web.getChart(document.getElementById("synced-1")!)!.getViewport().x;
      },
      [start, end] as const,
    );
    expect(view).toEqual([start, end]);
    const [event] = await events(page, "herceg:viewport", 1, "synced-1");
    // The synced chart's change, of the x every panel shares.
    expect(event!.detail).toMatchObject({
      id: "synced-1",
      cause: "sync",
      scales: [{ scale: "x", instance: "", time: true, panels: [""], view: [start, end] }],
      views: [{ panel: "", x: [start, end], y: null, yRight: null, time: ["x"] }],
    });
    await context.close();
  });

  it("tell the page of clicks and selections as JSON, the form's field filled first", async () => {
    const { context, page } = await open(browser);
    await page.goto(`${origin}/test/form`);
    await events(page, "herceg:ready", 1);
    const box = (await page.locator("#latency [data-herceg-runtime]").boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
    await page.mouse.up();
    const [select] = await events(page, "herceg:select", 1);
    const selection = select!.detail.selection as { x: [number, number]; time: string[] };
    expect(selection.time).toEqual(["x"]);
    expect(selection.x[0]).toBeLessThan(selection.x[1]);
    // The form sends what the event carries, which the app reads with herceg.web.selection.
    const [posted] = await page.evaluate(() => window.posted);
    expect(JSON.parse(posted!)).toEqual(selection);
    const summary = await fetch(`${origin}/summary`, {
      method: "POST",
      body: new URLSearchParams({ selection: posted! }),
    });
    expect(await summary.text()).toMatch(
      /^2026-01-01T\d\d:\d\d to 2026-01-01T\d\d:\d\d: median p50/,
    );

    await page.keyboard.press("Escape");
    await page.mouse.click(box.x + box.width * 0.8, y);
    const [click] = await events(page, "herceg:click", 1);
    const inspection = click!.detail.inspection as { axis: string; points: unknown[] };
    expect(inspection.axis).toBe("x");
    expect(inspection.points.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.violations)).toEqual([]);
    await context.close();
  });

  it("show what is not a chart's payload where the chart goes", async () => {
    const { context, page, errors } = await open(browser);
    await page.goto(`${origin}/test/page?kinds=&bad=html,missing,garbage&quiet=1`);
    const failed = await events(page, "herceg:error", 3);
    const messages = Object.fromEntries(
      failed.map(({ detail }) => [detail.id, detail.error as { code: string; message: string }]),
    );
    expect(messages["bad-html"]).toMatchObject({
      code: "load-failed",
      message:
        'payload: the response is not a Herceg payload (it starts with "<!doctype"); return herceg.web.payload(chart) from the data_url route',
    });
    expect(messages["bad-missing"]!.message).toMatch(
      /^payload "\/test\/bad\/missing\.bin": the server answered 404 NOT FOUND; /,
    );
    expect(messages["bad-garbage"]!.message).toMatch(/^payload: its header length/);
    for (const id of ["bad-html", "bad-missing", "bad-garbage"]) {
      const alert = await page.locator(`#${id} [role="alert"]`).textContent();
      expect(alert).toBe(`Chart could not be rendered\n${messages[id]!.message}`);
      expect(await page.locator(`#${id} [data-herceg-fallback]`).isHidden()).toBe(true);
    }
    // Canceled, they stay out of the console.
    expect(errors).toEqual([]);

    // A payload of another version, and a spec the engine refuses, held in the page.
    await page.evaluate(() => {
      const host = (id: string, payload: object) =>
        `<div id="${id}" data-herceg><template data-herceg-payload>${JSON.stringify(payload)}</template></div>`;
      document.querySelector("#more")!.innerHTML =
        host("v2", { protocol: 2, kind: "chart", spec: { marks: [] }, buffers: [] }) +
        host("refused", {
          protocol: 1,
          kind: "chart",
          spec: { marks: [{ type: "line", x: "t", y: "v" }] },
          buffers: [],
        });
    });
    const [v2] = await events(page, "herceg:error", 1, "v2");
    expect(v2!.detail.error).toMatchObject({
      code: "load-failed",
      phase: "load",
      message: expect.stringMatching(/^payload\.protocol: unsupported version 2; expected 1/),
    });
    const [refused] = await events(page, "herceg:error", 1, "refused");
    expect(refused!.detail.error).toMatchObject({ phase: "validate" });
    await context.close();
  });

  it("fetch a million points from a route, the page holding none", async () => {
    await reset();
    const { context, page } = await open(browser);
    const started = Date.now();
    const response = await page.goto(`${origin}/test/page?kinds=large&data=url`);
    expect((await response!.text()).length).toBeLessThan(4000);
    await events(page, "herceg:ready", 1);
    console.log(`${engine}: a million points from data_url ready in ${Date.now() - started} ms`);
    expect((await hits())["/test/payload/large.bin"]).toBe(1);
    await context.close();
  });

  it("keep labels that try to end the markup as text", async () => {
    for (const data of ["page", "url"]) {
      const { context, page } = await open(browser);
      await page.goto(`${origin}/test/page?kinds=malicious&data=${data}`);
      await events(page, "herceg:ready", 1);
      await nextFrame(page);
      expect(await page.evaluate(() => window.pwned)).toBeUndefined();
      expect(await page.evaluate(() => window.violations)).toEqual([]);
      expect(await page.locator("#malicious-0 [data-herceg-runtime]").textContent()).toContain(
        "</template><script>window.pwned = 1</script>",
      );
      await context.close();
    }
  });
});
