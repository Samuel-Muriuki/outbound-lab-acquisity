"use client";

import { useRef, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface RunsSearchProps {
  /**
   * The query currently reflected in the URL. Drives the input's
   * `defaultValue` and the input's `key` — when the URL changes, the
   * input re-mounts with the new value. Using an uncontrolled input
   * sidesteps the "setState in effect" anti-pattern entirely.
   */
  initialQuery: string;
}

/**
 * Search input for the /runs page. Submits a form action that pushes
 * `?q=...` onto the URL — server component re-renders with new results.
 * Empty string clears the query.
 *
 * Uncontrolled by design: input lives in the DOM, the URL is the source
 * of truth. When the URL changes, the `key` re-mounts the input with
 * the new defaultValue. This pattern dodges the React-19
 * setState-in-effect lint rule and stays simpler.
 */
export function RunsSearch({ initialQuery }: RunsSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function submit(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set("q", next);
    } else {
      params.delete("q");
    }
    // Reset pagination when the query changes — old page numbers
    // usually don't match the new result count.
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/runs?${qs}` : "/runs");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = inputRef.current?.value.trim() ?? "";
    submit(next);
  }

  function handleClear() {
    if (inputRef.current) inputRef.current.value = "";
    submit("");
  }

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className="relative"
      aria-busy={isPending}
    >
      <label htmlFor="runs-search" className="sr-only">
        Search runs
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        // The `key` re-mounts the input when the URL query changes,
        // resetting the uncontrolled defaultValue without an effect.
        key={initialQuery}
        ref={inputRef}
        id="runs-search"
        name="q"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Search by domain — e.g. acquisity"
        defaultValue={initialQuery}
        className="h-11 pl-9 pr-9 text-base"
      />
      {initialQuery && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </form>
  );
}
