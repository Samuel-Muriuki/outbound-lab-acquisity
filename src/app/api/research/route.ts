import { NextResponse, type NextRequest } from "next/server";
import {
  ResearchInput,
  normaliseDomain,
} from "@/lib/validation/research-input";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/research
 *
 * Body: `{ url: string }`
 *
 * Validates the URL with the same Zod schema the HeroInput form uses,
 * normalises the hostname, creates a `research_runs` row in
 * `pending` status, and returns the new run id.
 *
 * Phase 1 contract:
 *   201 → { run_id: uuid }
 *   400 → { error: string, issues?: [{ path, message }] }   (bad JSON or invalid URL)
 *   500 → { error: string }                                 (DB error or missing env)
 *
 * The orchestrator (Session 4 PR 16) will pick up rows in `pending`
 * status from a separate `GET /api/research/[id]/stream` route. This
 * endpoint just creates the row and hands the id back so the client
 * can navigate to `/research/[id]` and open the SSE stream.
 *
 * Cache hits are NOT handled here yet — Session 7 (Phase 2) adds the
 * cache_hit fast-path before any agent run is queued.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = ResearchInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid input.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  const { url } = parsed.data;
  const target_domain = normaliseDomain(url);

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    console.error(
      "[POST /api/research] Supabase client init failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Server is missing required configuration." },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("research_runs")
    .insert({
      target_url: url,
      target_domain,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(
      "[POST /api/research] Insert failed:",
      error?.message ?? "no data returned"
    );
    return NextResponse.json(
      { error: "Could not create research run. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ run_id: data.id }, { status: 201 });
}
