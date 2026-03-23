import Anthropic from '@anthropic-ai/sdk';
import type {
  FinancialData,
  DCFAssumptions,
  LBOAssumptions,
  ValuationType,
} from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Public entry points ───────────────────────────────────────────────────────

/**
 * Given real SEC financial data, ask Claude to produce model assumptions.
 * Returns DCFAssumptions or LBOAssumptions depending on type.
 */
export async function generateAssumptions(
  financialData: FinancialData,
  type: ValuationType,
  userOverrides: Record<string, unknown> = {}
): Promise<DCFAssumptions | LBOAssumptions> {
  const summary = buildFinancialSummary(financialData);

  const systemPrompt = `You are a senior investment banking analyst specializing in financial modelling.
You will be given historical financials for a public company and asked to generate valuation assumptions.
You must respond with a single valid JSON object — no markdown, no explanation, just JSON.
Base your assumptions on the historical data trends, but apply professional judgement.
All rates should be decimals (e.g. 0.08 for 8%), all dollar values in the same units as the input (usually USD).`;

  const userPrompt = type === 'dcf'
    ? buildDCFPrompt(summary, userOverrides)
    : buildLBOPrompt(summary, financialData, userOverrides);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();

  // Strip any accidental markdown fences Claude might include
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  return JSON.parse(cleaned) as DCFAssumptions | LBOAssumptions;
}

/**
 * Handle a follow-up chat message that adjusts assumptions.
 * e.g. "change WACC to 10%" or "be more aggressive on revenue growth"
 * Returns updated assumptions.
 */
export async function updateAssumptionsFromChat(
  currentAssumptions: DCFAssumptions | LBOAssumptions,
  type: ValuationType,
  userMessage: string
): Promise<DCFAssumptions | LBOAssumptions> {
  const systemPrompt = `You are a senior investment banking analyst.
The user has an existing set of ${type.toUpperCase()} model assumptions and wants to adjust them.
Apply their requested changes and return the complete updated assumptions as a single JSON object.
No markdown, no explanation — only the JSON object.`;

  const userPrompt = `Current assumptions:
${JSON.stringify(currentAssumptions, null, 2)}

User request: "${userMessage}"

Return the full updated JSON assumptions object.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  return JSON.parse(cleaned) as DCFAssumptions | LBOAssumptions;
}

/**
 * Generate a plain-English explanation of the assumptions and what they imply.
 * This is what the chat UI shows the user alongside the download link.
 */
export async function explainAssumptions(
  financialData: FinancialData,
  assumptions: DCFAssumptions | LBOAssumptions,
  type: ValuationType
): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Explain these ${type.toUpperCase()} assumptions for ${financialData.company.name} in 4-5 concise bullet points.
Focus on: what the key assumptions imply about the business, any notable risks, and what drives the valuation.
Be specific with numbers. Write for a finance professional.

Assumptions:
${JSON.stringify(assumptions, null, 2)}

Historical revenue (most recent): $${(financialData.incomeStatements.at(-1)?.revenue ?? 0 / 1e9).toFixed(1)}B
Historical EBITDA margin: ${(((financialData.incomeStatements.at(-1)?.ebitda ?? 0) / (financialData.incomeStatements.at(-1)?.revenue ?? 1)) * 100).toFixed(1)}%`,
    }],
  });

  return (message.content[0] as { type: string; text: string }).text;
}


// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildDCFPrompt(summary: string, overrides: Record<string, unknown>): string {
  const overrideNote = Object.keys(overrides).length > 0
    ? `\nThe user has requested these specific values — use them exactly:\n${JSON.stringify(overrides, null, 2)}`
    : '';

  return `Generate DCF assumptions for the following company based on its historical financials.
${overrideNote}

${summary}

Return a JSON object with exactly these fields:
{
  "revenueGrowthRates": [number, number, number, number, number],  // 5 years, Year1 through Year5
  "ebitdaMargin": number,
  "taxRate": number,
  "capexAsPercentOfRevenue": number,
  "nwcAsPercentOfRevenue": number,
  "terminalGrowthRate": number,
  "wacc": number,
  "forecastYears": 5
}`;
}

function buildLBOPrompt(
  summary: string,
  financialData: FinancialData,
  overrides: Record<string, unknown>
): string {
  const latestEBITDA = financialData.incomeStatements.at(-1)?.ebitda ?? 0;
  const overrideNote = Object.keys(overrides).length > 0
    ? `\nThe user has requested these specific values — use them exactly:\n${JSON.stringify(overrides, null, 2)}`
    : '';

  return `Generate LBO assumptions for the following company based on its historical financials.
${overrideNote}

${summary}

Latest annual EBITDA: $${(latestEBITDA / 1e9).toFixed(2)}B

Return a JSON object with exactly these fields:
{
  "purchasePrice": number,           // enterprise value in same currency units as financials
  "entryEbitdaMultiple": number,     // e.g. 12.5
  "exitEbitdaMultiple": number,      // typically slightly lower than entry
  "holdingPeriodYears": number,      // typically 5
  "debtToEbitda": number,            // leverage at entry, e.g. 5.5
  "interestRate": number,            // on acquisition debt, e.g. 0.065
  "revenueGrowthRates": [number, number, number, number, number],
  "ebitdaMargin": number,
  "taxRate": number,
  "capexAsPercentOfRevenue": number
}`;
}


// ─── Financial summary builder ────────────────────────────────────────────────
// Condenses SEC data into a compact text block for Claude's context window.

function buildFinancialSummary(data: FinancialData): string {
  const fmt = (n: number) => `$${(n / 1e9).toFixed(2)}B`;
  const pct  = (n: number) => `${(n * 100).toFixed(1)}%`;

  const lines: string[] = [
    `Company: ${data.company.name} (${data.company.ticker})`,
    '',
    'Historical Income Statements:',
  ];

  for (const is of data.incomeStatements) {
    const margin = is.revenue > 0 ? is.ebitda / is.revenue : 0;
    lines.push(
      `  ${is.year}: Revenue ${fmt(is.revenue)} | EBITDA ${fmt(is.ebitda)} (${pct(margin)} margin) | Net Income ${fmt(is.netIncome)}`
    );
  }

  lines.push('', 'Historical Cash Flows:');
  for (const cf of data.cashFlows) {
    lines.push(
      `  ${cf.year}: OCF ${fmt(cf.operatingCashFlow)} | CapEx ${fmt(cf.capitalExpenditures)} | FCF ${fmt(cf.freeCashFlow)}`
    );
  }

  if (data.balanceSheets.length > 0) {
    const bs = data.balanceSheets.at(-1)!;
    lines.push('', `Latest Balance Sheet (${bs.year}):`,
      `  Total Assets: ${fmt(bs.totalAssets)} | Total Debt: ${fmt(bs.totalDebt)} | Cash: ${fmt(bs.cash)}`
    );
  }

  // Revenue growth trend
  const stmts = data.incomeStatements;
  if (stmts.length >= 2) {
    lines.push('', 'Revenue Growth (YoY):');
    for (let i = 1; i < stmts.length; i++) {
      const g = (stmts[i].revenue - stmts[i-1].revenue) / stmts[i-1].revenue;
      lines.push(`  ${stmts[i].year}: ${pct(g)}`);
    }
  }

  return lines.join('\n');
}
