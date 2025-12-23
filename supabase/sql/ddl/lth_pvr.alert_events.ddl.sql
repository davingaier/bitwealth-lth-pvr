-- 1) Alerts table for LTH PVR

create table if not exists lth_pvr.alert_events (
  alert_id        uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  -- Where did it come from?
  component       text        not null,  -- e.g. 'ef_fetch_ci_bands', 'ef_post_ledger_and_balances'

  -- How serious is it?
  severity        text        not null check (severity in ('info','warn','error','critical')),

  -- Optional scoping
  org_id          uuid        null,
  customer_id     bigint      null,
  portfolio_id    uuid        null,

  -- Human-readable message
  message         text        not null,

  -- Extra context for debugging (payloads, ids, etc.)
  context         jsonb       not null default '{}'::jsonb,

  -- Resolution tracking
  resolved_at     timestamptz null,
  resolved_by     text        null,
  resolution_note text        null
);

-- Helpful indexes for querying
create index if not exists idx_lth_alerts_created_at
  on lth_pvr.alert_events (created_at desc);

create index if not exists idx_lth_alerts_unresolved
  on lth_pvr.alert_events (severity, created_at)
  where resolved_at is null;
