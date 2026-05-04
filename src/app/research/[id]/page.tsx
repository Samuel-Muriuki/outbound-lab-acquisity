import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ResearchRunRow {
  id: string;
  target_url: string;
  target_domain: string;
  status: "pending" | "running" | "done" | "error" | "degraded";
  started_at: string;
  completed_at: string | null;
  cache_hit: boolean;
}

/**
 * Phase 1 placeholder for the streaming research view.
 *
 * Resolves the run by id. If it doesn't exist → 404. If it does, shows
 * a minimal status card (target_domain + status). The full streaming UI
 * — AgentTimeline + ResultCard with SSE event handling — lands in
 * Sessions 4-5. This page exists so PR D's `router.push('/research/[id]')`
 * has somewhere to go.
 */
export default async function ResearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Quick UUID v4-shape gate so a path like `/research/foo` 404s without
  // a DB round-trip. Real id always matches `gen_random_uuid()` output.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  let data: ResearchRunRow | null = null;
  try {
    const supabase = getSupabaseAdmin();
    const result = await supabase
      .from("research_runs")
      .select(
        "id, target_url, target_domain, status, started_at, completed_at, cache_hit"
      )
      .eq("id", id)
      .maybeSingle<ResearchRunRow>();
    if (result.error) {
      // Supabase returned an error — log server-side and 404 to the user
      // rather than leaking the DB error message.
      console.error(
        "[research/[id]] Supabase select failed:",
        result.error.message
      );
      notFound();
    }
    data = result.data;
  } catch (err) {
    // Most likely cause: missing NEXT_PUBLIC_SUPABASE_URL or
    // SUPABASE_SERVICE_ROLE_KEY in .env.local. Log server-side and 404
    // gracefully — Next's default 500 page leaks too much.
    console.error(
      "[research/[id]] Server config error:",
      err instanceof Error ? err.message : err
    );
    notFound();
  }

  if (!data) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Link>

      <section className="mt-12">
        <p className="text-sm uppercase tracking-wide text-subtle-foreground">
          Researching
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
          {data.target_domain}
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          Status:{" "}
          <span className="font-mono text-foreground">{data.status}</span>
        </p>
      </section>

      <section className="mt-10 rounded-xl border border-border bg-surface-1 p-6">
        <p className="text-sm text-muted-foreground">
          The streaming agent timeline and result card land in Session 4-5.
          For now this page just confirms that the run row was created in{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
            research_runs
          </code>
          .
        </p>
      </section>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: `Research · ${id.slice(0, 8)}`,
  };
}
