export default function EnvironmentLabNotFound() {
  return (
    <main className="dark flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md border-border/70 border-y py-8 text-center">
        <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.16em]">
          Unknown case or variant
        </p>
        <h1 className="mt-3 font-semibold text-xl tracking-tight">
          Environment lab entry not found
        </h1>
        <p className="mt-2 text-pretty text-muted-foreground text-sm leading-6">
          This URL does not match a published case and variant. Nothing was loaded as a fallback.
        </p>
        <a
          className="mt-5 inline-flex min-h-10 items-center rounded-md border border-border bg-accent px-4 font-medium text-sm hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/environment-lab"
        >
          Browse the case index
        </a>
      </div>
    </main>
  )
}
