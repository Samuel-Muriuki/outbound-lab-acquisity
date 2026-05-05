"use client";

import { useState } from "react";
import { ArrowUpRight, Copy, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { ResearchResult } from "@/lib/agents/orchestrator";
import { cn } from "@/lib/utils";

interface ResultCardProps {
  result: ResearchResult;
}

/**
 * Hide the company-size badge when Agent 1 returned "Unknown" — that's
 * the schema-allowed sentinel for "no employee-count signal in the
 * web research." A badge that just reads "Unknown" tells the recruiter
 * nothing and clutters the header. Real values (e.g. "20-50 employees",
 * "Small (<50)", "Medium (50-500)") still render.
 */
function isUnknownSize(value: string): boolean {
  return value.trim().toLowerCase() === "unknown";
}

/**
 * The result card — the climax of the streaming view.
 *
 * Source of truth: `.ai/docs/12-ux-flows.md` §3.
 *
 * Four tabs in this exact order — Brief is reference, People is
 * supporting, Email is the deliverable (and the default), Sources is
 * provenance.
 *
 * The 'Regenerate · warmer tone' action is intentionally Phase 2 — it
 * needs a separate POST endpoint that re-runs Agent 3 only with
 * tone='warm', and that's not in Phase 1 scope.
 */
export function ResultCard({ result }: ResultCardProps) {
  const { recon, people, degraded, forbiddenReason } = result;

  return (
    <article className="glass-card rounded-xl border border-border p-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {recon.company_name}
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              {recon.one_liner}
            </p>
          </div>
          {!isUnknownSize(recon.company_size_estimate) && (
            <Badge variant="outline" className="font-mono tabular-nums">
              {recon.company_size_estimate}
            </Badge>
          )}
        </div>
        {degraded && (
          <p
            className="mt-4 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning"
            role="status"
          >
            Email was retried — review carefully before sending.
            {forbiddenReason ? ` (${forbiddenReason})` : null}
          </p>
        )}
      </header>

      <Tabs defaultValue="email" className="mt-6">
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="people">
            People
            <span className="ml-1 font-mono text-xs text-subtle-foreground tabular-nums">
              {people.decision_makers.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="email">
            <span className="inline-flex items-center gap-1.5">
              Email
              <Mail className="size-3.5 text-brand-secondary" aria-hidden />
            </span>
          </TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="brief">
          <BriefPanel result={result} />
        </TabsContent>
        <TabsContent value="people">
          <PeoplePanel result={result} />
        </TabsContent>
        <TabsContent value="email">
          <EmailPanel result={result} />
        </TabsContent>
        <TabsContent value="sources">
          <SourcesPanel result={result} />
        </TabsContent>
      </Tabs>
    </article>
  );
}

// ---- Tab panels ----

function BriefPanel({ result }: ResultCardProps) {
  const { recon } = result;
  return (
    <dl className="mt-4 space-y-5 text-sm">
      <Section label="What they sell">{recon.what_they_sell}</Section>
      <Section label="Target market">{recon.target_market}</Section>
      {recon.recent_signals.length > 0 && (
        <div>
          <dt className="text-xs uppercase tracking-wide text-subtle-foreground">
            Recent signals
          </dt>
          <ul className="mt-2 space-y-1.5 text-foreground">
            {recon.recent_signals.map((signal, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-secondary"
                  aria-hidden
                />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dl>
  );
}

function PeoplePanel({ result }: ResultCardProps) {
  const { people } = result;
  if (people.decision_makers.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        We couldn&apos;t verify any decision makers from public sources for this
        run. Try a different company URL or a domain with a public team page.
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-3">
      {people.decision_makers.map((dm, i) => (
        <div
          key={`${dm.name}-${i}`}
          className="rounded-lg border border-border bg-surface-2 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-medium tracking-tight">{dm.name}</p>
              <p className="text-sm text-muted-foreground">{dm.role}</p>
            </div>
            {dm.linkedin_url && (
              <a
                href={dm.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-brand-secondary transition-colors hover:text-brand"
              >
                LinkedIn
                <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
          <p className="mt-3 text-sm text-foreground">{dm.why_them}</p>
          <p className="mt-2 text-xs text-subtle-foreground">
            Source:{" "}
            <a
              href={dm.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-muted-foreground underline-offset-4 hover:underline"
            >
              {hostnameOf(dm.source_url)}
            </a>
          </p>
        </div>
      ))}
      {people.buyer_persona && (
        <p className="mt-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Buyer persona:</span>{" "}
          {people.buyer_persona}
        </p>
      )}
    </div>
  );
}

function EmailPanel({ result }: ResultCardProps) {
  const { email } = result;
  const [isCopying, setIsCopying] = useState(false);

  async function handleCopy() {
    if (isCopying) return;
    setIsCopying(true);
    try {
      const composed = `Subject: ${email.subject}\n\n${email.body}`;
      await navigator.clipboard.writeText(composed);
      toast.success("Email copied to clipboard.");
    } catch (err) {
      toast.error(
        "Could not copy. Your browser may be blocking clipboard access."
      );
      console.warn("[ResultCard] clipboard write failed:", err);
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-5">
      <dl className="space-y-3 text-sm">
        <FieldRow label="To">
          <span className="font-medium text-foreground">{email.to.name}</span>
          <span className="ml-2 text-subtle-foreground">{email.to.role}</span>
        </FieldRow>
        <FieldRow label="Subject">
          <span className="text-foreground">{email.subject}</span>
        </FieldRow>
      </dl>

      <hr className="my-4 border-border" />

      <p
        className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-foreground"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {email.body}
      </p>

      <hr className="my-4 border-border" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={isCopying}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-all duration-200 [transition-timing-function:var(--ease-out)] hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-60"
            )}
          >
            <Copy className="size-3.5" aria-hidden />
            Copy email
          </button>
          <button
            type="button"
            disabled
            title="Coming in Phase 2"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-muted-foreground opacity-60"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Regenerate · warmer tone
          </button>
        </div>
        <Badge
          variant="outline"
          className="font-mono text-xs uppercase tracking-wide tabular-nums"
        >
          {email.tone}
        </Badge>
      </div>

      {email.personalisation_hooks.length > 0 && (
        <details className="group mt-5 rounded-lg border border-border bg-surface-1">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-xs uppercase tracking-wide text-subtle-foreground">
              Personalisation hooks ·{" "}
              <span className="font-mono tabular-nums">
                {email.personalisation_hooks.length}
              </span>{" "}
              alternates
            </span>
            <span className="ml-2 text-xs text-subtle-foreground transition-transform group-open:rotate-90">
              ▸
            </span>
          </summary>
          <ul className="space-y-2 border-t border-border px-4 py-3 text-sm">
            {email.personalisation_hooks.map((hook, i) => (
              <li key={i} className="flex items-start gap-2 text-foreground">
                <span
                  className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-secondary"
                  aria-hidden
                />
                <span>{hook}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SourcesPanel({ result }: ResultCardProps) {
  const sources = collectSources(result);
  if (sources.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        No sources recorded for this run.
      </p>
    );
  }
  return (
    <ul className="mt-4 flex flex-col gap-2 text-sm">
      {sources.map((src, i) => (
        <li key={`${src.url}-${i}`}>
          <a
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-2.5 transition-colors hover:border-border-strong"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-foreground">
                {src.url}
              </p>
              <p className="text-xs text-subtle-foreground">{src.label}</p>
            </div>
            <ArrowUpRight
              className="size-4 shrink-0 text-subtle-foreground transition-colors group-hover:text-brand-secondary"
              aria-hidden
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---- Helpers ----

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-subtle-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-foreground">{children}</dd>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="w-[72px] shrink-0 text-xs uppercase tracking-wide text-subtle-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface SourceEntry {
  url: string;
  label: string;
}

function collectSources(result: ResearchResult): SourceEntry[] {
  const seen = new Set<string>();
  const entries: SourceEntry[] = [];

  for (const url of result.recon.sources) {
    if (!seen.has(url)) {
      seen.add(url);
      entries.push({ url, label: "Reconnaissance" });
    }
  }
  for (const dm of result.people.decision_makers) {
    if (!seen.has(dm.source_url)) {
      seen.add(dm.source_url);
      entries.push({ url: dm.source_url, label: `People · ${dm.name}` });
    }
    if (dm.linkedin_url && !seen.has(dm.linkedin_url)) {
      seen.add(dm.linkedin_url);
      entries.push({ url: dm.linkedin_url, label: `People · ${dm.name} (LinkedIn)` });
    }
  }
  return entries;
}
