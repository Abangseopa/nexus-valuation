import { useState, useCallback } from "react";
import { ValuationSidebar } from "@/components/ValuationSidebar";
import { ChatInterface } from "@/components/ChatInterface";

const Index = () => {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleValuationComplete = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex h-screen w-full bg-background">
      <ValuationSidebar
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        refreshKey={refreshKey}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatInterface onValuationComplete={handleValuationComplete} />
      </main>
    </div>
  );
};

export default Index;
