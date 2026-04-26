# Cursor for Financial Modelling

**Live app: [nexusaccelno.malva.company](https://nexusaccelno.malva.company)**

AccelNo is an AI-powered DCF and LBO financial modelling tool. Type any company name, and AccelNo fetches real SEC EDGAR 10-K filings, generates a Claude-powered financial model, and renders it live in a Goldman Sachs-grade spreadsheet — all inside a chat interface. No Excel required to get started.

---

## Screenshots

### Split-pane layout — spreadsheet left, AccelNo chat right
![Split pane layout](screenshots/01-layout.png)

### DCF model populating in real time — historical actuals + forecast columns
![DCF model live](screenshots/02-dcf-model.png)

### Full income statement — Revenue → Gross Profit → EBITDA → EBIT → Net Income
![Income statement](screenshots/03-income-statement.png)

### Valuation summary — equity bridge + credit statistics
![Valuation summary](screenshots/04-valuation-summary.png)

### AccelNo chat panel — Home tab with key metrics and analyst notes
![Home tab](screenshots/05-home-tab.png)

---

## What it does

1. **Type naturally** — *"Build me a DCF for Chipotle"* or *"LBO for Microsoft"*
2. **Company resolves automatically** — company name maps to SEC ticker, no manual entry needed
3. **Historical 10-K data is fetched** — 3–5 years of actual income statement, balance sheet, and cash flow data from SEC EDGAR
4. **Claude generates assumptions** — WACC, terminal growth, gross margins, SG&A, capex, NWC, entry/exit multiples — all grounded in historical data
5. **Model runs and renders live in the browser** — the spreadsheet populates with historical actuals (FY2022A, FY2023A) followed by forecast years (FY2025E, FY2026E, …)
6. **Excel is generated in parallel** — downloadable formatted workbook with 4 tabs
7. **Adjust via chat** — type *"lower WACC to 9%"* or *"be more aggressive on growth"* to regenerate

---

## Spreadsheet model — what's included

### Income Statement (historical actuals + 5-year forecast)
- Revenues & Year-over-Year Growth
- Cost of Revenues → **Gross Profit** + Gross Margin %
- SG&A and Operating Expenses → **EBITDA** + EBITDA Margin %
- D&A → **EBIT (Operating Income)** + EBIT Margin %
- Net Interest Expense → **Pretax Income** → Tax Expense → **Net Income** + Net Margin %

### Free Cash Flow Build
- NOPAT (EBIT × (1 – Tax Rate))
- (+) D&A · (–) CapEx · (–) Δ Net Working Capital
- **Unlevered Free Cash Flow** + FCF Conversion ratio

### DCF Analysis
- Mid-year discount factors
- PV of UFCFs per year
- Gordon Growth terminal value + TV as % of Enterprise Value

### Valuation Summary — Equity Bridge
- Sum of PV(FCFs) + PV(Terminal Value) → **Enterprise Value**
- (–) Net Debt → **Equity Value**
- Implied EV/EBITDA exit multiple

### Margin Analysis & Credit Statistics
- Gross / EBITDA / EBIT / Net Income margins (historical + forecast)
- Net Debt / EBITDA · Interest Coverage · FCF Conversion · CapEx / Revenue

### LBO model additionally includes
- Sources & Uses (entry EV, sponsor equity, debt financing)
- Full income statement with interest expense and debt schedule
- Year-by-year debt paydown with ending leverage ratios
- Returns analysis: MOIC + IRR

### Formula references (standard IB practice)
- Input cells (yellow): hardcoded assumptions on the **Assumptions** tab
- Calculation cells: cross-sheet formula references (`=Assumptions!$B$10`) — click any cell to see the formula in the formula bar

---

## Repository structure

```
nexus-valuation/
├── backend/                   # Node.js/TypeScript API — deployed on Railway
│   ├── src/
│   │   ├── routes/
│   │   │   └── valuation.ts   # All API endpoints + background pipeline
│   │   ├── services/
│   │   │   ├── sec.ts         # SEC EDGAR fetcher (income statement, BS, CF)
│   │   │   ├── claude.ts      # Assumption generation + chat updates
│   │   │   ├── valuation.ts   # DCF and LBO model math
│   │   │   ├── excel.ts       # ExcelJS workbook builder
│   │   │   └── supabase.ts    # Session persistence + file storage
│   │   └── types/index.ts     # Shared TypeScript types
│   ├── supabase/schema.sql    # Run once in Supabase SQL Editor
│   ├── railway.json           # Railway deploy config
│   └── package.json
├── ui/                        # React + Vite frontend
│   └── src/
│       ├── components/
│       │   ├── SpreadsheetGrid.tsx   # Excel-like interactive grid
│       │   └── ChatInterface.tsx     # AccelNo chat panel (Home/Data/Chat/Settings)
│       ├── lib/
│       │   ├── spreadsheet-utils.ts  # DCF/LBO cell + formula builders
│       │   └── valuation-api.ts      # API client
│       └── pages/Index.tsx           # Split-pane layout (spreadsheet + chat)
├── screenshots/
└── README.md
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js · TypeScript · Express |
| AI engine | Claude Sonnet 4.6 (Anthropic) |
| Financial data | SEC EDGAR public API — no key required |
| Excel generation | ExcelJS |
| Database + Storage | Supabase (Postgres + Storage buckets) |
| Frontend | React · Vite · Tailwind CSS |
| Deployment | Railway (backend) |

---

## Running locally

### Prerequisites
- Node.js 18+
- A Supabase project (free tier works)
- An Anthropic API key

### 1. Clone

```bash
git clone https://github.com/Abangseopa/nexus-valuation.git
cd nexus-valuation
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env   # then fill in your keys
npm run dev            # starts at http://localhost:3000
```

`.env` values:

```env
ANTHROPIC_API_KEY=your_anthropic_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PORT=3000
```

### 3. Supabase schema

In your Supabase project → **SQL Editor** → paste and run `backend/supabase/schema.sql`.

This creates:
- `valuation_sessions` — tracks every valuation request and status
- `sec_cache` — caches SEC EDGAR data per ticker (24h TTL)
- `valuation-files` storage bucket — stores generated Excel files (signed URLs)

### 4. Frontend

```bash
cd ui
npm install
npm run dev   # starts at http://localhost:5173
```

The UI connects to the Railway production backend by default. To point it at your local backend, update `API_BASE` in `ui/src/lib/valuation-api.ts` to `http://localhost:3000`.

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/valuation/search?q=chipotle` | Resolve company name → ticker |
| `POST` | `/api/valuation/start` | Start a DCF or LBO — returns `sessionId` immediately |
| `GET` | `/api/valuation/status/:id` | Poll status: `pending → fetching_data → generating → complete` |
| `POST` | `/api/valuation/chat` | Adjust assumptions via natural language, triggers regeneration |
| `GET` | `/api/valuation/download/:id` | Get a fresh signed URL for the Excel file |
| `GET` | `/api/valuation/sessions` | List recent sessions |

### Quick example

```bash
# Start a DCF
curl -X POST https://nexus-valuation-production.up.railway.app/api/valuation/start \
  -H "Content-Type: application/json" \
  -d '{"ticker": "CMG", "valuationType": "dcf"}'

# { "success": true, "data": { "sessionId": "abc-123", "status": "pending" } }

# Poll until complete (usually 60–90 seconds)
curl https://nexus-valuation-production.up.railway.app/api/valuation/status/abc-123
```

---

## Deploying the backend to Railway

```bash
cd backend
railway login
railway init          # create service, set root directory to /backend
railway variables set ANTHROPIC_API_KEY=...
railway variables set SUPABASE_URL=...
railway variables set SUPABASE_SERVICE_ROLE_KEY=...
git push origin main  # Railway auto-deploys on push
railway domain        # get your public URL
```

In Railway dashboard → Service → **Root Directory** → `/backend`

> **Note:** Supabase free tier pauses projects after ~1 week of inactivity. If API calls start failing, go to supabase.com/dashboard and click "Restore project".

---

## Environment variables

| Variable | Where to get it |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key |
| `PORT` | Set automatically by Railway; default 3000 locally |
