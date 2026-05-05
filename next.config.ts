import type { NextConfig } from "next";

/**
 * Security response headers — apply to every route via Next.js'
 * built-in `headers()` config so they ride on the static asset
 * responses too, not just route-handler / page responses.
 *
 * Trade-offs:
 *  - CSP allows 'unsafe-inline' for scripts because Next.js' App Router
 *    inlines hydration scripts in RSC payloads. Switching to nonces is
 *    a follow-up PR (requires middleware + a nonce read in the layout).
 *  - HSTS is set to 2 years with preload eligibility — only matters
 *    behind a domain we control; on *.vercel.app subdomains Vercel
 *    sets its own HSTS already.
 *  - frame-ancestors 'none' supersedes X-Frame-Options for modern
 *    browsers but we send both for older agents.
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.groq.com https://generativelanguage.googleapis.com https://api.tavily.com https://openrouter.ai https://*.openrouter.ai",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: CONTENT_SECURITY_POLICY,
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
