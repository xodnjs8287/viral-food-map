alter table public.new_product_sources
  add column if not exists parser_type text,
  add column if not exists parser_config jsonb not null default '{}'::jsonb,
  add column if not exists source_origin text not null default 'code',
  add column if not exists discovery_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.new_product_sources
    add constraint new_product_sources_source_origin_check
    check (source_origin in ('code', 'admin'));
exception
  when duplicate_object then null;
end $$;

create index if not exists new_product_sources_origin_idx
  on public.new_product_sources (source_origin, is_active);

create index if not exists new_product_sources_parser_idx
  on public.new_product_sources (parser_type, is_active);
