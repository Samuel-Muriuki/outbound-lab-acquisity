"use client";

import { useEffect, useRef } from "react";

export interface InteractiveBackgroundProps {
  /**
   * Visual variant.
   *  - 'spotlight' (default) — soft radial brand-tinted gradient that
   *    follows the cursor with a click ripple.
   *  - 'aurora' — slow drifting blobs (no cursor follow). Used on
   *    surfaces where a follower would compete with the foreground
   *    (e.g. the streaming view's tool-call timeline).
   */
  variant?: "spotlight" | "aurora";
}

/**
 * Decorative full-bleed background that responds to the visitor's
 * mouse + clicks. Sits behind everything (`z-0`, `pointer-events-none`)
 * and is purely cosmetic — no functionality depends on it. Honors
 * `prefers-reduced-motion` by short-circuiting all listeners.
 *
 * Implementation notes:
 *  - Mouse position writes to CSS custom properties via `style.setProperty`
 *    rather than React state. Avoids a render-per-mousemove and lets the
 *    GPU compose the gradient directly.
 *  - Click ripples are a small DOM pool: we keep up to 4 ripple divs and
 *    reset their `key`-equivalent (animation-name) by toggling a class
 *    on each click. Pure CSS animation handles the rest.
 */
export function InteractiveBackground({
  variant = "spotlight",
}: InteractiveBackgroundProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ripplePoolRef = useRef<HTMLSpanElement[]>([]);
  const ripplePointerRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const root = rootRef.current;
    if (!root) return;

    function handleMove(event: MouseEvent) {
      root!.style.setProperty("--mx", `${event.clientX}px`);
      root!.style.setProperty("--my", `${event.clientY}px`);
    }

    function handleClick(event: MouseEvent) {
      const pool = ripplePoolRef.current;
      if (pool.length === 0) return;
      const next = pool[ripplePointerRef.current % pool.length];
      ripplePointerRef.current += 1;
      if (!next) return;
      next.style.setProperty("--rx", `${event.clientX}px`);
      next.style.setProperty("--ry", `${event.clientY}px`);
      // Restart the animation by toggling the data-state attr.
      next.setAttribute("data-state", "off");
      // Force a reflow so the next frame sees the reset.
      void next.offsetWidth;
      next.setAttribute("data-state", "on");
    }

    if (variant === "spotlight") {
      window.addEventListener("mousemove", handleMove, { passive: true });
      window.addEventListener("click", handleClick);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("click", handleClick);
      };
    }
    // 'aurora' variant has no listeners — pure CSS animation.
  }, [variant]);

  if (variant === "aurora") {
    return (
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 spotlight-bg"
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          ref={(el) => {
            if (el) ripplePoolRef.current[i] = el;
          }}
          data-state="off"
          className="spotlight-ripple"
        />
      ))}
    </div>
  );
}
