"use client";

import { useEffect, useRef } from "react";

export interface InteractiveBackgroundProps {
  /**
   * Visual variant.
   *  - 'spotlight' (default) — soft radial brand-tinted gradient that
   *    follows the cursor with a click ripple. Intensity (--mv, 0-1)
   *    scales with cursor velocity and decays toward 0 when idle.
   *  - 'aurora' — slow drifting blobs (no cursor follow). Used on
   *    surfaces where a follower would compete with the foreground
   *    (e.g. the streaming view's tool-call timeline).
   */
  variant?: "spotlight" | "aurora";
}

/** Pixels-per-millisecond mapped to --mv = 1. Above this caps. */
const MAX_VELOCITY_PPM = 3;

/** Multiplier applied per-frame when no mousemove arrives. ~120ms half-life. */
const VELOCITY_DECAY = 0.94;

/**
 * Decorative full-bleed background that responds to the visitor's
 * mouse + clicks. Sits behind everything (`z-0`, `pointer-events-none`)
 * and is purely cosmetic — no functionality depends on it. Honors
 * `prefers-reduced-motion` by short-circuiting all listeners.
 *
 * Implementation notes:
 *  - Mouse position + velocity write to CSS custom properties via
 *    `style.setProperty` rather than React state. Avoids a
 *    render-per-mousemove and lets the GPU compose the gradient
 *    directly.
 *  - Velocity is computed from successive mousemove deltas, clamped to
 *    [0, 1] against MAX_VELOCITY_PPM, and decays via rAF when the
 *    cursor is idle so the gradient breathes back to baseline.
 *  - Click ripples are a small DOM pool: 4 ripple divs reused round-robin,
 *    reset by toggling `data-state` to retrigger the keyframes.
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

    let lastX: number | null = null;
    let lastY: number | null = null;
    let lastMoveAt = performance.now();
    let velocity = 0;
    let rafId = 0;

    function setMv(value: number) {
      const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
      root!.style.setProperty("--mv", clamped.toFixed(3));
    }

    function tick() {
      // Decay velocity toward 0 each frame. Stop the rAF loop once it's
      // close enough to zero so we're not running 60Hz forever.
      velocity *= VELOCITY_DECAY;
      setMv(velocity);
      if (velocity > 0.005) {
        rafId = requestAnimationFrame(tick);
      } else {
        velocity = 0;
        setMv(0);
        rafId = 0;
      }
    }

    function handleMove(event: MouseEvent) {
      root!.style.setProperty("--mx", `${event.clientX}px`);
      root!.style.setProperty("--my", `${event.clientY}px`);

      const now = performance.now();
      if (lastX !== null && lastY !== null) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        const distance = Math.hypot(dx, dy);
        const dt = Math.max(1, now - lastMoveAt);
        const ppm = distance / dt;
        const sample = Math.min(1, ppm / MAX_VELOCITY_PPM);
        // Take the max of the new sample and the decaying value so a
        // burst snaps the brightness up immediately, while idle frames
        // continue the smooth decay.
        velocity = Math.max(velocity, sample);
        setMv(velocity);
      }
      lastX = event.clientX;
      lastY = event.clientY;
      lastMoveAt = now;

      if (rafId === 0) {
        rafId = requestAnimationFrame(tick);
      }
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
        if (rafId !== 0) cancelAnimationFrame(rafId);
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
