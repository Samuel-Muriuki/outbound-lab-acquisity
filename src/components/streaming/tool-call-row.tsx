"use client";

import { Globe, Search } from "lucide-react";
import type { ToolCallEntry } from "@/hooks/use-research-stream";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<string, typeof Search> = {
  web_search: Search,
  web_fetch: Globe,
};

interface ToolCallRowProps {
  entry: ToolCallEntry;
  /** Border + accent color from the parent agent (agent-1 / agent-2 / agent-3). */
  accent: "agent-1" | "agent-2" | "agent-3";
}

/**
 * Single tool-call row inside an AgentCard. Native <details>/<summary>
 * for the expand-on-click behaviour — accessible by default, no JS
 * state needed.
 *
 * Visual reference: `.ai/docs/12-ux-flows.md` §2.4.
 */
export function ToolCallRow({ entry, accent }: ToolCallRowProps) {
  const Icon = TOOL_ICONS[entry.tool] ?? Search;
  const inputPreview = renderInputPreview(entry.input);

  return (
    <details className="group rounded-md border border-border bg-surface-2/40 transition-colors duration-200 [transition-timing-function:var(--ease-out)] open:bg-surface-2 hover:border-border-strong">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="text-subtle-foreground select-none" aria-hidden>
          ╰─
        </span>
        <Icon
          className={cn(
            "size-4 shrink-0",
            accent === "agent-1" && "text-agent-1",
            accent === "agent-2" && "text-agent-2",
            accent === "agent-3" && "text-agent-3"
          )}
          aria-hidden
        />
        <span className="font-mono text-xs text-muted-foreground">
          {entry.tool}
        </span>
        <span className="truncate font-mono text-xs text-foreground">
          {inputPreview}
        </span>
        <span className="ml-auto text-xs text-subtle-foreground transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>

      <div className="border-t border-border px-3 py-2 font-mono text-xs">
        <div className="space-y-2">
          <div>
            <p className="text-subtle-foreground">Input</p>
            <pre className="mt-1 whitespace-pre-wrap break-words text-foreground">
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </div>
          {entry.resultSummary !== null && (
            <div>
              <p className="text-subtle-foreground">Output (summary)</p>
              <pre className="mt-1 whitespace-pre-wrap break-words text-foreground">
                {entry.resultSummary}
              </pre>
            </div>
          )}
          {entry.resultSummary === null && (
            <p className="text-subtle-foreground italic">Awaiting result…</p>
          )}
        </div>
      </div>
    </details>
  );
}

/**
 * Render a one-line preview of the tool input — typically the first
 * string value (query / url) or just the JSON itself.
 */
function renderInputPreview(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    for (const key of ["query", "url"]) {
      if (typeof obj[key] === "string") {
        return `"${obj[key]}"`;
      }
    }
    const firstString = Object.values(obj).find(
      (v): v is string => typeof v === "string"
    );
    if (firstString) return `"${firstString}"`;
  }
  return JSON.stringify(input);
}
