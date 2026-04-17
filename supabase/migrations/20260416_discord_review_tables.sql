create table if not exists public.discord_review_messages (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null check (entity_kind in ('ai_review', 'ai_alias', 'report')),
  entity_id uuid not null,
  channel_id text not null,
  message_id text,
  state text not null default 'active' check (state in ('active', 'resolved', 'stale', 'failed')),
  posted_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  last_error text
);

create unique index if not exists discord_review_messages_entity_channel_uq
  on public.discord_review_messages (entity_kind, entity_id, channel_id);

create index if not exists discord_review_messages_state_updated_idx
  on public.discord_review_messages (state, updated_at desc);

create table if not exists public.discord_review_action_logs (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null check (entity_kind in ('ai_review', 'ai_alias', 'report')),
  entity_id uuid not null,
  action text not null,
  outcome text not null check (outcome in ('success', 'noop', 'error')),
  discord_user_id text not null,
  discord_username text not null,
  channel_id text not null,
  message_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists discord_review_action_logs_entity_created_idx
  on public.discord_review_action_logs (entity_kind, entity_id, created_at desc);

alter table public.discord_review_messages enable row level security;
alter table public.discord_review_action_logs enable row level security;

drop policy if exists "Admins can read discord review messages" on public.discord_review_messages;
create policy "Admins can read discord review messages"
  on public.discord_review_messages
  for select
  to authenticated
  using ((select public.is_admin_user()));

drop policy if exists "Admins can read discord review action logs" on public.discord_review_action_logs;
create policy "Admins can read discord review action logs"
  on public.discord_review_action_logs
  for select
  to authenticated
  using ((select public.is_admin_user()));
