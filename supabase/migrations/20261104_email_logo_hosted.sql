-- 20261104_email_logo_hosted.sql
-- ===========================================================================
-- Email logo: hosted light/dark pair instead of an inline base64 image.
--
-- Gmail (web + apps) does not render `data:` URIs in <img>, so every template showed a broken image. The two cropped
-- logos now live in the public `branding` storage bucket:
--   light  https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_transparent_cropped.png
--   dark   https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png
--
-- Swap mechanics (belt and braces):
--   • two plain <img>s (light / dark), each in its own <div>; the dark one hidden inline (display:none, max-height:0,
--     overflow:hidden, mso-hide:all) — a CSS swap flips them under @media (prefers-color-scheme: dark) and Outlook.com /
--     new Outlook's [data-ogsc] / [data-ogsb]. No <picture>: new Outlook unwraps it and drops the inner img's class.
--   • Clients that support neither (Gmail web, Yahoo) render emails in light mode and get the light logo.
-- Applied to every row in public.email_templates that carries the inline logo; the CSS is injected before </style>.
-- ===========================================================================

DO $do$
DECLARE
  light  text := 'https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_transparent_cropped.png';
  dark   text := 'https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png';
  block  text;
  css    text;
  n      int;
BEGIN
  -- Two plain <img>s, each in its own wrapper, swapped purely by CSS. (A first version used <picture>; new Outlook
  -- unwraps <picture> and drops the inner img's class, so the light logo was never hidden in dark mode.)
  block :=
       '<div class="logo-light" style="display: block;">'
    || '<img class="logo-light" src="' || light || '" alt="BitWealth" width="250" style="width: 250px; height: auto; display: block; margin: 0 auto; border: 0;" />'
    || '</div>'
    || '<div class="logo-dark" style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">'
    || '<img class="logo-dark" src="' || dark || '" alt="BitWealth" width="250" style="width: 250px; height: auto; display: block; margin: 0 auto; border: 0;" />'
    || '</div>';

  css :=
       chr(10) || '    /* Hosted logo: light by default, dark variant in dark mode (media query + Outlook.com data-ogsc/data-ogsb). */'
    || chr(10) || '    div.logo-dark, img.logo-dark { display: none !important; max-height: 0 !important; overflow: hidden !important; }'
    || chr(10) || '    @media (prefers-color-scheme: dark) {'
    || chr(10) || '      div.logo-light, img.logo-light { display: none !important; max-height: 0 !important; overflow: hidden !important; }'
    || chr(10) || '      div.logo-dark, img.logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }'
    || chr(10) || '    }'
    || chr(10) || '    [data-ogsc] div.logo-light, [data-ogsc] img.logo-light, [data-ogsb] div.logo-light, [data-ogsb] img.logo-light { display: none !important; max-height: 0 !important; overflow: hidden !important; }'
    || chr(10) || '    [data-ogsc] div.logo-dark, [data-ogsc] img.logo-dark, [data-ogsb] div.logo-dark, [data-ogsb] img.logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }'
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
   WHERE body_html LIKE '%div class="logo-light"%' AND body_html LIKE '%</style>%' AND body_html NOT LIKE '%div.logo-dark, img.logo-dark { display: none%';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'swap css added to % templates', n;

  -- 3) Templates without a <style> block but with the logo: add a minimal one in <head>.
  UPDATE public.email_templates
     SET body_html = regexp_replace(body_html, '<head>', '<head><style>' || css || '</style>'),
         updated_at = now()
   WHERE body_html LIKE '%div class="logo-light"%' AND body_html NOT LIKE '%</style>%' AND body_html LIKE '%<head>%';
END $do$;

-- kyc_finova_invite has a permanent blue-gradient header (no light variant), so the on-dark logo replaces its text wordmark.
UPDATE public.email_templates
   SET body_html = replace(body_html,
       '<div style="font-size:30px;font-weight:700;">BitWealth</div>',
       '<img src="https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png" alt="BitWealth" width="220" style="width: 220px; height: auto; display: block; margin: 0 auto; border: 0;" />'),
       updated_at = now()
 WHERE template_key = 'kyc_finova_invite' AND body_html LIKE '%<div style="font-size:30px;font-weight:700;">BitWealth</div>%';
