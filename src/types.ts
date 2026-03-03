export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type EndpointsMap = Record<HttpMethod, Record<PropertyKey, unknown>>;

export type PartialEndpointsMap = Partial<EndpointsMap>;

export type EnsureRecord<T> = T extends Record<PropertyKey, unknown>
  ? T
  : Record<never, never>;

export type NormalizeEndpoints<Endpoints extends PartialEndpointsMap> = {
  [Method in HttpMethod]: EnsureRecord<Endpoints[Method]>;
};

export type EndpointOf<
  Endpoints extends PartialEndpointsMap,
  Method extends HttpMethod,
  Path extends keyof NormalizeEndpoints<Endpoints>[Method],
> = NormalizeEndpoints<Endpoints>[Method][Path];

export type EndpointParams<E> = E extends { params: infer P } ? P : never;
export type EndpointBody<E> = E extends { body: infer B } ? B : never;
export type EndpointResponses<E> = E extends { responses: infer R }
  ? R extends Record<PropertyKey, unknown>
    ? R
    : never
  : never;

export type EndpointResponseMap<E> = [EndpointResponses<E>] extends [never]
  ? Record<number, unknown>
  : Partial<EndpointResponses<E>>;

export type EndpointResult<E> = {
  responses: EndpointResponseMap<E>;
};

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

export type FetchResult<E, Err = ClientError> =
  | { ok: true; responses: EndpointResponseMap<E>; response: Response }
  | { ok: false; error: Err; response?: Response };

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

export type Api<Endpoints extends PartialEndpointsMap> = {
  [Method in HttpMethod]: <
    Path extends Extract<keyof NormalizeEndpoints<Endpoints>[Method], string>,
  >(
    path: Path,
    ...args: RequestArgs<EndpointOf<Endpoints, Method, Path>>
  ) => Promise<FetchResult<EndpointOf<Endpoints, Method, Path>>>;
};

export type RequestHookContext = {
  method: HttpMethod;
  path: string;
  init: RequestInit;
};

export type ResponseHookContext = {
  method: HttpMethod;
  path: string;
  response: Response;
  durationMs: number;
};

export type ResponseInterceptorContext = {
  method: HttpMethod;
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
