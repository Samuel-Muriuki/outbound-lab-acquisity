"use client";

import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

/**
 * Canvas-driven dot field with cursor bulge + glow. Adapted from
 * https://www.reactbits.dev/backgrounds/dot-field (David Haz / reactbits, MIT).
 *
 * Adaptations from the original:
 *  - TypeScript-strict
 *  - useSyncExternalStore mount gate (no canvas attach during SSR)
 *  - Theme-aware 3-stop diagonal gradient (cyan → blue → purple) — light
 *    theme uses the same stops at lower saturation so dots stay readable
 *    over the white page bg; dark theme glows over zinc-950
 *  - Dropped the unused mouse-physics (`bulgeOnly: true` is the only
 *    mode we use). Cleans up the inner loop substantially.
 *  - Honours prefers-reduced-motion: dots stay static, glow stays off
 *
 * Mounts as a fixed full-bleed layer behind page content (z-0,
 * pointer-events-none).
 */

const TWO_PI = Math.PI * 2;

interface DotFieldBackgroundProps {
  dotRadius?: number;
  dotSpacing?: number;
  cursorRadius?: number;
  bulgeStrength?: number;
  glowRadius?: number;
}

interface Dot {
  ax: number;
  ay: number;
  sx: number;
  sy: number;
}

function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function DotFieldBackground({
  dotRadius = 1.5,
  dotSpacing = 18,
  cursorRadius = 360,
  bulgeStrength = 48,
  glowRadius = 220,
}: DotFieldBackgroundProps) {
  const mounted = useMounted();
  const { resolvedTheme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<SVGCircleElement>(null);
  // useId is stable across SSR / hydration / re-renders; sidesteps the
  // react-hooks/refs lint rule that flags reading refs during render.
  const glowId = useId().replace(/:/g, "");

  // Per-theme palette. Three-stop diagonal gradient (top-left → middle →
  // bottom-right) so the dot field reads as a colour sweep across the
  // page rather than a flat tint. Brand: cyan-400 → blue-500 → purple-500
  // in dark; light gets the same hues at lower saturation so dots stay
  // readable over the white page bg without overpowering the foreground.
  const isLight = resolvedTheme === "light";
  // Memoised so the useEffect deps array stays referentially stable
  // across re-renders that don't actually change the theme.
  const gradientStops = useMemo<ReadonlyArray<readonly [number, string]>>(
    () =>
      isLight
        ? [
            [0, "rgba(34, 211, 238, 0.55)"],   // cyan
            [0.5, "rgba(59, 130, 246, 0.45)"], // blue
            [1, "rgba(168, 85, 247, 0.40)"],   // purple
          ]
        : [
            [0, "rgba(34, 211, 238, 0.55)"],
            [0.5, "rgba(59, 130, 246, 0.45)"],
            [1, "rgba(168, 85, 247, 0.50)"],
          ],
    [isLight]
  );
  const glowColor = isLight ? "rgba(59, 130, 246, 0.22)" : "rgba(34, 211, 238, 0.28)";

  useEffect(() => {
    if (!mounted) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = canvasRef.current;
    const glowEl = glowRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let dots: Dot[] = [];
    const size = { w: 0, h: 0, offsetX: 0, offsetY: 0 };
    const mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 };
    let glowOpacity = 0;
    let engagement = 0;
    let rafId = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let speedInterval: ReturnType<typeof setInterval> | null = null;

    function buildDots(w: number, h: number) {
      const step = dotRadius + dotSpacing;
      const cols = Math.floor(w / step);
      const rows = Math.floor(h / step);
      const padX = (w % step) / 2;
      const padY = (h % step) / 2;
      const next: Dot[] = new Array(rows * cols);
      let idx = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const ax = padX + col * step + step / 2;
          const ay = padY + row * step + step / 2;
          next[idx++] = { ax, ay, sx: ax, sy: ay };
        }
      }
      dots = next;
    }

    function doResize() {
      if (!canvas || !ctx) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size.w = rect.width;
      size.h = rect.height;
      size.offsetX = rect.left + window.scrollX;
      size.offsetY = rect.top + window.scrollY;
      buildDots(rect.width, rect.height);
    }

    function resize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doResize, 100);
    }

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.pageX - size.offsetX;
      mouse.y = e.pageY - size.offsetY;
    }

    function updateMouseSpeed() {
      const dx = mouse.prevX - mouse.x;
      const dy = mouse.prevY - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      mouse.speed += (dist - mouse.speed) * 0.5;
      if (mouse.speed < 0.001) mouse.speed = 0;
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;
    }

    function tick() {
      const len = dots.length;
      const targetEng = Math.min(mouse.speed / 5, 1);
      engagement += (targetEng - engagement) * 0.06;
      if (engagement < 0.001) engagement = 0;
      const eng = engagement;

      glowOpacity += (eng - glowOpacity) * 0.08;
      if (glowEl) {
        glowEl.setAttribute("cx", String(mouse.x));
        glowEl.setAttribute("cy", String(mouse.y));
        glowEl.style.opacity = String(glowOpacity);
      }

      if (!ctx) return;
      ctx.clearRect(0, 0, size.w, size.h);
      const grad = ctx.createLinearGradient(0, 0, size.w, size.h);
      for (const [offset, color] of gradientStops) {
        grad.addColorStop(offset, color);
      }
      ctx.fillStyle = grad;

      const cr = cursorRadius;
      const crSq = cr * cr;
      const rad = dotRadius / 2;

      ctx.beginPath();
      for (let i = 0; i < len; i++) {
        const d = dots[i];
        if (!d) continue;
        const dx = mouse.x - d.ax;
        const dy = mouse.y - d.ay;
        const distSq = dx * dx + dy * dy;

        if (distSq < crSq && eng > 0.01) {
          const dist = Math.sqrt(distSq);
          const t = 1 - dist / cr;
          const push = t * t * bulgeStrength * eng;
          const angle = Math.atan2(dy, dx);
          d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.15;
          d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.15;
        } else {
          d.sx += (d.ax - d.sx) * 0.1;
          d.sy += (d.ay - d.sy) * 0.1;
        }

        ctx.moveTo(d.sx + rad, d.sy);
        ctx.arc(d.sx, d.sy, rad, 0, TWO_PI);
      }
      ctx.fill();

      rafId = requestAnimationFrame(tick);
    }

    function staticDraw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, size.w, size.h);
      const grad = ctx.createLinearGradient(0, 0, size.w, size.h);
      for (const [offset, color] of gradientStops) {
        grad.addColorStop(offset, color);
      }
      ctx.fillStyle = grad;
      const rad = dotRadius / 2;
      ctx.beginPath();
      for (const d of dots) {
        ctx.moveTo(d.ax + rad, d.ay);
        ctx.arc(d.ax, d.ay, rad, 0, TWO_PI);
      }
      ctx.fill();
    }

    doResize();
    window.addEventListener("resize", resize);
    if (reduced) {
      staticDraw();
    } else {
      window.addEventListener("mousemove", onMouseMove, { passive: true });
      speedInterval = setInterval(updateMouseSpeed, 20);
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (speedInterval) clearInterval(speedInterval);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [
    mounted,
    dotRadius,
    dotSpacing,
    cursorRadius,
    bulgeStrength,
    gradientStops,
  ]);

  // Defer the SVG render until the theme resolves on the client. The
  // gradient stop color is theme-dependent and would otherwise hydrate
  // mismatched (server has no cookie access, defaults to dark; client
  // resolves the actual theme on first paint). The canvas itself is
  // also painted from a useEffect, so a 1-frame gap is invisible.
  if (!mounted) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <defs>
          <radialGradient id={glowId}>
            <stop offset="0%" stopColor={glowColor} />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <circle
          ref={glowRef}
          cx="-9999"
          cy="-9999"
          r={glowRadius}
          fill={`url(#${glowId})`}
          style={{ opacity: 0, willChange: "opacity" }}
        />
      </svg>
    </div>
  );
}
