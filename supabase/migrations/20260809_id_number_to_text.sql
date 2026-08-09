-- ============================================================================
-- SA ID number: numeric -> text
-- Date: 2026-08-09
-- Purpose: A numeric id_number silently drops leading zeros, so a 13-digit SA ID
--          like 0005035092088 was stored as 5035092088. SA ID numbers are
--          identifiers (leading zeros significant), so store them as text.
--          The v_fic_kyc_completeness view references id_number only via
--          IS NOT NULL, so it is dropped and recreated verbatim.
-- Applied to the remote project via Supabase MCP.
-- ============================================================================

DROP VIEW IF EXISTS public.v_fic_kyc_completeness;

ALTER TABLE public.customer_details
  ALTER COLUMN id_number TYPE text USING id_number::text;

CREATE VIEW public.v_fic_kyc_completeness AS
 SELECT cd.customer_id,
    cd.org_id,
    cd.first_names,
    cd.last_name,
    cd.email,
    cd.registration_status,
    cd.date_of_birth IS NOT NULL AS has_dob,
    cd.id_number IS NOT NULL OR cd.id_passport_number IS NOT NULL AS has_id_number,
    cd.id_type IS NOT NULL AS has_id_type,
    cd.id_expiry_date IS NOT NULL AS has_id_expiry,
    cd.nationality IS NOT NULL AS has_nationality,
    cd.country_of_residence IS NOT NULL AS has_country_of_residence,
    cd.occupation IS NOT NULL AS has_occupation,
    cd.tax_number IS NOT NULL AS has_tax_number,
    cd.fic_source_of_funds IS NOT NULL AS has_source_of_funds,
    true AS has_pep_status,
    cd.kyc_id_document_url IS NOT NULL AS has_id_document,
    cd.kyc_proof_address_url IS NOT NULL AS has_proof_of_address,
    cd.kyc_source_of_income IS NOT NULL AS has_income_source,
    cd.kyc_source_of_income_doc_url IS NOT NULL AS has_income_doc,
    ba.bank_confirmation_url IS NOT NULL AS has_bank_confirmation,
    tfs.result AS latest_tfs_result,
    tfs.screened_at AS latest_tfs_screened_at,
    (cd.date_of_birth IS NOT NULL)::integer + (cd.id_number IS NOT NULL OR cd.id_passport_number IS NOT NULL)::integer + (cd.id_type IS NOT NULL)::integer + (cd.id_expiry_date IS NOT NULL)::integer + (cd.nationality IS NOT NULL)::integer + (cd.country_of_residence IS NOT NULL)::integer + (cd.occupation IS NOT NULL)::integer + (cd.tax_number IS NOT NULL)::integer + (cd.fic_source_of_funds IS NOT NULL)::integer + (cd.kyc_id_document_url IS NOT NULL)::integer + (cd.kyc_proof_address_url IS NOT NULL)::integer + (cd.kyc_source_of_income IS NOT NULL)::integer + (cd.kyc_source_of_income_doc_url IS NOT NULL)::integer + (ba.bank_confirmation_url IS NOT NULL)::integer + (tfs.result = 'clear'::text)::integer AS fic_completeness_score,
    15 AS fic_completeness_max,
    cd.fic_kyc_reviewed_at,
    cd.fic_kyc_reviewed_by
   FROM customer_details cd
     LEFT JOIN LATERAL ( SELECT bank_accounts.bank_confirmation_url
           FROM bank_accounts
          WHERE bank_accounts.customer_id = cd.customer_id AND bank_accounts.is_primary
         LIMIT 1) ba ON true
     LEFT JOIN LATERAL ( SELECT tfs_screening_log.result,
            tfs_screening_log.screened_at
           FROM fic.tfs_screening_log
          WHERE tfs_screening_log.customer_id = cd.customer_id
          ORDER BY tfs_screening_log.screened_at DESC
         LIMIT 1) tfs ON true
  WHERE cd.registration_status IS NULL OR cd.registration_status <> 'inactive'::text;

GRANT ALL ON public.v_fic_kyc_completeness TO anon, authenticated, service_role;
