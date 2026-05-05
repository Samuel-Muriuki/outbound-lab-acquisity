"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type ThemeChoice = "light" | "dark" | "system";

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; Icon: typeof Sun; label: string }> = [
  { value: "light", Icon: Sun, label: "Light" },
  { value: "dark", Icon: Moon, label: "Dark" },
  { value: "system", Icon: Monitor, label: "System" },
];

/**
 * Three-state theme toggle (Light / Dark / System).
 *
 * `useTheme().theme` is `undefined` until next-themes hydrates on the
 * client — render an identically-sized placeholder during that window
 * so the footer layout doesn't shift when the toggle resolves.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  if (theme === undefined) {
    return (
      <div
        className="inline-flex h-8 items-center gap-1 rounded-full border border-border/60 bg-surface-1/40 p-0.5"
        aria-hidden
      >
        {OPTIONS.map(({ value }) => (
          <span key={value} className="block size-7 rounded-full" />
        ))}
      </div>
    );
  }

  const active: ThemeChoice = (theme as ThemeChoice) ?? "system";

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex h-8 items-center gap-1 rounded-full border border-border/60 bg-surface-1/40 p-0.5"
    >
      {OPTIONS.map(({ value, Icon, label }) => {
        const selected = value === active;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "grid size-7 place-items-center rounded-full transition-colors duration-200 [transition-timing-function:var(--ease-out)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              selected
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
