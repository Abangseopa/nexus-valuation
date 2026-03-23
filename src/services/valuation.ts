import type {
  FinancialData,
  DCFAssumptions,
  LBOAssumptions,
} from '../types';

// ─── DCF Model ────────────────────────────────────────────────────────────────

export interface DCFYear {
  year: number;        // calendar year
  revenue: number;
  ebitda: number;
  ebit: number;
  nopat: number;       // EBIT × (1 - tax rate)
  da: number;          // D&A (assumed as % of revenue for simplicity)
  capex: number;
  changeInNWC: number;
  ufcf: number;        // Unlevered Free Cash Flow
  discountFactor: number;
  pvUFCF: number;      // Present value of that year's UFCF
}

export interface DCFResult {
  years: DCFYear[];
  terminalValue: number;
  pvTerminalValue: number;
  enterpriseValue: number;    // sum of PV(FCFs) + PV(terminal value)
  netDebt: number;            // total debt minus cash
  equityValue: number;        // EV - net debt
  assumptions: DCFAssumptions;
  baseRevenue: number;        // last historical revenue (anchor for projections)
}

/**
 * Run a full DCF model.
 *
 * Formula per year:
 *   EBITDA  = Revenue × ebitdaMargin
 *   D&A     = Revenue × 0.03 (rough proxy; ideally from historical avg)
 *   EBIT    = EBITDA - D&A
 *   NOPAT   = EBIT × (1 - taxRate)
 *   CapEx   = Revenue × capexAsPercentOfRevenue
 *   ΔNWC    = ΔRevenue × nwcAsPercentOfRevenue
 *   UFCF    = NOPAT + D&A - CapEx - ΔNWC
 *
 * Terminal Value (Gordon Growth):
 *   TV = UFCF_final × (1 + g) / (WACC - g)
 *
 * Enterprise Value = Σ PV(UFCF) + PV(TV)
 */
export function runDCF(
  financialData: FinancialData,
  assumptions: DCFAssumptions
): DCFResult {
  const { wacc, terminalGrowthRate, taxRate, ebitdaMargin,
          capexAsPercentOfRevenue, nwcAsPercentOfRevenue,
          revenueGrowthRates, forecastYears } = assumptions;

  // D&A as % of revenue — derive from historical average
  const daPercent = deriveDAPercent(financialData);

  const lastActual = financialData.incomeStatements.at(-1)!;
  const baseRevenue = lastActual.revenue;
  const baseYear    = lastActual.year;

  const years: DCFYear[] = [];
  let prevRevenue = baseRevenue;

  for (let i = 0; i < forecastYears; i++) {
    const growthRate = revenueGrowthRates[i] ?? revenueGrowthRates.at(-1)!;
    const revenue    = prevRevenue * (1 + growthRate);
    const ebitda     = revenue * ebitdaMargin;
    const da         = revenue * daPercent;
    const ebit       = ebitda - da;
    const nopat      = ebit * (1 - taxRate);
    const capex      = revenue * capexAsPercentOfRevenue;
    const changeInNWC = (revenue - prevRevenue) * nwcAsPercentOfRevenue;
    const ufcf       = nopat + da - capex - changeInNWC;

    // Discount factor: 1 / (1 + WACC)^year  (mid-year convention: year + 0.5)
    const t            = i + 0.5;
    const discountFactor = 1 / Math.pow(1 + wacc, t);
    const pvUFCF       = ufcf * discountFactor;

    years.push({
      year: baseYear + i + 1,
      revenue, ebitda, ebit, nopat, da,
      capex, changeInNWC, ufcf,
      discountFactor, pvUFCF,
    });

    prevRevenue = revenue;
  }

  const finalUFCF     = years.at(-1)!.ufcf;
  const terminalValue = (finalUFCF * (1 + terminalGrowthRate)) / (wacc - terminalGrowthRate);
  const pvTerminalValue = terminalValue / Math.pow(1 + wacc, forecastYears);

  const pvFCFs       = years.reduce((sum, y) => sum + y.pvUFCF, 0);
  const enterpriseValue = pvFCFs + pvTerminalValue;

  const latestBS    = financialData.balanceSheets.at(-1);
  const netDebt     = latestBS ? (latestBS.totalDebt - latestBS.cash) : 0;
  const equityValue = enterpriseValue - netDebt;

  return {
    years,
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    netDebt,
    equityValue,
    assumptions,
    baseRevenue,
  };
}


// ─── LBO Model ────────────────────────────────────────────────────────────────

export interface LBOYear {
  year: number;
  revenue: number;
  ebitda: number;
  ebit: number;
  interestExpense: number;
  ebt: number;           // Earnings before tax
  taxes: number;
  netIncome: number;
  capex: number;
  freeCashFlow: number;  // available to repay debt
  debtRepaid: number;
  endingDebt: number;
}

export interface LBOResult {
  years: LBOYear[];
  entryEquity: number;       // sponsor's equity cheque at entry
  entryDebt: number;
  exitEBITDA: number;
  exitEnterpriseValue: number;
  exitDebt: number;
  exitEquity: number;        // what the sponsor gets back
  moic: number;              // Multiple on Invested Capital
  irr: number;               // Internal Rate of Return (annualised)
  assumptions: LBOAssumptions;
}

/**
 * Run a full LBO model.
 *
 * Structure:
 *   Entry EV = entryEbitdaMultiple × lastEBITDA
 *   Entry Debt = debtToEbitda × lastEBITDA
 *   Entry Equity = Entry EV - Entry Debt
 *
 *   Each year:
 *     - Grow revenue, maintain EBITDA margin
 *     - Pay interest on outstanding debt
 *     - Tax on EBT
 *     - Remaining FCF sweeps against debt (cash sweep)
 *
 *   Exit:
 *     Exit EV = exitEbitdaMultiple × final EBITDA
 *     Exit Equity = Exit EV - Remaining Debt
 *     IRR = solve for r where Entry Equity = Exit Equity / (1+r)^years
 */
export function runLBO(
  financialData: FinancialData,
  assumptions: LBOAssumptions
): LBOResult {
  const {
    entryEbitdaMultiple, exitEbitdaMultiple, holdingPeriodYears,
    debtToEbitda, interestRate, taxRate, ebitdaMargin,
    capexAsPercentOfRevenue, revenueGrowthRates,
  } = assumptions;

  const lastActual  = financialData.incomeStatements.at(-1)!;
  const baseRevenue = lastActual.revenue;
  const baseEBITDA  = lastActual.ebitda;
  const baseYear    = lastActual.year;

  const entryEV    = entryEbitdaMultiple * baseEBITDA;
  const entryDebt  = debtToEbitda * baseEBITDA;
  const entryEquity = entryEV - entryDebt;

  const years: LBOYear[] = [];
  let currentDebt = entryDebt;
  let prevRevenue = baseRevenue;

  for (let i = 0; i < holdingPeriodYears; i++) {
    const growthRate    = revenueGrowthRates[i] ?? revenueGrowthRates.at(-1)!;
    const revenue       = prevRevenue * (1 + growthRate);
    const ebitda        = revenue * ebitdaMargin;
    const daPercent     = deriveDAPercent(financialData);
    const da            = revenue * daPercent;
    const ebit          = ebitda - da;
    const interestExpense = currentDebt * interestRate;
    const ebt           = ebit - interestExpense;
    const taxes         = Math.max(0, ebt * taxRate);  // no negative taxes
    const netIncome     = ebt - taxes;
    const capex         = revenue * capexAsPercentOfRevenue;

    // Free cash flow available for debt repayment
    const freeCashFlow  = netIncome + da - capex;
    const debtRepaid    = Math.min(freeCashFlow, currentDebt); // can't repay more than owed
    const endingDebt    = currentDebt - debtRepaid;

    years.push({
      year: baseYear + i + 1,
      revenue, ebitda, ebit, interestExpense,
      ebt, taxes, netIncome, capex,
      freeCashFlow, debtRepaid, endingDebt,
    });

    currentDebt = endingDebt;
    prevRevenue = revenue;
  }

  const exitEBITDA          = years.at(-1)!.ebitda;
  const exitEnterpriseValue = exitEbitdaMultiple * exitEBITDA;
  const exitDebt            = years.at(-1)!.endingDebt;
  const exitEquity          = exitEnterpriseValue - exitDebt;

  const moic = exitEquity / entryEquity;
  const irr  = Math.pow(moic, 1 / holdingPeriodYears) - 1; // simplified IRR (no interim cash flows)

  return {
    years,
    entryEquity,
    entryDebt,
    exitEBITDA,
    exitEnterpriseValue,
    exitDebt,
    exitEquity,
    moic,
    irr,
    assumptions,
  };
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive D&A as % of revenue from historical data. Falls back to 3% if unavailable. */
function deriveDAPercent(financialData: FinancialData): number {
  const stmts = financialData.incomeStatements.filter(
    s => s.revenue > 0 && s.depreciationAmortization > 0
  );
  if (stmts.length === 0) return 0.03;

  const avg = stmts.reduce((sum, s) => sum + s.depreciationAmortization / s.revenue, 0) / stmts.length;
  return avg;
}
