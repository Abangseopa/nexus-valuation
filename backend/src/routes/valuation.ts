import { Router, Request, Response } from 'express';
import type {
  StartValuationRequest,
  ChatMessageRequest,
  ApiResponse,
  ValuationSession,
} from '../types';
import { createSession, getSession, updateSession, uploadExcelFile } from '../services/supabase';
import { getFinancialData } from '../services/sec';
import { generateAssumptions, updateAssumptionsFromChat, explainAssumptions } from '../services/claude';
import { runDCF, runLBO } from '../services/valuation';
import { buildDCFExcel, buildLBOExcel } from '../services/excel';
import type { DCFAssumptions, LBOAssumptions } from '../types';

const router = Router();


// ─── GET /api/valuation/search?q=chipotle ────────────────────────────────────
// Resolves a company name or partial ticker to matching tickers.
// Lovable calls this before /start so "chipotle" → CMG.

router.get('/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) {
    return res.status(400).json({ success: false, error: 'q must be at least 2 characters' } satisfies ApiResponse);
  }

  try {
    const axios = (await import('axios')).default;
    const { data } = await axios.get('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'NexusValuation research@nexusvaluation.com' },
      timeout: 10_000,
    });

    const entries = Object.values(data) as Array<{ cik_str: number; ticker: string; title: string }>;

    // Match against ticker (exact prefix) OR company name (contains)
    const results = entries
      .filter(e =>
        e.ticker.toLowerCase().startsWith(q) ||
        e.title.toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map(e => ({ ticker: e.ticker, name: e.title }));

    return res.json({ success: true, data: results } satisfies ApiResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message } satisfies ApiResponse);
  }
});


// ─── POST /api/valuation/start ────────────────────────────────────────────────
// Kick off a new valuation.
// Returns the session ID immediately — processing happens in the background.
// The UI should start polling /status/:id right away.
//
// Body: { ticker: string, valuationType: "dcf" | "lbo", customAssumptions?: {} }

router.post('/start', async (req: Request, res: Response) => {
  const { ticker, valuationType, customAssumptions = {} } =
    req.body as StartValuationRequest;

  if (!ticker || !valuationType) {
    return res.status(400).json({
      success: false,
      error: 'ticker and valuationType are required',
    } satisfies ApiResponse);
  }

  if (!['dcf', 'lbo'].includes(valuationType)) {
    return res.status(400).json({
      success: false,
      error: 'valuationType must be "dcf" or "lbo"',
    } satisfies ApiResponse);
  }

  // Create the session row in Supabase (status: 'pending')
  const session = await createSession(
    ticker.toUpperCase(),
    '',            // company name filled in once we have SEC data
    valuationType
  );

  // Fire off background processing — do NOT await, return to client immediately
  runValuationPipeline(session.id, ticker.toUpperCase(), valuationType, customAssumptions)
    .catch(err => console.error(`[pipeline] session ${session.id} failed:`, err));

  return res.status(202).json({
    success: true,
    data: { sessionId: session.id, status: 'pending' },
  } satisfies ApiResponse<{ sessionId: string; status: string }>);
});


// ─── GET /api/valuation/status/:id ───────────────────────────────────────────
// Poll this every 2–3 seconds from the UI.
// Returns the full session object so the UI can show status + explanation.

router.get('/status/:id', async (req: Request, res: Response) => {
  const session = await getSession(String(req.params.id));

  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found',
    } satisfies ApiResponse);
  }

  return res.json({ success: true, data: session } satisfies ApiResponse<ValuationSession>);
});


// ─── POST /api/valuation/chat ─────────────────────────────────────────────────
// Let the user tweak assumptions via natural language.
// Regenerates the Excel file with updated assumptions.
//
// Body: { sessionId: string, message: string }
// e.g. { sessionId: "...", message: "change WACC to 10% and be more aggressive on growth" }

router.post('/chat', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body as ChatMessageRequest;

  if (!sessionId || !message) {
    return res.status(400).json({
      success: false,
      error: 'sessionId and message are required',
    } satisfies ApiResponse);
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse);
  }
  if (session.status !== 'complete') {
    return res.status(409).json({
      success: false,
      error: 'Session must be complete before adjusting assumptions',
    } satisfies ApiResponse);
  }
  if (!session.assumptions) {
    return res.status(409).json({ success: false, error: 'No assumptions to update' } satisfies ApiResponse);
  }

  // Mark as regenerating so the UI can show a spinner
  await updateSession(sessionId, { status: 'generating' });

  // Fire off re-generation in background
  regenerateWithUpdatedAssumptions(session, message)
    .catch(err => console.error(`[chat] session ${sessionId} regen failed:`, err));

  return res.json({
    success: true,
    data: { sessionId, status: 'generating' },
  } satisfies ApiResponse<{ sessionId: string; status: string }>);
});


// ─── GET /api/valuation/download/:id ─────────────────────────────────────────
// Returns a fresh signed URL (1 hour expiry).
// Lovable calls this when the user clicks "Download Excel".

router.get('/download/:id', async (req: Request, res: Response) => {
  const dlSession = await getSession(String(req.params.id));

  if (!dlSession) {
    return res.status(404).json({ success: false, error: 'Session not found' } satisfies ApiResponse);
  }
  if (dlSession.status !== 'complete' || !dlSession.fileUrl) {
    return res.status(409).json({
      success: false,
      error: 'Valuation not yet complete',
    } satisfies ApiResponse);
  }

  return res.json({
    success: true,
    data: { fileUrl: dlSession.fileUrl },
  } satisfies ApiResponse<{ fileUrl: string }>);
});


// ─── GET /api/valuation/sessions ─────────────────────────────────────────────
// List of recent sessions — useful for the UI's history panel.

router.get('/sessions', async (_req: Request, res: Response) => {
  // We query Supabase directly for a lightweight list
  const { default: supabase } = await import('../services/supabase');

  const { data, error } = await supabase
    .from('valuation_sessions')
    .select('id, ticker, company_name, valuation_type, status, created_at, file_url')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return res.status(500).json({ success: false, error: error.message } satisfies ApiResponse);
  }

  return res.json({ success: true, data } satisfies ApiResponse);
});


// ════════════════════════════════════════════════════════════════════════════════
// Background pipeline — runs after the HTTP response is sent
// ════════════════════════════════════════════════════════════════════════════════

async function runValuationPipeline(
  sessionId: string,
  ticker: string,
  valuationType: 'dcf' | 'lbo',
  customAssumptions: Record<string, unknown>
): Promise<void> {
  try {
    // ── Step 1: Fetch SEC data ────────────────────────────────────────────────
    await updateSession(sessionId, { status: 'fetching_data' });
    const financialData = await getFinancialData(ticker);
    await updateSession(sessionId, { companyName: financialData.company.name });

    // ── Step 2: Generate assumptions via Claude ───────────────────────────────
    await updateSession(sessionId, { status: 'generating' });
    const assumptions = await generateAssumptions(financialData, valuationType, customAssumptions);

    // ── Step 3: Run the valuation model ──────────────────────────────────────
    let excelBuffer: Buffer;
    let modelExtras: Record<string, any> = {};

    // ── Derive metrics from SEC historical data ───────────────────────────────
    const stmts  = financialData.incomeStatements;
    const latestBS = financialData.balanceSheets.at(-1);
    const latestIS = stmts.at(-1);

    const avgGrossMarginPct = stmts.filter(s => s.revenue > 0 && s.grossProfit > 0)
      .reduce((acc, s, _, arr) => acc + s.grossProfit / s.revenue / arr.length, 0) || 0;

    const avgInterestExpensePct = stmts.filter(s => s.revenue > 0 && s.interestExpense > 0)
      .reduce((acc, s, _, arr) => acc + s.interestExpense / s.revenue / arr.length, 0) || 0;

    // Full historical IS rows — stored as JSON so the browser can render historical columns
    const historicalIS = stmts.map(s => ({
      year:            s.year,
      revenue:         s.revenue,
      costOfRevenue:   s.costOfRevenue,
      grossProfit:     s.grossProfit,
      ebitda:          s.ebitda,
      ebit:            s.ebit,
      netIncome:       s.netIncome,
      interestExpense: s.interestExpense,
      taxExpense:      s.taxExpense,
      da:              s.depreciationAmortization,
      operatingExpenses: s.operatingExpenses,
    }));

    const historicalExtras = {
      _grossMarginPct:       avgGrossMarginPct,
      _interestExpensePct:   avgInterestExpensePct,
      _baseNetIncome:        latestIS?.netIncome   ?? 0,
      _baseCash:             latestBS?.cash        ?? 0,
      _baseTotalDebt:        latestBS?.totalDebt   ?? 0,
      _baseEBITDA:           latestIS?.ebitda      ?? 0,
      _baseEBIT:             latestIS?.ebit        ?? 0,
      _historicalIS:         historicalIS,          // full rows for historical columns
    };

    if (valuationType === 'dcf') {
      const result = runDCF(financialData, assumptions as DCFAssumptions);
      excelBuffer  = await buildDCFExcel(financialData, result);
      modelExtras = {
        _baseRevenue:      result.baseRevenue,
        _enterpriseValue:  result.enterpriseValue,
        _equityValue:      result.equityValue,
        _netDebt:          result.netDebt,
        _terminalValue:    result.terminalValue,
        _pvTerminalValue:  result.pvTerminalValue,
        ...historicalExtras,
      };
    } else {
      const result = runLBO(financialData, assumptions as LBOAssumptions);
      excelBuffer  = await buildLBOExcel(financialData, result);
      modelExtras = {
        _baseRevenue: financialData.incomeStatements.at(-1)?.revenue ?? 0,
        _moic:        result.moic,
        _irr:         result.irr,
        _entryEquity: result.entryEquity,
        _exitEquity:  result.exitEquity,
        _entryDebt:   result.entryDebt,
        ...historicalExtras,
      };
    }

    // ── Step 4: Upload Excel to Supabase Storage ──────────────────────────────
    const { filePath, fileUrl } = await uploadExcelFile(sessionId, ticker, excelBuffer);

    // ── Step 5: Generate explanation for the chat UI ─────────────────────────
    // (Fire and forget — explanation is a nice-to-have, not blocking)
    const explanation = await explainAssumptions(financialData, assumptions, valuationType)
      .catch(() => '');

    // ── Step 6: Mark complete ────────────────────────────────────────────────
    // Stash explanation + model output numbers so the browser spreadsheet can render without re-fetching.
    const assumptionsWithExplanation = { ...assumptions, _explanation: explanation, ...modelExtras } as unknown as typeof assumptions;
    await updateSession(sessionId, {
      status: 'complete',
      assumptions: assumptionsWithExplanation,
      filePath,
      fileUrl,
    });

    console.log(`[pipeline] session ${sessionId} complete — ${ticker} ${valuationType.toUpperCase()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] session ${sessionId} error: ${message}`);
    await updateSession(sessionId, { status: 'error', errorMessage: message });
  }
}


async function regenerateWithUpdatedAssumptions(
  session: ValuationSession,
  userMessage: string
): Promise<void> {
  try {
    const financialData = await getFinancialData(session.ticker);

    // Strip internal underscore fields before passing to Claude
    const currentAssumptions = { ...session.assumptions } as Record<string, unknown>;
    for (const k of Object.keys(currentAssumptions)) {
      if (k.startsWith('_')) delete currentAssumptions[k];
    }

    const updatedAssumptions = await updateAssumptionsFromChat(
      currentAssumptions as unknown as DCFAssumptions | LBOAssumptions,
      session.valuationType,
      userMessage
    );

    let excelBuffer: Buffer;
    let modelExtras: Record<string, any> = {};

    const stmtsR   = financialData.incomeStatements;
    const latestBSR = financialData.balanceSheets.at(-1);
    const latestISR = stmtsR.at(-1);
    const histExtrasR = {
      _grossMarginPct:     stmtsR.filter(s => s.revenue > 0 && s.grossProfit > 0).reduce((a, s, _, arr) => a + s.grossProfit / s.revenue / arr.length, 0) || 0,
      _interestExpensePct: stmtsR.filter(s => s.revenue > 0 && s.interestExpense > 0).reduce((a, s, _, arr) => a + s.interestExpense / s.revenue / arr.length, 0) || 0,
      _baseNetIncome:  latestISR?.netIncome ?? 0,
      _baseCash:       latestBSR?.cash     ?? 0,
      _baseTotalDebt:  latestBSR?.totalDebt ?? 0,
      _baseEBITDA:     latestISR?.ebitda   ?? 0,
      _baseEBIT:       latestISR?.ebit     ?? 0,
      _historicalIS:   stmtsR.map(s => ({
        year: s.year, revenue: s.revenue, costOfRevenue: s.costOfRevenue,
        grossProfit: s.grossProfit, ebitda: s.ebitda, ebit: s.ebit,
        netIncome: s.netIncome, interestExpense: s.interestExpense,
        taxExpense: s.taxExpense, da: s.depreciationAmortization,
        operatingExpenses: s.operatingExpenses,
      })),
    };

    if (session.valuationType === 'dcf') {
      const result = runDCF(financialData, updatedAssumptions as DCFAssumptions);
      excelBuffer  = await buildDCFExcel(financialData, result);
      modelExtras  = {
        _baseRevenue:     result.baseRevenue,
        _enterpriseValue: result.enterpriseValue,
        _equityValue:     result.equityValue,
        _netDebt:         result.netDebt,
        _terminalValue:   result.terminalValue,
        _pvTerminalValue: result.pvTerminalValue,
        ...histExtrasR,
      };
    } else {
      const result = runLBO(financialData, updatedAssumptions as LBOAssumptions);
      excelBuffer  = await buildLBOExcel(financialData, result);
      modelExtras  = {
        _baseRevenue: financialData.incomeStatements.at(-1)?.revenue ?? 0,
        _moic:        result.moic,
        _irr:         result.irr,
        _entryEquity: result.entryEquity,
        _exitEquity:  result.exitEquity,
        _entryDebt:   result.entryDebt,
        ...histExtrasR,
      };
    }

    const { filePath, fileUrl } = await uploadExcelFile(session.id, session.ticker, excelBuffer);
    const explanation = await explainAssumptions(financialData, updatedAssumptions, session.valuationType)
      .catch(() => '');

    const updatedWithExplanation = { ...updatedAssumptions, _explanation: explanation, ...modelExtras } as unknown as typeof updatedAssumptions;
    await updateSession(session.id, {
      status: 'complete',
      assumptions: updatedWithExplanation,
      filePath,
      fileUrl,
    });

    console.log(`[chat] session ${session.id} regenerated`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSession(session.id, { status: 'error', errorMessage: message });
  }
}

export default router;
