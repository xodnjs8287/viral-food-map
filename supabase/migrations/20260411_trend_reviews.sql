-- Phase 1: 트렌드 AI 판정 관측 가능성 추가

-- A) trends 테이블에 AI 판정 컬럼 추가
ALTER TABLE public.trends
  ADD COLUMN IF NOT EXISTS ai_verdict text,
  ADD COLUMN IF NOT EXISTS ai_reason text,
  ADD COLUMN IF NOT EXISTS ai_confidence double precision,
  ADD COLUMN IF NOT EXISTS ai_grounding_sources jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_model text;

-- B) trend_reviews 감사 테이블 생성
CREATE TABLE IF NOT EXISTS public.trend_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_id uuid REFERENCES public.trends(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  verdict text NOT NULL,
  confidence double precision NOT NULL DEFAULT 0,
  reason text,
  category text,
  model text,
  grounding_used boolean DEFAULT false,
  grounding_queries jsonb DEFAULT '[]'::jsonb,
  grounding_sources jsonb DEFAULT '[]'::jsonb,
  trigger text,
  score double precision,
  acceleration double precision,
  novelty_lift double precision,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS trend_reviews_keyword_idx
  ON public.trend_reviews (keyword);
CREATE INDEX IF NOT EXISTS trend_reviews_trend_id_idx
  ON public.trend_reviews (trend_id);
CREATE INDEX IF NOT EXISTS trend_reviews_created_at_idx
  ON public.trend_reviews (created_at DESC);

-- C) RLS 정책
ALTER TABLE public.trend_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read trend reviews" ON public.trend_reviews;
CREATE POLICY "Admins can read trend reviews"
  ON public.trend_reviews
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_user()));

DROP POLICY IF EXISTS "Admins can insert trend reviews" ON public.trend_reviews;
CREATE POLICY "Admins can insert trend reviews"
  ON public.trend_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_admin_user()));

-- Phase 3: hysteresis 연속 카운트 컬럼
ALTER TABLE public.trends
  ADD COLUMN IF NOT EXISTS ai_consecutive_accepts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_consecutive_rejects integer NOT NULL DEFAULT 0;

-- Phase 3: status 체크 제약에 watchlist 추가
ALTER TABLE public.trends
  DROP CONSTRAINT IF EXISTS trends_status_check;
ALTER TABLE public.trends
  ADD CONSTRAINT trends_status_check
  CHECK (status IN ('watchlist', 'rising', 'active', 'inactive'));
