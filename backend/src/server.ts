import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import valuationRoutes from './routes/valuation';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

// CORS: open to all origins — this is a public API, auth is handled via Supabase RLS
app.use(cors());

app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

// All valuation endpoints live under /api/valuation
app.use('/api/valuation', valuationRoutes);

// Health check — Lovable (or any monitoring) can ping this
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Nexus Valuation API running on port ${PORT}`);
});

export default app;
