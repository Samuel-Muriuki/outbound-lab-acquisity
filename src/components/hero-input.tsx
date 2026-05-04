"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResearchInput } from "@/lib/validation/research-input";
import { cn } from "@/lib/utils";

/**
 * Hero URL input. Phase 1 PR A: client-side validation only.
 *
 * On valid submit, the input enters a submitting state but does NOT yet
 * call the API — that wires up in a later PR alongside the
 * `/api/research` route handler. Until then submitting just logs the
 * normalised URL and resets after a short delay so the loading state is
 * inspectable.
 *
 * Visual states per `.ai/docs/12-ux-flows.md` §1.4:
 *   idle      → border-border, no ring
 *   hover     → border-border-strong
 *   focus     → border-brand, ring-brand/20
 *   invalid   → border-error,  ring-error/20  + inline message
 *   submitting→ Loader2 spin + 'Researching…' label, input disabled
 */
export function HeroInput() {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = ResearchInput.safeParse({ url: value });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Enter a valid URL.");
      return;
    }
    setError(null);
    startSubmit(() => {
      // Placeholder: the next PR replaces this with a POST to /api/research
      // followed by router.push(`/research/${run_id}`).
      console.info("[HeroInput] would research:", result.data.url);
      return new Promise<void>((resolve) => {
        setTimeout(resolve, 600);
      });
    });
  }

  const hasError = error !== null;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      aria-busy={isSubmitting}
    >
      <div className="flex-1">
        <label htmlFor={inputId} className="sr-only">
          Company URL to research
        </label>
        <Input
          id={inputId}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://acquisity.com"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (hasError) setError(null);
          }}
          disabled={isSubmitting}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          className={cn(
            "h-12 text-base transition-colors duration-200 [transition-timing-function:var(--ease-out)]",
            hasError &&
              "border-error focus-visible:border-error focus-visible:ring-error/20"
          )}
        />
        {hasError ? (
          <p
            id={errorId}
            role="alert"
            className="mt-2 text-sm text-error"
          >
            {error}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        className="h-12 sm:w-auto"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Researching…
          </>
        ) : (
          <>
            Research
            <ArrowRight className="size-4" aria-hidden />
          </>
        )}
      </Button>
    </form>
  );
}
