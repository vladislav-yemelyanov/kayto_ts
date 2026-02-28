# kayto_ts

Type-safe HTTP client with:

- typed `method + path`
- typed `params` and `body` from endpoint schema
- request/response hooks
- response interceptor
- timeout and cancellation
- unified error shape

## Install

```bash
npm i kayto_ts
# or:
# pnpm add kayto_ts
# yarn add kayto_ts
# bun add kayto_ts
```

During install, `kayto_ts` automatically downloads `kayto` binary into local package directory: `.kayto/bin`.
No global `kayto` install is required.

### Auto-install config (optional)

- `KAYTO_VERSION` (default: latest release tag from GitHub)
- `KAYTO_REPO` (default: `vladislav-yemelyanov/kayto`)
- `KAYTO_FORCE_INSTALL=1` to force re-download
- `KAYTO_SHA256` to pin expected archive SHA-256
- `KAYTO_SKIP_CHECKSUM=1` to skip checksum verification (not recommended)

## Using CLI

`kayto_ts` exposes `kayto` binary via package `bin`:

```bash
npx kayto --help
pnpm exec kayto --help
yarn kayto --help
bunx kayto --help
```

## Multiple Services

If you generate one schema file per microservice, keep clients centralized in one place.

```ts
import { clientApi, type EndpointsMap } from "./src/index";
import type { Endpoints as AccountsEndpoints } from "./schemas/accounts";
import type { Endpoints as BillingEndpoints } from "./schemas/billing";
import type { Endpoints as NotificationsEndpoints } from "./schemas/notifications";

const SERVICE_URLS = {
  accounts: "https://accounts.example.com",
  billing: "https://billing.example.com",
  notifications: "https://notifications.example.com",
} as const;

function createServiceClient<TEndpoints extends EndpointsMap>(baseUrl: string) {
  return clientApi<TEndpoints>({
    baseUrl,
    onRequest: ({ init }) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${getAccessToken()}`);
      init.headers = headers;
    },
  });
}

export const clients = {
  accounts: createServiceClient<AccountsEndpoints>(SERVICE_URLS.accounts),
  billing: createServiceClient<BillingEndpoints>(SERVICE_URLS.billing),
  notifications: createServiceClient<NotificationsEndpoints>(SERVICE_URLS.notifications),
};

function getAccessToken(): string {
  return "token";
}

// usage
const me = await clients.accounts.get("/v1/me");
const invoices = await clients.billing.get("/v1/invoices");
```

Suggested structure:
- `schemas/accounts.ts`, `schemas/billing.ts`, `schemas/notifications.ts`
- one shared `clients.ts` that exports preconfigured clients
- app code imports only `clients` and never constructs clients ad-hoc

## Quick Start (Cats API)

### With `baseUrl`

```ts
import { clientApi } from "./src/index";
import type { Endpoints as CatsEndpoints } from "./schemas/cats";

const clientWithBaseUrl = clientApi<CatsEndpoints>({
  baseUrl: "https://api.example.com",
});
```

`baseUrl` applies only to relative paths.
If you pass an absolute URL (`https://...`), it is used as-is and `baseUrl` is ignored.

```ts
import { clientApi } from "./src/index";
import type { Endpoints as CatsEndpoints } from "./schemas/cats";

const client = clientApi<CatsEndpoints>({
  baseUrl: "https://api.example.com",
});

await client.get("/api/cats");
// -> https://api.example.com/api/cats

await client.get("https://other.example.com/api/cats" as "/api/cats");
// -> https://other.example.com/api/cats
```

## Basic Requests

### GET with query params

```ts
const listResult = await client.get("/api/cats", {
  params: {
    query: {
      page: 1,
      search: "british",
    },
  },
});
```

### GET with path params

```ts
const oneResult = await client.get("/api/cats/{id}", {
  params: {
    path: {
      id: "cat_42",
    },
  },
});
```

### POST with body

```ts
const createResult = await client.post("/api/cats", {
  body: {
    name: "Milo",
    age: 2,
  },
});
```

### Request headers

```ts
const authorizedResult = await client.get("/api/cats", {
  headers: {
    Authorization: "Bearer <token>",
    "x-cats-trace-id": "trace_123",
  },
});
```

### DELETE with path params

```ts
const deleteResult = await client.delete("/api/cats/{id}", {
  params: {
    path: {
      id: "cat_42",
    },
  },
});
```

## Timeout and Cancellation

### Timeout

```ts
const result = await client.get("/api/cats", {
  timeoutMs: 5_000,
});
```

### AbortController

```ts
const controller = new AbortController();

const promise = client.get("/api/cats", {
  signal: controller.signal,
});

controller.abort();

const result = await promise;
```

## Hooks and Interceptor

```ts
import { clientApi } from "./src/index";
import type { Endpoints as CatsEndpoints } from "./schemas/cats";

const clientWithHooks = clientApi<CatsEndpoints>({
  baseUrl: "https://api.example.com",

  onRequest: ({ method, path, init }) => {
    const headers = new Headers(init.headers);
    headers.set("x-cats-trace-id", "trace_123");
    init.headers = headers;

    console.log("request", method, path);
  },

  responseInterceptor: async ({ response }) => {
    // Example: could refresh token and retry in your own wrapper logic.
    return response;
  },

  onResponse: ({ method, path, response, durationMs }) => {
    console.log("response", method, path, response.status, `${durationMs}ms`);
  },
});
```

## Error Handling

All requests return a discriminated union:

- success: `{ ok: true, result, response }`
- failure: `{ ok: false, error, response? }`

`error.kind` values:

- `network`
- `timeout`
- `aborted`
- `http`
- `parse`
- `hook`

You can handle errors by `kind`, but it is optional.
You can also handle them generically via `message` / `status` / `cause` without branching by `kind`.

```ts
const result = await client.get("/api/cats");

if (!result.ok) {
  console.error("Request failed:", result.error.message);

  if (result.error.status != null) {
    console.error("HTTP status:", result.error.status);
  }

  if (result.error.cause) {
    console.error("Cause:", result.error.cause);
  }
}
```

```ts
const result = await client.get("/api/cats");

if (!result.ok) {
  switch (result.error.kind) {
    case "timeout":
      console.error("Cats API timeout");
      break;
    case "aborted":
      console.error("Request was cancelled");
      break;
    case "http":
      console.error("HTTP error", result.error.status);
      break;
    default:
      console.error(result.error.message, result.error.cause);
  }
}
```

## Response Parsing Rules

Client parses response body automatically by `content-type`:

- JSON: `application/json`, `application/problem+json`, `*+json`
- Text: `text/*`
- Other content-types: `Blob`
- Empty body statuses (`204`, `205`, `304`): `null`

## Notes

- Runtime shape validation is not built in yet (current typing is compile-time only).
- If you need runtime validation, validate `result.result` in consumer code (ArkType/Zod/etc.).
- Current entrypoint is `src/index.ts`.
