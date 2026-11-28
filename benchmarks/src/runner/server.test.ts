import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type PageServer, serve } from "./server.ts";

const directory = mkdtempSync(join(tmpdir(), "bench-server-"));
writeFileSync(join(directory, "a.js"), Buffer.alloc(20_000, 97));
writeFileSync(join(directory, "b.js"), Buffer.alloc(20_000, 98));
const page = (name: string) => `<!doctype html><title>${name}</title>`;
const servers: PageServer[] = [];
afterAll(() => {
  for (const server of servers) server.close();
  rmSync(directory, { recursive: true, force: true });
});

async function timed(url: string): Promise<{ ms: number; bytes: number; headers: Headers }> {
  const start = performance.now();
  const response = await fetch(url);
  const body = await response.arrayBuffer();
  return { ms: performance.now() - start, bytes: body.byteLength, headers: response.headers };
}

describe("page server", () => {
  it("serves pages uncached and their assets cacheable, cross-origin isolated, logging requests", async () => {
    const server = await serve(directory, page);
    servers.push(server);
    const html = await timed(`${server.origin}/herceg.html`);
    expect(html.headers.get("cache-control")).toBe("no-store");
    expect(html.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    const script = await timed(`${server.origin}/a.js`);
    expect(script.bytes).toBe(20_000);
    expect(script.headers.get("cache-control")).toBe("max-age=3600");
    expect(script.headers.get("content-type")).toBe("text/javascript");
    expect((await fetch(`${server.origin}/../secret`)).status).toBe(404);
    expect(server.requests.slice(0, 2)).toEqual(["/herceg.html", "/a.js"]);
  });

  it("delays every response by the throttle's latency and shares its bandwidth among bodies", async () => {
    // 50 ms, and 800 kbit/s: 100 KB a second, so 20 KB takes 200 ms.
    const server = await serve(directory, page, {
      throttle: { latencyMs: 50, bitsPerSecond: 800_000 },
    });
    servers.push(server);
    const html = await timed(`${server.origin}/herceg.html`);
    expect(html.ms).toBeGreaterThanOrEqual(48);
    const one = await timed(`${server.origin}/a.js`);
    expect(one.bytes).toBe(20_000);
    expect(one.ms).toBeGreaterThanOrEqual(240);
    expect(one.ms).toBeLessThan(400);
    // Two at once share the link: both end after their 40 KB together, about 450 ms.
    const start = performance.now();
    const both = await Promise.all([
      timed(`${server.origin}/a.js`),
      timed(`${server.origin}/b.js`),
    ]);
    const together = performance.now() - start;
    expect(both.map((response) => response.bytes)).toEqual([20_000, 20_000]);
    expect(together).toBeGreaterThanOrEqual(430);
    expect(together).toBeLessThan(700);
  });
});
