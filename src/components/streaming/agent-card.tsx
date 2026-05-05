"use client";

import { Check, Compass, Loader2, Mail, Users } from "lucide-react";
import type { AgentState } from "@/hooks/use-research-stream";
import type { AgentIndex } from "@/lib/agents/stream-events";
import { cn } from "@/lib/utils";
import { ToolCallRow } from "./tool-call-row";

interface AgentDescriptor {
  number: AgentIndex;
  name: string;
  description: string;
  accent: "agent-1" | "agent-2" | "agent-3";
  Icon: typeof Compass;
}

const AGENTS: Record<AgentIndex, AgentDescriptor> = {
  1: {
    number: 1,
    name: "Reconnaissance",
    description: "Reading the company.",
    accent: "agent-1",
    Icon: Compass,
  },
  2: {
    number: 2,
    name: "People & ICP",
    description: "Identifying decision makers.",
    accent: "agent-2",
    Icon: Users,
  },
  3: {
    number: 3,
    name: "Personalisation & Outreach",
    description: "Drafting the email.",
    accent: "agent-3",
    Icon: Mail,
  },
};

interface AgentCardProps {
  index: AgentIndex;
  state: AgentState;
}

/**
 * Single row in the agent timeline. Three visual states per
 * `.ai/docs/12-ux-flows.md` §2.3:
 *
 *   pending  → muted, border-border, em-dash status
 *   running  → border + glow in the agent's accent color, spinner status
 *   done     → border in the accent color, check + duration in mono
 */
export function AgentCard({ index, state }: AgentCardProps) {
  const descriptor = AGENTS[index];
  const { status, durationMs, toolCalls, thinking, provider } = state;

  return (
    <article
      data-agent-status={status}
      className={cn(
        "glass-card rounded-xl border p-5 transition-all duration-300 [transition-timing-function:var(--ease-out)]",
        status === "pending" && "border-border opacity-60",
        status === "running" &&
          (descriptor.accent === "agent-1"
            ? "border-agent-1 agent-glow-1"
            : descriptor.accent === "agent-2"
              ? "border-agent-2 agent-glow-2"
              : "border-agent-3 agent-glow-3"),
        status === "done" &&
          (descriptor.accent === "agent-1"
            ? "border-agent-1"
            : descriptor.accent === "agent-2"
              ? "border-agent-2"
              : "border-agent-3")
      )}
    >
      <header className="flex items-center gap-3">
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            descriptor.accent === "agent-1" && "bg-agent-1",
            descriptor.accent === "agent-2" && "bg-agent-2",
            descriptor.accent === "agent-3" && "bg-agent-3",
            status === "running" && "animate-pulse-agent"
          )}
          aria-hidden
        />
        <descriptor.Icon
          className={cn(
            "size-4 shrink-0",
            descriptor.accent === "agent-1" && "text-agent-1",
            descriptor.accent === "agent-2" && "text-agent-2",
            descriptor.accent === "agent-3" && "text-agent-3"
          )}
          aria-hidden
        />
        <span className="font-mono text-xs text-subtle-foreground tabular-nums">
          {descriptor.number}
        </span>
        <h3 className="text-base font-medium tracking-tight text-foreground">
          {descriptor.name}
        </h3>
        <div className="ml-auto flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
          {status === "pending" && (
            <span className="text-subtle-foreground" aria-label="Pending">
              ─
            </span>
          )}
          {status === "running" && (
            <>
              <Loader2
                className={cn(
                  "size-4 animate-spin",
                  descriptor.accent === "agent-1" && "text-agent-1",
                  descriptor.accent === "agent-2" && "text-agent-2",
                  descriptor.accent === "agent-3" && "text-agent-3"
                )}
                aria-label="Running"
              />
            </>
          )}
          {status === "done" && (
            <>
              {durationMs !== null && (
                <span>{(durationMs / 1000).toFixed(1)}s</span>
              )}
              <Check
                className={cn(
                  "size-4",
                  descriptor.accent === "agent-1" && "text-agent-1",
                  descriptor.accent === "agent-2" && "text-agent-2",
                  descriptor.accent === "agent-3" && "text-agent-3"
                )}
                aria-label="Done"
              />
            </>
          )}
        </div>
      </header>

      <p className="mt-1 ml-[26px] text-sm text-muted-foreground">
        {descriptor.description}
      </p>

      {provider && status !== "pending" && (
        <p className="mt-2 ml-[26px] font-mono text-xs text-subtle-foreground">
          via {provider}
        </p>
      )}

      {(toolCalls.length > 0 || thinking) && status !== "pending" && (
        <div className="mt-4 space-y-1.5">
          {toolCalls.map((entry, i) => (
            <ToolCallRow
              key={`${entry.tool}-${i}`}
              entry={entry}
              accent={descriptor.accent}
            />
          ))}
          {thinking && (
            <p className="px-3 py-2 font-mono text-xs italic text-subtle-foreground">
              {thinking}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
