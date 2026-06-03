export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-100/85 px-6 py-4 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm"
          aria-hidden
        >
          M
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Miden × Epoch</h1>
        <span className="ui-chip">Testnet</span>
      </div>
    </header>
  );
}
