// Quick smoke test — run with: npx ts-node src/utils/testSec.ts
import 'dotenv/config';
import { getFinancialData } from '../services/sec';

async function main() {
  const ticker = process.argv[2] || 'AAPL';
  console.log(`\nFetching SEC data for ${ticker}...\n`);

  const data = await getFinancialData(ticker);

  console.log(`Company: ${data.company.name} (CIK: ${data.company.cik})`);
  console.log(`\nIncome Statements (last ${data.incomeStatements.length} years):`);

  for (const is of data.incomeStatements) {
    const fmt = (n: number) => `$${(n / 1e9).toFixed(1)}B`;
    console.log(
      `  ${is.year}  Revenue: ${fmt(is.revenue)}  EBITDA: ${fmt(is.ebitda)}  Net Income: ${fmt(is.netIncome)}`
    );
  }

  console.log('\nCash Flows:');
  for (const cf of data.cashFlows) {
    const fmt = (n: number) => `$${(n / 1e9).toFixed(1)}B`;
    console.log(
      `  ${cf.year}  OCF: ${fmt(cf.operatingCashFlow)}  CapEx: ${fmt(cf.capitalExpenditures)}  FCF: ${fmt(cf.freeCashFlow)}`
    );
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
