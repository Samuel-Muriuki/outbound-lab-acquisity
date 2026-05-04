import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">OutboundLab</h1>
      <p className="text-sm text-muted-foreground">
        Scaffold ready · brand tokens, Geist fonts, and the real landing page
        land in PR 4.
      </p>
      <Button>shadcn primitive smoke test</Button>
    </main>
  );
}
