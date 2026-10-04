import { createSpanId, currentTraceContext } from "./trace-context";
import {
  getObservabilityConfig,
  loggableBody,
  writeStructuredLog,
} from "./structured-log";

let installed = false;

function isTextualContentType(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return (
    value.includes("application/json") ||
    value.includes("application/problem+json") ||
    value.startsWith("text/") ||
    value.includes("xml") ||
    value.includes("x-www-form-urlencoded")
  );
}

type FetchInput = Parameters<typeof fetch>[0];

function requestBodyForLog(body: RequestInit["body"] | null | undefined, contentType: string): unknown {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return loggableBody(body, contentType);
  if (body instanceof URLSearchParams) return loggableBody(body.toString(), contentType);
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const entries: Record<string, unknown[]> = {};
    for (const [key, value] of body.entries()) {
      const current = entries[key] ?? [];
      current.push(
        typeof value === "string"
          ? value
          : { kind: "file", name: value.name, type: value.type, bytes: value.size },
      );
      entries[key] = current;
    }
    return loggableBody(entries, "application/json");
  }
  if (Buffer.isBuffer(body)) return loggableBody(body, contentType);
  if (body instanceof Uint8Array) return loggableBody(body, contentType);
  if (body instanceof ArrayBuffer) return loggableBody(new Uint8Array(body), contentType);
  if (ArrayBuffer.isView(body)) {
    return loggableBody(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      contentType,
    );
  }
  return {
    kind: body.constructor?.name ?? typeof body,
    note: "streaming_or_non_serializable_request_body",
  };
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (next.value.byteLength > remaining) {
        chunks.push(next.value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }
      chunks.push(next.value);
      total += next.value.byteLength;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  return `${buffer.toString("utf8")}${truncated ? "…[TRUNCATED]" : ""}`;
}

async function responseBodyForLog(response: Response): Promise<unknown> {
  const config = getObservabilityConfig();
  const contentType = response.headers.get("content-type") ?? "";
  if (config.bodyMode === "off") return undefined;

  if (!isTextualContentType(contentType)) {
    const length = Number(response.headers.get("content-length"));
    return {
      kind: "binary",
      contentType: contentType || undefined,
      ...(Number.isFinite(length) ? { bytes: length } : {}),
    };
  }
  if (config.bodyMode === "metadata") {
    const length = Number(response.headers.get("content-length"));
    return {
      kind: contentType.includes("json") ? "json" : "text",
      ...(Number.isFinite(length) ? { bytes: length } : {}),
    };
  }

  try {
    const text = await readBoundedResponseText(response.clone(), config.maxBodyBytes);
    return loggableBody(text, contentType);
  } catch (error) {
    return { kind: "unavailable", error };
  }
}

function mergeHeaders(input: FetchInput, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  const supplied = new Headers(init?.headers);
  supplied.forEach((value, key) => headers.set(key, value));
  return headers;
}

export function installInstrumentedFetch(): void {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const config = getObservabilityConfig();
    if (!config.outboundEnabled) return nativeFetch(input, init);

    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = mergeHeaders(input, init);
    const trace = currentTraceContext();
    const clientSpanId = createSpanId();

    if (trace && config.tracePropagationEnabled) {
      if (!headers.has("x-trace-id")) headers.set("x-trace-id", trace.traceId);
      if (!headers.has("x-request-id")) headers.set("x-request-id", trace.requestId);
      if (!headers.has("traceparent")) {
        headers.set("traceparent", `00-${trace.traceId}-${clientSpanId}-01`);
      }
    }

    const contentType = headers.get("content-type") ?? "";
    const startedAt = process.hrtime.bigint();

    writeStructuredLog("info", "http.client.request", {
      direction: "outbound",
      clientSpanId,
      method,
      url,
      headers: Object.fromEntries(headers.entries()),
      body: requestBodyForLog(init?.body, contentType),
    });

    try {
      const response = await nativeFetch(input, { ...init, headers });
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      writeStructuredLog(
        response.ok ? "info" : "warn",
        "http.client.response",
        {
          direction: "inbound",
          clientSpanId,
          method,
          url,
          statusCode: response.status,
          durationMs: Number(durationMs.toFixed(3)),
          headers: Object.fromEntries(response.headers.entries()),
          body: await responseBodyForLog(response),
        },
      );
      return response;
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      writeStructuredLog("error", "http.client.error", {
        direction: "inbound",
        clientSpanId,
        method,
        url,
        durationMs: Number(durationMs.toFixed(3)),
        error,
      });
      throw error;
    }
  };
}
