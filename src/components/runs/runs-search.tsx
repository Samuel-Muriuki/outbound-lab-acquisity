"use client";

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Debounce delay for live-search submissions (ms). Long enough to
 *  avoid a router.push() per keystroke, short enough that the visitor
 *  sees results within a beat of stopping typing. */
const LIVE_SEARCH_DELAY_MS = 250;

interface RunsSearchProps {
  /** The query currently reflected in the URL. Seeds the input. */
  initialQuery: string;
}

/**
 * Live-as-you-type search input for the /runs page. Each keystroke
 * (after a 250ms debounce) pushes `?q=...` onto the URL — the server
 * component re-renders with new results. Submitting via Enter still
 * works as the explicit "search now" path.
 *
 * Implementation notes:
 *  - Controlled input keyed off local state, debounced router.push so
 *    we don't churn the URL per keystroke
 *  - Lucide X clear button on the right; the native HTML5
 *    type="search" cancel-X is hidden via CSS in globals so we only
 *    show one (the user spotted both before — confusing)
 *  - Clearing (clicking X or emptying the input) immediately drops
 *    `?q=` from the URL, returning the page to its full-list state
 */
export function RunsSearch({ initialQuery }: RunsSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushQuery(next: string) {
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

  function scheduleLiveSubmit(next: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushQuery(next.trim());
    }, LIVE_SEARCH_DELAY_MS);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setValue(next);
    scheduleLiveSubmit(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushQuery(value.trim());
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setValue("");
    pushQuery("");
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
        id="runs-search"
        name="q"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Search by domain — e.g. acquisity"
        value={value}
        onChange={handleChange}
        className="runs-search-input h-11 pl-9 pr-9 text-base"
      />
      {value && (
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
