const PORTFOLIO_URL = "https://samuel-muriuki.vercel.app/";
const GITHUB_URL = "https://github.com/Samuel-Muriuki/OutBound-Lab-Acquisity";

/**
 * GitHub's official mark (single-path silhouette). Inlined rather than
 * pulled from a brand-icon package — lucide-react drops trademarked
 * marks, and one icon doesn't justify a dep.
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.262.82-.582 0-.288-.012-1.243-.018-2.252-3.338.725-4.043-1.41-4.043-1.41-.547-1.387-1.336-1.755-1.336-1.755-1.092-.747.083-.732.083-.732 1.205.085 1.84 1.237 1.84 1.237 1.073 1.838 2.815 1.307 3.502.999.108-.776.42-1.307.764-1.607-2.665-.302-5.467-1.332-5.467-5.93 0-1.31.469-2.382 1.236-3.222-.124-.303-.535-1.524.116-3.176 0 0 1.008-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.02.005 2.047.138 3.005.404 2.29-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.912 1.235 3.222 0 4.61-2.806 5.624-5.479 5.92.43.372.815 1.103.815 2.222 0 1.605-.015 2.898-.015 3.293 0 .322.218.701.825.582C20.565 21.795 24 17.297 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  );
}

/**
 * Site-wide footer — sits at the bottom of every page via the
 * `mt-auto` class combined with the layout's `min-h-full flex flex-col`.
 *
 * Voice per `.ai/design/brand-decision-2026-05.md`: precise, confident,
 * quiet. Two links + a copyright. Theme toggle lives in the layout's
 * fixed top-right slot.
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
          aria-label="OutboundLab source on GitHub (opens in a new tab)"
          title="OutboundLab on GitHub"
          className="grid size-8 place-items-center rounded-full transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <GithubMark className="size-4" />
        </a>
      </div>
    </footer>
  );
}
