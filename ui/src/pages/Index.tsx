import { useState, useCallback } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { SpreadsheetGrid } from "@/components/SpreadsheetGrid";
import { ChatInterface } from "@/components/ChatInterface";
import { buildSheetsFromResult, emptySheets, statusSheets } from "@/lib/spreadsheet-utils";
import type { ValuationResult } from "@/lib/valuation-api";
import type { Sheet } from "@/lib/spreadsheet-utils";

const Index = () => {
  const [sheets, setSheets] = useState<Sheet[]>(emptySheets);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  const handleStatusUpdate = useCallback((status: string, ticker: string) => {
    setSheets(statusSheets(status, ticker ? `Company: ${ticker}` : ""));
    setActiveSheetIndex(0);
  }, []);

  const handleValuationComplete = useCallback((result: ValuationResult) => {
    const builtSheets = buildSheetsFromResult(result);
    setSheets(builtSheets);
    setActiveSheetIndex(1); // jump straight to the model sheet
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white">
      <PanelGroup direction="horizontal" autoSaveId="nexus-layout">
        {/* ── Spreadsheet pane ───────────────────────────────────────────────── */}
        <Panel defaultSize={68} minSize={40}>
          <SpreadsheetGrid
            sheets={sheets}
            activeSheetIndex={activeSheetIndex}
            onSheetChange={setActiveSheetIndex}
          />
        </Panel>

        {/* ── Drag handle ───────────────────────────────────────────────────── */}
        <PanelResizeHandle className="w-[3px] bg-gray-200 hover:bg-blue-400 active:bg-blue-500 transition-colors cursor-col-resize" />

        {/* ── Chat pane ─────────────────────────────────────────────────────── */}
        <Panel defaultSize={32} minSize={22} maxSize={50}>
          <ChatInterface
            onValuationComplete={handleValuationComplete}
            onStatusUpdate={handleStatusUpdate}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default Index;
