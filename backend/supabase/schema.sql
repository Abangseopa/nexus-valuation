-- ============================================================
-- Nexus Valuation — Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- (Project → SQL Editor → New query → paste → Run)
-- ============================================================


-- ─── 1. valuation_sessions ───────────────────────────────────────────────────
-- One row per valuation request.
-- The frontend (Lovable) will poll status until it hits 'complete' or 'error'.

create table if not exists valuation_sessions (
  id               uuid primary key default gen_random_uuid(),
  ticker           text not null,
  company_name     text not null default '',
  valuation_type   text not null check (valuation_type in ('dcf', 'lbo')),
  status           text not null default 'pending'
                     check (status in ('pending', 'fetching_data', 'generating', 'complete', 'error')),

  -- Claude's derived assumptions stored as JSON so we can show them in the UI
  -- and let the user tweak them via chat
  assumptions      jsonb,

  -- Supabase Storage path to the generated Excel file
  file_path        text,

  -- Public download URL (set once file is uploaded to storage)
  file_url         text,

  -- If anything goes wrong we put the message here so the UI can show it
  error_message    text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);


-- ─── 2. sec_cache ────────────────────────────────────────────────────────────
-- Caches raw financial data from SEC EDGAR per ticker.
-- TTL of 24h — if cached_at is older than that we re-fetch.
-- This prevents hammering the SEC API every time someone asks about Apple.

create table if not exists sec_cache (
  ticker           text primary key,
  cik              text not null,
  company_name     text not null,
  financial_data   jsonb not null,   -- full FinancialData object
  cached_at        timestamptz not null default now()
);


-- ─── 3. Auto-update updated_at on sessions ───────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on valuation_sessions;
create trigger set_updated_at
  before update on valuation_sessions
  for each row execute function update_updated_at();


-- ─── 4. Storage bucket for Excel files ───────────────────────────────────────
-- Files are private by default — we generate signed URLs for downloads.

insert into storage.buckets (id, name, public)
values ('valuation-files', 'valuation-files', false)
on conflict (id) do nothing;


-- ─── 5. Storage policy — service role can do anything ────────────────────────
-- The backend uses the service role key so it bypasses RLS entirely.
-- When you add user auth later, add per-user policies here.

create policy "service role full access"
  on storage.objects
  for all
  to service_role
  using (true)
  with check (true);
