import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import {
  ResearchInput,
  normaliseDomain,
} from "@/lib/validation/research-input";
import { BLOCKED_MESSAGE } from "@/lib/validation/profanity";
import { isFamilyDnsBlocked } from "@/lib/validation/family-dns";
import { getOrCreateSessionId } from "@/lib/session/cookie";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { deleteRun } from "@/lib/db/queries";

const RunIdInput = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      { message: "Invalid run id." }
    ),
});

export const researchRouter = router({
  /**
   * Create a new research run. Validates the URL with `ResearchInput`,
   * normalises the hostname, runs the Cloudflare Family DNS gate, then
   * inserts a `pending` row in `research_runs` and returns the new id.
   *
   * Replaces the old `POST /api/research` route handler. Same contract,
   * mapped to TRPCError codes:
   *   BAD_REQUEST       → invalid URL or DNS-blocked domain
   *   INTERNAL_SERVER_ERROR → DB / config error
   */
  create: publicProcedure
    .input(ResearchInput)
    .mutation(async ({ input }) => {
      const { url, tone, channel } = input;
      const target_domain = normaliseDomain(url);

      // Cloudflare Family DNS gate — catches NSFW brand domains
      // (onlyfans, chaturbate, etc.) that the sync profanity refine in
      // `ResearchInput` can't see. Fails open on timeout / DNS error so
      // a Cloudflare blip never blocks a legitimate user.
      if (await isFamilyDnsBlocked(target_domain)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: BLOCKED_MESSAGE,
        });
      }

      let supabase;
      try {
        supabase = getSupabaseAdmin();
      } catch (error) {
        console.error(
          "[trpc research.create] Supabase client init failed:",
          error instanceof Error ? error.message : error
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Server is missing required configuration.",
        });
      }

      const sessionId = await getOrCreateSessionId();

      const { data, error } = await supabase
        .from("research_runs")
        .insert({
          target_url: url,
          target_domain,
          status: "pending",
          creator_session_id: sessionId,
          tone,
          channel,
        })
        .select("id")
        .single();

      if (error || !data) {
        console.error(
          "[trpc research.create] Insert failed:",
          error?.message ?? "no data returned"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create research run. Try again.",
        });
      }

      return { run_id: data.id as string };
    }),

  /**
   * Delete a run created by the current visitor. Ownership check uses
   * the read-only `outboundlab_sid` cookie compared against the row's
   * `creator_session_id`.
   *
   * Replaces the old `DELETE /api/research/[id]` route handler. Same
   * contract:
   *   BAD_REQUEST          → invalid UUID
   *   UNAUTHORIZED         → no session cookie present
   *   NOT_FOUND            → no row with that id
   *   FORBIDDEN            → cookie doesn't match the row's creator
   *   INTERNAL_SERVER_ERROR → DB error
   *
   * Returns `{ ok: true }` on success — the client only needs to know
   * the call succeeded.
   */
  delete: publicProcedure
    .input(RunIdInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.sessionId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "No session — you can only delete runs you created in this browser.",
        });
      }

      let result;
      try {
        result = await deleteRun(input.id, ctx.sessionId);
      } catch (err) {
        console.error(
          "[trpc research.delete] deleteRun threw:",
          err instanceof Error ? err.message : err
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not delete this run. Try again.",
        });
      }

      if (result === "not_found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run not found.",
        });
      }
      if (result === "forbidden") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete runs you created.",
        });
      }

      return { ok: true as const };
    }),
});
