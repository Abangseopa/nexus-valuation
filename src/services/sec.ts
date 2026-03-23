import axios from 'axios';
import type {
  CompanyInfo,
  FinancialData,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
} from '../types';
import { getCachedFinancials, setCachedFinancials } from './supabase';

// ─── SEC API Config ───────────────────────────────────────────────────────────
// SEC requires a descriptive User-Agent or they'll block you (fair-use policy).
// Format: "Company/App contact@email.com"

const SEC_HEADERS = {
  'User-Agent': 'NexusValuation research@nexusvaluation.com',
  'Accept-Encoding': 'gzip, deflate',
};

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const FACTS_BASE  = 'https://data.sec.gov/api/xbrl/companyfacts';


// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Main function called by the valuation engine.
 * Checks Supabase cache first; fetches from SEC if stale.
 */
export async function getFinancialData(ticker: string): Promise<FinancialData> {
  const upper = ticker.toUpperCase();

  // 1. Try cache
  const cached = await getCachedFinancials(upper);
  if (cached) {
    console.log(`[SEC] Cache hit for ${upper}`);
    return cached;
  }

  // 2. Resolve ticker → CIK
  console.log(`[SEC] Resolving CIK for ${upper}...`);
  const company = await resolveCIK(upper);

  // 3. Fetch all financial facts from SEC
  console.log(`[SEC] Fetching facts for ${upper} (CIK: ${company.cik})...`);
  const facts = await fetchFacts(company.cik);

  // 4. Parse into structured FinancialData
  const financialData = parseFacts(company, facts);

  // 5. Store in cache
  await setCachedFinancials(upper, company.cik, company.name, financialData);

  return financialData;
}


// ─── Step 1: Ticker → CIK ─────────────────────────────────────────────────────

async function resolveCIK(ticker: string): Promise<CompanyInfo> {
  const { data } = await axios.get(TICKERS_URL, { headers: SEC_HEADERS });

  // The JSON is an object keyed by index: { "0": { cik_str, ticker, title }, ... }
  const entries = Object.values(data) as Array<{
    cik_str: number;
    ticker: string;
    title: string;
  }>;

  const match = entries.find(e => e.ticker.toUpperCase() === ticker);
  if (!match) throw new Error(`Ticker "${ticker}" not found in SEC database`);

  // CIK must be zero-padded to 10 digits for the facts API
  const cik = String(match.cik_str).padStart(10, '0');

  return {
    ticker,
    name: match.title,
    cik,
    sic: '', // SIC comes from the facts payload; we'll leave blank for now
  };
}


// ─── Step 2: Fetch raw XBRL facts ─────────────────────────────────────────────

async function fetchFacts(cik: string): Promise<XBRLFacts> {
  const url = `${FACTS_BASE}/CIK${cik}.json`;
  const { data } = await axios.get(url, {
    headers: SEC_HEADERS,
    timeout: 30_000, // SEC can be slow — 30s timeout
  });
  return data.facts['us-gaap'] ?? {};
}


// ─── Step 3: Parse facts into our types ───────────────────────────────────────

function parseFacts(company: CompanyInfo, facts: XBRLFacts): FinancialData {
  // Extract annual figures for each concept we need
  // getAnnual() tries multiple XBRL tag names because companies differ

  const revenue  = getAnnual(facts, REVENUE_TAGS);
  const netIncome = getAnnual(facts, NET_INCOME_TAGS);
  const cogs     = getAnnual(facts, COGS_TAGS);
  const opex     = getAnnual(facts, OPEX_TAGS);
  const da       = getAnnual(facts, DA_TAGS);
  const interest = getAnnual(facts, INTEREST_TAGS);
  const tax      = getAnnual(facts, TAX_TAGS);

  const totalAssets  = getAnnual(facts, TOTAL_ASSETS_TAGS);
  const totalLiab    = getAnnual(facts, TOTAL_LIAB_TAGS);
  const totalEquity  = getAnnual(facts, EQUITY_TAGS);
  const cash         = getAnnual(facts, CASH_TAGS);
  const longTermDebt = getAnnual(facts, LT_DEBT_TAGS);
  const shortTermDebt = getAnnual(facts, ST_DEBT_TAGS);

  const operatingCF  = getAnnual(facts, OPERATING_CF_TAGS);
  const capex        = getAnnual(facts, CAPEX_TAGS);

  // Get the union of all years we have revenue data for (revenue is our anchor)
  const years = Object.keys(revenue)
    .map(Number)
    .filter(y => y >= new Date().getFullYear() - 5) // last 5 years
    .sort();

  if (years.length === 0) throw new Error(`No annual revenue data found for ${company.ticker}`);

  const incomeStatements: IncomeStatement[] = years.map(year => {
    const rev   = revenue[year]    ?? 0;
    const cg    = cogs[year]       ?? 0;
    const gross = rev - cg;
    const opExp = opex[year]       ?? 0;
    const dep   = da[year]         ?? 0;
    const int_  = interest[year]   ?? 0;
    const taxAmt = tax[year]       ?? 0;
    const net   = netIncome[year]  ?? 0;

    // EBIT = Net Income + Tax + Interest
    const ebit  = net + taxAmt + int_;
    // EBITDA = EBIT + D&A
    const ebitda = ebit + dep;

    return {
      year,
      revenue: rev,
      costOfRevenue: cg,
      grossProfit: gross,
      operatingExpenses: opExp,
      ebit,
      ebitda,
      netIncome: net,
      interestExpense: int_,
      taxExpense: taxAmt,
      depreciationAmortization: dep,
    };
  });

  const balanceSheets: BalanceSheet[] = years.map(year => {
    const assets = totalAssets[year] ?? 0;
    const liab   = totalLiab[year]   ?? 0;
    const equity = totalEquity[year] ?? (assets - liab);
    const cashAmt = cash[year]       ?? 0;
    const ltd    = longTermDebt[year]  ?? 0;
    const std    = shortTermDebt[year] ?? 0;

    return {
      year,
      totalAssets: assets,
      totalLiabilities: liab,
      totalEquity: equity,
      cash: cashAmt,
      totalDebt: ltd + std,
      workingCapital: 0, // simplified — would need current assets/liabilities breakdown
    };
  });

  const cashFlows: CashFlowStatement[] = years.map(year => {
    const ocf  = operatingCF[year] ?? 0;
    const capx = Math.abs(capex[year] ?? 0); // SEC reports capex as negative outflow
    return {
      year,
      operatingCashFlow: ocf,
      capitalExpenditures: capx,
      freeCashFlow: ocf - capx,
    };
  });

  return {
    company,
    incomeStatements,
    balanceSheets,
    cashFlows,
  };
}


// ─── XBRL tag helpers ─────────────────────────────────────────────────────────
// Each concept (revenue, net income, etc.) can be tagged different ways by
// different companies. We try each tag in order and use the first one found.

type YearMap = Record<number, number>; // { 2022: 394328000000, 2023: 383285000000 }
type XBRLFacts = Record<string, {
  label: string;
  units: { USD?: XBRLEntry[] };
}>;
type XBRLEntry = {
  end: string;     // "2023-09-30"
  val: number;
  form: string;    // "10-K", "10-Q", etc.
  accn: string;    // accession number
  fy: number;      // fiscal year
  fp: string;      // fiscal period: "FY", "Q1", etc.
  filed: string;
};

/**
 * Try each tag name in order; return the first one that has annual (10-K) data.
 * Returns a map of fiscal year → value.
 */
function getAnnual(facts: XBRLFacts, tags: string[]): YearMap {
  for (const tag of tags) {
    const concept = facts[tag];
    if (!concept?.units?.USD) continue;

    const annualEntries = concept.units.USD.filter(
      e => e.form === '10-K' && e.fp === 'FY'
    );
    if (annualEntries.length === 0) continue;

    // If a company files multiple 10-Ks for the same FY (amendments),
    // keep the most recently filed one.
    const byYear: Record<number, XBRLEntry> = {};
    for (const entry of annualEntries) {
      const year = entry.fy;
      if (!byYear[year] || entry.filed > byYear[year].filed) {
        byYear[year] = entry;
      }
    }

    const result: YearMap = {};
    for (const [year, entry] of Object.entries(byYear)) {
      result[Number(year)] = entry.val;
    }
    return result;
  }

  return {}; // tag not found — caller handles missing data gracefully
}


// ─── XBRL tag lists (order = preference) ─────────────────────────────────────
// We list the most common tags first. If a company doesn't use the first tag,
// we fall through to the next one.

const REVENUE_TAGS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax', // Apple, most modern companies
  'Revenues',                                            // older / industrial
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
];

const NET_INCOME_TAGS = [
  'NetIncomeLoss',
  'ProfitLoss',
  'NetIncomeLossAttributableToParent',
];

const COGS_TAGS = [
  'CostOfGoodsAndServicesSold',
  'CostOfRevenue',
  'CostOfGoodsSold',
];

const OPEX_TAGS = [
  'OperatingExpenses',
  'OperatingCostsAndExpenses',
  'CostsAndExpenses',
];

const DA_TAGS = [
  'DepreciationDepletionAndAmortization',
  'DepreciationAndAmortization',
  'Depreciation',
];

const INTEREST_TAGS = [
  'InterestExpense',
  'InterestAndDebtExpense',
  'InterestExpenseDebt',
];

const TAX_TAGS = [
  'IncomeTaxExpenseBenefit',
  'IncomeTaxesPaid',
];

const TOTAL_ASSETS_TAGS = [
  'Assets',
];

const TOTAL_LIAB_TAGS = [
  'Liabilities',
];

const EQUITY_TAGS = [
  'StockholdersEquity',
  'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  'LiabilitiesAndStockholdersEquity', // fallback — assets side
];

const CASH_TAGS = [
  'CashAndCashEquivalentsAtCarryingValue',
  'CashCashEquivalentsAndShortTermInvestments',
  'Cash',
];

const LT_DEBT_TAGS = [
  'LongTermDebt',
  'LongTermDebtNoncurrent',
  'LongTermNotesPayable',
];

const ST_DEBT_TAGS = [
  'ShortTermBorrowings',
  'NotesPayableCurrent',
  'LongTermDebtCurrent',
];

const OPERATING_CF_TAGS = [
  'NetCashProvidedByUsedInOperatingActivities',
];

const CAPEX_TAGS = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsForCapitalImprovements',
  'CapitalExpendituresIncurredButNotYetPaid',
];
