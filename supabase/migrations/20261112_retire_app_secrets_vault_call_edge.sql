-- 20261112_retire_app_secrets_vault_call_edge.sql
-- Incident #2 follow-up: no key may live in a plain table.
--   * lth_pvr.call_edge read its Authorization header from lth_pvr.settings (ef_auth_header) — a table the attacker
--     read 8× on 2026-11-11. It now reads Vault (`ef_auth_header`, `ef_base_url`), falling back to settings only
--     for the URL. The settings row holding the bearer is deleted.
--   * pg_cron job `real-txs-sync-valr-daily` used public.get_secret(...) (the anon-callable leak); it now uses
--     lth_pvr.call_edge like every other job.
--   * public.get_secret(text) and private.app_secrets are dropped.

begin;

create or replace function lth_pvr.call_edge(fn_name text, payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = lth_pvr, public, vault, extensions
as $function$
declare
  base_url  text;
  auth_hdr  text;
  headers   jsonb := jsonb_build_object('Content-Type','application/json');
  url       text;
  resp_json jsonb := '{}'::jsonb;
  st        int;
  body_txt  text := '';
begin
  -- Secrets come from Vault only (settings is a readable config table; it must never hold a key).
  select decrypted_secret into auth_hdr from vault.decrypted_secrets where name = 'ef_auth_header';
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'ef_base_url';
  if coalesce(base_url,'') = '' then
    select val into base_url from lth_pvr.settings where key = 'ef_base_url';
  end if;
  if coalesce(base_url,'') = '' then
    raise exception 'ef_base_url not configured (vault or lth_pvr.settings)';
  end if;
  if coalesce(auth_hdr,'') = '' then
    raise exception 'vault secret ef_auth_header missing';
  end if;
  if base_url like 'https://%.functions.supabase.co%' then
    base_url := replace(base_url, '.functions.supabase.co', '.supabase.co/functions/v1');
  elsif base_url like 'https://%.supabase.co%' and position('/functions/' in base_url) = 0 then
    base_url := rtrim(base_url, '/') || '/functions/v1';
  end if;
  -- Server-to-server callers present the secret key in `apikey` (and as bearer for legacy callers).
  headers := headers || jsonb_build_object('Authorization', auth_hdr,
                                           'apikey', regexp_replace(auth_hdr, '^Bearer\s+', ''));
  url := rtrim(base_url, '/') || '/' || fn_name;
  begin
    select to_jsonb(net.http_post(url, payload, '{}'::jsonb, headers, 30000)) into resp_json;
  exception when others then
    resp_json := jsonb_build_object('error', sqlerrm);
    st := 599; body_txt := sqlerrm;
  end;
  -- pg_net is asynchronous: the real HTTP status lands in net._http_response later. Log the dispatch with the
  -- Authorization/apikey values REDACTED — invoker_logs used to store the live bearer in plain text.
  insert into lth_pvr.invoker_logs(fn_name, url, status, body, headers, payload)
  values (fn_name, url, coalesce(st, 200), left(body_txt, 2000),
          headers || jsonb_build_object('Authorization', 'Bearer <redacted>', 'apikey', '<redacted>'), payload);
  if st is not null and st >= 400 then
    raise warning 'call_edge % failed to dispatch: %', fn_name, left(body_txt, 200);
  end if;
end
$function$;
revoke execute on function lth_pvr.call_edge(text, jsonb) from public, anon, authenticated;

-- Scrub historical invoker_logs headers (they held the previous bearer tokens).
update lth_pvr.invoker_logs
   set headers = headers || jsonb_build_object('Authorization', 'Bearer <redacted>')
 where headers ? 'Authorization' and headers->>'Authorization' <> 'Bearer <redacted>';

delete from lth_pvr.settings where key = 'ef_auth_header';

select cron.alter_job(
  (select jobid from cron.job where jobname = 'real-txs-sync-valr-daily'),
  command => $cmd$select lth_pvr.call_edge('real-txs-sync-valr',
                    jsonb_build_object('from', (current_date - 1)::text, 'to', current_date::text, 'debug', false));$cmd$
);

-- Nothing in a browser reads the dispatch log.
revoke all on lth_pvr.invoker_logs from anon, authenticated;

drop function if exists public.get_secret(text);
drop table if exists private.app_secrets;

commit;
