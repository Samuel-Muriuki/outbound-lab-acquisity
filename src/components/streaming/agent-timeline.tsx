"use client";

import type { ResearchStreamState } from "@/hooks/use-research-stream";
import { AgentCard } from "./agent-card";

interface AgentTimelineProps {
  state: ResearchStreamState;
}

/**
 * Vertical timeline of three AgentCards. Reads directly from the
 * useResearchStream() state. Wraps in an aria-live region so screen
 * readers announce status changes politely (per
 * `.ai/docs/12-ux-flows.md` §9.2).
 */
export function AgentTimeline({ state }: AgentTimelineProps) {
  return (
    <ol
      aria-live="polite"
      aria-relevant="additions text"
      className="flex flex-col gap-3 list-none p-0"
    >
      <li>
        <AgentCard index={1} state={state.agents[1]} />
      </li>
      <li>
        <AgentCard index={2} state={state.agents[2]} />
      </li>
      <li>
        <AgentCard index={3} state={state.agents[3]} />
      </li>
    </ol>
  );
}
