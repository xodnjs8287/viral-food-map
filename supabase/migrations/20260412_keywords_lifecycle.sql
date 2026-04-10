-- 키워드 생명주기 최소 스키마
ALTER TABLE public.keywords
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.keywords
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;

UPDATE public.keywords
SET source = 'manual'
WHERE source IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'keywords_source_check'
  ) THEN
    ALTER TABLE public.keywords
      ADD CONSTRAINT keywords_source_check
      CHECK (source IN ('manual', 'discovered'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS keywords_active_source_idx
  ON public.keywords (is_active, source);

CREATE INDEX IF NOT EXISTS keywords_last_confirmed_at_idx
  ON public.keywords (last_confirmed_at);
