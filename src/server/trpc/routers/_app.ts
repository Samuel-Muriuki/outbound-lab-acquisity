import "server-only";
import { router } from "../init";

/**
 * Application router — composition root.
 *
 * Procedures land here as we migrate route handlers in subsequent PRs:
 *   - `research.create`   (PR B — replaces POST   /api/research)
 *   - `research.delete`   (PR C — replaces DELETE /api/research/[id])
 *   - `research.stream`   (PR D — replaces GET    /api/research/[id]/stream, as a subscription)
 *
 * Until those land, this router is intentionally empty so the scaffold
 * compiles + serves a 404-on-procedure under `/api/trpc/*` without
 * affecting the existing REST routes.
 */
export const appRouter = router({});

export type AppRouter = typeof appRouter;
