// A W3C WebDriver client, as much of it as the device runner uses (run.ts):
// safaridriver drives Safari on this Mac or on an attached iPhone through
// the same protocol, and Playwright drives neither. Each call is one HTTP
// request; a WebDriver error answer is thrown with its error code.

/** What a WebDriver endpoint answered with an error status. */
export class WebDriverError extends Error {
  override name = "WebDriverError";
  /** The WebDriver error code ("session not created", ...). */
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** One source of a WebDriver action chain: a pointer (mouse or touch) or a key source. */
export type ActionSource =
  | {
      type: "pointer";
      id: string;
      parameters: { pointerType: "mouse" | "touch" };
      actions: (
        | { type: "pointerMove"; x: number; y: number; duration?: number; origin?: "viewport" }
        | { type: "pointerDown" | "pointerUp"; button: number }
        | { type: "pause"; duration: number }
      )[];
    }
  | {
      type: "key";
      id: string;
      actions: (
        | { type: "keyDown" | "keyUp"; value: string }
        | { type: "pause"; duration: number }
      )[];
    };

export interface Session {
  readonly id: string;
  /** The capabilities the driver matched: browser name and version, platform. */
  readonly capabilities: Record<string, unknown>;
  navigate(url: string): Promise<void>;
  /** Runs `script` (a function body; `arguments` holds `args`) in the page and returns its value. */
  execute<T>(script: string, args?: unknown[]): Promise<T>;
  /**
   * Runs `script` in the page with a callback as its last argument, and
   * returns what it passed the callback.
   */
  executeAsync<T>(script: string, args?: unknown[]): Promise<T>;
  /** Dispatches input as the browser's own (trusted) events, and waits until it was dispatched. */
  perform(actions: ActionSource[]): Promise<void>;
  releaseActions(): Promise<void>;
  /** A PNG of the viewport, base64, in device pixels. */
  screenshot(): Promise<string>;
  /** Limits, ms: a script's run, and a page load. */
  timeouts(limits: { script?: number; pageLoad?: number }): Promise<void>;
  close(): Promise<void>;
}

async function call<T>(endpoint: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let answer: { value?: unknown };
  try {
    answer = text ? (JSON.parse(text) as { value?: unknown }) : {};
  } catch {
    throw new WebDriverError(
      "invalid answer",
      `${method} ${path}: ${response.status} ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok) {
    const error = answer.value as { error?: string; message?: string } | undefined;
    throw new WebDriverError(
      error?.error ?? `HTTP ${response.status}`,
      error?.message ?? text.slice(0, 200),
    );
  }
  return answer.value as T;
}

/** Starts a session at a WebDriver endpoint (`http://127.0.0.1:PORT`) matching `capabilities`. */
export async function newSession(
  endpoint: string,
  capabilities: Record<string, unknown>,
): Promise<Session> {
  const started = await call<{ sessionId: string; capabilities: Record<string, unknown> }>(
    endpoint,
    "POST",
    "/session",
    { capabilities: { alwaysMatch: capabilities } },
  );
  const base = `/session/${started.sessionId}`;
  const run = <T>(method: string, path: string, body?: unknown) =>
    call<T>(endpoint, method, `${base}${path}`, body);
  return {
    id: started.sessionId,
    capabilities: started.capabilities,
    navigate: (url) => run("POST", "/url", { url }),
    execute: (script, args = []) => run("POST", "/execute/sync", { script, args }),
    executeAsync: (script, args = []) => run("POST", "/execute/async", { script, args }),
    perform: (actions) => run("POST", "/actions", { actions }),
    releaseActions: () => run("DELETE", "/actions"),
    screenshot: () => run("GET", "/screenshot"),
    timeouts: (limits) => run("POST", "/timeouts", limits),
    close: () => run("DELETE", ""),
  };
}
