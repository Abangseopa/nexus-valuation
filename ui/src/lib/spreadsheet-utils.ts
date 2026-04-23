import type { ValuationResult } from "./valuation-api";

export type CellBg    = "header" | "subheader" | "input" | "total" | "highlight" | "divider" | undefined;
export type CellColor = "muted" | "negative" | "positive" | undefined;

export interface Cell {
  value: string | number | null;
  formula?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  bg?: CellBg;
  color?: CellColor;
}

export type GridRow = (Cell | null)[];

export interface Sheet {
  name: string;
  rows: GridRow[];
  colWidths: number[];
}

// ── Excel formula helpers ─────────────────────────────────────────────────────

function cl(col0: number): string {
  let r = "", n = col0;
  do { r = String.fromCharCode(65 + (n % 26)) + r; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return r;
}
const abs = (r: number, c: number) => `$${cl(c)}$${r + 1}`;
const rel = (r: number, c: number) => `${cl(c)}${r + 1}`;
const xr  = (sheet: string, r: number, c = 1) => `${sheet}!${abs(r, c)}`;

// ── Cell builders ─────────────────────────────────────────────────────────────

const H   = (v: string | null, opts?: Partial<Cell>): Cell => ({ value: v, bold: true, bg: "header",    align: "left",   ...opts });
const SH  = (v: string | null, opts?: Partial<Cell>): Cell => ({ value: v, bold: true, bg: "subheader", align: "left",   ...opts });
const L   = (v: string | number | null, opts?: Partial<Cell>): Cell => ({ value: v, align: "left",  ...opts });
const V   = (v: string | number | null, f?: string, opts?: Partial<Cell>): Cell => ({ value: v, formula: f, align: "right", ...opts });
const I   = (v: string | number | null, opts?: Partial<Cell>): Cell => ({ value: v, align: "right", bg: "input",    ...opts });
const TOT = (v: string | number | null, f?: string, opts?: Partial<Cell>): Cell => ({ value: v, formula: f, align: "right", bold: true, bg: "total",    ...opts });
const HI  = (v: string | number | null, f?: string, opts?: Partial<Cell>): Cell => ({ value: v, formula: f, align: "right", bold: true, bg: "highlight", ...opts });
const E   = (): Cell => ({ value: null });

// ── Formatters ────────────────────────────────────────────────────────────────

function pct(n: number | undefined, decimals = 1): string {
  if (n == null || isNaN(n)) return "—";
  const p = n > 1 ? n : n * 100;
  return `${p.toFixed(decimals)}%`;
}
function money(n: number | undefined, unit: number): string {
  if (n == null || isNaN(n)) return "—";
  const v = n / unit;
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `(${s})` : s;
}
function num(n: number | undefined, d = 3): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(d);
}
function mult(n: number | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${Number(n).toFixed(1)}x`;
}
function ratio(n: number | undefined): string {
  if (n == null || isNaN(n) || !isFinite(n)) return "—";
  return `${n.toFixed(1)}x`;
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSUMPTIONS SHEET ROW MAP  (shared between DCF and LBO callers)
// ════════════════════════════════════════════════════════════════════════════════

// DCF Assumptions rows (0-indexed).  See buildDCFAssumptionsSheet for exact layout.
function dcfAssumpRows(forecastYears: number) {
  // Key Assumptions section starts at row 9
  const wacc          = 9;
  const termGrowth    = 10;
  const ebitdaMargin  = 11;
  const grossMargin   = 12;   // NEW: gross profit margin
  const taxRate       = 13;
  const capexPct      = 14;
  const nwcPct        = 15;
  const daPct         = 16;
  const intRateOnDebt = 17;   // NEW: interest rate on debt
  // blank at 18
  // "Capital Structure" header at 19
  const baseCash      = 20;
  const baseTotalDebt = 21;
  // blank at 22
  // "Revenue Growth Rates" header at 23
  // Year i growth at 24 + i
  const growth        = (i: number) => 24 + i;
  // After forecastYears growth rows: blank, blank, "Base Year Data" header, base revenue
  const baseRevenue   = 24 + forecastYears + 3;   // e.g. n=5 → 32
  const baseEBITDA    = 24 + forecastYears + 4;
  const baseEBIT      = 24 + forecastYears + 5;
  const baseNetIncome = 24 + forecastYears + 6;
  return { wacc, termGrowth, ebitdaMargin, grossMargin, taxRate, capexPct, nwcPct, daPct,
           intRateOnDebt, baseCash, baseTotalDebt, growth,
           baseRevenue, baseEBITDA, baseEBIT, baseNetIncome };
}

// LBO Assumptions rows
function lboAssumpRows(holdYears: number) {
  const entryMult    = 9;
  const exitMult     = 10;
  const holdingYears = 11;
  const leverage     = 12;
  const intRate      = 13;
  const ebitdaMargin = 16;
  const grossMargin  = 17;
  const taxRate      = 18;
  const capexPct     = 19;
  const daPct        = 20;
  // blank at 21
  // "Revenue Growth Rates" at 22
  const growth       = (i: number) => 23 + i;
  // blank, blank, "Base Year Data" header, ...
  const baseRevenue  = 23 + holdYears + 3;
  const baseEBITDA   = 23 + holdYears + 4;
  return { entryMult, exitMult, holdingYears, leverage, intRate,
           ebitdaMargin, grossMargin, taxRate, capexPct, daPct,
           growth, baseRevenue, baseEBITDA };
}

// ════════════════════════════════════════════════════════════════════════════════
// DCF MODEL BUILDER
// ════════════════════════════════════════════════════════════════════════════════

export function buildDCFSheets(result: ValuationResult): Sheet[] {
  const a = result.assumptions as Record<string, any>;

  // ── Extract assumptions ────────────────────────────────────────────────────
  const wacc:          number   = a.wacc                      ?? 0.10;
  const termGrowth:    number   = a.terminalGrowthRate         ?? 0.025;
  const ebitdaMargin:  number   = a.ebitdaMargin              ?? 0.35;
  const taxRate:       number   = a.taxRate                   ?? 0.21;
  const capexPct:      number   = a.capexAsPercentOfRevenue   ?? 0.05;
  const nwcPct:        number   = a.nwcAsPercentOfRevenue     ?? 0.02;
  const daPct                   = 0.03;
  const forecastYears: number   = a.forecastYears             ?? 5;
  const growthRates:   number[] = a.revenueGrowthRates        ?? Array(forecastYears).fill(0.07);

  // Historical-derived metrics (from SEC data via backend)
  const rawGrossMargin: number  = a._grossMarginPct           ?? 0;
  const grossMarginPct: number  = rawGrossMargin > 0.01
    ? rawGrossMargin
    : Math.min(ebitdaMargin + 0.20, 0.95);   // fallback estimate
  const intExpPct:     number   = a._interestExpensePct       ?? 0.02;
  const baseCash:      number   = a._baseCash                 ?? 0;
  const baseTotalDebt: number   = a._baseTotalDebt            ?? 0;
  const baseEBITDA_hist:number  = a._baseEBITDA               ?? 0;
  const baseEBIT_hist: number   = a._baseEBIT                 ?? 0;

  const baseRevenue:   number   = a._baseRevenue              ?? 1_000_000_000;
  const unit = baseRevenue >= 1_000_000_000 ? 1_000_000 : 1_000;
  const unitLbl = unit === 1_000_000 ? "($ in millions, unless noted)" : "($ in thousands, unless noted)";

  const netDebt:       number   = a._netDebt                  ?? (baseTotalDebt - baseCash);
  const ev:            number   = a._enterpriseValue          ?? 0;
  const equityVal:     number   = a._equityValue              ?? 0;

  // ── Historical income statement rows from SEC EDGAR ───────────────────────
  interface HistRow {
    year: number; revenue: number; costOfRevenue: number;
    grossProfit: number; ebitda: number; ebit: number;
    netIncome: number; interestExpense: number; taxExpense: number;
    da: number; operatingExpenses: number;
  }
  const rawHist = a._historicalIS;
  const hist: HistRow[] = Array.isArray(rawHist)
    ? (rawHist as HistRow[]).filter((s: any) => s && s.revenue > 0)
    : [];
  const hc = hist.length;  // number of historical columns

  const curYear = new Date().getFullYear();
  const AR = dcfAssumpRows(forecastYears);
  const A  = (row: number) => xr("Assumptions", row);
  const blank = (n: number) => Array.from({ length: n }, E);
  const blankH = () => blank(hc);   // blank cells for historical cols on non-IS rows

  // ── Pre-calculate year projections ─────────────────────────────────────────
  const years: Array<{
    year: number; g: number;
    rev: number; cogs: number; grossProfit: number;
    sga: number; ebitda: number; da: number; ebit: number;
    interest: number; ebt: number; taxExp: number; netIncome: number;
    capex: number; dnwc: number; nopat: number; ufcf: number;
    df: number; pvFcf: number;
  }> = [];

  let prevRev = baseRevenue;
  for (let i = 0; i < forecastYears; i++) {
    const g          = growthRates[i] ?? growthRates.at(-1) ?? 0.05;
    const rev        = prevRev * (1 + g);
    const cogs       = rev * (1 - grossMarginPct);
    const grossProfit= rev - cogs;
    const ebitda     = rev * ebitdaMargin;
    const sga        = grossProfit - ebitda;    // SG&A = Gross Profit - EBITDA (before D&A)
    const da         = rev * daPct;
    const ebit       = ebitda - da;
    const interest   = rev * intExpPct;
    const ebt        = ebit - interest;
    const taxExp     = Math.max(0, ebt * taxRate);
    const netIncome  = ebt - taxExp;
    const capex      = rev * capexPct;
    const dnwc       = (rev - prevRev) * nwcPct;
    const nopat      = ebit * (1 - taxRate);
    const ufcf       = nopat + da - capex - dnwc;
    const t          = i + 0.5;
    const df         = 1 / Math.pow(1 + wacc, t);
    years.push({ year: curYear + i + 1, g, rev, cogs, grossProfit, sga, ebitda, da, ebit,
                 interest, ebt, taxExp, netIncome, capex, dnwc, nopat, ufcf, df, pvFcf: ufcf * df });
    prevRev = rev;
  }

  const pvFcfs   = years.reduce((s, y) => s + y.pvFcf, 0);
  const lastUFCF = years.at(-1)!.ufcf;
  const lastEBITDA = years.at(-1)!.ebitda;
  const tv       = a._terminalValue   ?? (lastUFCF * (1 + termGrowth)) / (wacc - termGrowth);
  const pvTv     = a._pvTerminalValue ?? tv / Math.pow(1 + wacc, forecastYears);
  const totalEV  = ev || pvFcfs + pvTv;
  const tvPctOfEV = pvTv / totalEV;
  const impliedEVEBITDA = lastEBITDA > 0 ? totalEV / lastEBITDA : 0;

  const nc  = forecastYears;
  // Forecast cols are offset right by hc (number of historical columns)
  const yc      = (i: number)              => hc + i;
  const ycr     = (row: number, i: number) => rel(row, yc(i));
  const lastYcr = (row: number)            => rel(row, yc(nc));

  // ════════════════════════════════════════════════════
  // ROW INDEX MAP for DCF Model sheet
  // ════════════════════════════════════════════════════
  const DM = (() => {
    // Counts from 0
    let r = 0;
    const map: Record<string, number> = {};
    const mark = (name: string) => { map[name] = r; };

    mark("header");    r++;  // 0
    mark("unit");      r++;  // 1
    r++;                     // 2: blank
    mark("colHeaders");r++;  // 3
    // ── Income Statement ──
    mark("incomeHdr"); r++;  // 4
    mark("revenue");   r++;  // 5
    mark("revGrowth"); r++;  // 6
    r++;                     // 7: blank
    mark("cogs");      r++;  // 8
    mark("grossProfit");r++; // 9
    mark("grossMgn");  r++;  // 10
    r++;                     // 11: blank
    mark("sga");       r++;  // 12
    mark("ebitda");    r++;  // 13
    mark("ebitdaMgn"); r++;  // 14
    r++;                     // 15: blank
    mark("da");        r++;  // 16
    mark("ebit");      r++;  // 17
    mark("ebitMgn");   r++;  // 18
    r++;                     // 19: blank
    mark("interest");  r++;  // 20
    mark("ebt");       r++;  // 21
    mark("taxRate");   r++;  // 22
    mark("taxExp");    r++;  // 23
    r++;                     // 24: blank
    mark("netIncome"); r++;  // 25
    mark("netMgn");    r++;  // 26
    r++;                     // 27: blank
    // ── Margin Analysis ──
    mark("marginHdr"); r++;  // 28
    mark("mGross");    r++;  // 29
    mark("mEBITDA");   r++;  // 30
    mark("mEBIT");     r++;  // 31
    mark("mNet");      r++;  // 32
    r++;                     // 33: blank
    // ── Free Cash Flow ──
    mark("fcfHdr");    r++;  // 34
    mark("fcfNopat");  r++;  // 35
    mark("fcfDA");     r++;  // 36
    mark("fcfCapex");  r++;  // 37
    mark("fcfNWC");    r++;  // 38
    mark("ufcf");      r++;  // 39
    r++;                     // 40: blank
    mark("fcfEBITDA"); r++;  // 41
    mark("fcfConv");   r++;  // 42
    r++;                     // 43: blank
    // ── DCF Analysis ──
    mark("discHdr");   r++;  // 44
    mark("discWACC");  r++;  // 45
    mark("discPeriod");r++;  // 46
    mark("discFactor");r++;  // 47
    mark("pvFcf");     r++;  // 48
    r++;                     // 49: blank
    // ── Terminal Value ──
    mark("tvHdr");     r++;  // 50
    mark("tvGrowth");  r++;  // 51
    mark("tvWACC");    r++;  // 52
    mark("tvFinalFCF");r++;  // 53
    mark("tvGordon");  r++;  // 54
    mark("pvTV");      r++;  // 55
    mark("tvPctOfEV"); r++;  // 56
    mark("tvImplied"); r++;  // 57
    r++;                     // 58: blank
    // ── Valuation Summary ──
    mark("valHdr");    r++;  // 59
    mark("sumPvFcf");  r++;  // 60
    mark("pvTVline");  r++;  // 61
    mark("ev");        r++;  // 62
    r++;                     // 63: blank
    mark("bridgeDebt");r++;  // 64
    mark("bridgeCash");r++;  // 65
    mark("netDebt");   r++;  // 66
    mark("equityVal"); r++;  // 67
    r++;                     // 68: blank
    // ── Credit Statistics ──
    mark("creditHdr"); r++;  // 69
    mark("creditLev"); r++;  // 70: Net Debt / EBITDA
    mark("creditCov"); r++;  // 71: EBIT / Interest
    mark("creditFCF"); r++;  // 72: FCF Conversion
    mark("creditCapex");r++; // 73: CapEx / Revenue

    return map;
  })();

  // ════════════════════════════════════════════════════
  // BUILD ASSUMPTIONS SHEET
  // ════════════════════════════════════════════════════
  const aRows: GridRow[] = [
    [H(`${result.ticker} — DCF Valuation Model`, { align: "center" }), ...Array(nc).fill({ value: null, bg: "header" } as Cell)],
    [E(), ...blank(nc)],
    [SH("Company Overview"), ...blank(nc)],
    [L("Company Name"),        V(result.companyName || result.ticker),           ...blank(nc - 1)],
    [L("Ticker Symbol"),       V(result.ticker),                                  ...blank(nc - 1)],
    [L("Valuation Method"),    V("DCF — Discounted Cash Flow"),                   ...blank(nc - 1)],
    [L("Reporting Currency"),  V(unitLbl),                                        ...blank(nc - 1)],
    [E(), ...blank(nc)],
    [SH("Model Assumptions"), ...blank(nc)],                          // row 8
    [L("WACC (Discount Rate)"),           I(pct(wacc))],              // row AR.wacc   = 9
    [L("Terminal Growth Rate"),           I(pct(termGrowth))],        // row 10
    [L("EBITDA Margin"),                  I(pct(ebitdaMargin))],      // row 11
    [L("Gross Profit Margin"),            I(pct(grossMarginPct))],    // row AR.grossMargin = 12
    [L("Effective Tax Rate"),             I(pct(taxRate))],           // row 13
    [L("CapEx as % of Revenue"),          I(pct(capexPct))],          // row 14
    [L("Net Working Capital as % of Rev"),I(pct(nwcPct))],           // row 15
    [L("D&A as % of Revenue"),            I(pct(daPct))],             // row 16
    [L("Interest Rate on Debt"),          I(pct(intExpPct))],         // row AR.intRateOnDebt = 17
    [E(), ...blank(nc)],                                              // row 18 blank
    [SH("Capital Structure  (Base Year)"), ...blank(nc)],             // row 19
    [L("Cash & Cash Equivalents"),        I(money(baseCash, unit))],  // row AR.baseCash = 20
    [L("Total Debt"),                     I(money(baseTotalDebt, unit))], // row AR.baseTotalDebt = 21
    [E(), ...blank(nc)],                                              // row 22 blank
    [SH("Revenue Growth Rates  (Forecast Period)"), ...blank(nc)],    // row 23
    ...years.map((y, i) => [                                          // rows 24..24+n-1
      L(`${y.year}  (Year ${i + 1})`),
      I(pct(growthRates[i] ?? growthRates.at(-1))),
      ...blank(nc - 1),
    ]),
    [E(), ...blank(nc)],
    [E(), ...blank(nc)],
    [SH("Base Year Financial Data  (FY" + curYear + ")"), ...blank(nc)],   // row 24+n+2
    [L("Revenue"),        I(money(baseRevenue,    unit))],  // row AR.baseRevenue
    [L("EBITDA"),         I(money(baseEBITDA_hist || baseRevenue * ebitdaMargin, unit))], // row AR.baseEBITDA
    [L("EBIT"),           I(money(baseEBIT_hist   || baseRevenue * ebitdaMargin * 0.85, unit))],
    [L("Net Income"),     I(money(a._baseNetIncome ?? 0, unit))],
  ];

  // ════════════════════════════════════════════════════
  // BUILD DCF MODEL SHEET
  // ════════════════════════════════════════════════════
  // Historical column headers (greyed-out "actual" label)
  const histHdrs = hist.map(h => V(`FY${h.year}A`, undefined, { bold: true, bg: "subheader", align: "center", color: "muted" }));
  const foreHdrs = years.map(y => V(`FY${y.year}E`, undefined, { bold: true, bg: "subheader", align: "center" }));
  const YH: GridRow = [V(null), ...histHdrs, ...foreHdrs];

  // Base revenue reference for Year 1 formulas: use last historical column if we have it
  const baseRevRef = hc > 0 ? rel(DM.revenue, hc) : A(AR.baseRevenue);

  function revFormula(i: number): string {
    if (i === 1) return `=${baseRevRef}*(1+${A(AR.growth(0))})`;
    return `=${ycr(DM.revenue, i - 1)}*(1+${A(AR.growth(i - 1))})`;
  }
  function nwcFormula(i: number): string {
    const prev = i === 1 ? baseRevRef : ycr(DM.revenue, i - 1);
    return `=-(${ycr(DM.revenue, i)}-${prev})*${A(AR.nwcPct)}`;
  }

  // Helpers: historical cell values for each income statement row
  const hRev  = (h: HistRow) => V(money(h.revenue, unit));
  const hCogs = (h: HistRow) => V(money(-(h.costOfRevenue || h.revenue - h.grossProfit), unit), undefined, { color: "muted" });
  const hGP   = (h: HistRow) => TOT(money(h.grossProfit, unit));
  const hGM   = (h: HistRow) => V(pct(h.grossProfit / h.revenue), undefined, { color: "muted" });
  const hSGA  = (h: HistRow) => V(money(-(h.operatingExpenses || h.grossProfit - h.ebitda), unit), undefined, { color: "muted" });
  const hEBITDA  = (h: HistRow) => TOT(money(h.ebitda, unit), undefined, { bold: true });
  const hEBITDAm = (h: HistRow) => V(pct(h.ebitda / h.revenue), undefined, { color: "muted" });
  const hDA   = (h: HistRow) => V(money(-(h.da || h.ebitda - h.ebit), unit), undefined, { color: "muted" });
  const hEBIT    = (h: HistRow) => TOT(money(h.ebit, unit));
  const hEBITm   = (h: HistRow) => V(pct(h.ebit / h.revenue), undefined, { color: "muted" });
  const hInt  = (h: HistRow) => V(money(-h.interestExpense, unit), undefined, { color: "muted" });
  const hEBT  = (h: HistRow) => V(money(h.ebit - h.interestExpense, unit));
  const hTaxR = (h: HistRow) => {
    const ebt = h.ebit - h.interestExpense;
    return V(ebt > 0 ? pct(h.taxExpense / ebt) : "—", undefined, { color: "muted" });
  };
  const hTaxE = (h: HistRow) => V(money(-h.taxExpense, unit), undefined, { color: "muted" });
  const hNI   = (h: HistRow) => TOT(money(h.netIncome, unit), undefined, { bold: true });
  const hNIm  = (h: HistRow) => V(pct(h.netIncome / h.revenue), undefined, { color: "muted" });
  const hRevG = (h: HistRow, prev?: HistRow) =>
    prev ? V(pct(h.revenue / prev.revenue - 1), undefined, { color: "muted" }) : V("—", undefined, { color: "muted" });

  const colWidths = [220, ...Array(hc).fill(100), ...Array(nc).fill(110)];

  const totCols = hc + nc;                         // total data columns
  const blankAll = () => blank(totCols);            // blank all data cols (for headers etc.)
  const bAll = () => blank(totCols - 1);            // blank after first data col (single-value rows)

  const mRows: GridRow[] = [
    // ── Header ───────────────────────────────────────────────────────────────
    [H("DCF Valuation Model  —  " + result.ticker, { align: "center" }),
      ...Array(totCols).fill({ value: null, bg: "header" } as Cell)],
    [L(unitLbl, { italic: true, color: "muted" }), ...blankAll()],
    [E(), ...blankAll()],
    YH,

    // ── Income Statement ─────────────────────────────────────────────────────
    [SH("Income Statement Summary"), ...blankAll()],
    [L("Revenues"),
      ...hist.map(h => hRev(h)),
      ...years.map((y, i) => V(money(y.rev, unit), revFormula(i + 1)))],
    [L("  % Change Year-over-Year"),
      ...hist.map((h, i) => hRevG(h, hist[i - 1])),
      ...years.map((_, i) => V(pct(growthRates[i] ?? growthRates.at(-1)), `=${A(AR.growth(i))}`, { color: "muted" }))],
    [E(), ...blankAll()],

    [L("Cost of Revenues"),
      ...hist.map(h => hCogs(h)),
      ...years.map((y, i) => V(money(-y.cogs, unit), `=-${ycr(DM.revenue, i+1)}*(1-${A(AR.grossMargin)})`, { color: "muted" }))],
    [L("Gross Profit"),
      ...hist.map(h => hGP(h)),
      ...years.map((y, i) => TOT(money(y.grossProfit, unit), `=${ycr(DM.revenue, i+1)}+${ycr(DM.cogs, i+1)}`))],
    [L("  Gross Margin"),
      ...hist.map(h => hGM(h)),
      ...years.map(y => V(pct(y.grossProfit / y.rev), `=${A(AR.grossMargin)}`, { color: "muted" }))],
    [E(), ...blankAll()],

    [L("SG&A and Operating Expenses"),
      ...hist.map(h => hSGA(h)),
      ...years.map((y, i) => V(money(-y.sga, unit), `=-${ycr(DM.grossProfit, i+1)}+${ycr(DM.ebitda, i+1)}`, { color: "muted" }))],
    [L("EBITDA"),
      ...hist.map(h => hEBITDA(h)),
      ...years.map((y, i) => TOT(money(y.ebitda, unit), `=${ycr(DM.revenue, i+1)}*${A(AR.ebitdaMargin)}`, { bold: true }))],
    [L("  EBITDA Margin"),
      ...hist.map(h => hEBITDAm(h)),
      ...years.map(y => V(pct(y.ebitda / y.rev), `=${A(AR.ebitdaMargin)}`, { color: "muted" }))],
    [E(), ...blankAll()],

    [L("Depreciation & Amortization"),
      ...hist.map(h => hDA(h)),
      ...years.map((y, i) => V(money(-y.da, unit), `=-${ycr(DM.revenue, i+1)}*${A(AR.daPct)}`, { color: "muted" }))],
    [L("EBIT  (Operating Income)"),
      ...hist.map(h => hEBIT(h)),
      ...years.map((y, i) => TOT(money(y.ebit, unit), `=${ycr(DM.ebitda, i+1)}+${ycr(DM.da, i+1)}`))],
    [L("  EBIT Margin"),
      ...hist.map(h => hEBITm(h)),
      ...years.map(y => V(pct(y.ebit / y.rev), undefined, { color: "muted" }))],
    [E(), ...blankAll()],

    [L("  Net Interest Expense"),
      ...hist.map(h => hInt(h)),
      ...years.map((y, i) => V(money(-y.interest, unit), `=-${ycr(DM.revenue, i+1)}*${A(AR.intRateOnDebt)}`, { color: "muted" }))],
    [L("Pretax Income"),
      ...hist.map(h => hEBT(h)),
      ...years.map((y, i) => V(money(y.ebt, unit), `=${ycr(DM.ebit, i+1)}+${ycr(DM.interest, i+1)}`))],
    [L("  Effective Tax Rate"),
      ...hist.map(h => hTaxR(h)),
      ...years.map(() => V(pct(taxRate), `=${A(AR.taxRate)}`, { color: "muted" }))],
    [L("  Income Tax Expense"),
      ...hist.map(h => hTaxE(h)),
      ...years.map((y, i) => V(money(-y.taxExp, unit), `=-MAX(0,${ycr(DM.ebt, i+1)}*${A(AR.taxRate)})`, { color: "muted" }))],
    [E(), ...blankAll()],
    [L("Net Income"),
      ...hist.map(h => hNI(h)),
      ...years.map((y, i) => TOT(money(y.netIncome, unit), `=${ycr(DM.ebt, i+1)}+${ycr(DM.taxExp, i+1)}`, { bold: true }))],
    [L("  Net Income Margin"),
      ...hist.map(h => hNIm(h)),
      ...years.map(y => V(pct(y.netIncome / y.rev), undefined, { color: "muted" }))],
    [E(), ...blankAll()],

    // ── Margin Analysis ──────────────────────────────────────────────────────
    [SH("Margin Analysis  (% of Revenue)"), ...blankAll()],
    [L("Gross Profit Margin"),
      ...hist.map(h => hGM(h)),
      ...years.map(y => V(pct(y.grossProfit / y.rev), `=${A(AR.grossMargin)}`, { color: "muted" }))],
    [L("EBITDA Margin"),
      ...hist.map(h => hEBITDAm(h)),
      ...years.map(y => V(pct(y.ebitda / y.rev), `=${A(AR.ebitdaMargin)}`, { color: "muted" }))],
    [L("EBIT Margin"),
      ...hist.map(h => hEBITm(h)),
      ...years.map(y => V(pct(y.ebit / y.rev), undefined, { color: "muted" }))],
    [L("Net Income Margin"),
      ...hist.map(h => hNIm(h)),
      ...years.map(y => V(pct(y.netIncome / y.rev), undefined, { color: "muted" }))],
    [E(), ...blankAll()],

    // ── Free Cash Flow ────────────────────────────────────────────────────────
    [SH("Unlevered Free Cash Flow  (UFCF)"), ...blankAll()],
    [L("NOPAT  (EBIT × (1 – Tax Rate))"),
      ...blankH(),
      ...years.map((y, i) => V(money(y.nopat, unit), `=${ycr(DM.ebit, i+1)}*(1-${A(AR.taxRate)})`, { bold: true }))],
    [L("  (+) Depreciation & Amortization"),
      ...blankH(),
      ...years.map((y, i) => V(money(y.da, unit), `=-${ycr(DM.da, i+1)}`))],
    [L("  (–) Capital Expenditures"),
      ...blankH(),
      ...years.map((y, i) => V(money(-y.capex, unit), `=-${ycr(DM.revenue, i+1)}*${A(AR.capexPct)}`))],
    [L("  (–) Δ Net Working Capital"),
      ...blankH(),
      ...years.map((y, i) => V(money(-y.dnwc, unit), nwcFormula(i + 1)))],
    [L("Unlevered Free Cash Flow"),
      ...blankH(),
      ...years.map((y, i) =>
        TOT(money(y.ufcf, unit),
            `=${ycr(DM.fcfNopat, i+1)}+${ycr(DM.fcfDA, i+1)}+${ycr(DM.fcfCapex, i+1)}+${ycr(DM.fcfNWC, i+1)}`,
            { bold: true }))],
    [E(), ...blankAll()],
    [L("  EBITDA  (for reference)"),
      ...blankH(),
      ...years.map((y, i) => V(money(y.ebitda, unit), `=${ycr(DM.ebitda, i+1)}`, { color: "muted" }))],
    [L("  FCF Conversion  (UFCF / EBITDA)"),
      ...blankH(),
      ...years.map(y => V(pct(y.ufcf / y.ebitda), undefined, { color: "muted" }))],
    [E(), ...blankAll()],

    // ── DCF Analysis ─────────────────────────────────────────────────────────
    [SH("DCF Analysis  (Discounted Cash Flow)"), ...blankAll()],
    [L("WACC  (Discount Rate)"),
      ...blankH(),
      ...years.map(() => V(pct(wacc), `=${A(AR.wacc)}`, { color: "muted" }))],
    [L("Discount Period  (mid-year)"),
      ...blankH(),
      ...years.map((_, i) => V(`${(i + 0.5).toFixed(1)} yr`, undefined, { color: "muted" }))],
    [L("Discount Factor"),
      ...blankH(),
      ...years.map((y, i) => V(num(y.df), `=1/(1+${A(AR.wacc)})^${(i + 0.5).toFixed(1)}`))],
    [L("Present Value of UFCF"),
      ...blankH(),
      ...years.map((y, i) => TOT(money(y.pvFcf, unit), `=${ycr(DM.ufcf, i+1)}*${ycr(DM.discFactor, i+1)}`))],
    [E(), ...blankAll()],

    // ── Terminal Value ────────────────────────────────────────────────────────
    [SH("Terminal Value Analysis  (Gordon Growth Model)"), E()],
    [L("Terminal Growth Rate"),  V(pct(termGrowth), `=${A(AR.termGrowth)}`), ...bAll()],
    [L("WACC"),                  V(pct(wacc), `=${A(AR.wacc)}`), ...bAll()],
    [L("Terminal Year UFCF"),    V(money(lastUFCF, unit), `=${lastYcr(DM.ufcf)}`), ...bAll()],
    [L("Terminal Value"),
      TOT(money(tv, unit),
          `=${lastYcr(DM.ufcf)}*(1+${A(AR.termGrowth)})/(${A(AR.wacc)}-${A(AR.termGrowth)})`),
      ...bAll()],
    [L("PV of Terminal Value"),
      TOT(money(pvTv, unit),
          `=${rel(DM.tvGordon, 1)}/(1+${A(AR.wacc)})^${forecastYears}`),
      ...bAll()],
    [L("  Terminal Value as % of Enterprise Value"), V(pct(tvPctOfEV), undefined, { color: "muted" }), ...bAll()],
    [L("  Implied Exit EV / EBITDA Multiple"), V(impliedEVEBITDA > 0 ? mult(impliedEVEBITDA) : "—"), ...bAll()],
    [E(), ...blankAll()],

    // ── Valuation Summary ─────────────────────────────────────────────────────
    [SH("Valuation Summary  —  Equity Bridge"), E()],
    [L("Present Value of UFCFs  (Years 1–" + forecastYears + ")"),
      TOT(money(pvFcfs, unit), `=SUM(${rel(DM.pvFcf, yc(1))}:${rel(DM.pvFcf, yc(nc))})`), ...bAll()],
    [L("(+) Present Value of Terminal Value"),
      V(money(pvTv, unit), `=${rel(DM.pvTV, 1)}`), ...bAll()],
    [L("Enterprise Value"),
      HI(money(totalEV, unit), `=${rel(DM.sumPvFcf, 1)}+${rel(DM.pvTVline, 1)}`), ...bAll()],
    [E(), ...blankAll()],
    [L("  (–) Total Debt"),       V(money(-baseTotalDebt, unit)), ...bAll()],
    [L("  (+) Cash & Equivalents"),V(money(baseCash, unit)),      ...bAll()],
    [L("  Net Debt  (Debt – Cash)"),
      V(money(netDebt, unit), `=${rel(DM.bridgeDebt, 1)}-${rel(DM.bridgeCash, 1)}`), ...bAll()],
    [L("Equity Value"),
      HI(money(equityVal || totalEV - netDebt, unit),
         `=${rel(DM.ev, 1)}-${rel(DM.netDebt, 1)}`), ...bAll()],
    [E(), ...blankAll()],

    // ── Credit Statistics ─────────────────────────────────────────────────────
    [SH("Credit Statistics"), ...blankAll()],
    [L("Net Debt / EBITDA"),
      ...hist.map(h => V(h.ebitda > 0 ? ratio(netDebt / h.ebitda) : "—", undefined, { color: "muted" })),
      ...years.map(y => V(ratio(netDebt / y.ebitda), undefined, { color: "muted" }))],
    [L("EBIT Interest Coverage  (EBIT / Interest)"),
      ...hist.map(h => V(h.interestExpense > 0 ? ratio(h.ebit / h.interestExpense) : "—", undefined, { color: "muted" })),
      ...years.map(y => V(y.interest > 0 ? ratio(y.ebit / y.interest) : "N/A", undefined, { color: "muted" }))],
    [L("FCF Conversion  (UFCF / EBITDA)"),
      ...blankH(),
      ...years.map(y => V(pct(y.ufcf / y.ebitda), undefined, { color: "muted" }))],
    [L("Capital Expenditures / Revenue"),
      ...blankH(),
      ...years.map(() => V(pct(capexPct), `=${A(AR.capexPct)}`, { color: "muted" }))],
  ];

  return [
    { name: "Assumptions", rows: aRows,  colWidths: [240, 130, ...Array(Math.max(nc - 1, 0)).fill(0)] },
    { name: "DCF Model",   rows: mRows,  colWidths },
  ];
}

// ════════════════════════════════════════════════════════════════════════════════
// LBO MODEL BUILDER
// ════════════════════════════════════════════════════════════════════════════════

export function buildLBOSheets(result: ValuationResult): Sheet[] {
  const a = result.assumptions as Record<string, any>;

  const entryMult:    number   = a.entryEbitdaMultiple    ?? 10;
  const exitMult:     number   = a.exitEbitdaMultiple     ?? 12;
  const holdYears:    number   = a.holdingPeriodYears     ?? 5;
  const leverage:     number   = a.debtToEbitda           ?? 5;
  const intRate:      number   = a.interestRate           ?? 0.08;
  const ebitdaMargin: number   = a.ebitdaMargin           ?? 0.35;
  const taxRate:      number   = a.taxRate                ?? 0.21;
  const capexPct:     number   = a.capexAsPercentOfRevenue ?? 0.05;
  const daPct                  = 0.03;
  const growthRates:  number[] = a.revenueGrowthRates     ?? Array(holdYears).fill(0.07);

  const rawGrossMargin: number  = a._grossMarginPct       ?? 0;
  const grossMarginPct: number  = rawGrossMargin > 0.01 ? rawGrossMargin : Math.min(ebitdaMargin + 0.20, 0.95);

  const baseRevenue:  number   = a._baseRevenue           ?? 1_000_000_000;
  const baseEBITDA                = a._baseEBITDA ?? baseRevenue * ebitdaMargin;
  const unit    = baseRevenue >= 1_000_000_000 ? 1_000_000 : 1_000;
  const unitLbl = unit === 1_000_000 ? "($ in millions, unless noted)" : "($ in thousands, unless noted)";

  const entryEV     = entryMult  * baseEBITDA;
  const entryDebt   = leverage   * baseEBITDA;
  const entryEquity = entryEV - entryDebt;

  const curYear = new Date().getFullYear();
  const AR = lboAssumpRows(holdYears);
  const A  = (row: number) => xr("Assumptions", row);
  const blank = (n: number) => Array.from({ length: n }, E);

  // ── Pre-calculate year projections ─────────────────────────────────────────
  const years: Array<{
    year: number; g: number;
    rev: number; cogs: number; grossProfit: number; sga: number;
    ebitda: number; da: number; ebit: number;
    interest: number; ebt: number; taxes: number; netIncome: number;
    capex: number; fcf: number; debtRepaid: number; endDebt: number;
  }> = [];

  let curDebt = entryDebt;
  let prevRev = baseRevenue;
  for (let i = 0; i < holdYears; i++) {
    const g          = growthRates[i] ?? growthRates.at(-1) ?? 0.05;
    const rev        = prevRev * (1 + g);
    const cogs       = rev * (1 - grossMarginPct);
    const grossProfit= rev - cogs;
    const ebitda     = rev * ebitdaMargin;
    const sga        = grossProfit - ebitda;
    const da         = rev * daPct;
    const ebit       = ebitda - da;
    const interest   = curDebt * intRate;
    const ebt        = ebit - interest;
    const taxes      = Math.max(0, ebt * taxRate);
    const netIncome  = ebt - taxes;
    const capex      = rev * capexPct;
    const fcf        = netIncome + da - capex;
    const debtRepaid = Math.min(fcf, curDebt);
    const endDebt    = curDebt - debtRepaid;
    years.push({ year: curYear + i + 1, g, rev, cogs, grossProfit, sga, ebitda, da, ebit, interest, ebt, taxes, netIncome, capex, fcf, debtRepaid, endDebt });
    curDebt = endDebt;
    prevRev = rev;
  }

  const exitEBITDA  = years.at(-1)!.ebitda;
  const exitEV      = exitMult  * exitEBITDA;
  const exitDebt    = years.at(-1)!.endDebt;
  const exitEquity  = exitEV - exitDebt;
  const moic        = a._moic ?? exitEquity / entryEquity;
  const irr         = a._irr  ?? Math.pow(moic, 1 / holdYears) - 1;

  const nc  = holdYears;
  const yc  = (i: number) => i;
  const ycr = (row: number, i: number) => rel(row, yc(i));

  // ── Row index map ──────────────────────────────────────────────────────────
  const LM = (() => {
    let r = 0;
    const map: Record<string, number> = {};
    const mark = (name: string) => { map[name] = r; };

    mark("header");     r++;  // 0
    mark("unit");       r++;  // 1
    r++;                      // 2
    mark("colHeaders"); r++;  // 3
    r++;                      // 4: blank
    // Transaction Summary
    mark("txnHdr");     r++;  // 5
    mark("entryEV");    r++;  // 6
    mark("entryEquity");r++;  // 7
    mark("entryDebt");  r++;  // 8
    mark("debtEBITDA"); r++;  // 9
    r++;                      // 10
    // Income Statement
    mark("incomeHdr");  r++;  // 11
    mark("revenue");    r++;  // 12
    mark("revGrowth");  r++;  // 13
    r++;                      // 14
    mark("cogs");       r++;  // 15
    mark("grossProfit");r++;  // 16
    mark("grossMgn");   r++;  // 17
    r++;                      // 18
    mark("sga");        r++;  // 19
    mark("ebitda");     r++;  // 20
    mark("ebitdaMgn");  r++;  // 21
    r++;                      // 22
    mark("da");         r++;  // 23
    mark("ebit");       r++;  // 24
    mark("ebitMgn");    r++;  // 25
    r++;                      // 26
    mark("interest");   r++;  // 27
    mark("ebt");        r++;  // 28
    mark("taxes");      r++;  // 29
    mark("netIncome");  r++;  // 30
    mark("netMgn");     r++;  // 31
    r++;                      // 32
    // Cash Flow & Debt Paydown
    mark("cfHdr");      r++;  // 33
    mark("cfNetInc");   r++;  // 34
    mark("cfDA");       r++;  // 35
    mark("cfCapex");    r++;  // 36
    mark("fcf");        r++;  // 37
    mark("debtRepaid"); r++;  // 38
    mark("endDebt");    r++;  // 39
    mark("endDebtEBITDA");r++;// 40
    r++;                      // 41
    // Returns Analysis
    mark("retHdr");     r++;  // 42
    mark("exitEBITDA"); r++;  // 43
    mark("exitMult");   r++;  // 44
    mark("exitEV");     r++;  // 45
    mark("exitDebt");   r++;  // 46
    mark("exitEquity"); r++;  // 47
    r++;                      // 48
    mark("moic");       r++;  // 49
    mark("irr");        r++;  // 50
    return map;
  })();

  // ── Assumptions Sheet ─────────────────────────────────────────────────────
  const aRows: GridRow[] = [
    [H(`${result.ticker} — LBO Analysis`, { align: "center" }), ...Array(nc).fill({ value: null, bg: "header" } as Cell)],
    [E(), ...blank(nc)],
    [SH("Company Overview"), ...blank(nc)],
    [L("Company Name"),   V(result.companyName || result.ticker), ...blank(nc - 1)],
    [L("Ticker"),         V(result.ticker),                       ...blank(nc - 1)],
    [L("Valuation Type"), V("LBO — Leveraged Buyout"),            ...blank(nc - 1)],
    [L("Currency Unit"),  V(unitLbl),                             ...blank(nc - 1)],
    [E(), ...blank(nc)],
    [SH("Transaction Assumptions"), ...blank(nc)],        // row 8
    [L("Entry EV / EBITDA Multiple"),      I(mult(entryMult))], // AR.entryMult = 9
    [L("Exit EV / EBITDA Multiple"),       I(mult(exitMult))],  // 10
    [L("Holding Period (years)"),          I(String(holdYears))], // 11
    [L("Debt / EBITDA at Entry"),          I(mult(leverage))],  // 12
    [L("Interest Rate on Debt"),           I(pct(intRate))],    // 13
    [E(), ...blank(nc)],                                        // 14
    [SH("Operating Assumptions"), ...blank(nc)],                // 15
    [L("EBITDA Margin"),           I(pct(ebitdaMargin))],       // AR.ebitdaMargin = 16
    [L("Gross Profit Margin"),     I(pct(grossMarginPct))],     // AR.grossMargin = 17
    [L("Effective Tax Rate"),      I(pct(taxRate))],            // 18
    [L("CapEx % of Revenue"),      I(pct(capexPct))],           // 19
    [L("D&A % of Revenue"),        I(pct(daPct))],              // 20
    [E(), ...blank(nc)],                                        // 21
    [SH("Revenue Growth Rates"), ...blank(nc)],                 // 22
    ...years.map((y, i) => [                                    // 23..23+holdYears-1
      L(`${y.year}  (Year ${i + 1})`),
      I(pct(growthRates[i] ?? growthRates.at(-1))),
      ...blank(nc - 1),
    ]),
    [E(), ...blank(nc)],
    [E(), ...blank(nc)],
    [SH("Base Year Data  (FY" + curYear + ")"), ...blank(nc)],
    [L("Base Revenue"),  I(money(baseRevenue, unit))],  // AR.baseRevenue
    [L("Base EBITDA"),   I(money(baseEBITDA, unit))],   // AR.baseEBITDA
  ];

  // ── LBO Model Sheet ───────────────────────────────────────────────────────
  const YH: GridRow = [
    V(null),
    ...years.map(y => V(`FY${y.year}E`, undefined, { bold: true, bg: "subheader", align: "center" })),
  ];

  function lboRevFormula(i: number): string {
    if (i === 1) return `=${A(AR.baseRevenue)}*(1+${A(AR.growth(0))})`;
    return `=${ycr(LM.revenue, i - 1)}*(1+${A(AR.growth(i - 1))})`;
  }

  const colWidths = [230, ...Array(nc).fill(110)];

  const mRows: GridRow[] = [
    [H("LBO Model  —  " + result.ticker, { align: "center" }), ...years.map(() => ({ value: null, bg: "header" } as Cell))],
    [L(unitLbl, { italic: true, color: "muted" }), ...blank(nc)],
    [E(), ...blank(nc)],
    YH,
    [E(), ...blank(nc)],

    // ── Transaction Summary ───────────────────────────────────────────────
    [SH("Transaction Summary (Entry)"), E()],
    [L("Entry Enterprise Value"),
      HI(money(entryEV, unit), `=${A(AR.entryMult)}*${A(AR.baseEBITDA)}`), ...blank(nc - 1)],
    [L("  Sponsor Equity Contribution"),
      V(money(entryEquity, unit), `=${rel(LM.entryEV, 1)}-${rel(LM.entryDebt, 1)}`), ...blank(nc - 1)],
    [L("  Total Debt Financing"),
      V(money(entryDebt, unit), `=${A(AR.leverage)}*${A(AR.baseEBITDA)}`), ...blank(nc - 1)],
    [L("  Entry Leverage  (Debt / EBITDA)"),
      V(mult(leverage), `=${A(AR.leverage)}`), ...blank(nc - 1)],
    [E(), ...blank(nc)],

    // ── Income Statement ──────────────────────────────────────────────────
    [SH("Income Statement Summary"), ...blank(nc)],
    [L("Revenues"), ...years.map((y, i) => V(money(y.rev, unit), lboRevFormula(i + 1)))],
    [L("  % Change Year-over-Year"), ...years.map((_, i) => V(pct(growthRates[i] ?? growthRates.at(-1)), `=${A(AR.growth(i))}`, { color: "muted" }))],
    [E(), ...blank(nc)],
    [L("Cost of Revenues"), ...years.map((y, i) => V(money(-y.cogs, unit), `=-${ycr(LM.revenue, i+1)}*(1-${A(AR.grossMargin)})`, { color: "muted" }))],
    [L("Gross Profit"), ...years.map((y, i) => TOT(money(y.grossProfit, unit), `=${ycr(LM.revenue, i+1)}+${ycr(LM.cogs, i+1)}`))],
    [L("  Gross Margin"), ...years.map(y => V(pct(y.grossProfit / y.rev), `=${A(AR.grossMargin)}`, { color: "muted" }))],
    [E(), ...blank(nc)],
    [L("SG&A and Operating Expenses"), ...years.map((y, i) => V(money(-y.sga, unit), undefined, { color: "muted" }))],
    [L("EBITDA"), ...years.map((y, i) => TOT(money(y.ebitda, unit), `=${ycr(LM.revenue, i+1)}*${A(AR.ebitdaMargin)}`, { bold: true }))],
    [L("  EBITDA Margin"), ...years.map(y => V(pct(y.ebitda / y.rev), `=${A(AR.ebitdaMargin)}`, { color: "muted" }))],
    [E(), ...blank(nc)],
    [L("Depreciation & Amortization"), ...years.map((y, i) => V(money(-y.da, unit), `=-${ycr(LM.revenue, i+1)}*${A(AR.daPct)}`, { color: "muted" }))],
    [L("EBIT  (Operating Income)"), ...years.map((y, i) => TOT(money(y.ebit, unit), `=${ycr(LM.ebitda, i+1)}+${ycr(LM.da, i+1)}`))],
    [L("  EBIT Margin"), ...years.map(y => V(pct(y.ebit / y.rev), undefined, { color: "muted" }))],
    [E(), ...blank(nc)],
    [L("  Interest Expense  (on Outstanding Debt)"),
      ...years.map((y, i) => {
        const dRef = i === 0 ? `${A(AR.leverage)}*${A(AR.baseEBITDA)}` : ycr(LM.endDebt, i);
        return V(money(-y.interest, unit), `=-${dRef}*${A(AR.intRate)}`, { color: "negative" });
      })],
    [L("Pretax Income  (EBT)"), ...years.map((y, i) => V(money(y.ebt, unit), `=${ycr(LM.ebit, i+1)}+${ycr(LM.interest, i+1)}`))],
    [L("  Income Tax Expense"), ...years.map((y, i) => V(money(-y.taxes, unit), `=-MAX(0,${ycr(LM.ebt, i+1)}*${A(AR.taxRate)})`, { color: "muted" }))],
    [L("Net Income"), ...years.map((y, i) => TOT(money(y.netIncome, unit), `=${ycr(LM.ebt, i+1)}+${ycr(LM.taxes, i+1)}`))],
    [L("  Net Income Margin"), ...years.map(y => V(pct(y.netIncome / y.rev), undefined, { color: "muted" }))],
    [E(), ...blank(nc)],

    // ── Cash Flow & Debt Schedule ─────────────────────────────────────────
    [SH("Cash Flow & Debt Repayment Schedule"), ...blank(nc)],
    [L("Net Income"),            ...years.map((y, i) => V(money(y.netIncome, unit), `=${ycr(LM.netIncome, i+1)}`))],
    [L("  (+) Depreciation & Amortization"), ...years.map((y, i) => V(money(y.da, unit), `=-${ycr(LM.da, i+1)}`))],
    [L("  (–) Capital Expenditures"), ...years.map((y, i) => V(money(-y.capex, unit), `=-${ycr(LM.revenue, i+1)}*${A(AR.capexPct)}`))],
    [L("Free Cash Flow  (Available for Debt Service)"),
      ...years.map((y, i) => TOT(money(y.fcf, unit), `=${ycr(LM.cfNetInc, i+1)}+${ycr(LM.cfDA, i+1)}+${ycr(LM.cfCapex, i+1)}`))],
    [L("  Mandatory Debt Repayment"),
      ...years.map((y, i) => {
        const prevDebt = i === 0 ? rel(LM.entryDebt, 1) : ycr(LM.endDebt, i);
        return V(money(y.debtRepaid, unit), `=MIN(${ycr(LM.fcf, i+1)},${prevDebt})`);
      })],
    [L("  Ending Debt Balance"),
      ...years.map((y, i) => {
        const prevDebt = i === 0 ? rel(LM.entryDebt, 1) : ycr(LM.endDebt, i);
        return V(money(y.endDebt, unit), `=${prevDebt}-${ycr(LM.debtRepaid, i+1)}`);
      })],
    [L("  Net Leverage  (Debt / EBITDA)"),
      ...years.map(y => V(ratio(y.endDebt / y.ebitda), undefined, { color: "muted" }))],
    [E(), ...blank(nc)],

    // ── Returns Analysis ──────────────────────────────────────────────────
    [SH("Returns Analysis"), E()],
    [L("Exit EBITDA"),           V(money(exitEBITDA, unit), `=${ycr(LM.ebitda, nc)}`), ...blank(nc - 1)],
    [L("Exit EV / EBITDA Multiple"), V(mult(exitMult), `=${A(AR.exitMult)}`), ...blank(nc - 1)],
    [L("Exit Enterprise Value"), HI(money(exitEV, unit), `=${rel(LM.exitEBITDA, 1)}*${A(AR.exitMult)}`), ...blank(nc - 1)],
    [L("  (–) Exit Debt"),       V(money(-exitDebt, unit), `=-${ycr(LM.endDebt, nc)}`), ...blank(nc - 1)],
    [L("Exit Equity Value"),     HI(money(exitEquity, unit), `=${rel(LM.exitEV, 1)}+${rel(LM.exitDebt, 1)}`), ...blank(nc - 1)],
    [E(), ...blank(nc)],
    [L("MOIC  (Multiple on Invested Capital)"),
      HI(mult(moic), `=${rel(LM.exitEquity, 1)}/${rel(LM.entryEquity, 1)}`), ...blank(nc - 1)],
    [L("IRR  (Internal Rate of Return)"),
      HI(pct(irr), `=(${rel(LM.moic, 1)})^(1/${A(AR.holdingYears)})-1`), ...blank(nc - 1)],
  ];

  return [
    { name: "Assumptions", rows: aRows,  colWidths: [240, 130, ...Array(Math.max(nc - 1, 0)).fill(0)] },
    { name: "LBO Model",   rows: mRows,  colWidths },
  ];
}

// ════════════════════════════════════════════════════════════════════════════════
// Public helpers
// ════════════════════════════════════════════════════════════════════════════════

export function buildSheetsFromResult(result: ValuationResult): Sheet[] {
  return result.valuationType === "dcf"
    ? buildDCFSheets(result)
    : buildLBOSheets(result);
}

export function emptySheets(): Sheet[] {
  const rows: GridRow[] = Array(40).fill(null).map(() =>
    Array(10).fill(null).map(() => ({ value: null } as Cell))
  );
  return [{ name: "Sheet1", rows, colWidths: Array(10).fill(100) }];
}

export function statusSheets(statusLine: string, subLine = ""): Sheet[] {
  const rows: GridRow[] = Array(40).fill(null).map(() =>
    Array(10).fill(null).map(() => ({ value: null } as Cell))
  );
  rows[2][1] = { value: statusLine, italic: true, color: "muted", align: "left" };
  if (subLine) rows[3][1] = { value: subLine, italic: true, color: "muted", align: "left" };
  return [{ name: "Sheet1", rows, colWidths: [300, ...Array(9).fill(100)] }];
}
