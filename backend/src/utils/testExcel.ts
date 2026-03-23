// Quick smoke test — run with: npx ts-node src/utils/testExcel.ts [TICKER] [dcf|lbo]
import 'dotenv/config';
import fs from 'fs';
import { getFinancialData } from '../services/sec';
import { generateAssumptions } from '../services/claude';
import { runDCF, runLBO } from '../services/valuation';
import { buildDCFExcel, buildLBOExcel } from '../services/excel';
import type { DCFAssumptions, LBOAssumptions } from '../types';

async function main() {
  const ticker = process.argv[2] || 'AAPL';
  const type   = (process.argv[3] || 'dcf') as 'dcf' | 'lbo';

  console.log(`\nBuilding ${type.toUpperCase()} Excel for ${ticker}...\n`);

  const financialData = await getFinancialData(ticker);
  console.log(`Got data for: ${financialData.company.name}`);

  const assumptions = await generateAssumptions(financialData, type);
  console.log('Assumptions generated.');

  let buffer: Buffer;
  if (type === 'dcf') {
    const result = runDCF(financialData, assumptions as DCFAssumptions);
    buffer = await buildDCFExcel(financialData, result);
    console.log(`EV: $${(result.enterpriseValue / 1e9).toFixed(1)}B`);
  } else {
    const result = runLBO(financialData, assumptions as LBOAssumptions);
    buffer = await buildLBOExcel(financialData, result);
    console.log(`MOIC: ${result.moic.toFixed(1)}x  IRR: ${(result.irr * 100).toFixed(1)}%`);
  }

  const outPath = `/tmp/${ticker}_${type}.xlsx`;
  fs.writeFileSync(outPath, buffer);
  console.log(`\nExcel saved to: ${outPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
