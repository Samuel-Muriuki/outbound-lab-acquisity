import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center px-4 py-16 sm:px-6 md:py-24 lg:px-8 focus:outline-none"
    >
      <p className="text-sm uppercase tracking-wide text-subtle-foreground">
        404
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
        We couldn&apos;t find that.
      </h1>
      <p className="mt-4 max-w-prose text-base text-muted-foreground">
        The page or research run you&apos;re looking for doesn&apos;t exist —
        or the URL was mistyped. Head back to the start and try again.
      </p>

      <Link
        href="/"
        className="mt-10 inline-flex items-center gap-1.5 text-sm text-foreground transition-colors hover:text-brand-secondary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to OutboundLab
      </Link>
    </main>
  );
}
