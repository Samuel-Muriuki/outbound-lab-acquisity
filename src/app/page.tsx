import { Suspense } from "react";
import { HeroInput } from "@/components/hero-input";
import { InteractiveBackground } from "@/components/interactive-background";
import { RecentRunsPreview } from "@/components/landing/recent-runs-preview";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <>
      <InteractiveBackground variant="spotlight" />
      <main
        id="main"
        tabIndex={-1}
        className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-16 sm:px-6 md:py-24 lg:px-8 focus:outline-none"
      >
      <header className="flex items-center gap-3">
        <span
          className="size-3 rounded-full gradient-bg"
          aria-hidden
        />
        <span className="text-base font-medium tracking-tight">
          OutboundLab
        </span>
      </header>

      <section className="mt-16 md:mt-24">
        <h1 className="text-5xl font-semibold tracking-[-0.025em] md:text-6xl">
          OutboundLab
        </h1>
        <p className="mt-4 text-lg text-muted-foreground md:text-xl">
          Multi-agent B2B research, on demand.
        </p>
        <p className="mt-6 max-w-prose text-base text-muted-foreground">
          Paste any company URL. Get a personalised outreach package in
          under a minute — researched by AI, not templated.
        </p>

        <div className="mt-10">
          <HeroInput />
        </div>
      </section>

      <Suspense fallback={null}>
        <RecentRunsPreview />
      </Suspense>
      </main>
    </>
  );
}
