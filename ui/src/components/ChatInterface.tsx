import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";

import {
  ChatMessage,
  ValuationResult,
  resolveTickerAndStart,
  getValuationStatus,
  sendChatMessage,
  parseUserIntent,
} from "@/lib/valuation-api";
import { ValuationResultCard } from "./ValuationResultCard";

interface ChatInterfaceProps {
  onValuationComplete: () => void;
}

export function ChatInterface({ onValuationComplete }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const addMessage = useCallback((msg: Omit<ChatMessage, "id">) => {
    const newMsg = { ...msg, id: genId() };
    setMessages((prev) => [...prev, newMsg]);
    return newMsg.id;
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
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

          const statusMessages: Record<string, string> = {
            pending: "Initialising...",
            fetching_data: `Fetching SEC EDGAR filings for ${ticker}...`,
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

            updateMessage(loadingMsgId, {
              type: "result",
              content: "Valuation complete!",
              resultData: result,
            });

            onValuationComplete();
          } else if (status === "error") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            setIsPolling(false);

            updateMessage(loadingMsgId, {
              type: "error",
              content: data.error || "An error occurred while generating the valuation.",
            });
          } else {
            updateMessage(loadingMsgId, {
              content: statusMessages[status] || "Processing...",
            });
          }
        } catch {
          // Silently retry
        }
      }, 3000);
    },
    [updateMessage, onValuationComplete]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    setInput("");
    addMessage({ role: "user", content: trimmed, type: "text" });

    // Check if it's a follow-up on an active session
    if (activeSessionId && !parseUserIntent(trimmed)) {
      const loadingId = addMessage({
        role: "assistant",
        content: "Updating model...",
        type: "loading",
      });

      try {
        await sendChatMessage(activeSessionId, trimmed);
        startPolling(activeSessionId, loadingId, "");
      } catch {
        updateMessage(loadingId, {
          type: "error",
          content: "Failed to send message. Please try again.",
        });
      }
      return;
    }

    // Parse new valuation request
    const intent = parseUserIntent(trimmed);
    if (!intent) {
      addMessage({
        role: "assistant",
        content:
          "I can build DCF and LBO models for public companies. Try something like:\n\n• \"Make me a DCF for Apple\"\n• \"Build an LBO for Microsoft\"\n• \"DCF for TSLA\"",
        type: "text",
      });
      return;
    }

    const loadingId = addMessage({
      role: "assistant",
      content: "Starting valuation...",
      type: "loading",
    });

    try {
      const res = await resolveTickerAndStart(intent.rawInput, intent.type);
      const sessionId = res.data?.sessionId || res.sessionId;
      const resolvedTicker = res.data?.ticker || intent.rawInput.toUpperCase();
      setActiveSessionId(sessionId);
      startPolling(sessionId, loadingId, resolvedTicker);
    } catch {
      updateMessage(loadingId, {
        type: "error",
        content: "Failed to start valuation. Please try again.",
      });
    }
  };

  const handleRegenerate = useCallback(
    async (message: string) => {
      if (!activeSessionId) return;

      addMessage({ role: "user", content: message, type: "text" });

      const loadingId = addMessage({
        role: "assistant",
        content: "Regenerating model...",
        type: "loading",
      });

      try {
        await sendChatMessage(activeSessionId, message);
        startPolling(activeSessionId, loadingId, "");
      } catch {
        updateMessage(loadingId, {
          type: "error",
          content: "Failed to regenerate. Please try again.",
        });
      }
    },
    [activeSessionId, addMessage, updateMessage, startPolling]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {messages.length === 0 && <WelcomeMessage />}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onRegenerate={msg.type === "result" ? handleRegenerate : undefined}
              isRegenerating={isPolling}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-4">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50 transition-colors">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isPolling ? "Wait for current valuation..." : "Ask me to build a DCF or LBO..."}
              disabled={isPolling}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isPolling}
              className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground disabled:opacity-30 hover:bg-primary/90 transition-colors"
            >
              {isPolling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            Nexus Valuation uses AI to generate financial models. Always verify outputs independently.
          </p>
        </form>
      </div>
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-4">
        <span className="text-xl">📊</span>
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">Welcome to Nexus Valuation</h2>
      <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
        Ask me to build a DCF or LBO for any public company.
      </p>
      <div className="mt-4 space-y-1.5">
        <ExampleChip text="Make me a DCF for Apple" />
        <ExampleChip text="Build an LBO for Microsoft" />
        <ExampleChip text="DCF for TSLA" />
      </div>
    </div>
  );
}

function ExampleChip({ text }: { text: string }) {
  return (
    <div className="inline-block px-3 py-1.5 rounded-md bg-secondary text-xs text-secondary-foreground font-mono">
      "{text}"
    </div>
  );
}

function MessageBubble({ message, onRegenerate, isRegenerating }: { message: ChatMessage; onRegenerate?: (message: string) => void; isRegenerating?: boolean }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-lg rounded-lg px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : message.type === "error"
            ? "bg-destructive/10 text-destructive border border-destructive/20"
            : "bg-card border border-border text-card-foreground"
        }`}
      >
        {message.type === "loading" && (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>{message.content}</span>
          </div>
        )}

        {message.type === "result" && message.resultData && (
          <ValuationResultCard
            result={message.resultData}
            onRegenerate={onRegenerate}
            isRegenerating={isRegenerating}
          />
        )}

        {(message.type === "text" || message.type === "error") && (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
      </div>
    </div>
  );
}

function genId() {
  return Math.random().toString(36).slice(2, 11);
}
