// Quick smoke test — run with: npx ts-node src/utils/testValuation.ts
import 'dotenv/config';
import { getFinancialData } from '../services/sec';
import { generateAssumptions, explainAssumptions } from '../services/claude';
import { runDCF } from '../services/valuation';
import type { DCFAssumptions } from '../types';

async function main() {
  const ticker = process.argv[2] || 'AAPL';
  console.log(`\n=== DCF Test: ${ticker} ===\n`);

  console.log('1. Fetching SEC data...');
  const financialData = await getFinancialData(ticker);
  console.log(`   Got ${financialData.incomeStatements.length} years of data for ${financialData.company.name}`);

  console.log('\n2. Asking Claude for DCF assumptions...');
  const assumptions = await generateAssumptions(financialData, 'dcf') as DCFAssumptions;
  console.log('   Assumptions received:');
  console.log(`   WACC: ${(assumptions.wacc * 100).toFixed(1)}%`);
  console.log(`   Terminal Growth: ${(assumptions.terminalGrowthRate * 100).toFixed(1)}%`);
  console.log(`   EBITDA Margin: ${(assumptions.ebitdaMargin * 100).toFixed(1)}%`);
  console.log(`   Revenue Growth: ${assumptions.revenueGrowthRates.map(r => `${(r*100).toFixed(1)}%`).join(', ')}`);

  console.log('\n3. Running DCF model...');
  const result = runDCF(financialData, assumptions);

  const fmt = (n: number) => `$${(n / 1e9).toFixed(1)}B`;
  console.log('\n   Projected Cash Flows:');
  for (const y of result.years) {
    console.log(`   ${y.year}: Revenue ${fmt(y.revenue)} | UFCF ${fmt(y.ufcf)} | PV ${fmt(y.pvUFCF)}`);
  }
  console.log(`\n   Terminal Value:      ${fmt(result.terminalValue)}`);
  console.log(`   PV Terminal Value:   ${fmt(result.pvTerminalValue)}`);
  console.log(`   Enterprise Value:    ${fmt(result.enterpriseValue)}`);
  console.log(`   Net Debt:            ${fmt(result.netDebt)}`);
  console.log(`   Equity Value:        ${fmt(result.equityValue)}`);

  console.log('\n4. Generating explanation...');
  const explanation = await explainAssumptions(financialData, assumptions, 'dcf');
  console.log('\n' + explanation);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
