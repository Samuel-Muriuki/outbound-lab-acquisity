"use client";

import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import { ArrowUpRight, Copy, Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TRPCClientError } from "@trpc/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc/client";
import type { ResearchResult } from "@/lib/agents/orchestrator";
import type { EmailOutputT } from "@/lib/agents/schemas";
import { cn } from "@/lib/utils";

/**
 * Brand marks (LinkedIn, X) inlined as single-path SVGs — lucide-react
 * v1 dropped trademarked brand-icon exports, and three icons don't
 * justify a separate brand-icon dep.
 */
function LinkedInMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43A2.07 2.07 0 1 1 5.34 3.3a2.07 2.07 0 0 1 0 4.13Zm1.78 13.02H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45C23.2 24 24 23.23 24 22.28V1.72C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}

function XMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.967 6.817H1.677l7.73-8.834L1.254 2.25h6.83l4.713 6.231 5.447-6.231Zm-1.16 17.52h1.834L7.084 4.126H5.117L17.084 19.77Z" />
    </svg>
  );
}

const CHANNEL_LABEL = {
  email: "Email",
  linkedin: "LinkedIn DM",
  x: "X DM",
} as const;

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const CHANNEL_ICON: Record<"email" | "linkedin" | "x", IconComponent> = {
  email: Mail,
  linkedin: LinkedInMark,
  x: XMark,
};

interface ResultCardProps {
  result: ResearchResult;
  /**
   * The run id — passed through to the EmailPanel so it can call the
   * `research.regenerateEmail` mutation when the visitor picks a
   * different decision maker as the email target.
   */
  runId?: string;
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
export function ResultCard({ result, runId }: ResultCardProps) {
  const { recon, people, degraded, forbiddenReason, email } = result;
  const channel = email.channel ?? "email";
  const channelLabel = CHANNEL_LABEL[channel];
  const ChannelIcon = CHANNEL_ICON[channel];

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
              {channelLabel}
              <ChannelIcon className="size-3.5 text-brand-secondary" aria-hidden />
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
          <EmailPanel result={result} runId={runId} />
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

function EmailPanel({ result, runId }: ResultCardProps) {
  const { email: persistedEmail, people } = result;
  // Local state: the email shown in the panel. Starts as the persisted
  // one; gets swapped when the visitor regenerates for a different
  // target. Never written back to the DB — exploration is local.
  const [email, setEmail] = useState<EmailOutputT>(persistedEmail);
  const channel = email.channel ?? "email";
  const [isCopying, setIsCopying] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Find which decision maker the current email targets so the picker
  // pre-selects the right radio. Match by name (Agent 3 may have
  // truncated "John Smith" to "John" — fall back to the first DM).
  const activeIndex = useMemo(() => {
    const idx = people.decision_makers.findIndex(
      (dm) => dm.name === email.to.name
    );
    if (idx >= 0) return idx;
    return people.decision_makers.findIndex((dm) =>
      dm.name.toLowerCase().includes(email.to.name.toLowerCase().split(" ")[0])
    );
  }, [email.to.name, people.decision_makers]);

  async function handleCopy() {
    if (isCopying) return;
    setIsCopying(true);
    try {
      const composed = email.subject
        ? `Subject: ${email.subject}\n\n${email.body}`
        : email.body;
      await navigator.clipboard.writeText(composed);
      toast.success(`${CHANNEL_LABEL[channel]} copied to clipboard.`);
    } catch (err) {
      toast.error(
        "Could not copy. Your browser may be blocking clipboard access."
      );
      console.warn("[ResultCard] clipboard write failed:", err);
    } finally {
      setIsCopying(false);
    }
  }

  async function handleRegenerate(targetIndex: number) {
    if (!runId) return;
    if (isRegenerating) return;
    if (targetIndex === activeIndex) return;
    setIsRegenerating(true);
    try {
      const res = await trpc.research.regenerateEmail.mutate({
        id: runId,
        targetIndex,
      });
      setEmail(res.email);
      toast.success(
        `Rewritten for ${res.email.to.name}.`,
        res.degraded
          ? {
              description:
                res.forbiddenReason ??
                "Draft was retried — review carefully before sending.",
            }
          : undefined
      );
    } catch (err) {
      if (err instanceof TRPCClientError) {
        toast.error(err.message || "Could not regenerate. Try again.");
      } else {
        toast.error("Network error — could not regenerate.");
      }
    } finally {
      setIsRegenerating(false);
    }
  }

  const canRegenerate =
    runId !== undefined && people.decision_makers.length > 1;

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-5">
      {canRegenerate && (
        <div
          role="radiogroup"
          aria-label="Write this message to"
          className="mb-4 -mt-1 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="text-subtle-foreground">Write to:</span>
          {people.decision_makers.map((dm, i) => {
            const selected = i === activeIndex;
            return (
              <button
                key={`${dm.name}-${i}`}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleRegenerate(i)}
                disabled={isRegenerating}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-colors duration-200 [transition-timing-function:var(--ease-out)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  selected
                    ? "border-brand-secondary/60 bg-brand-secondary/10 text-foreground"
                    : "border-border bg-surface-1 text-muted-foreground hover:border-brand-secondary/40 hover:text-foreground",
                  isRegenerating && "cursor-wait opacity-60"
                )}
              >
                {selected && isRegenerating ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : null}
                <span className="truncate max-w-[18ch]">{dm.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <dl className="space-y-3 text-sm">
        <FieldRow label="To">
          <span className="font-medium text-foreground">{email.to.name}</span>
          <span className="ml-2 text-subtle-foreground">{email.to.role}</span>
        </FieldRow>
        {email.subject ? (
          <FieldRow label="Subject">
            <span className="text-foreground">{email.subject}</span>
          </FieldRow>
        ) : null}
      </dl>

      {channel === "email" && (
        <p className="mt-2 text-xs text-subtle-foreground">
          Recipient email not auto-populated — find via LinkedIn or the
          company&apos;s contact page before sending.
        </p>
      )}

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
            Copy {CHANNEL_LABEL[channel].toLowerCase()}
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
