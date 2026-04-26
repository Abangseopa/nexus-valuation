import { useState, useRef, useEffect, useCallback } from "react";
import {
  Loader2, Plus, ChevronDown, Paperclip, Zap, ArrowUp,
  X, ArrowUpRight, Download, BarChart2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

import {
  ChatMessage,
  ValuationResult,
  resolveTickerAndStart,
  getValuationStatus,
  sendChatMessage,
  parseUserIntent,
} from "@/lib/valuation-api";

interface ChatInterfaceProps {
  onValuationComplete: (result: ValuationResult) => void;
  onStatusUpdate?: (status: string, ticker: string) => void;
}

type Tab = "home" | "data" | "chat" | "settings";

// ── AccelNo brand mark ────────────────────────────────────────────────────────
function AccelNoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="url(#accel-grad)"/>
      <path d="M7 24L16 8L25 24" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="11.5" y1="18.5" x2="20.5" y2="18.5" stroke="white" strokeWidth="2.8" strokeLinecap="round"/>
      <path d="M21 13L25 9" stroke="#A5B4FC" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="25" cy="9" r="1.8" fill="#C7D2FE"/>
      <defs>
        <linearGradient id="accel-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1"/>
          <stop offset="1" stopColor="#4338CA"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Small avatar used in chat ─────────────────────────────────────────────────
function Avatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
      <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
        <path d="M7 24L16 8L25 24" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="11.5" y1="18.5" x2="20.5" y2="18.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════

export function ChatInterface({ onValuationComplete, onStatusUpdate }: ChatInterfaceProps) {
  const [tab, setTab]                 = useState<Tab>("chat");
  const [messages, setMessages]       = useState<ChatMessage[]>([]);
  const [input, setInput]             = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTicker, setActiveTicker]       = useState<string>("");
  const [activeCompany, setActiveCompany]     = useState<string>("");
  const [activeResult, setActiveResult]       = useState<ValuationResult | null>(null);
  const [isPolling, setIsPolling]     = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  const addMessage = useCallback((msg: Omit<ChatMessage, "id">) => {
    const newMsg = { ...msg, id: genId() };
    setMessages(prev => [...prev, newMsg]);
    return newMsg.id;
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const startPolling = useCallback(
    (sessionId: string, loadingMsgId: string, ticker: string) => {
      setIsPolling(true);
      if (pollingRef.current) clearInterval(pollingRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const res    = await getValuationStatus(sessionId);
          const status = res.data?.status || res.status;
          const data   = res.data || res;

          const labels: Record<string, string> = {
            pending:       "Initialising...",
            fetching_data: `Fetching ${ticker} SEC EDGAR filings...`,
            generating:    "Claude is building the model...",
          };

          if (status === "complete") {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setIsPolling(false);

            const result: ValuationResult = {
              sessionId,
              ticker:        data.ticker      || ticker,
              companyName:   data.companyName || data.company_name || ticker,
              valuationType: data.valuationType || data.valuation_type || "dcf",
              fileUrl:       data.fileUrl     || data.file_url      || "",
              assumptions:   data.assumptions || {},
            };

            setActiveResult(result);
            setActiveCompany(result.companyName || ticker);
            updateMessage(loadingMsgId, { type: "result", content: "Model complete", resultData: result });
            onValuationComplete(result);
            setTab("chat");

          } else if (status === "error") {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setIsPolling(false);
            updateMessage(loadingMsgId, { type: "error", content: data.error || "An error occurred." });

          } else {
            const label = labels[status] || "Processing...";
            updateMessage(loadingMsgId, { content: label });
            onStatusUpdate?.(label, ticker);
          }
        } catch { /* silently retry */ }
      }, 3000);
    },
    [updateMessage, onValuationComplete, onStatusUpdate]
  );

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isPolling) return;

    setInput("");

    // Follow-up on existing session
    if (activeSessionId && !parseUserIntent(trimmed)) {
      addMessage({ role: "user", content: trimmed, type: "text" });
      const loadingId = addMessage({ role: "assistant", content: "Updating model...", type: "loading" });
      try {
        await sendChatMessage(activeSessionId, trimmed);
        startPolling(activeSessionId, loadingId, activeTicker);
      } catch {
        updateMessage(loadingId, { type: "error", content: "Failed to send message." });
      }
      return;
    }

    const intent = parseUserIntent(trimmed);
    if (!intent) {
      addMessage({ role: "user", content: trimmed, type: "text" });
      addMessage({
        role: "assistant",
        content: "I can build DCF and LBO models for any public company. Try:\n\n• \"Build a DCF for Apple\"\n• \"LBO for Microsoft\"\n• \"DCF for TSLA\"",
        type: "text",
      });
      return;
    }

    addMessage({ role: "user", content: trimmed, type: "text" });
    const loadingId = addMessage({ role: "assistant", content: "Starting valuation...", type: "loading" });
    onStatusUpdate?.("Starting valuation...", intent.rawInput.toUpperCase());

    try {
      const res        = await resolveTickerAndStart(intent.rawInput, intent.type);
      const sessionId  = res.data?.sessionId || res.sessionId;
      const ticker     = res.data?.ticker    || intent.rawInput.toUpperCase();
      setActiveSessionId(sessionId);
      setActiveTicker(ticker);
      setActiveCompany(ticker);
      startPolling(sessionId, loadingId, ticker);
    } catch {
      updateMessage(loadingId, { type: "error", content: "Failed to start valuation. Please try again." });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRegenerate = useCallback(async (message: string) => {
    if (!activeSessionId) return;
    addMessage({ role: "user", content: message, type: "text" });
    const loadingId = addMessage({ role: "assistant", content: "Regenerating...", type: "loading" });
    try {
      await sendChatMessage(activeSessionId, message);
      startPolling(activeSessionId, loadingId, activeTicker);
    } catch {
      updateMessage(loadingId, { type: "error", content: "Failed to regenerate." });
    }
  }, [activeSessionId, activeTicker, addMessage, updateMessage, startPolling]);

  // Label for the session selector pill
  const sessionLabel = activeTicker
    ? `Run a ${(activeResult?.valuationType ?? "DCF").toUpperCase()}  ${activeCompany || activeTicker}`
    : null;

  return (
    <div className="flex flex-col h-full bg-white text-gray-900 border-l border-gray-200">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2.5 border-b border-gray-100 shrink-0">
        <AccelNoMark size={26} />
        <span className="text-[15px] font-semibold text-gray-900 tracking-tight">AccelNo</span>
        {activeTicker && (
          <div className="ml-auto">
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
              {activeTicker}
            </span>
          </div>
        )}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-100 shrink-0">
        {(["home", "data", "chat", "settings"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-2.5 text-[12px] font-medium capitalize transition-colors border-b-2 ${
              tab === t
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Session selector (when model is active) ─────────────────────────── */}
      {sessionLabel && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 shrink-0">
          <button className="flex items-center gap-1.5 text-[12px] font-medium text-gray-700 hover:text-gray-900 transition-colors">
            {sessionLabel}
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          </button>
          <button
            onClick={() => { setMessages([]); setActiveSessionId(null); setActiveTicker(""); setActiveResult(null); setActiveCompany(""); }}
            className="ml-auto w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      {tab === "home"     && <HomeTab result={activeResult} onGoToChat={() => setTab("chat")} />}
      {tab === "data"     && <DataTab result={activeResult} />}
      {tab === "settings" && <SettingsTab />}
      {tab === "chat"     && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
          {messages.length === 0 && <WelcomeMsg />}
          {messages.map(msg => (
            <MessageRow
              key={msg.id}
              message={msg}
              onRegenerate={msg.type === "result" ? handleRegenerate : undefined}
              isRegenerating={isPolling}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* ── Input (only in chat tab) ──────────────────────────────────────────── */}
      {tab === "chat" && (
        <div className="shrink-0 px-3 py-3 border-t border-gray-100">
          <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isPolling ? "Building model..." : "Ask Accelno anything..."}
              disabled={isPolling}
              rows={1}
              className="w-full px-3 pt-2.5 pb-1 text-[13px] text-gray-900 placeholder:text-gray-400 resize-none outline-none bg-white disabled:opacity-50"
              style={{ maxHeight: 120, overflowY: "auto" }}
            />
            <div className="flex items-center px-3 py-2 bg-gray-50 border-t border-gray-100">
              <button className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors font-medium">
                Sources
                <ChevronDown className="h-3 w-3" />
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button className="text-gray-400 hover:text-gray-600 transition-colors p-1">
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
                <button className="text-gray-400 hover:text-gray-600 transition-colors p-1">
                  <Zap className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleSubmit()}
                  disabled={!input.trim() || isPolling}
                  className="w-7 h-7 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 flex items-center justify-center transition-colors"
                >
                  {isPolling
                    ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                    : <ArrowUp   className="h-3.5 w-3.5 text-white" />
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Home tab ──────────────────────────────────────────────────────────────────

function HomeTab({ result, onGoToChat }: { result: ValuationResult | null; onGoToChat: () => void }) {
  if (!result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
          <BarChart2 className="h-6 w-6 text-indigo-500" />
        </div>
        <p className="text-[13px] font-medium text-gray-800 mb-1">No model loaded</p>
        <p className="text-[12px] text-gray-500 mb-5">Switch to Chat to build a DCF or LBO</p>
        <button
          onClick={onGoToChat}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[12px] font-medium hover:bg-indigo-700 transition-colors"
        >
          Start building
        </button>
      </div>
    );
  }

  const a = result.assumptions as Record<string, any>;
  const isDCF = result.valuationType === "dcf";

  const stats = isDCF ? [
    { label: "WACC",          value: fmtPct(a.wacc) },
    { label: "Term. Growth",  value: fmtPct(a.terminalGrowthRate) },
    { label: "EBITDA Margin", value: fmtPct(a.ebitdaMargin) },
    { label: "Forecast",      value: `${a.forecastYears ?? 5} yr` },
    ...(a._enterpriseValue ? [{ label: "Ent. Value", value: fmtLarge(a._enterpriseValue) }] : []),
    ...(a._equityValue     ? [{ label: "Equity Val", value: fmtLarge(a._equityValue)    }] : []),
  ] : [
    { label: "Entry Mult",   value: `${Number(a.entryEbitdaMultiple ?? 0).toFixed(1)}x` },
    { label: "Exit Mult",    value: `${Number(a.exitEbitdaMultiple  ?? 0).toFixed(1)}x` },
    { label: "Leverage",     value: `${Number(a.debtToEbitda ?? 0).toFixed(1)}x` },
    { label: "Hold Period",  value: `${a.holdingPeriodYears ?? 5} yr` },
    ...(a._moic ? [{ label: "MOIC", value: `${Number(a._moic).toFixed(2)}x` }] : []),
    ...(a._irr  ? [{ label: "IRR",  value: fmtPct(a._irr) }] : []),
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {/* Company card */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono font-bold text-[13px] text-gray-900">{result.ticker}</span>
          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 font-semibold">
            {result.valuationType.toUpperCase()}
          </span>
        </div>
        {result.companyName && <p className="text-[11px] text-gray-500">{result.companyName}</p>}
      </div>

      {/* Metrics */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium mb-2">Key Metrics</p>
        <div className="grid grid-cols-2 gap-1.5">
          {stats.map(s => (
            <div key={s.label} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
              <p className="text-[9px] uppercase text-gray-400 mb-0.5">{s.label}</p>
              <p className="font-mono text-[13px] font-semibold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Analyst notes */}
      {a._explanation && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium mb-2">Analyst Notes</p>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-[12px] text-gray-600 leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-4 [&_p]:my-1">
            <ReactMarkdown>{a._explanation}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Download */}
      {result.fileUrl && (
        <a
          href={result.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-medium transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download Excel Model
        </a>
      )}
    </div>
  );
}

// ── Data tab ──────────────────────────────────────────────────────────────────

function DataTab({ result }: { result: ValuationResult | null }) {
  if (!result) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <p className="text-[12px] text-gray-400">Build a model first to see data</p>
      </div>
    );
  }
  const a = result.assumptions as Record<string, any>;
  const hist = (a._historicalIS ?? []) as Array<Record<string, any>>;
  const unit = (a._baseRevenue ?? 0) >= 1e9 ? 1e6 : 1e3;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium mb-3">
        Historical Financials  (SEC EDGAR)
      </p>
      {hist.length === 0 ? (
        <p className="text-[12px] text-gray-400">No historical data available</p>
      ) : (
        <div className="space-y-1.5">
          {hist.map((s: any) => (
            <div key={s.year} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-[10px] text-gray-500 font-medium mb-1">FY{s.year}A</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                <div className="flex justify-between"><span className="text-gray-500">Revenue</span><span className="font-mono font-medium">{fmtLarge(s.revenue)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">EBITDA</span><span className="font-mono font-medium">{fmtLarge(s.ebitda)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">EBIT</span><span className="font-mono font-medium">{fmtLarge(s.ebit)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Net Income</span><span className="font-mono font-medium">{fmtLarge(s.netIncome)}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab() {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium mb-3">Preferences</p>
      <div className="space-y-2">
        {[
          ["Default model type", "DCF"],
          ["Currency", "USD"],
          ["Forecast period", "5 years"],
          ["Mid-year convention", "Enabled"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
            <span className="text-[12px] text-gray-700">{label}</span>
            <span className="text-[11px] font-medium text-gray-500">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[10px] text-gray-400 text-center">AccelNo · Nexus Valuation Engine</p>
    </div>
  );
}

// ── Chat components ───────────────────────────────────────────────────────────

function WelcomeMsg() {
  return (
    <div className="flex items-start gap-2.5 pt-2">
      <Avatar />
      <div className="rounded-2xl rounded-tl-sm bg-gray-100 text-gray-800 text-[12.5px] px-3 py-2 leading-relaxed max-w-[85%]">
        Hello, how can I help?
      </div>
    </div>
  );
}

function MessageRow({
  message,
  onRegenerate,
  isRegenerating,
}: {
  message: ChatMessage;
  onRegenerate?: (msg: string) => void;
  isRegenerating?: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="bg-indigo-600 text-white text-[12.5px] rounded-2xl rounded-tr-sm px-3 py-2 max-w-[82%] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex items-start gap-2.5">
      <Avatar />
      <div className="flex-1 min-w-0">
        {message.type === "loading" && (
          <div className="flex items-center gap-2 text-[12px] text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 shrink-0" />
            {message.content}
          </div>
        )}

        {message.type === "result" && message.resultData && (
          <ResultCard
            result={message.resultData}
            onRegenerate={onRegenerate}
            isRegenerating={isRegenerating}
          />
        )}

        {message.type === "error" && (
          <div className="rounded-xl bg-red-50 border border-red-100 text-red-600 text-[12px] px-3 py-2">
            {message.content}
          </div>
        )}

        {message.type === "text" && (
          <div className="text-[12.5px] text-gray-700 leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  onRegenerate,
  isRegenerating,
}: {
  result: ValuationResult;
  onRegenerate?: (msg: string) => void;
  isRegenerating?: boolean;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const [editMsg, setEditMsg]   = useState("");

  return (
    <div className="space-y-2">
      {/* Action card — matches Image 8 "Built X Tab" style */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-900 text-white px-3 py-2.5 text-[12.5px]">
        <span>
          Built&nbsp;<span className="font-semibold">{result.valuationType.toUpperCase()} model</span>&nbsp;for&nbsp;
          <span className="font-semibold">{result.companyName || result.ticker}</span>
        </span>
        <ArrowUpRight className="h-4 w-4 text-gray-400 shrink-0 ml-2" />
      </div>

      <p className="text-[11px] text-gray-400 pl-0.5">
        Spreadsheet populated ↖ · Download below
      </p>

      {result.fileUrl && (
        <a
          href={result.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download Excel
        </a>
      )}

      {onRegenerate && (
        showEdit ? (
          <div className="flex gap-1.5 mt-1">
            <input
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11.5px] text-gray-800 outline-none focus:border-indigo-400 bg-white"
              placeholder='e.g. "change WACC to 12%"'
              value={editMsg}
              onChange={e => setEditMsg(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && editMsg.trim()) {
                  onRegenerate(editMsg.trim());
                  setEditMsg("");
                  setShowEdit(false);
                }
              }}
            />
            <button onClick={() => setShowEdit(false)} className="text-gray-400 hover:text-gray-600 p-1">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowEdit(true)}
            disabled={isRegenerating}
            className="text-[11.5px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors"
          >
            Adjust assumptions →
          </button>
        )
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return Math.random().toString(36).slice(2, 11);
}

function fmtPct(v: any): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  if (isNaN(n)) return String(v);
  return n > 1 ? `${n.toFixed(1)}%` : `${(n * 100).toFixed(1)}%`;
}

function fmtLarge(v: any): string {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}
