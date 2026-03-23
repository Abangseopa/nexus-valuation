# Nexus Valuation — UI

The frontend is built with [Lovable](https://lovable.dev) and connects directly to:
- **Supabase** — for session history (reads `valuation_sessions` table)
- **Backend API** — `https://nexus-valuation-production.up.railway.app`

## Lovable Project

Open and edit the UI at: https://lovable.dev (search your projects for "Nexus Valuation")

## How it connects to the backend

| Action | API Call |
|--------|----------|
| Resolve company name → ticker | `GET /api/valuation/search?q={name}` |
| Start a DCF or LBO | `POST /api/valuation/start` |
| Poll for status | `GET /api/valuation/status/:sessionId` |
| Adjust assumptions via chat | `POST /api/valuation/chat` |
| Download Excel | `GET /api/valuation/download/:sessionId` |
| Session history (sidebar) | Supabase `valuation_sessions` table directly |
