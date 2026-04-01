create table if not exists public.keyword_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  alias_normalized text not null,
  canonical_keyword text not null,
  canonical_normalized text not null,
  confidence double precision,
  source_job text not null,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists keyword_aliases_alias_normalized_key
  on public.keyword_aliases (alias_normalized);

create index if not exists keyword_aliases_canonical_normalized_idx
  on public.keyword_aliases (canonical_normalized);

create table if not exists public.ai_automation_usage (
  id uuid primary key default gen_random_uuid(),
  usage_date date not null,
  job_name text not null,
  trigger text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_automation_usage_usage_date_idx
  on public.ai_automation_usage (usage_date);
