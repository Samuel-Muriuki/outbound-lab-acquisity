import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase admin client (uses the `service_role` key —
 * bypasses RLS, full read/write across every table).
 *
 * MUST NEVER be imported from a client component or shipped in the
 * client bundle. The `server-only` import at the top throws a build-time
 * error if anything in `src/components/`, a `"use client"` file, or a
 * page rendered as a Client Component imports this module.
 *
 * The cached instance avoids creating a new HTTP client on every call.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Copy .env.example → .env.local and fill in."
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Copy .env.example → .env.local and fill in (server-only)."
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
