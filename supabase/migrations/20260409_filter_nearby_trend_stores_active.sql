create or replace function public.get_nearby_trend_stores(
  user_lat double precision,
  user_lng double precision,
  result_limit integer default 5
)
returns table (
  id uuid,
  trend_id uuid,
  name text,
  address text,
  lat double precision,
  lng double precision,
  phone text,
  place_url text,
  rating numeric,
  source text,
  verified boolean,
  last_updated timestamptz,
  trend_name text,
  distance_km double precision
)
language sql
stable
as $$
  select
    s.id,
    s.trend_id,
    s.name,
    s.address,
    s.lat,
    s.lng,
    s.phone,
    s.place_url,
    s.rating,
    s.source,
    s.verified,
    s.last_updated,
    t.name as trend_name,
    (
      6371 * acos(
        least(
          1,
          greatest(
            -1,
            cos(radians(user_lat)) * cos(radians(s.lat)) * cos(radians(s.lng) - radians(user_lng)) +
            sin(radians(user_lat)) * sin(radians(s.lat))
          )
        )
      )
    ) as distance_km
  from public.stores s
  inner join public.trends t
    on t.id = s.trend_id
   and t.status in ('rising', 'active')
  order by distance_km asc
  limit greatest(result_limit, 1);
$$;
