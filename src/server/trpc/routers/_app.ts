import "server-only";
import { router } from "../init";
import { researchRouter } from "./research";

/**
 * Application router — composition root.
 *
 * Procedures land here as we migrate route handlers across the
 * tRPC v11 migration:
 *   - `research.create`   (PR B — replaces POST   /api/research)         ✅
 *   - `research.delete`   (PR C — replaces DELETE /api/research/[id])
 *   - `research.stream`   (PR D — replaces GET    /api/research/[id]/stream, as a subscription)
 */
export const appRouter = router({
  research: researchRouter,
});

export type AppRouter = typeof appRouter;
