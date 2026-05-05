import "server-only";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

/**
 * tRPC initialisation — single source of truth for `router`,
 * `publicProcedure`, and `mergeRouters`. Procedures import from here,
 * not from `@trpc/server` directly, so the context type and transformer
 * are guaranteed consistent across the surface.
 *
 * `superjson` is registered as the transformer so Date / Map / Set
 * serialise transparently. The client must use the same transformer
 * (configured in `src/lib/trpc/client.ts`).
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const createCallerFactory = t.createCallerFactory;
