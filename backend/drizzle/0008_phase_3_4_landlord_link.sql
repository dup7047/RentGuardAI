-- Phase 3.4: link buildings to their registered owner in landlords table.
-- Adds FK column on buildings, indexes for lookup performance, and a
-- unique partial index on normalized owner name for ON CONFLICT upserts.

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS registered_owner_landlord_id uuid
  REFERENCES public.landlords(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_landlord_id
  ON public.buildings (registered_owner_landlord_id);

-- Enables ON CONFLICT DO UPDATE on lower(registered_owner_name)
-- in the landlord upsert path (src/data/landlord.ts).
CREATE UNIQUE INDEX IF NOT EXISTS uq_landlords_owner_name_lower
  ON public.landlords (lower(registered_owner_name))
  WHERE registered_owner_name IS NOT NULL;
