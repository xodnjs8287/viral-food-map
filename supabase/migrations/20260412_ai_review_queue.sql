create table if not exists public.ai_review_queue (
  id uuid primary key default gen_random_uuid(),
  source_job text not null,
  item_type text not null check (item_type in ('keyword', 'trend')),
  candidate_key text not null,
  candidate_name text not null,
  category text,
  confidence double precision not null default 0,
  ai_verdict text not null default 'review',
  reason text,
  model text,
  trend_id uuid references public.trends(id) on delete set null,
  trigger text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_review_queue_status_created_at_idx
  on public.ai_review_queue (status, created_at desc);

create index if not exists ai_review_queue_item_type_created_at_idx
  on public.ai_review_queue (item_type, created_at desc);

create index if not exists ai_review_queue_trend_id_idx
  on public.ai_review_queue (trend_id);

create unique index if not exists ai_review_queue_pending_candidate_idx
  on public.ai_review_queue (item_type, candidate_key)
  where status = 'pending';

alter table public.ai_review_queue enable row level security;

drop policy if exists "Admins can read ai review queue" on public.ai_review_queue;
create policy "Admins can read ai review queue"
  on public.ai_review_queue
  for select
  to authenticated
  using ((select public.is_admin_user()));

drop policy if exists "Admins can insert ai review queue" on public.ai_review_queue;
create policy "Admins can insert ai review queue"
  on public.ai_review_queue
  for insert
  to authenticated
  with check ((select public.is_admin_user()));

drop policy if exists "Admins can update ai review queue" on public.ai_review_queue;
create policy "Admins can update ai review queue"
  on public.ai_review_queue
  for update
  to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

drop policy if exists "Admins can delete ai review queue" on public.ai_review_queue;
create policy "Admins can delete ai review queue"
  on public.ai_review_queue
  for delete
  to authenticated
  using ((select public.is_admin_user()));
