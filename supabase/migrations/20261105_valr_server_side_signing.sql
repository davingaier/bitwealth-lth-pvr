-- 20261105_valr_server_side_signing.sql
-- ===========================================================================
-- Server-side VALR request signing (post-incident hardening, stage 1).
--
-- Problem: every Edge Function held VALR API *secrets* (master key in env, customer keys returned in plaintext by
-- get_customer_valr_credentials). A stolen Supabase key therefore meant stolen exchange keys.
-- Fix: secrets live only in Vault; Edge Functions ask `lth_pvr.valr_sign()` for a signature and get back
-- {api_key, subaccount_id, timestamp, signature} — never the secret. HMAC-SHA-512 via pgcrypto is byte-identical to
-- the WebCrypto implementation the functions used (verified: hmac('hello','abc','sha512') matches).
--
-- Vault slots (operator populates via SQL Editor — values never appear in code or chat):
--   valr_master_api_key / valr_master_api_secret     BitWealth master key (trade-only permissions recommended)
--   valr_withdraw_api_key / valr_withdraw_api_secret  optional: separate key that holds the withdraw permission;
--                                                     used automatically for /withdraw paths when present
--   customer_<id>_valr_api_key / _secret              already present for api-model customers
--
-- Rollout: Edge Functions call valr_sign first and fall back to local signing only while VALR_API_SECRET is still
-- set in their environment AND the master key is not yet in Vault. Once the Vault slots are filled, remove
-- VALR_API_SECRET from Edge Function secrets and the fallback becomes impossible.
-- ===========================================================================

-- Empty slots so the operator only has to UPDATE (vault.update_secret) rather than remember create_secret syntax.
DO $$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['valr_master_api_key','valr_master_api_secret','valr_withdraw_api_key','valr_withdraw_api_secret'] LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = n) THEN
      PERFORM vault.create_secret('', n, 'VALR credential slot (2026-11-05 server-side signing). Fill via vault.update_secret.');
    END IF;
  END LOOP;
END $$;

ALTER TABLE lth_pvr.valr_credential_access_log ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'credentials';
ALTER TABLE lth_pvr.valr_credential_access_log ADD COLUMN IF NOT EXISTS scope   text;
ALTER TABLE lth_pvr.valr_credential_access_log ADD COLUMN IF NOT EXISTS path    text;

CREATE OR REPLACE FUNCTION lth_pvr.valr_hmac_hex(p_payload text, p_secret text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path TO 'lth_pvr','public','extensions' AS $$
  SELECT encode(extensions.hmac(convert_to(p_payload,'UTF8'), convert_to(p_secret,'UTF8'), 'sha512'), 'hex');
$$;
REVOKE ALL ON FUNCTION lth_pvr.valr_hmac_hex(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- lth_pvr.valr_sign
--   p_customer_id   NULL → BitWealth master (or withdraw) key, no subaccount header unless p_subaccount_id given
--                   id   → resolves the customer's model: api/finova_omnibus → own Vault key; subaccount → master key
--                          + the customer's subaccount id
--   p_scope         'trade' (default) | 'withdraw'  — withdraw uses the dedicated withdraw key when configured
--   p_verb/p_path/p_body  exactly what will be sent (body = JSON string or '')
--   p_subaccount_id optional explicit subaccount header (only honoured for master-key signing)
-- Returns the headers' ingredients. Raises 'VALR_SECRET_NOT_CONFIGURED' when the needed Vault slot is empty so the
-- caller can decide whether to fall back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lth_pvr.valr_sign(
  p_customer_id   bigint,
  p_verb          text,
  p_path          text,
  p_body          text DEFAULT '',
  p_scope         text DEFAULT 'trade',
  p_subaccount_id text DEFAULT NULL
)
RETURNS TABLE(api_key text, subaccount_id text, ts text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'lth_pvr','public','vault','extensions' AS $$
DECLARE
  v_model   text;
  v_sub     text := p_subaccount_id;
  v_key_id  uuid; v_sec_id uuid;
  v_key     text; v_secret text;
  v_ts      text := (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text;
  v_distinct int;
BEGIN
  IF p_scope NOT IN ('trade','withdraw') THEN RAISE EXCEPTION 'valr_sign: bad scope %', p_scope; END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT cd.account_model, ea.subaccount_id, ea.api_key_vault_id, ea.api_secret_vault_id
      INTO v_model, v_sub, v_key_id, v_sec_id
    FROM public.customer_details cd
    JOIN public.customer_strategies cs ON cs.customer_id = cd.customer_id
    JOIN lth_pvr.exchange_accounts ea  ON ea.exchange_account_id = cs.exchange_account_id
    WHERE cd.customer_id = p_customer_id
    ORDER BY cs.effective_from DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'valr_sign: no exchange account for customer %', p_customer_id; END IF;

    IF v_model IN ('api','finova_omnibus') THEN
      SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE id = v_key_id;
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_sec_id;
      v_sub := NULL;                                   -- key is already scoped to the account
      IF coalesce(v_key,'') = '' OR coalesce(v_secret,'') = '' THEN
        RAISE EXCEPTION 'VALR_SECRET_NOT_CONFIGURED: customer % (%)', p_customer_id, v_model;
      END IF;
    ELSIF v_model = 'subaccount' THEN
      v_model := 'master';                             -- fall through to master-key branch below
    ELSE
      RAISE EXCEPTION 'valr_sign: unknown account_model % for customer %', v_model, p_customer_id;
    END IF;
  ELSE
    v_model := 'master';
  END IF;

  IF v_model = 'master' THEN
    IF p_scope = 'withdraw' THEN
      SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'valr_withdraw_api_key';
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'valr_withdraw_api_secret';
    END IF;
    IF coalesce(v_key,'') = '' OR coalesce(v_secret,'') = '' THEN   -- no dedicated withdraw key → master
      SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'valr_master_api_key';
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'valr_master_api_secret';
    END IF;
    IF coalesce(v_key,'') = '' OR coalesce(v_secret,'') = '' THEN
      RAISE EXCEPTION 'VALR_SECRET_NOT_CONFIGURED: master key missing in vault';
    END IF;
  END IF;

  -- audit (reuses the credential-access log) + the same anomaly alarm as get_customer_valr_credentials
  INSERT INTO lth_pvr.valr_credential_access_log(customer_id, account_model, purpose, scope, path)
  VALUES (p_customer_id, v_model, 'sign', p_scope, left(p_path, 120));
  IF p_scope = 'withdraw' THEN
    INSERT INTO public.alert_events(component, severity, org_id, customer_id, message, context)
    VALUES ('valr_sign', 'warn', (SELECT org_id FROM public.customer_details WHERE customer_id = p_customer_id),
            p_customer_id, format('VALR withdraw request signed (%s)', p_path),
            jsonb_build_object('path', p_path, 'customer_id', p_customer_id));
  END IF;

  RETURN QUERY SELECT v_key, v_sub, v_ts,
    lth_pvr.valr_hmac_hex(v_ts || upper(p_verb) || p_path || coalesce(p_body,'') || coalesce(v_sub,''), v_secret);
END $$;

REVOKE ALL ON FUNCTION lth_pvr.valr_sign(bigint, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lth_pvr.valr_sign(bigint, text, text, text, text, text) TO service_role;

-- Self-test of the HMAC primitive against the WebCrypto reference value.
DO $$ BEGIN
  IF lth_pvr.valr_hmac_hex('hello','abc') <> '7b458e1a9dda7dcff225037f22ddb4d2c47b706fe380a70a4952d9905f4c0aae1d52bcbf014a33b769e8029771fe92cbd8337ba3a2580ad46788985567cb7a3e' THEN
    RAISE EXCEPTION 'valr_hmac_hex does not match the WebCrypto reference';
  END IF;
END $$;
