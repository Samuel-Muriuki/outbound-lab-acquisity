"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc/client";
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
 * Calls the `research.delete` tRPC mutation, showing a confirm prompt
 * first.
 *
 * Confirmation is a sonner toast with Delete/Cancel action buttons —
 * keeps the experience inside the app's brand voice (dark Geist surface
 * + brand-secondary actions) instead of falling back to the OS-themed
 * `window.confirm` dialog. The toast auto-dismisses on either click;
 * clicking outside the toast cancels by inaction.
 *
 * The mutation validates the visitor's `outboundlab_sid` cookie against
 * the row's `creator_session_id`. The button itself only renders when
 * the server has already confirmed `isOwner` — the call is the
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

  function performDelete() {
    startTransition(async () => {
      try {
        await trpc.research.delete.mutate({ id: runId });
        toast.success("Run deleted", {
          description: "The research run and its agent messages are gone.",
        });
        if (onDeleted === "home") {
          router.push("/");
        } else {
          router.refresh();
        }
      } catch (err) {
        if (err instanceof TRPCClientError) {
          toast.error(err.message || "Could not delete run.");
        } else {
          toast.error("Network error — could not delete run.");
        }
      }
    });
  }

  function handleClick(event: React.MouseEvent) {
    // Recent-runs cards wrap the button inside an anchor — stop the
    // navigation so clicking delete doesn't also open the run.
    event.preventDefault();
    event.stopPropagation();

    toast("Delete this run?", {
      description: "This can't be undone.",
      duration: 10_000,
      action: {
        label: "Delete",
        onClick: performDelete,
      },
      // Inline styles for the action/cancel buttons — sonner doesn't
      // expose a built-in destructive variant, so we paint them
      // explicitly: Delete in brand error red, Cancel in brand
      // success green so each option's intent is obvious at a glance.
      actionButtonStyle: {
        background: "var(--error)",
        color: "var(--background)",
      },
      cancelButtonStyle: {
        background: "var(--success)",
        color: "var(--background)",
      },
      cancel: {
        label: "Cancel",
        onClick: () => {
          // No-op — sonner auto-dismisses the toast when either
          // action is clicked. We pass an explicit handler so the
          // cancel button renders.
        },
      },
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
