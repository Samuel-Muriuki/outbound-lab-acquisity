import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://outbound-lab.vercel.app";
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
      // 'dark' is hardcoded here so the SSR'd HTML carries the dark
      // theme on first paint — next-themes hydrates afterward and only
      // swaps classes when the user explicitly toggles. Eliminates the
      // white-flash FOUC that's especially visible on error pages
      // (Next.js's default 404, error.tsx fallbacks) which paint
      // before next-themes' inline script runs.
      className={`dark ${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
