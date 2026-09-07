-- Backend-only registry mapping Meta WhatsApp phone_number_id to LJ workspace.
-- The webhook must fail closed once registry rows exist, preventing cross-workspace message routing.
create table public.lji_whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lji_workspaces(id) on delete cascade,
  provider text not null default 'meta_cloud_api' check (provider in ('meta_cloud_api')),
  phone_number_id text not null,
  display_phone_number text,
  waba_id text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lji_whatsapp_accounts_phone_number_id_nonempty check (btrim(phone_number_id) <> ''),
  constraint lji_whatsapp_accounts_phone_number_id_key unique (phone_number_id)
);

create index lji_whatsapp_accounts_workspace_active_idx
  on public.lji_whatsapp_accounts(workspace_id, is_active);

alter table public.lji_whatsapp_accounts enable row level security;

revoke all on table public.lji_whatsapp_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.lji_whatsapp_accounts to service_role;

create trigger trg_lji_whatsapp_accounts_updated_at
before update on public.lji_whatsapp_accounts
for each row execute function public.lji_set_updated_at();

comment on table public.lji_whatsapp_accounts is
  'Backend-only registry mapping Meta WhatsApp phone_number_id to an LJ workspace. Webhook resolution must fail closed once registry rows exist.';
