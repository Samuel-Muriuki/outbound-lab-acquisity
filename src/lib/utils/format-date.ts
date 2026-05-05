/**
 * Human-friendly run-timestamp formatting.
 *
 * Used on the streaming view, recent-runs preview, related-runs panel,
 * and the /runs page so visitors can see when a run actually happened
 * — not just how long it took.
 *
 * Format ladder (in order, most-recent-wins):
 *   today     → "Today at 8:45 PM"
 *   yesterday → "Yesterday at 8:45 PM"
 *   <7 days   → "Tue at 3:12 PM"
 *   this year → "May 5 at 8:45 PM"
 *   older     → "May 5, 2025 at 8:45 PM"
 */
export function formatRunDateTime(
  iso: string | null | undefined,
  now: Date = new Date()
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  // Calendar-day comparison (not millisecond delta) so "yesterday at
  // 11:55 PM viewed at 12:01 AM today" reads as "Yesterday", not "today".
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.round(
    (startOfDay(now) - startOfDay(d)) / (24 * 60 * 60 * 1000)
  );

  if (dayDelta === 0) return `Today at ${time}`;
  if (dayDelta === 1) return `Yesterday at ${time}`;
  if (dayDelta > 1 && dayDelta < 7) {
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} at ${time}`;
  }

  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date} at ${time}`;
}

/**
 * Always-absolute datetime — for the `title` attribute / tooltip on
 * relative timestamps so visitors can hover to see the precise moment.
 */
export function formatAbsoluteDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
