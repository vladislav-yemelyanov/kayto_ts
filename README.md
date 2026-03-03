# kayto_ts

[📦 npm: kayto_ts](https://www.npmjs.com/package/kayto_ts)

`kayto_ts` is a type-safe HTTP client that works in pair with `kayto` 🦀 (Rust).

`kayto` generates `schema.ts` from your OpenAPI spec, and `kayto_ts` uses that schema to provide strongly-typed requests, responses, and hooks across any TypeScript platform: browser, Bun, Node.js, Deno, and more.

- 🔒 End-to-end type safety for `method + path + params + body + response`
- ⚡ Zero-boilerplate HTTP client usage with generated schema types
- 🧩 Request/response hooks for auth, tracing, and custom logic
- ⏱️ Built-in timeout and cancellation support
- 🛡️ Predictable, unified error model for cleaner handling

## Install

```bash
bun add kayto_ts
# alternatives:
# npm i kayto_ts
# pnpm add kayto_ts
# yarn add kayto_ts
```

## Generate schema (install kayto separately)

`kayto_ts` is a client library only.
To generate `schema.ts`, install `kayto` using the official guide:

[Install kayto from releases](https://github.com/vladislav-yemelyanov/kayto?tab=readme-ov-file#install-from-releases)

Example generation command after installing `kayto`:

```bash
kayto --lang ts --input "https://example.com/openapi.json" --output "generated/schema.ts"
```

## Multiple Services

If you generate one schema file per microservice, keep clients centralized in one place.

```ts
import { clientApi, type PartialEndpointsMap } from "kayto_ts";
import type { Endpoints as AccountsEndpoints } from "./schemas/accounts";
import type { Endpoints as BillingEndpoints } from "./schemas/billing";
import type { Endpoints as NotificationsEndpoints } from "./schemas/notifications";

const SERVICE_URLS = {
  accounts: "https://accounts.example.com",
  billing: "https://billing.example.com",
  notifications: "https://notifications.example.com",
} as const;

function createServiceClient<TEndpoints extends PartialEndpointsMap>(baseUrl: string) {
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
import { clientApi } from "kayto_ts";
import type { Endpoints as CatsEndpoints } from "./schemas/cats";

const clientWithBaseUrl = clientApi<CatsEndpoints>({
  baseUrl: "https://api.example.com",
});
```

`baseUrl` applies only to relative paths.
If you pass an absolute URL (`https://...`), it is used as-is and `baseUrl` is ignored.

```ts
import { clientApi } from "kayto_ts";
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
import { clientApi } from "kayto_ts";
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

## Success Handling (Cats API)

```ts
async function fetchCatsUI() {
  let loading = true;

  try {
    const result = await client.get("/api/cats");

    if (!result.ok) {
      throw result.error;
    }

    const cats = result.responses[200];

    if (!cats) {
      throw new Error("Cats response is empty");
    }

    return cats;
  } catch (error) {
    // UI can show toast/snackbar here
    throw error;
  } finally {
    loading = false;
  }
}
```

```ts
async function createCatUI() {
  let loading = true;

  try {
    const result = await client.post("/api/cats", {
      body: {
        name: "Milo",
        age: 2,
      },
    });

    if (!result.ok) {
      throw result.error;
    }

    const created = result.responses[201] ?? result.responses[200];

    if (!created) {
      throw new Error("Create cat payload is empty");
    }

    return created;
  } catch (error) {
    throw error;
  } finally {
    loading = false;
  }
}
```

## Error Handling

All requests return a discriminated union:

- success: `{ ok: true, responses, response }`
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

For `http` errors, `error.data` contains the parsed backend payload and is typed from the endpoint's non-2xx responses (for example `400`, `404`, `422`).

```ts
const result = await client.get("/api/cats");

if (result.ok) {
  const success = result.responses[200];
  console.log(success);
}
```

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
      console.error("Backend payload", result.error.data);
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
- If you need runtime validation, validate `result.responses[statusCode]` in consumer code (ArkType/Zod/etc.).
- Current entrypoint is `src/index.ts`.
