import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import valuationRoutes from './routes/valuation';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

// CORS: allow Lovable preview/production domains + localhost dev
// Add your custom domain here if you set one up later
const allowedOrigins = [
  /\.lovable\.app$/,       // all Lovable preview URLs
  /\.lovableproject\.com$/, // Lovable custom domains
  /^http:\/\/localhost/,   // local dev
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some(pattern => pattern.test(origin));
    callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
  },
  credentials: true,
}));

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
