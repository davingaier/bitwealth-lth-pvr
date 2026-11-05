-- 20261105_email_header_navy.sql
-- ===========================================================================
-- Email header: solid navy band + single on-dark logo (no light/dark CSS swap).
--
-- Why: after four rounds (20261104_email_logo_hosted.sql) the two-image swap was still unreliable — new Outlook's
-- dark-mode rewriter honours rules that *reveal* an image ([data-ogsc] .logo-dark {display:block}) but silently drops
-- rules that *hide* a visible one, so both logos showed; Gmail ignores dark-mode CSS altogether. Dark backgrounds and
-- images are left alone by every client's dark mode, so a #032C48 header with the white logo renders identically
-- everywhere (and the header text that was white-on-white in light mode is now legible).
--
-- The conversion was applied by tools/email_header_navy.py --apply (plain string slicing of the header element,
-- validated per template; 24 templates, the image-less 25th skipped). It is NOT re-implemented in SQL: regex surgery on
-- whole template bodies caused the 2026-11-04 incident. Per template it:
--   • replaced the swap CSS block with  .bw-hdr / .bw-hdr-text  rules (+ [data-ogsc]/[data-ogsb] variants)
--   • header <td>/<div>: background-color #ffffff → #032C48, bgcolor="#032C48", class bw-hdr (legacy "header" class
--     dropped so its <style> rules no longer force navy text), navy/grey header text → white, class bw-hdr-text
--   • <img class="logo-light"> + <img class="logo-dark"> → one <img class="bw-logo" src=…ondark_cropped.png>
-- 20261104_sth_cb_email_templates.sql (re-runnable) was updated to emit the same header.
-- ===========================================================================

DO $do$
DECLARE
  n_stale int;
  n_navy  int;
BEGIN
  SELECT count(*) FILTER (WHERE body_html LIKE '%class="logo-light"%' OR body_html LIKE '%class="logo-dark"%'),
         count(*) FILTER (WHERE body_html LIKE '%class="bw-logo"%')
    INTO n_stale, n_navy
  FROM public.email_templates;

  IF n_stale > 0 THEN
    RAISE WARNING 'email_templates: % template(s) still carry the light/dark logo pair — run tools/email_header_navy.py --apply', n_stale;
  END IF;
  RAISE NOTICE 'email_templates: % navy-header template(s), % stale', n_navy, n_stale;
END
$do$;
