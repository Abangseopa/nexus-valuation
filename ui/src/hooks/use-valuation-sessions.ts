import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ValuationSession } from "@/lib/valuation-api";

export function useValuationSessions() {
  const [sessions, setSessions] = useState<ValuationSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("valuation_sessions")
      .select("id, ticker, company_name, valuation_type, status, created_at")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setSessions(data as ValuationSession[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const deleteSession = useCallback(async (id: string) => {
    await (supabase as any).from("valuation_sessions").delete().eq("id", id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { sessions, loading, refetch: fetchSessions, deleteSession };
}
