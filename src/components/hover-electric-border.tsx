"use client";

import { useState, type ReactNode } from "react";
import { ElectricBorder } from "@/components/electric-border";

/**
 * Wraps a card so the ElectricBorder canvas + glow only mount while the
 * cursor is over it. The reactbits ElectricBorder runs an rAF loop with
 * per-frame perlin-noise sampling along the perimeter — running 9 of
 * those simultaneously on the /runs grid would be wasteful CPU. Mount-
 * on-hover keeps the loop active for at most one card at a time.
 *
 * The wrapper uses an absolute-positioned overlay so the border sits
 * flush around the static card without changing its layout.
 */

interface HoverElectricBorderProps {
  children: ReactNode;
  /** Stroke + glow colour. Default = reactbits indigo `#7d7eff`. */
  color?: string;
  /** Border radius (px) — match the wrapped card's radius. */
  borderRadius?: number;
}

export function HoverElectricBorder({
  children,
  color = "#7d7eff",
  borderRadius = 12,
}: HoverElectricBorderProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      // `contain: layout style` isolates the ElectricBorder's canvas
      // bleed (60px outward extension + scale(1.1) halo) from the
      // page's layout — it can paint outward freely so the jagged
      // spikes look right, without growing document scroll height or
      // pushing adjacent cards. `overflow: visible` lets the spikes
      // actually render past the card edge (the inverse of what we
      // had with overflow:hidden, which was clipping them inward).
      className="relative h-full"
      style={{ borderRadius, contain: "layout style" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <ElectricBorder
          // ElectricBorder reads its container size from
          // getBoundingClientRect(); the chain through .eb-content +
          // empty placeholder gives 0 height by default. Force the
          // root to fill the parent card via inline style — the
          // component's own className puts `relative` on the root,
          // which would otherwise win over a Tailwind `absolute` due
          // to the v4 alphabetical class order.
          className="pointer-events-none"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
          color={color}
          borderRadius={borderRadius}
          chaos={0.12}
          speed={1}
        >
          <div className="h-full w-full" />
        </ElectricBorder>
      )}
    </div>
  );
}
