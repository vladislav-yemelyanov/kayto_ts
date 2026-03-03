import { type ClientError, type ErrorKind, type RequestInput, type RequestOptions, type Result } from "./types.js";

export const HTTP_METHOD = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
} as const;

export function makeClientError<E = unknown>(
  kind: ErrorKind,
  message: string,
  cause?: unknown,
  status?: number,
  data?: unknown,
): ClientError<E> {
  if (kind === "http") {
    return {
      kind,
      message,
      cause,
      status: status ?? 0,
      data,
    } as ClientError<E>;
  }

  return { kind, message, cause, status } as ClientError<E>;
}

export function createFetchSignal(options: RequestOptions): {
  signal?: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const { signal, timeoutMs } = options;

  if (timeoutMs == null) {
    return { signal, cleanup: () => {}, didTimeout: () => false };
  }

  let timedOut = false;
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(
      signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
    );
  };

  if (signal?.aborted) {
    onAbort();
  } else if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException(`Timed out after ${timeoutMs}ms`, "TimeoutError"),
    );
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timeoutId);

    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  return { signal: controller.signal, cleanup, didTimeout: () => timedOut };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbsoluteUrl(path: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(path) || path.startsWith("//");
}

function appendQueryToUrl(path: string, query: Record<string, unknown>): string {
  const absolute = isAbsoluteUrl(path);
  const url = absolute ? new URL(path) : new URL(path, "http://localhost");

  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) {
          url.searchParams.append(key, String(item));
        }
      }

      continue;
    }

    url.searchParams.set(key, String(value));
  }

  if (absolute) {
    return url.toString();
  }

  return `${url.pathname}${url.search}`;
}

export function buildPath(path: string, params: unknown): string {
  if (!isRecord(params)) {
    return path;
  }

  let nextPath = path;

  if (isRecord(params.path)) {
    for (const [key, value] of Object.entries(params.path)) {
      if (value != null) {
        nextPath = nextPath.replaceAll(
          "{" + key + "}",
          encodeURIComponent(String(value)),
        );
      }
    }
  }

  if (isRecord(params.query)) {
    return appendQueryToUrl(nextPath, params.query);
  }

  return nextPath;
}

export function resolveRequestUrl(path: string, baseUrl?: string): string {
  if (!baseUrl || isAbsoluteUrl(path)) {
    return path;
  }

  return new URL(path, baseUrl).toString();
}

function isRawBody(body: unknown): body is NonNullable<RequestInit["body"]> {
  return (
    typeof body === "string"
    || body instanceof Blob
    || body instanceof FormData
    || body instanceof URLSearchParams
    || body instanceof ArrayBuffer
    || ArrayBuffer.isView(body)
    || body instanceof ReadableStream
  );
}

export function createBodyAndHeaders(input: RequestInput<unknown>): {
  body?: NonNullable<RequestInit["body"]>;
  headers: Headers;
} {
  const headers = new Headers(input.headers);
  const body = "body" in input ? (input as { body?: unknown }).body : undefined;

  if (body == null) {
    return { body: undefined, headers };
  }

  if (isRawBody(body)) {
    return { body, headers };
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return { body: JSON.stringify(body), headers };
}

function isJsonContentType(contentType: string): boolean {
  return (
    contentType.includes("application/json")
    || contentType.includes("application/problem+json")
    || contentType.includes("+json")
  );
}

function isTextContentType(contentType: string): boolean {
  return contentType.startsWith("text/");
}

export async function safeResponseBody(
  response: Response,
): Promise<Result<unknown, unknown>> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return { ok: true, result: null };
  }

  try {
    if (isJsonContentType(contentType)) {
      return { ok: true, result: await response.json() };
    }

    if (isTextContentType(contentType)) {
      return { ok: true, result: await response.text() };
    }

    return { ok: true, result: await response.blob() };
  } catch (err) {
    return { ok: false, error: err };
  }
}
