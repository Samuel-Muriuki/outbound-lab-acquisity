import "server-only";
import { getSessionId } from "@/lib/session/cookie";

/**
 * tRPC request context — created once per incoming request via
 * `fetchRequestHandler`'s `createContext` callback in
 * `src/app/api/trpc/[trpc]/route.ts`.
 *
 * `sessionId` is the visitor's `outboundlab_sid` cookie (read-only).
 * Mutations that need to *create* the cookie (e.g. `research.create`)
 * call `getOrCreateSessionId()` directly inside the procedure — the
 * context layer is intentionally read-only so middlewares can pass it
 * around without side effects.
 *
 * `headers` exposes the incoming Request headers in case a procedure
 * needs to inspect them (rate-limit fingerprinting, etc.).
 */
export interface Context {
  sessionId: string | null;
  headers: Headers;
}

export async function createContext({
  req,
}: {
  req: Request;
}): Promise<Context> {
  return {
    sessionId: await getSessionId(),
    headers: req.headers,
  };
}
