// The benchmark pages' HTTP server: built pages and their assets,
// cross-origin isolated (so `performance.now()` has 5 µs resolution), with
// cache headers so a second visit takes the assets from the cache, a log of
// the requests it answered, and optionally a throttled connection.
//
// Throttling is the server's, not a browser's, so it is the same in Chrome,
// Firefox, WebKit, and on a phone: every response, the page's HTML
// included, waits a fixed latency before its headers, and the bodies of all
// responses under way share one bandwidth, sent in chunks as that budget
// allows.

import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";

// Cross-origin isolation raises performance.now() resolution from 100 µs to 5 µs.
export const ISOLATION = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
};

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
};

/** A connection as slow as a mobile network: a latency added to every response and one bandwidth for all of them. */
export interface Throttle {
  /** ms before each response's headers. */
  latencyMs: number;
  /** Bits per second the response bodies share. */
  bitsPerSecond: number;
}

/** The latency case's connection: Chrome's "Slow 4G" preset, 150 ms and 1.6 Mbit/s down. */
export const SLOW_4G: Throttle = { latencyMs: 150, bitsPerSecond: 1_600_000 };

const CHUNK = 16 * 1024;

/** Sends `body` through the throttled link: after its latency, in chunks the shared bandwidth paces. */
function throttled(throttle: Throttle, link: { freeAt: number }) {
  return (response: ServerResponse, status: number, headers: object, body: Buffer) => {
    setTimeout(() => {
      response.writeHead(status, headers as Record<string, string>);
      let offset = 0;
      const next = () => {
        if (offset >= body.length) {
          response.end();
          return;
        }
        const chunk = body.subarray(offset, offset + CHUNK);
        offset += chunk.length;
        const now = performance.now();
        link.freeAt =
          Math.max(now, link.freeAt) + (chunk.length * 8 * 1000) / throttle.bitsPerSecond;
        setTimeout(() => {
          response.write(chunk);
          next();
        }, link.freeAt - now);
      };
      next();
    }, throttle.latencyMs);
  };
}

export interface PageServer {
  server: Server;
  origin: string;
  /** Paths answered, in order, since the server started or `requests.length = 0`. */
  requests: string[];
  close(): void;
}

/**
 * Serves `/<name>.html` as `page(name)` and other paths from `directory`,
 * on 127.0.0.1 (or `host`), with JavaScript and CSS cacheable for an hour
 * (they do not change within a run).
 */
export function serve(
  directory: string,
  page: (name: string) => string,
  options: { throttle?: Throttle; host?: string } = {},
): Promise<PageServer> {
  const requests: string[] = [];
  const link = { freeAt: 0 };
  const send = options.throttle
    ? throttled(options.throttle, link)
    : (response: ServerResponse, status: number, headers: object, body: Buffer) => {
        response.writeHead(status, headers as Record<string, string>);
        response.end(body);
      };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    requests.push(path);
    const html = /^\/([\w-]+)\.html$/.exec(path);
    if (html) {
      send(
        response,
        200,
        { "content-type": "text/html", "cache-control": "no-store", ...ISOLATION },
        Buffer.from(page(html[1]!)),
      );
      return;
    }
    const file = join(directory, path.replace(/^\//, ""));
    if (!file.startsWith(directory) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    send(
      response,
      200,
      {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": "max-age=3600",
        ...ISOLATION,
      },
      readFileSync(file),
    );
  });
  return new Promise((resolve) => {
    const host = options.host ?? "127.0.0.1";
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://${host}:${port}`, requests, close: () => server.close() });
    });
  });
}
