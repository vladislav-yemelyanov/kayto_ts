import {
  type Api,
  type ClientConfig,
  type EndpointsMap,
  type PartialEndpointsMap,
  type HttpMethod,
  type EndpointOf,
  type EndpointResponseMap,
  type EndpointResult,
  type FetchResult,
  type RequestInput,
} from "./types.js";
import {
  buildPath,
  createBodyAndHeaders,
  createFetchSignal,
  HTTP_METHOD,
  makeClientError,
  resolveRequestUrl,
  safeResponseBody,
} from "./utils.js";

export type {
  Api,
  ClientConfig,
  ClientError,
  ClientHooks,
  EndpointsMap,
  PartialEndpointsMap,
  HttpMethod,
  EndpointOf,
  EndpointResponseMap,
  EndpointResult,
  FetchResult,
  RequestInput,
  RequestOptions,
} from "./types.js";

export function clientApi<Endpoints extends PartialEndpointsMap>(
  config: ClientConfig = {},
): Api<Endpoints> {
  const { baseUrl, onRequest, onResponse, responseInterceptor } = config;

  const request = async (
    method: HttpMethod,
    path: string,
    input?: RequestInput<unknown>,
  ): Promise<FetchResult<unknown>> => {
    const requestInput = input ?? {};
    const { signal, cleanup, didTimeout } = createFetchSignal(requestInput);
    const builtPath = buildPath(
      path,
      (requestInput as { params?: unknown }).params,
    );
    const resolvedPath = resolveRequestUrl(builtPath, baseUrl);
    const { body, headers } = createBodyAndHeaders(requestInput);
    const init: RequestInit = {
      method: HTTP_METHOD[method],
      signal,
      headers,
      body,
    };

    if (onRequest) {
      try {
        await onRequest({ method, path: resolvedPath, init });
      } catch (err) {
        cleanup();
        return {
          ok: false,
          error: makeClientError("hook", "onRequest hook failed", err),
        };
      }
    }

    const startedAt = Date.now();

    let rawResponse: Response;

    try {
      rawResponse = await fetch(resolvedPath, init);
    } catch (err) {
      if (didTimeout()) {
        return {
          ok: false,
          error: makeClientError("timeout", "Request timed out", err),
        };
      }

      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          error: makeClientError("aborted", "Request was aborted", err),
        };
      }

      return {
        ok: false,
        error: makeClientError("network", "Network error before response", err),
      };
    } finally {
      cleanup();
    }

    let response = rawResponse;

    if (responseInterceptor) {
      try {
        response = await responseInterceptor({
          method,
          path: resolvedPath,
          response: rawResponse,
        });
      } catch (err) {
        return {
          ok: false,
          error: makeClientError("hook", "responseInterceptor failed", err),
          response: rawResponse,
        };
      }
    }

    if (onResponse) {
      try {
        await onResponse({
          method,
          path: resolvedPath,
          response,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        return {
          ok: false,
          error: makeClientError("hook", "onResponse hook failed", err),
          response,
        };
      }
    }

    const bodyResult = await safeResponseBody(response);

    if (!bodyResult.ok) {
      return {
        ok: false,
        error: makeClientError(
          "parse",
          "Failed to parse response body",
          bodyResult.error,
        ),
        response,
      };
    }

    const responses = {
      [response.status]: bodyResult.result,
    } as EndpointResponseMap<unknown>;

    if (!response.ok) {
      return {
        ok: false,
        error: makeClientError(
          "http",
          `Request failed with status ${response.status}`,
          undefined,
          response.status,
        ),
        response,
      };
    }

    return { ok: true, responses, response };
  };

  return {
    get: ((path, ...args) => request("get", path, args[0])) as Api<Endpoints>["get"],
    post: ((path, ...args) => request("post", path, args[0])) as Api<Endpoints>["post"],
    put: ((path, ...args) => request("put", path, args[0])) as Api<Endpoints>["put"],
    patch: ((path, ...args) => request("patch", path, args[0])) as Api<Endpoints>["patch"],
    delete: ((path, ...args) => request("delete", path, args[0])) as Api<Endpoints>["delete"],
  };
}
