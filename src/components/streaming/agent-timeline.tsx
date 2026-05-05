"use client";

import { useEffect, useRef } from "react";
import type { ResearchStreamState } from "@/hooks/use-research-stream";
import type { AgentIndex } from "@/lib/agents/stream-events";
import { TiltedWrapper } from "@/components/tilted-wrapper";
import { AgentCard } from "./agent-card";

interface AgentTimelineProps {
  state: ResearchStreamState;
}

/**
 * Vertical timeline of three AgentCards. Reads directly from the
 * useResearchStream() state. Wraps in an aria-live region so screen
 * readers announce status changes politely (per
 * `.ai/docs/12-ux-flows.md` §9.2).
 *
 * Auto-scrolls the currently-running AgentCard into view as the
 * orchestrator advances from agent 1 → 2 → 3, so visitors don't have
 * to follow the work manually. Honours prefers-reduced-motion (skips
 * the smooth-scroll, falls back to instant) and only scrolls when an
 * agent transitions *into* running — never on subsequent re-renders
 * inside the same agent.
 */
export function AgentTimeline({ state }: AgentTimelineProps) {
  const agent1Ref = useRef<HTMLLIElement>(null);
  const agent2Ref = useRef<HTMLLIElement>(null);
  const agent3Ref = useRef<HTMLLIElement>(null);
  const previouslyRunningRef = useRef<AgentIndex | null>(null);

  useEffect(() => {
    const refs: Record<AgentIndex, HTMLLIElement | null> = {
      1: agent1Ref.current,
      2: agent2Ref.current,
      3: agent3Ref.current,
    };
    const runningEntry = (Object.keys(state.agents) as Array<`${AgentIndex}`>)
      .map((k) => Number(k) as AgentIndex)
      .find((i) => state.agents[i].status === "running");
    if (!runningEntry) return;
    if (previouslyRunningRef.current === runningEntry) return;
    previouslyRunningRef.current = runningEntry;

    const target = refs[runningEntry];
    if (!target) return;
    const reduced = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
  }, [state.agents]);

  return (
    <ol
      aria-live="polite"
      aria-relevant="additions text"
      className="flex flex-col gap-3 list-none p-0"
    >
      <li ref={agent1Ref}>
        <TiltedWrapper rotateAmplitude={4} scaleOnHover={1.01}>
          <AgentCard index={1} state={state.agents[1]} />
        </TiltedWrapper>
      </li>
      <li ref={agent2Ref}>
        <TiltedWrapper rotateAmplitude={4} scaleOnHover={1.01}>
          <AgentCard index={2} state={state.agents[2]} />
        </TiltedWrapper>
      </li>
      <li ref={agent3Ref}>
        <TiltedWrapper rotateAmplitude={4} scaleOnHover={1.01}>
          <AgentCard index={3} state={state.agents[3]} />
        </TiltedWrapper>
      </li>
    </ol>
  );
}
