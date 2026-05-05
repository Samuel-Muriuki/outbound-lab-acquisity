import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/routers/_app";
import { createContext } from "@/server/trpc/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Maximum function-execution time on Vercel. Subscriptions (added in
 * PR D) can run up to ~60s for a full 3-agent research pipeline; cap at
 * 90s with room for a graceful close. Same value used previously by the
 * SSE route handler.
 */
export const maxDuration = 90;

/**
 * Single tRPC route handler that fans out to every procedure on
 * `appRouter`. Mutations + queries arrive as POST/GET; subscriptions
 * arrive as GET with `Accept: text/event-stream` and are handled by
 * the fetch adapter (tRPC v11 has built-in SSE support).
 */
function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ req }),
    onError({ error, path }) {
      // Only log unexpected errors. TRPCError thrown intentionally
      // (BAD_REQUEST, NOT_FOUND, etc.) is normal request flow.
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[trpc] ${path ?? "<root>"} crashed:`, error);
      }
    },
  });
}

export { handler as GET, handler as POST };
