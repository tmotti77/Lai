-- Phase 3b: CV uploads
-- One row per uploaded CV. Latest-per-user retrieved via ORDER BY created_at DESC.
-- Inserts/updates go through service role (lib/db/cv.ts). RLS only allows users to
-- SELECT their own rows from the client (defense in depth — anonymous users go
-- through service role anyway).

CREATE TABLE IF NOT EXISTS public.cv_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  extracted_text TEXT,
  reflection_he TEXT,
  extracted_skills JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cv_uploads_user_id_idx
  ON public.cv_uploads (user_id, created_at DESC);

ALTER TABLE public.cv_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cv_uploads_select_own" ON public.cv_uploads;
CREATE POLICY "cv_uploads_select_own" ON public.cv_uploads
  FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users WHERE auth_id = auth.uid()
    )
  );

-- ============================================================================
-- Storage bucket: cv-uploads
-- ============================================================================
-- Stores the original uploaded files (PDF/DOCX). Path convention:
--   <user_id>/<random_uuid>.<ext>
-- Reads + writes go through service role from app server.
-- Auto-deletion after 30 days: configured via Supabase Dashboard lifecycle
-- rules (no pure-SQL primitive for this — see CLAUDE.md Phase 3b notes).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('cv-uploads', 'cv-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated owners can read their own files. Service role bypasses RLS.
DROP POLICY IF EXISTS "cv_storage_select_own" ON storage.objects;
CREATE POLICY "cv_storage_select_own" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'cv-uploads' AND
    (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM public.users WHERE auth_id = auth.uid()
    )
  );
