import { createClient } from '@supabase/supabase-js';
import type { ValuationSession, FinancialData } from '../types';

// ─── Client ───────────────────────────────────────────────────────────────────
// We use the service role key here (backend only — never expose this to the browser).
// The service role bypasses Row Level Security so the API can read/write freely.

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default supabase;


// ─── Sessions ─────────────────────────────────────────────────────────────────

/** Create a new session row and return it. */
export async function createSession(
  ticker: string,
  companyName: string,
  valuationType: 'dcf' | 'lbo'
): Promise<ValuationSession> {
  const { data, error } = await supabase
    .from('valuation_sessions')
    .insert({ ticker, company_name: companyName, valuation_type: valuationType })
    .select()
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return toSession(data);
}

/** Fetch a session by ID. */
export async function getSession(id: string): Promise<ValuationSession | null> {
  const { data, error } = await supabase
    .from('valuation_sessions')
    .select()
    .eq('id', id)
    .single();

  if (error) return null;
  return toSession(data);
}

/** Partial update — pass only the fields you want to change. */
export async function updateSession(
  id: string,
  patch: Partial<{
    status: ValuationSession['status'];
    companyName: string;
    assumptions: ValuationSession['assumptions'];
    filePath: string;
    fileUrl: string;
    errorMessage: string;
  }>
): Promise<void> {
  // Map camelCase → snake_case for Supabase
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined)      row.status = patch.status;
  if (patch.companyName !== undefined) row.company_name = patch.companyName;
  if (patch.assumptions !== undefined) row.assumptions = patch.assumptions;
  if (patch.filePath !== undefined)    row.file_path = patch.filePath;
  if (patch.fileUrl !== undefined)     row.file_url = patch.fileUrl;
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;

  const { error } = await supabase
    .from('valuation_sessions')
    .update(row)
    .eq('id', id);

  if (error) throw new Error(`Failed to update session ${id}: ${error.message}`);
}


// ─── SEC Cache ────────────────────────────────────────────────────────────────

const CACHE_TTL_HOURS = 24;

/** Return cached financial data for a ticker if fresh, otherwise null. */
export async function getCachedFinancials(ticker: string): Promise<FinancialData | null> {
  const { data, error } = await supabase
    .from('sec_cache')
    .select()
    .eq('ticker', ticker.toUpperCase())
    .single();

  if (error || !data) return null;

  const ageHours = (Date.now() - new Date(data.cached_at).getTime()) / 1000 / 3600;
  if (ageHours > CACHE_TTL_HOURS) return null;

  return data.financial_data as FinancialData;
}

/** Upsert financial data into the cache. */
export async function setCachedFinancials(
  ticker: string,
  cik: string,
  companyName: string,
  financialData: FinancialData
): Promise<void> {
  const { error } = await supabase
    .from('sec_cache')
    .upsert({
      ticker: ticker.toUpperCase(),
      cik,
      company_name: companyName,
      financial_data: financialData,
      cached_at: new Date().toISOString(),
    });

  if (error) throw new Error(`Failed to cache SEC data: ${error.message}`);
}


// ─── File Storage ─────────────────────────────────────────────────────────────

/**
 * Upload an Excel file buffer to Supabase Storage.
 * Returns a signed URL valid for 1 hour (enough for the user to download).
 */
export async function uploadExcelFile(
  sessionId: string,
  ticker: string,
  buffer: Buffer
): Promise<{ filePath: string; fileUrl: string }> {
  const filePath = `${ticker.toUpperCase()}/${sessionId}.xlsx`;

  const { error: uploadError } = await supabase.storage
    .from('valuation-files')
    .upload(filePath, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true,
    });

  if (uploadError) throw new Error(`Failed to upload Excel: ${uploadError.message}`);

  // Signed URL expires in 1 hour — regenerate on demand if needed
  const { data: signedData, error: signError } = await supabase.storage
    .from('valuation-files')
    .createSignedUrl(filePath, 3600);

  if (signError || !signedData) throw new Error(`Failed to create signed URL: ${signError?.message}`);

  return { filePath, fileUrl: signedData.signedUrl };
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(row: any): ValuationSession {
  return {
    id: row.id,
    ticker: row.ticker,
    companyName: row.company_name,
    valuationType: row.valuation_type,
    status: row.status,
    assumptions: row.assumptions ?? null,
    filePath: row.file_path ?? null,
    fileUrl: row.file_url ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
