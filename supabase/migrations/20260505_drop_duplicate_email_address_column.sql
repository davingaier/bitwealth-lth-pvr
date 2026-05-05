-- Migration: Drop the duplicate `customer_details.email_address` column.
-- ============================================================================
-- Background: `public.customer_details` historically had two email columns:
--   * `email`         — the canonical column used by virtually every edge fn
--                       and the auth/portal layer.
--   * `email_address` — a legacy column kept in sync via UI back-mirroring
--                       and `ef_prospect_submit` writes.
-- Today we drop `email_address`. All read-paths that previously coalesced
-- (`coalesce(email, email_address)`) now read `email` only. Two views and
-- five RPCs that referenced `email_address` are recreated to source from
-- `cd.email` instead.
-- ============================================================================

BEGIN;

-- 1) Backfill any rows where email_address has data but email is null
--    (defensive — should be zero rows in production but cheap insurance).
UPDATE public.customer_details
   SET email = email_address
 WHERE email IS NULL AND email_address IS NOT NULL;

-- 2) Drop dependent objects so the column drop succeeds.
DROP VIEW IF EXISTS lth_pvr.v_fills_with_customer;
DROP VIEW IF EXISTS public.v_fic_kyc_completeness;
DROP FUNCTION IF EXISTS public.list_fic_kyc_incomplete();
DROP FUNCTION IF EXISTS public.list_fic_atms_alerts(boolean);
DROP FUNCTION IF EXISTS public.list_fic_tfs_alerts(boolean);
DROP FUNCTION IF EXISTS public.list_support_tickets(text, text, text, integer);
DROP FUNCTION IF EXISTS public.get_support_ticket(uuid);
DROP FUNCTION IF EXISTS public.is_ticket_owner(bigint);

-- 3) Drop the duplicate column.
ALTER TABLE public.customer_details DROP COLUMN email_address;

-- 4) Recreate views sourcing from `cd.email`.

CREATE VIEW lth_pvr.v_fills_with_customer AS
SELECT f.org_id,
       cd.customer_id,
       cd.first_names,
       cd.last_name,
       cd.email,
       cd.cellphone_number,
       f.fill_id,
       f.exchange_order_id,
       f.trade_ts,
       f.price            AS fill_price,
       f.qty              AS fill_qty,
       f.fee_asset,
       f.fee_qty,
       f.created_at       AS fill_created_at,
       eo.exchange_account_id,
       eo.ext_order_id,
       eo.pair            AS order_pair,
       eo.side            AS order_side,
       eo.price           AS order_price,
       eo.qty             AS order_qty,
       eo.status          AS order_status,
       eo.submitted_at    AS order_submitted_at,
       eo.updated_at      AS order_updated_at,
       eo.raw             AS order_raw,
       i.intent_id,
       i.trade_date,
       i.side             AS intent_side,
       i.limit_price      AS intent_limit_price,
       i.amount           AS intent_amount,
       i.base_asset,
       i.quote_asset,
       i.reason           AS intent_reason,
       i.note             AS intent_note,
       i.status           AS intent_status,
       i.created_at       AS intent_created_at
  FROM lth_pvr.order_fills f
  JOIN lth_pvr.exchange_orders eo
    ON eo.exchange_order_id = f.exchange_order_id AND eo.org_id = f.org_id
  JOIN lth_pvr.order_intents i
    ON i.intent_id = eo.intent_id AND i.org_id = eo.org_id
  JOIN public.customer_details cd
    ON cd.customer_id = i.customer_id AND cd.org_id = i.org_id;

CREATE VIEW public.v_fic_kyc_completeness AS
SELECT cd.customer_id,
       cd.org_id,
       cd.first_names,
       cd.last_name,
       cd.email,
       cd.registration_status,
       cd.date_of_birth IS NOT NULL                                    AS has_dob,
       (cd.id_number IS NOT NULL OR cd.id_passport_number IS NOT NULL) AS has_id_number,
       cd.id_type IS NOT NULL                                          AS has_id_type,
       cd.id_expiry_date IS NOT NULL                                   AS has_id_expiry,
       cd.nationality IS NOT NULL                                      AS has_nationality,
       cd.country_of_residence IS NOT NULL                             AS has_country_of_residence,
       cd.occupation IS NOT NULL                                       AS has_occupation,
       cd.tax_number IS NOT NULL                                       AS has_tax_number,
       cd.fic_source_of_funds IS NOT NULL                              AS has_source_of_funds,
       true                                                            AS has_pep_status,
       cd.kyc_id_document_url IS NOT NULL                              AS has_id_document,
       cd.kyc_proof_address_url IS NOT NULL                            AS has_proof_of_address,
       cd.kyc_source_of_income IS NOT NULL                             AS has_income_source,
       cd.kyc_source_of_income_doc_url IS NOT NULL                     AS has_income_doc,
       ba.bank_confirmation_url IS NOT NULL                            AS has_bank_confirmation,
       tfs.result        AS latest_tfs_result,
       tfs.screened_at   AS latest_tfs_screened_at,
       (cd.date_of_birth IS NOT NULL)::int
       + (cd.id_number IS NOT NULL OR cd.id_passport_number IS NOT NULL)::int
       + (cd.id_type IS NOT NULL)::int
       + (cd.id_expiry_date IS NOT NULL)::int
       + (cd.nationality IS NOT NULL)::int
       + (cd.country_of_residence IS NOT NULL)::int
       + (cd.occupation IS NOT NULL)::int
       + (cd.tax_number IS NOT NULL)::int
       + (cd.fic_source_of_funds IS NOT NULL)::int
       + (cd.kyc_id_document_url IS NOT NULL)::int
       + (cd.kyc_proof_address_url IS NOT NULL)::int
       + (cd.kyc_source_of_income IS NOT NULL)::int
       + (cd.kyc_source_of_income_doc_url IS NOT NULL)::int
       + (ba.bank_confirmation_url IS NOT NULL)::int
       + (tfs.result = 'clear')::int                                   AS fic_completeness_score,
       15                                                              AS fic_completeness_max,
       cd.fic_kyc_reviewed_at,
       cd.fic_kyc_reviewed_by
  FROM public.customer_details cd
  LEFT JOIN LATERAL (
        SELECT bank_accounts.bank_confirmation_url
          FROM public.bank_accounts
         WHERE bank_accounts.customer_id = cd.customer_id AND bank_accounts.is_primary
         LIMIT 1) ba ON true
  LEFT JOIN LATERAL (
        SELECT tfs_screening_log.result, tfs_screening_log.screened_at
          FROM fic.tfs_screening_log
         WHERE tfs_screening_log.customer_id = cd.customer_id
         ORDER BY tfs_screening_log.screened_at DESC
         LIMIT 1) tfs ON true
 WHERE cd.registration_status IS NULL OR cd.registration_status <> 'inactive';

-- 5) Recreate RPCs sourcing from `cd.email`. Return-column renamed
--    `email_address` -> `email` where it appeared.

CREATE OR REPLACE FUNCTION public.list_fic_kyc_incomplete()
RETURNS TABLE(customer_id bigint, first_names text, last_name text, email text,
              fic_completeness_score integer, fic_completeness_max integer,
              missing_fields text[], latest_tfs_result text,
              latest_tfs_screened_at timestamp with time zone,
              fic_kyc_reviewed_at timestamp with time zone)
LANGUAGE sql SECURITY DEFINER
AS $function$
SELECT
  customer_id, first_names, last_name, email,
  fic_completeness_score, fic_completeness_max,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT has_dob                  THEN 'Date of birth' END,
    CASE WHEN NOT has_id_number            THEN 'ID / Passport number' END,
    CASE WHEN NOT has_id_type              THEN 'ID type' END,
    CASE WHEN NOT has_id_expiry            THEN 'ID expiry date' END,
    CASE WHEN NOT has_nationality          THEN 'Nationality' END,
    CASE WHEN NOT has_country_of_residence THEN 'Country of residence' END,
    CASE WHEN NOT has_occupation           THEN 'Occupation' END,
    CASE WHEN NOT has_tax_number           THEN 'Tax number' END,
    CASE WHEN NOT has_source_of_funds      THEN 'Source of funds' END,
    CASE WHEN NOT has_id_document          THEN 'ID document (upload)' END,
    CASE WHEN NOT has_proof_of_address     THEN 'Proof of address (upload)' END,
    CASE WHEN NOT has_income_source        THEN 'Income source' END,
    CASE WHEN NOT has_income_doc           THEN 'Income document (upload)' END,
    CASE WHEN NOT has_bank_confirmation    THEN 'Bank confirmation (upload)' END,
    CASE WHEN latest_tfs_result IS NULL OR latest_tfs_result != 'clear' THEN 'TFS screening clear' END
  ], NULL) AS missing_fields,
  latest_tfs_result, latest_tfs_screened_at, fic_kyc_reviewed_at
FROM public.v_fic_kyc_completeness
WHERE org_id IN (SELECT id FROM public.my_orgs())
  AND fic_completeness_score < 15
ORDER BY fic_completeness_score ASC, last_name ASC;
$function$;

CREATE OR REPLACE FUNCTION public.list_fic_atms_alerts(p_show_all boolean DEFAULT false)
RETURNS TABLE(alert_id uuid, customer_id bigint, customer_name text, email text,
              rule_code text, severity text, status text, description text,
              context jsonb, created_at timestamp with time zone,
              reviewed_at timestamp with time zone, review_notes text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'fic', 'pg_temp'
AS $function$
  SELECT
    ca.alert_id,
    ca.customer_id,
    (cd.first_names || ' ' || cd.last_name) AS customer_name,
    cd.email                                AS email,
    ca.rule_code, ca.severity, ca.status, ca.description, ca.context,
    ca.created_at, ca.reviewed_at, ca.review_notes
  FROM fic.compliance_alerts ca
  LEFT JOIN public.customer_details cd ON cd.customer_id = ca.customer_id
  WHERE ca.alert_type = 'atms'
    AND (p_show_all OR ca.status NOT IN ('dismissed', 'resolved', 'escalated'))
  ORDER BY
    CASE ca.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    ca.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.list_fic_tfs_alerts(p_show_all boolean DEFAULT false)
RETURNS TABLE(alert_id uuid, customer_id bigint, severity text, status text,
              description text, context jsonb, created_at timestamp with time zone,
              reviewed_at timestamp with time zone, review_notes text,
              regulatory_report_id uuid, first_names text, last_name text,
              email text, compliance_frozen boolean)
LANGUAGE sql SECURITY DEFINER
AS $function$
SELECT
  ca.alert_id, ca.customer_id, ca.severity, ca.status, ca.description, ca.context,
  ca.created_at, ca.reviewed_at, ca.review_notes, ca.regulatory_report_id,
  cd.first_names, cd.last_name, cd.email, cd.compliance_frozen
FROM fic.compliance_alerts ca
JOIN public.customer_details cd ON cd.customer_id = ca.customer_id
WHERE ca.org_id IN (SELECT id FROM public.my_orgs())
  AND ca.alert_type = 'tfs_match'
  AND (p_show_all OR ca.status NOT IN ('dismissed', 'reported'))
ORDER BY
  CASE ca.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
  ca.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.list_support_tickets(
    p_status text DEFAULT NULL,
    p_priority text DEFAULT NULL,
    p_category text DEFAULT NULL,
    p_limit integer DEFAULT 100)
RETURNS TABLE(ticket_id uuid, ticket_number text, org_id uuid, customer_id bigint,
              customer_name text, customer_email text, category text, priority text,
              subject text, status text, assigned_to uuid, message_count bigint,
              last_activity_at timestamp with time zone,
              first_response_at timestamp with time zone,
              age_seconds bigint, created_at timestamp with time zone)
LANGUAGE sql STABLE
AS $function$
  with base as (
    select t.* from public.support_tickets t
     where (p_status is null
            or t.status = p_status
            or (p_status = 'active' and t.status not in ('resolved','closed')))
       and (p_priority is null or t.priority = p_priority)
       and (p_category is null or t.category = p_category)
  )
  select
    b.ticket_id, b.ticket_number, b.org_id, b.customer_id,
    coalesce(cd.first_names || ' ' || cd.last_name, 'Customer') as customer_name,
    cd.email                                                     as customer_email,
    b.category, b.priority, b.subject, b.status, b.assigned_to,
    coalesce(m.cnt, 0) as message_count,
    coalesce(m.last_at, b.created_at) as last_activity_at,
    b.first_response_at,
    extract(epoch from (now() - b.created_at))::bigint as age_seconds,
    b.created_at
  from base b
  left join public.customer_details cd on cd.customer_id = b.customer_id
  left join lateral (
    select count(*) as cnt, max(created_at) as last_at
      from public.support_ticket_messages
     where ticket_id = b.ticket_id
  ) m on true
  order by b.created_at desc
  limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.get_support_ticket(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $function$
declare v_ticket jsonb; v_msgs jsonb;
begin
  select to_jsonb(t.*) || jsonb_build_object(
           'customer_name',  cd.first_names || ' ' || cd.last_name,
           'customer_email', cd.email,
           'customer_phone', cd.phone_number
         )
    into v_ticket
    from public.support_tickets t
    left join public.customer_details cd on cd.customer_id = t.customer_id
   where t.ticket_id = p_ticket_id;

  if v_ticket is null then return null; end if;

  select coalesce(jsonb_agg(to_jsonb(m.*) order by m.created_at), '[]'::jsonb)
    into v_msgs
    from public.support_ticket_messages m
   where m.ticket_id = p_ticket_id;

  return jsonb_build_object('ticket', v_ticket, 'messages', v_msgs);
end$function$;

CREATE OR REPLACE FUNCTION public.is_ticket_owner(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.customer_details cd
     join auth.users u on lower(u.email) = lower(cd.email)
     where cd.customer_id = p_customer_id and u.id = auth.uid()
  );
$function$;

COMMIT;
