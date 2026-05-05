import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

/**
 * Cookie-derived session id — drives "your runs" attribution without
 * forcing the user to log in.
 *
 * Set on first POST /api/research (the cookie is created server-side
 * and stored on the run row's `creator_session_id`). Compared against
 * the row's column on DELETE /api/research/[id] — only matching cookies
 * can delete. UI components compare server-side and pass an `isOwner`
 * boolean down so the delete button only renders for the original
 * creator.
 *
 * Trade-off: clearing cookies (or switching browsers/devices) loses the
 * ability to delete past runs. Acceptable for a portfolio demo where
 * the alternative is a full magic-link auth flow.
 */

const COOKIE_NAME = "outboundlab_sid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function generateSessionId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Returns the visitor's session id, creating + setting the cookie on
 * first access. Always returns a value — never null.
 */
export async function getOrCreateSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const fresh = generateSessionId();
  store.set(COOKIE_NAME, fresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return fresh;
}

/**
 * Read-only variant — returns null if the cookie isn't set. Used by
 * server components that need to know "is this visitor the owner of
 * this row" without side-effects.
 */
export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}
