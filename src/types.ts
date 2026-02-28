export type EndpointsMap = {
  get: Record<PropertyKey, unknown>;
  post: Record<PropertyKey, unknown>;
  put: Record<PropertyKey, unknown>;
  patch: Record<PropertyKey, unknown>;
  delete: Record<PropertyKey, unknown>;
};

export type EndpointOf<
  Endpoints extends EndpointsMap,
  Method extends keyof EndpointsMap,
  Path extends keyof EndpointsMap[Method],
> = Endpoints[Method][Path];

export type EndpointParams<E> = E extends { params: infer P } ? P : never;
export type EndpointBody<E> = E extends { body: infer B } ? B : never;

export type ErrorKind =
  | "network"
  | "timeout"
  | "aborted"
  | "http"
  | "parse"
  | "hook";

export type ClientError = {
  kind: ErrorKind;
  message: string;
  cause?: unknown;
  status?: number;
};

export type FetchResult<R, E = ClientError> =
  | { ok: true; result: R; response: Response }
  | { ok: false; error: E; response?: Response };

export type Result<R, E = string> =
  | { ok: true; result: R }
  | { ok: false; error: E };

export type MaybePromise<T> = T | Promise<T>;

export type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: RequestInit["headers"];
};

export type RequestInput<E> = RequestOptions
  & ([EndpointParams<E>] extends [never] ? {} : { params?: EndpointParams<E> })
  & ([EndpointBody<E>] extends [never] ? {} : { body: EndpointBody<E> });

export type RequestArgs<E> = [EndpointBody<E>] extends [never]
  ? [input?: RequestInput<E>]
  : [input: RequestInput<E>];

export type Api<Endpoints extends EndpointsMap> = {
  [Method in keyof EndpointsMap]: <
    Path extends Extract<keyof Endpoints[Method], string>,
  >(
    path: Path,
    ...args: RequestArgs<EndpointOf<Endpoints, Method, Path>>
  ) => Promise<FetchResult<EndpointOf<Endpoints, Method, Path>>>;
};

export type RequestHookContext = {
  method: keyof EndpointsMap;
  path: string;
  init: RequestInit;
};

export type ResponseHookContext = {
  method: keyof EndpointsMap;
  path: string;
  response: Response;
  durationMs: number;
};

export type ResponseInterceptorContext = {
  method: keyof EndpointsMap;
  path: string;
  response: Response;
};

export type ClientHooks = {
  onRequest?: (context: RequestHookContext) => MaybePromise<void>;
  onResponse?: (context: ResponseHookContext) => MaybePromise<void>;
  responseInterceptor?: (
    context: ResponseInterceptorContext,
  ) => MaybePromise<Response>;
};

export type ClientConfig = ClientHooks & {
  baseUrl?: string;
};
