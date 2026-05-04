import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div className="flex items-center gap-3">
        <span className="size-3 rounded-full gradient-bg" aria-hidden />
        <h1 className="text-3xl font-semibold tracking-tight">OutboundLab</h1>
      </div>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Scaffold ready · brand tokens loaded · the real landing page lands in
        Session 2.
      </p>
      <Button>shadcn primitive smoke test</Button>
    </main>
  );
}
