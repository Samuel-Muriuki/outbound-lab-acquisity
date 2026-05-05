"use client";

import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/routers/_app";

/**
 * Browser-side tRPC client. Mutations + queries route through
 * `httpBatchLink` (POST /api/trpc with batched calls); subscriptions
 * route through `httpSubscriptionLink` (GET /api/trpc/<path> with
 * `Accept: text/event-stream`).
 *
 * `splitLink` picks the right link per-operation. The transformer must
 * match the server (`superjson` — see `src/server/trpc/init.ts`).
 *
 * Created once at module-load and reused — no provider needed because
 * we don't use react-query. Components import `trpc` directly.
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: "/api/trpc",
        transformer: superjson,
      }),
      false: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
      }),
    }),
  ],
});
