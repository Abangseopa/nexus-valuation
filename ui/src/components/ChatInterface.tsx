import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Home, MessageSquare, Download, TrendingUp, ChevronDown, X } from "lucide-react";
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

type Tab = "home" | "chat";

export function ChatInterface({ onValuationComplete, onStatusUpdate }: ChatInterfaceProps) {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTicker, setActiveTicker] = useState<string>("");
  const [activeResult, setActiveResult] = useState<ValuationResult | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          const res = await getValuationStatus(sessionId);
          const status = res.data?.status || res.status;
          const data = res.data || res;

          const statusLabels: Record<string, string> = {
            pending: "Initialising...",
            fetching_data: `Fetching ${ticker} SEC EDGAR filings...`,
            generating: "Claude is building the model...",
          };

          if (status === "complete") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            setIsPolling(false);

            const result: ValuationResult = {
              sessionId,
              ticker: data.ticker || ticker,
              companyName: data.companyName || data.company_name || ticker,
              valuationType: data.valuationType || data.valuation_type || "dcf",
              fileUrl: data.fileUrl || data.file_url || "",
              assumptions: data.assumptions || {},
            };

            setActiveResult(result);
            updateMessage(loadingMsgId, {
              type: "result",
              content: "Model complete",
              resultData: result,
            });
            onValuationComplete(result);
            setTab("chat");
          } else if (status === "error") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            setIsPolling(false);
            updateMessage(loadingMsgId, {
              type: "error",
              content: data.error || "An error occurred while generating the valuation.",
            });
          } else {
            const label = statusLabels[status] || "Processing...";
            updateMessage(loadingMsgId, { content: label });
            onStatusUpdate?.(label, ticker);
          }
        } catch { /* silently retry */ }
      }, 3000);
    },
    [updateMessage, onValuationComplete, onStatusUpdate]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    setInput("");
    addMessage({ role: "user", content: trimmed, type: "text" });

    if (activeSessionId && !parseUserIntent(trimmed)) {
      const loadingId = addMessage({ role: "assistant", content: "Updating model...", type: "loading" });
      try {
        await sendChatMessage(activeSessionId, trimmed);
        startPolling(activeSessionId, loadingId, activeTicker);
      } catch {
        updateMessage(loadingId, { type: "error", content: "Failed to send message. Please try again." });
      }
      return;
    }

    const intent = parseUserIntent(trimmed);
    if (!intent) {
      addMessage({
        role: "assistant",
        content: "I can build DCF and LBO models for public companies. Try:\n\n• \"Make me a DCF for Apple\"\n• \"Build an LBO for Microsoft\"\n• \"DCF for TSLA\"",
        type: "text",
      });
      return;
    }

    const loadingId = addMessage({ role: "assistant", content: "Starting valuation...", type: "loading" });
    onStatusUpdate?.("Starting valuation...", intent.rawInput.toUpperCase());

    try {
      const res = await resolveTickerAndStart(intent.rawInput, intent.type);
      const sessionId = res.data?.sessionId || res.sessionId;
      const ticker = res.data?.ticker || intent.rawInput.toUpperCase();
      setActiveSessionId(sessionId);
      setActiveTicker(ticker);
      startPolling(sessionId, loadingId, ticker);
    } catch {
      updateMessage(loadingId, { type: "error", content: "Failed to start valuation. Please try again." });
    }
  };

  const handleRegenerate = useCallback(async (message: string) => {
    if (!activeSessionId) return;
    addMessage({ role: "user", content: message, type: "text" });
    const loadingId = addMessage({ role: "assistant", content: "Regenerating model...", type: "loading" });
    try {
      await sendChatMessage(activeSessionId, message);
      startPolling(activeSessionId, loadingId, activeTicker);
    } catch {
      updateMessage(loadingId, { type: "error", content: "Failed to regenerate. Please try again." });
    }
  }, [activeSessionId, activeTicker, addMessage, updateMessage, startPolling]);

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-white">
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-white/10">
        {/* Logo + session row */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <TrendingUp className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-white tracking-tight">AccelNo</span>
          </div>
          {activeTicker && (
            <button className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition-colors">
              {activeTicker}
              <ChevronDown className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          {([["home", "Home", Home], ["chat", "Chat", MessageSquare]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                tab === id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      {tab === "home" ? (
        <HomeTab result={activeResult} onGoToChat={() => setTab("chat")} />
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
            {messages.length === 0 && <WelcomeMessage />}
            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onRegenerate={msg.type === "result" ? handleRegenerate : undefined}
                isRegenerating={isPolling}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-white/10 px-3 py-3">
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 focus-within:border-blue-500/50 transition-colors">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={isPolling ? "Building model..." : "Ask me to build a DCF or LBO..."}
                  disabled={isPolling}
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-500 outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isPolling}
                  className="flex items-center justify-center w-7 h-7 rounded bg-blue-600 text-white disabled:opacity-30 hover:bg-blue-500 transition-colors shrink-0"
                >
                  {isPolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[9px] text-gray-600 text-center mt-1.5">
                AI-generated models. Verify before use.
              </p>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

// ── Home tab ──────────────────────────────────────────────────────────────────

function HomeTab({ result, onGoToChat }: { result: ValuationResult | null; onGoToChat: () => void }) {
  if (!result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center mb-3">
          <TrendingUp className="h-5 w-5 text-blue-400" />
        </div>
        <p className="text-sm font-medium text-white mb-1">No model loaded</p>
        <p className="text-xs text-gray-500 mb-4">Switch to Chat to build a DCF or LBO</p>
        <button onClick={onGoToChat} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors">
          Start building
        </button>
      </div>
    );
  }

  const a = result.assumptions as Record<string, any>;
  const isDCF = result.valuationType === "dcf";

  const stats = isDCF ? [
    { label: "WACC", value: fmtPct(a.wacc) },
    { label: "Term. Growth", value: fmtPct(a.terminalGrowthRate) },
    { label: "EBITDA Margin", value: fmtPct(a.ebitdaMargin) },
    { label: "Forecast Years", value: String(a.forecastYears ?? 5) },
    ...(a._enterpriseValue ? [{ label: "Enterprise Value", value: fmtLarge(a._enterpriseValue) }] : []),
    ...(a._equityValue    ? [{ label: "Equity Value",      value: fmtLarge(a._equityValue)    }] : []),
  ] : [
    { label: "Entry Multiple", value: `${Number(a.entryEbitdaMultiple ?? 0).toFixed(1)}x` },
    { label: "Exit Multiple",  value: `${Number(a.exitEbitdaMultiple  ?? 0).toFixed(1)}x` },
    { label: "Leverage",       value: `${Number(a.debtToEbitda ?? 0).toFixed(1)}x` },
    { label: "Holding Period", value: `${a.holdingPeriodYears ?? 5}y` },
    ...(a._moic ? [{ label: "MOIC", value: `${Number(a._moic).toFixed(1)}x` }] : []),
    ...(a._irr  ? [{ label: "IRR",  value: fmtPct(a._irr)  }] : []),
  ];

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
      {/* Company header */}
      <div className="rounded-lg bg-white/5 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono font-bold text-sm text-white">{result.ticker}</span>
          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-400 font-semibold">
            {result.valuationType.toUpperCase()}
          </span>
        </div>
        {result.companyName && <p className="text-xs text-gray-400">{result.companyName}</p>}
      </div>

      {/* Key stats grid */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Key Metrics</p>
        <div className="grid grid-cols-2 gap-1.5">
          {stats.map(s => (
            <div key={s.label} className="rounded bg-white/5 px-2.5 py-2">
              <p className="text-[9px] uppercase text-gray-500 mb-0.5">{s.label}</p>
              <p className="font-mono text-sm font-semibold text-white">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Explanation */}
      {a._explanation && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Analyst Notes</p>
          <div className="rounded-lg bg-white/5 p-3 text-xs text-gray-300 leading-relaxed prose prose-invert prose-xs max-w-none [&_ul]:list-disc [&_ul]:pl-4 [&_p]:my-1">
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
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download Excel Model
        </a>
      )}
    </div>
  );
}

// ── Chat sub-components ───────────────────────────────────────────────────────

function WelcomeMessage() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <p className="text-xs text-gray-500 max-w-[200px] leading-relaxed">
        Ask me to build a DCF or LBO for any public company.
      </p>
      <div className="mt-3 space-y-1">
        {["DCF for Apple", "LBO for Microsoft", "DCF for TSLA"].map(t => (
          <div key={t} className="px-2.5 py-1 rounded bg-white/5 text-[10px] text-gray-400 font-mono">
            "{t}"
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onRegenerate,
  isRegenerating,
}: {
  message: ChatMessage;
  onRegenerate?: (msg: string) => void;
  isRegenerating?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? "bg-blue-600 text-white"
            : message.type === "error"
            ? "bg-red-900/30 text-red-300 border border-red-700/30"
            : "bg-white/5 text-gray-200"
        }`}
      >
        {message.type === "loading" && (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-blue-400 shrink-0" />
            <span className="text-gray-400">{message.content}</span>
          </div>
        )}

        {message.type === "result" && message.resultData && (
          <ResultCard result={message.resultData} onRegenerate={onRegenerate} isRegenerating={isRegenerating} />
        )}

        {(message.type === "text" || message.type === "error") && (
          <div className="whitespace-pre-wrap">{message.content}</div>
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
  const [editMsg, setEditMsg] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded bg-emerald-600/30 flex items-center justify-center">
          <span className="text-[8px]">✓</span>
        </div>
        <span className="text-emerald-400 font-medium text-[11px]">
          Built {result.valuationType.toUpperCase()} model for {result.companyName || result.ticker}
        </span>
      </div>
      <p className="text-gray-400 text-[10px]">Spreadsheet populated ↖ · Download Excel below</p>

      {result.fileUrl && (
        <a
          href={result.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-emerald-700/30 text-emerald-400 text-[10px] font-medium hover:bg-emerald-700/50 transition-colors"
        >
          <Download className="h-3 w-3" />
          Download Excel
        </a>
      )}

      {onRegenerate && (
        <div>
          {showEdit ? (
            <div className="flex gap-1">
              <input
                className="flex-1 bg-white/5 text-white text-[10px] rounded px-2 py-1 outline-none border border-white/10 focus:border-blue-500"
                placeholder="e.g. change WACC to 12%"
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
              <button onClick={() => setShowEdit(false)} className="text-gray-500 hover:text-white">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowEdit(true)}
              disabled={isRegenerating}
              className="text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
            >
              Adjust assumptions →
            </button>
          )}
        </div>
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
