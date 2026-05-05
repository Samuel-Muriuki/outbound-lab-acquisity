import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://outbound-lab-acquisity.vercel.app";
const TITLE = "OutboundLab — Multi-agent B2B research";
const DESCRIPTION =
  "Paste any company URL and get a personalised outreach package in under a minute — researched by AI, not templated.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: TITLE,
    template: "%s · OutboundLab",
  },
  description: DESCRIPTION,
  applicationName: "OutboundLab",
  authors: [{ name: "Samuel Muriuki", url: "https://github.com/Samuel-Muriuki" }],
  openGraph: {
    type: "website",
    siteName: "OutboundLab",
    title: TITLE,
    description: DESCRIPTION,
    url: APP_URL,
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "OutboundLab — Multi-agent B2B research",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // 'dark' is the SSR-time fallback. next-themes' inline script
      // runs synchronously in <head> before first paint and swaps the
      // class to whatever the visitor's stored preference resolves to
      // (or, when unset, their system preference — see ThemeProvider's
      // defaultTheme="system" below). Keeping a baked-in class also
      // keeps JS-disabled visitors and unstyled error pages dark
      // instead of flashing white.
      className={`dark ${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/*
          Skip-to-content link per .ai/docs/12-ux-flows.md §9.1.
          Visible only when keyboard-focused (the focus-visible pseudo
          handles that automatically). Targets the [tabindex=-1] main
          element on each page so screen-reader and keyboard-only users
          can bypass the back-link / wordmark header.
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-background focus:shadow"
        >
          Skip to content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/*
            Fixed top-right theme toggle. z-50 keeps it above page
            content and InteractiveBackground (z-0). ThemeToggle uses
            useSyncExternalStore to render an identically-sized
            placeholder during SSR + first client paint, then swaps to
            the live radiogroup once mounted — that's how it dodges the
            hydration mismatch next-themes would otherwise cause (the
            cookie-driven theme isn't readable in RSC).
          */}
          <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
            <ThemeToggle />
          </div>
          {children}
          <SiteFooter />
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
