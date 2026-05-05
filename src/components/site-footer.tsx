const PORTFOLIO_URL = "https://samuel-muriuki.vercel.app/";
const GITHUB_URL = "https://github.com/Samuel-Muriuki";

/**
 * Site-wide footer — sits at the bottom of every page via the
 * `mt-auto` class combined with the layout's `min-h-full flex flex-col`.
 *
 * Voice per `.ai/design/brand-decision-2026-05.md`: precise, confident,
 * quiet. Two links + a copyright. Nothing more.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/50">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © 2026{" "}
          <a
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:text-brand-secondary"
          >
            Samuel Muriuki
          </a>
        </p>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub profile (opens in a new tab)"
          className="transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:text-foreground"
        >
          GitHub →
        </a>
      </div>
    </footer>
  );
}
