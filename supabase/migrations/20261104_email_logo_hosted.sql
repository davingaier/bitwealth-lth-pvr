-- 20261104_email_logo_hosted.sql
-- ===========================================================================
-- ⚠️ SUPERSEDED 2026-11-05 by 20261105_email_header_navy.sql + tools/email_header_navy.py: the light/dark swap below
--    never hid the light logo in new Outlook's dark mode (it can only *reveal* images, not hide them) and Gmail ignores
--    dark-mode CSS, so both logos showed. Templates now have a solid navy header with the single on-dark logo.
--    Kept for history / fresh-DB bootstrap (it is still what converts the inline base64 image to hosted files).
--
-- Email logo: hosted light/dark pair instead of an inline base64 image.
--
-- Gmail (web + apps) does not render `data:` URIs in <img>, so every template showed a broken image. The two cropped
-- logos now live in the public `branding` storage bucket:
--   light  https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_transparent_cropped.png
--   dark   https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png
--
-- Swap mechanics (belt and braces):
--   • two plain <img>s (light / dark) carrying .logo-light / .logo-dark; the dark one hidden inline (display:none,
--     mso-hide:all) — a CSS swap on PLAIN class selectors flips them under @media (prefers-color-scheme: dark) and
--     Outlook.com / new Outlook's [data-ogsc] / [data-ogsb]. No <picture> and no wrapper <div>s (see note below).
--   • Clients that support neither (Gmail web, Yahoo) render emails in light mode and get the light logo.
-- IMPORTANT (lesson from 2026-11-04): never use a greedy/non-greedy mix such as '<div[^>]*>.*?</div>' in Postgres
-- regexp_replace — ARE makes the whole pattern greedy when the first quantifier is greedy, and it swallowed every
-- template body up to the LAST </div>. Content had to be restored from _email_previews (tools/restore_email_templates.py).
-- ===========================================================================

DO $do$
DECLARE
  light  text := 'https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_transparent_cropped.png';
  dark   text := 'https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png';
  block  text;
  css    text;
  n      int;
BEGIN
  -- Two plain <img>s with the classes ON THE IMAGES (no <picture>, no wrapper <div>s): new Outlook unwraps <picture>
  -- and drops the inner img's class, and its dark-mode CSS rewriter only honours plain class selectors (.logo-dark),
  -- not element-qualified ones (div.logo-dark) nor max-height/overflow tricks. This is the only form that toggled
  -- correctly in new Outlook, Apple Mail and Gmail (which has no dark hook and shows the light logo).
  block :=
       '<img class="logo-light" src="' || light || '" alt="BitWealth" width="250" style="width: 250px; height: auto; display: block; margin: 0 auto; border: 0;" />'
    || '<img class="logo-dark" src="' || dark || '" alt="BitWealth" width="250" style="width: 250px; height: auto; display: none; margin: 0 auto; border: 0; mso-hide: all;" />';
  css :=
       chr(10) || '    /* Hosted logo: light by default, dark variant in dark mode. Plain class selectors only — Outlook.com drops element-qualified rules. */'
    || chr(10) || '    .logo-dark { display: none !important; }'
    || chr(10) || '    @media (prefers-color-scheme: dark) {'
    || chr(10) || '      .logo-light { display: none !important; }'
    || chr(10) || '      .logo-dark { display: block !important; }'
    || chr(10) || '    }'
    || chr(10) || '    [data-ogsc] .logo-light { display: none !important; }'
    || chr(10) || '    [data-ogsc] .logo-dark { display: block !important; }'
    || chr(10) || '    [data-ogsb] .logo-light { display: none !important; }'
    || chr(10) || '    [data-ogsb] .logo-dark { display: block !important; }'
    || chr(10) || '  ';
  -- 1) Replace every inline-logo <img ...data:image...> with the hosted block.
  UPDATE public.email_templates
     SET body_html = regexp_replace(body_html, '<img[^>]*src="data:image[^"]*"[^>]*>', block, 'g'),
         updated_at = now()
   WHERE body_html ~ '<img[^>]*src="data:image';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'logo replaced in % templates', n;

  -- 2) Inject the swap CSS once per template (before the first </style>).
  UPDATE public.email_templates
     SET body_html = regexp_replace(body_html, '</style>', css || '</style>'),
         updated_at = now()
   WHERE body_html LIKE '%<img class="logo-light"%' AND body_html LIKE '%</style>%' AND body_html NOT LIKE '%/* Hosted logo:%';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'swap css added to % templates', n;

  -- 3) Templates without a <style> block but with the logo: add a minimal one in <head>.
  UPDATE public.email_templates
     SET body_html = regexp_replace(body_html, '<head>', '<head><style>' || css || '</style>'),
         updated_at = now()
   WHERE body_html LIKE '%<img class="logo-light"%' AND body_html NOT LIKE '%</style>%' AND body_html LIKE '%<head>%';
END $do$;

-- kyc_finova_invite has a permanent blue-gradient header (no light variant), so the on-dark logo replaces its text wordmark.
UPDATE public.email_templates
   SET body_html = replace(body_html,
       '<div style="font-size:30px;font-weight:700;">BitWealth</div>',
       '<img src="https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png" alt="BitWealth" width="220" style="width: 220px; height: auto; display: block; margin: 0 auto; border: 0;" />'),
       updated_at = now()
 WHERE template_key = 'kyc_finova_invite' AND body_html LIKE '%<div style="font-size:30px;font-weight:700;">BitWealth</div>%';
