export interface ValuationSession {
  id: string;
  ticker: string;
  company_name: string | null;
  valuation_type: "dcf" | "lbo";
  status: "pending" | "fetching_data" | "generating" | "complete" | "error";
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  type: "text" | "loading" | "result" | "error";
  resultData?: ValuationResult;
}

export interface ValuationResult {
  sessionId: string;
  ticker: string;
  companyName: string;
  valuationType: "dcf" | "lbo";
  fileUrl: string;
  assumptions: Record<string, any>;
}

const API_BASE = "https://nexus-valuation-production.up.railway.app";

function looksLikeTicker(text: string): boolean {
  return /^[A-Z]{1,5}$/.test(text);
}

export async function searchCompany(query: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/valuation/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Failed to search company");
  const data = await res.json();
  const results = data.data || data.results || data;
  if (Array.isArray(results) && results.length > 0) {
    return results[0].ticker || results[0].symbol;
  }
  throw new Error(`No results found for "${query}"`);
}

export async function resolveTickerAndStart(input: string, valuationType: "dcf" | "lbo") {
  let ticker = input.trim();
  if (!looksLikeTicker(ticker)) {
    ticker = await searchCompany(ticker);
  }
  return startValuation(ticker, valuationType);
}

export async function startValuation(ticker: string, valuationType: "dcf" | "lbo") {
  const res = await fetch(`${API_BASE}/api/valuation/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, valuationType }),
  });
  if (!res.ok) throw new Error("Failed to start valuation");
  return res.json();
}

export async function getValuationStatus(sessionId: string) {
  const res = await fetch(`${API_BASE}/api/valuation/status/${sessionId}`);
  if (!res.ok) throw new Error("Failed to get status");
  return res.json();
}

export async function sendChatMessage(sessionId: string, message: string) {
  const res = await fetch(`${API_BASE}/api/valuation/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export function parseUserIntent(message: string): { rawInput: string; type: "dcf" | "lbo" } | null {
  const lower = message.toLowerCase();
  
  const isDCF = /\bdcf\b/.test(lower);
  const isLBO = /\blbo\b/.test(lower);
  if (!isDCF && !isLBO) return null;

  // Try to extract what comes after "for"
  const forMatch = message.match(/for\s+([A-Za-z]+)/i);
  
  // Try all-caps ticker
  const tickerMatch = message.match(/\b([A-Z]{1,5})\b/g)
    ?.filter(w => !["DCF", "LBO", "FOR", "ME", "A", "AN", "THE"].includes(w));

  let rawInput = "";

  if (forMatch) {
    rawInput = forMatch[1];
  } else if (tickerMatch && tickerMatch.length > 0) {
    rawInput = tickerMatch[0];
  }

  if (!rawInput) {
    // Check for known company names
    const words = lower.split(/\s+/);
    for (const word of words) {
      if (!["dcf", "lbo", "for", "me", "a", "an", "the", "make", "build", "run", "do", "create"].includes(word) && word.length > 1) {
        rawInput = word;
        break;
      }
    }
  }

  if (!rawInput) return null;

  return { rawInput, type: isDCF ? "dcf" : "lbo" };
}
