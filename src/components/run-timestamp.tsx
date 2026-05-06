"use client";

import { useSyncExternalStore } from "react";
import {
  formatAbsoluteDateTime,
  formatRunDateTime,
} from "@/lib/utils/format-date";
import { cn } from "@/lib/utils";

/**
 * Timezone-correct run timestamp.
 *
 * Why this exists: `formatRunDateTime()` uses `Date.toLocaleTimeString()`
 * which is sensitive to the runtime's timezone. Server Components render
 * in the deployment's timezone (UTC on Vercel); Client Components render
 * in the visitor's local timezone. Mixing them produces inconsistent
 * timestamps across pages — the home-page card was showing "Today at
 * 5:33 AM" (server UTC) while the detail page header showed "Today at
 * 8:33 AM" (browser UTC+3) for the same run.
 *
 * This component renders a stable absolute UTC string on the server +
 * first client paint, then swaps to the friendly local representation
 * once mounted. `useSyncExternalStore` is the lint-clean way to derive
 * a `mounted` flag without the `useEffect(setMounted)` pattern that
 * trips `react-hooks/set-state-in-effect`.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export interface RunTimestampProps {
  iso: string | null | undefined;
  className?: string;
}

export function RunTimestamp({ iso, className }: RunTimestampProps) {
  const mounted = useMounted();
  if (!iso) return null;
  // Server / first-paint placeholder: render the absolute UTC date so
  // there's no hydration mismatch — same string on server + first
  // client render. Once mounted, swap to local-relative.
  const display = mounted ? formatRunDateTime(iso) : formatUtcStable(iso);
  return (
    <time
      dateTime={iso}
      title={formatAbsoluteDateTime(iso)}
      className={cn(className)}
      // Suppress hydration warning at the leaf — the deliberate
      // server→client swap of the text content is what this whole
      // component exists to make safe.
      suppressHydrationWarning
    >
      {display}
    </time>
  );
}

/**
 * Stable, deployment-timezone-independent fallback for SSR + first
 * paint. Formats as e.g. "May 6, 2026, 05:33Z" — readable but plain,
 * always identical for a given iso regardless of timezone.
 */
function formatUtcStable(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = d.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year}, ${hh}:${mm}Z`;
}
