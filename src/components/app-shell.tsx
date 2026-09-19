import { FolderOpen, Layers, Library, Settings, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { activeChats, useChatStore, type AppView } from "@/lib/chats/store";
import { cn } from "@/lib/utils";

const NAV: { id: AppView; label: string; icon: typeof Library }[] = [
  { id: "insights", label: "Insights", icon: Layers },
  { id: "library", label: "Library", icon: Library },
  { id: "cleanup", label: "Cleanup", icon: FolderOpen },
  { id: "import", label: "Import", icon: Upload },
];

const DESKTOP_NAV: { id: AppView; label: string; icon: typeof Library }[] = [
  ...NAV,
  { id: "settings", label: "Archive", icon: Settings },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 items-center justify-center rounded-sm border border-border bg-card" aria-hidden>
        <svg viewBox="0 0 32 32" className="size-4">
          <rect x="4" y="8" width="24" height="3" rx="0.5" fill="currentColor" />
          <rect x="8" y="14.5" width="20" height="3" rx="0.5" fill="currentColor" />
          <rect x="4" y="21" width="16" height="3" rx="0.5" fill="currentColor" />
        </svg>
      </span>
      <span className="font-display text-2xl leading-none tracking-tight">Sift</span>
    </div>
  );
}

export function AppShell({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  const view = useChatStore((s) => s.view);
  const setView = useChatStore((s) => s.setView);
  const usingDemo = useChatStore((s) => s.usingDemo);
  const chats = useChatStore((s) => s.chats);
  const analysis = useChatStore((s) => s.analysis);
  const deleteCount = analysis?.deleteSuggestions.length ?? 0;
  const activeCount = activeChats(chats).length;

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-background text-foreground lg:flex-row">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border px-4 py-6 lg:flex">
        <Wordmark />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Your chats, sorted — locally.</p>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {DESKTOP_NAV.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            const badge = item.id === "cleanup" && deleteCount > 0 ? deleteCount : item.id === "library" ? activeCount : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                  active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {item.label}
                {badge > 0 && item.id !== "insights" && item.id !== "import" && item.id !== "settings" && (
                  <span className="ml-auto text-xs tabular-nums text-subtle">{badge}</span>
                )}
              </button>
            );
          })}
        </nav>
        <p className="mt-auto pt-8 text-xs leading-relaxed text-subtle">
          Conversations live in a SQLite archive in this browser. Hide and merge are reversible. Sift cannot delete
          chats on grok.com.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-8">
          <div className="lg:hidden">
            <Wordmark />
          </div>
          <div className="hidden min-w-0 lg:block">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {view === "settings" ? "Archive" : NAV.find((n) => n.id === view)?.label}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("settings")}
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-md lg:hidden",
                view === "settings" ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
              aria-label="Archive and settings"
            >
              <Settings className="size-4" strokeWidth={1.75} />
            </button>
            {actions}
          </div>
        </header>
        {usingDemo && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5 text-sm text-muted-foreground lg:px-8">
            <span>Sample library so you can try analysis now. Import your own chats to replace the view — the sample stays in the archive.</span>
            <button
              type="button"
              onClick={() => setView("import")}
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              Import
            </button>
          </div>
        )}
        <div className="flex-1 pb-24 lg:pb-0">{children}</div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Main"
      >
        <div className="grid grid-cols-4">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-1 text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {item.label}
                {item.id === "cleanup" && deleteCount > 0 && (
                  <span className="absolute top-1.5 right-[calc(50%-18px)] size-1.5 rounded-full bg-silver" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}