// Chart options from a payload: fetched from a URL or given as bytes.

import type { ChartOptions } from "../dom/chart.ts";
import { ChartError, chartError } from "../spec/errors.ts";
import { type LoadedSpec, loadSpec } from "../spec/load.ts";
import { decodePayload } from "./payload.ts";

/** Where a payload comes from: a URL to fetch, or its bytes. */
export type PayloadSource = string | URL | ArrayBuffer | ArrayBufferView;

/**
 * The chart options of a payload (see `encodePayload`; Python's
 * `herceg.web.payload(chart)`), fetched from `source` when it is a URL,
 * for `createChart` or an adapter's `<Chart>`. Rejects with a `ChartError`
 * for a response that is not a payload or a spec the engine refuses, and
 * with the `signal`'s reason when it aborts.
 */
export async function loadPayload(
  source: PayloadSource,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<ChartOptions> {
  return (await loadPayloadSpec(source, options)).config;
}

/** As `loadPayload`, with the spec's tables and selection stores by name. */
export async function loadPayloadSpec(
  source: PayloadSource,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<LoadedSpec> {
  const { signal } = options;
  signal?.throwIfAborted();
  const bytes =
    typeof source === "string" || source instanceof URL
      ? await fetchPayload(String(source), signal)
      : source;
  signal?.throwIfAborted();
  const { header, buffers } = decodePayload(bytes);
  try {
    return loadSpec(header.spec, buffers);
  } catch (error) {
    throw chartError(error, "validate");
  }
}

async function fetchPayload(url: string, signal: AbortSignal | undefined): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ?? null });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw failed(url, `could not be fetched (${(error as Error).message})`, error);
  }
  if (!response.ok)
    throw failed(url, `the server answered ${response.status} ${response.statusText}`.trimEnd());
  try {
    return await response.arrayBuffer();
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw failed(url, `its body could not be read (${(error as Error).message})`, error);
  }
}

function failed(url: string, problem: string, cause?: unknown): ChartError {
  return new ChartError(
    {
      code: "load-failed",
      phase: "load",
      message: `payload ${JSON.stringify(url)}: ${problem}; check the route that serves it, and that the page's connect-src allows it`,
    },
    cause,
  );
}
