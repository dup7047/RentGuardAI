-- Phase 1.6: Supabase Storage buckets + RLS policies (hand-written, --custom)
--
-- Creates two buckets:
--   • lease-pdfs  (private) — service role reads/writes all;
--                             authenticated users SELECT their own folder only;
--                             anonymous users access only via backend-issued signed URLs.
--   • firm-logos (public)   — public reads; service role writes (Phase 7 B2B).
--
-- Path conventions (enforced by RLS, not the schema):
--   Authenticated lease:  lease-pdfs/{user_id}/{lease_review_id}.pdf
--   Anonymous lease:      lease-pdfs/anon/{anon_token}/{lease_review_id}.pdf
--   Firm logo:            firm-logos/{org_id}/logo.png

-- ─── Buckets ──────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('lease-pdfs',  'lease-pdfs',  false, 52428800,  ARRAY['application/pdf']),
  ('firm-logos',  'firm-logos',  true,  5242880,   ARRAY['image/jpeg','image/png','image/webp','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- ─── RLS policies on storage.objects ─────────────────────────────────────────
--
-- storage.objects already has RLS enabled by Supabase.
-- We add policies scoped per bucket_id so each table share a single policy
-- namespace without collisions.

-- lease-pdfs: authenticated users can SELECT files under their own user_id folder.
-- (storage.foldername(name))[1] = first path segment, which must equal auth.uid().
-- Anonymous users have NO SELECT policy — they must use a backend-issued signed URL.
-- Nobody (anon or authenticated) has INSERT/UPDATE/DELETE policies;
-- all writes go through the service role (BYPASSRLS).
CREATE POLICY "lease_pdfs_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'lease-pdfs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- firm-logos: public read for both anonymous and authenticated users.
-- This lets the Next.js frontend render firm logos without an auth token
-- (B2B Phase 7). All writes remain service-role-only.
CREATE POLICY "firm_logos_select_public"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'firm-logos');
