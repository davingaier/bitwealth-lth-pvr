-- ============================================================================
-- Entity onboarding — Phase 0: data model
-- Date: 2026-08-13
-- Purpose: Support ENTITY clients (companies, trusts, CCs, partnerships, NPOs)
--   alongside individuals.
--   1. customer_details: client_type discriminator + entity columns + a
--      trigger-maintained display_name; relax first_names/last_name NOT NULL
--      (entities have no personal name).
--   2. New public.client_related_persons: directors / trustees / members /
--      beneficial owners / authorised reps. Each is a KYC subject captured
--      WITHIN the single entity Finova payload (no separate Finova client/uuid).
--      Per-director KYC status lives here (NOT in kyc_finova, which stays one
--      row per customer so ef_confirm_strategy's onConflict:customer_id upsert
--      keeps working).
-- ============================================================================

-- 1. customer_details: client_type + entity columns --------------------------
ALTER TABLE public.customer_details
  ADD COLUMN IF NOT EXISTS client_type                     text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS entity_name                     text,
  ADD COLUMN IF NOT EXISTS entity_type                     text,   -- company|trust|close_corporation|partnership|npo|other
  ADD COLUMN IF NOT EXISTS entity_registration_number      text,
  ADD COLUMN IF NOT EXISTS entity_vat_number               text,
  ADD COLUMN IF NOT EXISTS entity_country_of_incorporation text,
  ADD COLUMN IF NOT EXISTS entity_tax_number               text,
  ADD COLUMN IF NOT EXISTS nature_of_business              text,
  ADD COLUMN IF NOT EXISTS industry                        text,
  ADD COLUMN IF NOT EXISTS government_tenders              text,
  ADD COLUMN IF NOT EXISTS number_of_directors            integer,
  ADD COLUMN IF NOT EXISTS largest_shareholder            text,
  ADD COLUMN IF NOT EXISTS largest_shareholder_holding    text,
  ADD COLUMN IF NOT EXISTS display_name                   text;

ALTER TABLE public.customer_details
  DROP CONSTRAINT IF EXISTS chk_customer_details_client_type;
ALTER TABLE public.customer_details
  ADD CONSTRAINT chk_customer_details_client_type
    CHECK (client_type IN ('individual','entity'));

-- Entities have no personal name.
ALTER TABLE public.customer_details ALTER COLUMN first_names DROP NOT NULL;
ALTER TABLE public.customer_details ALTER COLUMN last_name  DROP NOT NULL;

-- display_name: entity_name for entities, else "First Last". Trigger-maintained
-- so existing name-building queries can migrate to it incrementally.
CREATE OR REPLACE FUNCTION public.customer_details_set_display_name()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.display_name := CASE
    WHEN NEW.client_type = 'entity'
      THEN COALESCE(NEW.entity_name, NEW.display_name, NEW.email)
    ELSE COALESCE(NULLIF(TRIM(COALESCE(NEW.first_names,'') || ' ' || COALESCE(NEW.last_name,'')), ''),
                  NEW.entity_name, NEW.email)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_details_display_name ON public.customer_details;
CREATE TRIGGER trg_customer_details_display_name
  BEFORE INSERT OR UPDATE ON public.customer_details
  FOR EACH ROW EXECUTE FUNCTION public.customer_details_set_display_name();

-- Backfill display_name for existing rows.
UPDATE public.customer_details
   SET display_name = COALESCE(
         NULLIF(TRIM(COALESCE(first_names,'') || ' ' || COALESCE(last_name,'')), ''),
         entity_name, email)
 WHERE display_name IS NULL;

-- 2. client_related_persons ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_related_persons (
  related_person_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id             uuid,
  customer_id        bigint NOT NULL REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  role               text NOT NULL DEFAULT 'director',
                       -- director | authorized_representative | beneficial_owner | shareholder | trustee | member | partner
  is_authorized_rep  boolean NOT NULL DEFAULT false,
  can_login          boolean NOT NULL DEFAULT false,
  shareholding_pct   numeric,

  -- Person identity / KYC
  title              text,
  first_names        text,
  last_name          text,
  id_type            text,
  id_number          text,
  id_passport_number text,
  date_of_birth      date,
  gender             text,
  marital_status     text,
  place_of_birth     text,
  country_of_birth   text,
  nationality        text,
  country_of_residence text,
  email              text,
  phone_country_code text,
  phone_number       text,
  occupation         text,
  job_description    text,
  department         text,
  employer_name      text,
  employer_nature_of_business text,
  tax_number         text,
  registered_for_tax_other text,
  source_of_funds    text,
  source_of_income   text,
  source_of_wealth   text,
  address_line1      text,
  address_line2      text,
  address_line3      text,
  city               text,
  province           text,
  postal_code        text,
  country            text,

  -- Re-hosted KYC document URLs
  kyc_id_document_url text,
  kyc_selfie_url      text,
  kyc_id_backside_url text,
  kyc_proof_address_url text,

  -- Per-director Finova KYC tracking (directors have no uuid; client_id may
  -- appear in the nested payload metadata).
  finova_client_id   text,
  finova_status      text,          -- invited | in_progress | passed | rejected | review
  client_risk_score  numeric,
  liveness_risk_score numeric,
  doc_discrepancy_risk_score numeric,
  screening          jsonb,
  last_payload       jsonb,

  -- Optional portal login (single-rep now; multi-director login is a future enhancement).
  auth_user_id       uuid,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_related_persons_customer
  ON public.client_related_persons(customer_id);

COMMENT ON TABLE public.client_related_persons IS
  'Directors / trustees / members / beneficial owners / authorised reps linked to an entity customer_details row. KYC subjects captured within the entity Finova payload. Service-role only (RLS enabled, no policies); access via SECURITY DEFINER RPCs.';

ALTER TABLE public.client_related_persons ENABLE ROW LEVEL SECURITY;

-- 3. Reader + writer RPCs (table is RLS-no-policy) ----------------------------
CREATE OR REPLACE FUNCTION public.list_entity_directors(p_customer_id bigint)
RETURNS SETOF public.client_related_persons
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.client_related_persons
   WHERE customer_id = p_customer_id
   ORDER BY is_authorized_rep DESC, related_person_id;
$$;

-- Upsert a related person from a jsonb of allowed fields. p_related_person_id
-- NULL => insert, else update.
CREATE OR REPLACE FUNCTION public.upsert_entity_director(
  p_customer_id bigint,
  p_data jsonb,
  p_related_person_id bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id  bigint;
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.customer_details WHERE customer_id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer % not found', p_customer_id; END IF;

  IF p_related_person_id IS NULL THEN
    INSERT INTO public.client_related_persons (customer_id, org_id, role)
    VALUES (p_customer_id, v_org, COALESCE(p_data->>'role','director'))
    RETURNING related_person_id INTO v_id;
  ELSE
    v_id := p_related_person_id;
  END IF;

  UPDATE public.client_related_persons SET
    role                = COALESCE(p_data->>'role', role),
    is_authorized_rep   = COALESCE((p_data->>'is_authorized_rep')::boolean, is_authorized_rep),
    can_login           = COALESCE((p_data->>'can_login')::boolean, can_login),
    shareholding_pct    = COALESCE((p_data->>'shareholding_pct')::numeric, shareholding_pct),
    title               = COALESCE(p_data->>'title', title),
    first_names         = COALESCE(p_data->>'first_names', first_names),
    last_name           = COALESCE(p_data->>'last_name', last_name),
    id_type             = COALESCE(p_data->>'id_type', id_type),
    id_number           = COALESCE(p_data->>'id_number', id_number),
    id_passport_number  = COALESCE(p_data->>'id_passport_number', id_passport_number),
    date_of_birth       = COALESCE((p_data->>'date_of_birth')::date, date_of_birth),
    gender              = COALESCE(p_data->>'gender', gender),
    nationality         = COALESCE(p_data->>'nationality', nationality),
    country_of_residence= COALESCE(p_data->>'country_of_residence', country_of_residence),
    email               = COALESCE(p_data->>'email', email),
    phone_country_code  = COALESCE(p_data->>'phone_country_code', phone_country_code),
    phone_number        = COALESCE(p_data->>'phone_number', phone_number),
    occupation          = COALESCE(p_data->>'occupation', occupation),
    tax_number          = COALESCE(p_data->>'tax_number', tax_number),
    source_of_funds     = COALESCE(p_data->>'source_of_funds', source_of_funds),
    source_of_income    = COALESCE(p_data->>'source_of_income', source_of_income),
    source_of_wealth    = COALESCE(p_data->>'source_of_wealth', source_of_wealth),
    address_line1       = COALESCE(p_data->>'address_line1', address_line1),
    address_line2       = COALESCE(p_data->>'address_line2', address_line2),
    address_line3       = COALESCE(p_data->>'address_line3', address_line3),
    city                = COALESCE(p_data->>'city', city),
    province            = COALESCE(p_data->>'province', province),
    postal_code         = COALESCE(p_data->>'postal_code', postal_code),
    country             = COALESCE(p_data->>'country', country),
    updated_at          = now()
  WHERE related_person_id = v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_entity_director(p_related_person_id bigint)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.client_related_persons WHERE related_person_id = p_related_person_id
  RETURNING true;
$$;

GRANT EXECUTE ON FUNCTION public.list_entity_directors(bigint)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_entity_director(bigint, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_entity_director(bigint)                TO authenticated;
