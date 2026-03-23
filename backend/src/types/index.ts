// ─── Valuation Types ─────────────────────────────────────────────────────────

export type ValuationType = 'dcf' | 'lbo';

export type SessionStatus =
  | 'pending'       // just created
  | 'fetching_data' // pulling SEC data
  | 'generating'    // Claude is building the model
  | 'complete'      // Excel ready for download
  | 'error';

// ─── SEC / Financial Data ─────────────────────────────────────────────────────

export interface CompanyInfo {
  ticker: string;
  name: string;
  cik: string;       // SEC Central Index Key — unique company ID
  sic: string;       // Standard Industry Classification code
}

export interface IncomeStatement {
  year: number;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  ebit: number;        // Earnings Before Interest & Tax
  ebitda: number;      // EBIT + D&A
  netIncome: number;
  interestExpense: number;
  taxExpense: number;
  depreciationAmortization: number;
}

export interface BalanceSheet {
  year: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cash: number;
  totalDebt: number;
  workingCapital: number;
}

export interface CashFlowStatement {
  year: number;
  operatingCashFlow: number;
  capitalExpenditures: number;
  freeCashFlow: number;
}

export interface FinancialData {
  company: CompanyInfo;
  incomeStatements: IncomeStatement[];   // last 3–5 years, oldest first
  balanceSheets: BalanceSheet[];
  cashFlows: CashFlowStatement[];
}

// ─── Valuation Assumptions ────────────────────────────────────────────────────

export interface DCFAssumptions {
  revenueGrowthRates: number[];   // one per forecast year, e.g. [0.08, 0.07, 0.06, 0.05, 0.05]
  ebitdaMargin: number;           // e.g. 0.30
  taxRate: number;                // e.g. 0.21
  capexAsPercentOfRevenue: number;
  nwcAsPercentOfRevenue: number;  // net working capital
  terminalGrowthRate: number;     // e.g. 0.025
  wacc: number;                   // weighted avg cost of capital
  forecastYears: number;          // typically 5
}

export interface LBOAssumptions {
  purchasePrice: number;          // enterprise value paid
  entryEbitdaMultiple: number;
  exitEbitdaMultiple: number;
  holdingPeriodYears: number;
  debtToEbitda: number;           // leverage at entry
  interestRate: number;
  revenueGrowthRates: number[];
  ebitdaMargin: number;
  taxRate: number;
  capexAsPercentOfRevenue: number;
}

// ─── Session (persisted in Supabase) ─────────────────────────────────────────

export interface ValuationSession {
  id: string;
  ticker: string;
  companyName: string;
  valuationType: ValuationType;
  status: SessionStatus;
  assumptions: DCFAssumptions | LBOAssumptions | null;
  filePath: string | null;        // Supabase Storage path
  fileUrl: string | null;         // Signed download URL when ready
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── API Request / Response shapes ───────────────────────────────────────────

export interface StartValuationRequest {
  ticker: string;
  valuationType: ValuationType;
  customAssumptions?: Partial<DCFAssumptions> | Partial<LBOAssumptions>;
}

export interface ChatMessageRequest {
  sessionId: string;
  message: string;   // e.g. "change wacc to 10%"
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
