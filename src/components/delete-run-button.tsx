"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface DeleteRunButtonProps {
  runId: string;
  /** Where to send the user after a successful delete. Default: refresh in place. */
  onDeleted?: "refresh" | "home";
  /**
   * Visual variant.
   *  - 'icon-only' = compact, used in the recent-runs preview cards
   *  - 'with-label' = used in the streaming view header where there's room
   */
  variant?: "icon-only" | "with-label";
  className?: string;
}

/**
 * Issues DELETE /api/research/[id], showing a confirm prompt first.
 *
 * The endpoint validates the visitor's `outboundlab_sid` cookie against
 * the row's `creator_session_id`. The button itself only renders when
 * the server has already confirmed `isOwner` — the API call is the
 * authoritative check, this is just a UX gate to avoid an unnecessary
 * request in the happy path.
 */
export function DeleteRunButton({
  runId,
  onDeleted = "refresh",
  variant = "with-label",
  className,
}: DeleteRunButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick(event: React.MouseEvent) {
    // Recent-runs cards wrap the button inside an anchor — stop the
    // navigation so clicking delete doesn't also open the run.
    event.preventDefault();
    event.stopPropagation();

    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this run? This can't be undone.")
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/research/${runId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(body.error ?? "Could not delete run.");
          return;
        }
        toast.success("Run deleted.");
        if (onDeleted === "home") {
          router.push("/");
        } else {
          router.refresh();
        }
      } catch {
        toast.error("Network error — could not delete run.");
      }
    });
  }

  const Icon = isPending ? Loader2 : Trash2;
  const iconClass = isPending ? "size-4 animate-spin" : "size-4";

  if (variant === "icon-only") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-label={isPending ? "Deleting run" : "Delete this run"}
        className={cn(
          "inline-flex items-center justify-center rounded-md p-1.5 text-subtle-foreground transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:bg-surface-2 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40 disabled:opacity-50",
          className
        )}
      >
        <Icon className={iconClass} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40 disabled:opacity-50",
        className
      )}
    >
      <Icon className={iconClass} aria-hidden />
      {isPending ? "Deleting…" : "Delete run"}
    </button>
  );
}
