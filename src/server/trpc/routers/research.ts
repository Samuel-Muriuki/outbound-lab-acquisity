import "server-only";
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
});
