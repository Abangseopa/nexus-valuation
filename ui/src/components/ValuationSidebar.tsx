import { TrendingUp, PanelLeftClose, PanelLeft, Trash2 } from "lucide-react";
import { useValuationSessions } from "@/hooks/use-valuation-sessions";
import { StatusBadge } from "./StatusBadge";
import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";

interface ValuationSidebarProps {
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  refreshKey: number;
}

export function ValuationSidebar({ activeSessionId, onSelectSession, onDeleteSession, refreshKey }: ValuationSidebarProps) {
  const { sessions, loading, refetch, deleteSession } = useValuationSessions();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (refreshKey > 0) refetch();
  }, [refreshKey, refetch]);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center w-12 border-r border-border bg-sidebar py-4">
        <button onClick={() => setCollapsed(false)} className="text-muted-foreground hover:text-foreground transition-colors">
          <PanelLeft className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-72 border-r border-border bg-sidebar h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground tracking-tight">AccelNo</h1>
            <p className="text-[10px] text-muted-foreground font-medium tracking-wide">Nexus Valuation</p>
          </div>
        </div>
        <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground transition-colors">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-2 mb-2">
          Recent Valuations
        </p>

        {loading ? (
          <div className="space-y-2 px-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-md bg-secondary/50 animate-pulse" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-4">No valuations yet. Start one in the chat!</p>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group relative w-full text-left rounded-md px-3 py-2.5 transition-colors cursor-pointer ${
                  activeSessionId === s.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                }`}
                onClick={() => onSelectSession(s.id)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-semibold tracking-wide">{s.ticker}</span>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={s.status} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(s.id);
                        onDeleteSession?.(s.id);
                        toast({ title: "Valuation deleted", description: `${s.ticker} session removed.` });
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-medium text-muted-foreground">
                    {s.valuation_type.toUpperCase()}
                  </span>
                  {s.company_name && (
                    <>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-[10px] text-muted-foreground truncate">{s.company_name}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
