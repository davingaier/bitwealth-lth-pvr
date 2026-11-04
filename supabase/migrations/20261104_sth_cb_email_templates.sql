-- 20261104_sth_cb_email_templates.sql
-- ===========================================================================
-- Email templates for the STH Cost Basis Strategy (STH_CB) + strategy-switch notifications.
--
-- The HTML shell (doctype, dark-mode CSS, outer tables, inline BitWealth logo, footer) is COPIED from the live
-- `registration_complete_welcome` template at migration time, so every new template is pixel-consistent with the
-- LTH PVR set without duplicating ~90 KB of base64 in this file.
--
-- Templates created / refreshed (ON CONFLICT (template_key) DO UPDATE):
--   strategy_switch_confirmation          client — switch done + what happens next (state-dependent copy from the EF)
--   strategy_switch_admin_notification    admin  — who/what/why + holdings snapshot
--   registration_complete_welcome_sth_cb  client — first deposit welcome (STH CB wording, state-dependent next step)
--   subsequent_deposit_notification_sth_cb client — later deposits (how new cash is deployed)
--   sth_cb_position_change                client — the strategy entered / exited / scaled out today
--   kyc_verified_notification_sth_cb      clone of the LTH template with the strategy name swapped
--   monthly_statement_sth_cb              clone of the LTH template with the strategy name swapped
--
-- Placeholders use the existing {{key}} convention of ef_send_email (unknown keys are left verbatim, so the sending
-- EFs MUST supply every key listed per template — see _shared/strategyEmail.ts).
-- ===========================================================================

CREATE OR REPLACE FUNCTION pg_temp.tpl_wrap(p_pre text, p_logo text, p_suffix text, p_title text, p_subtitle text, p_content text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT p_pre
      || '<!-- Header -->' || chr(10)
      || '<tr><td style="background-color: #ffffff; border: 3px solid #032C48; padding: 40px; text-align: center;">' || chr(10)
      || p_logo || chr(10)
      || '<h1 style="margin: 0; font-size: 24px; color: #ffffff; font-weight: 600;">' || p_title || '</h1>' || chr(10)
      || CASE WHEN p_subtitle IS NULL OR p_subtitle = '' THEN '' ELSE '<p style="margin: 8px 0 0 0; font-size: 14px; color: #ffffff;">' || p_subtitle || '</p>' || chr(10) END
      || '</td></tr>' || chr(10)
      || '<!-- Content -->' || chr(10)
      || '<tr><td style="padding: 15px; color: #111827; font-size: 15px; line-height: 1.5;">' || chr(10)
      || p_content || chr(10)
      || '</td></tr>' || chr(10)
      || p_suffix;
$$;

DO $do$
DECLARE
  src     text;
  pre     text;
  logo    text;
  suffix  text;
  sub     text := 'STH Cost Basis Strategy';
  btn     text := 'display: inline-block; background-color: #3b82f6; color: #032C48; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;';
  box_g   text := 'background-color: #d4edda; color: #155724; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; border: 1px solid #c3e6cb;';
  box_b   text := 'background-color: #dbeafe; color: #1e40af; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; border: 1px solid #bfdbfe;';
  box_y   text := 'background-color: #fef3c7; color: #78350f; padding: 16px 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #fde68a; font-size: 14px;';
  tbl     text := 'width: 100%; border-collapse: collapse; margin: 10px 0 20px 0; font-size: 14px;';
  tdk     text := 'padding: 8px 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 45%;';
  tdv     text := 'padding: 8px 10px; border-bottom: 1px solid #e5e7eb; color: #111827; font-weight: 600;';
  body_html text;
BEGIN
  SELECT t.body_html INTO src FROM public.email_templates t WHERE t.template_key = 'registration_complete_welcome';
  IF src IS NULL THEN RAISE EXCEPTION 'registration_complete_welcome template missing — cannot derive shell'; END IF;
  pre    := substring(src from '^(.*?)<!-- Header -->');
  logo   := substring(src from '(<img src="data:image[^>]*>)');
  suffix := substring(src from '(<!-- Footer -->.*)$');
  IF pre IS NULL OR logo IS NULL OR suffix IS NULL THEN RAISE EXCEPTION 'could not parse the template shell'; END IF;

  -- ── 1. strategy_switch_confirmation (client) ─────────────────────────────
  body_html := pg_temp.tpl_wrap(pre, logo, suffix, 'Your strategy switch is complete', '{{to_strategy_name}}',
    '<p style="margin: 0 0 15px 0;">Hi {{first_name}},</p>'
 || '<p style="margin: 0 0 15px 0;">As requested, we have switched your BitWealth portfolio from the <strong>{{from_strategy_name}}</strong> to the <strong>{{to_strategy_name}}</strong>, effective <strong>{{switch_date}}</strong>.</p>'
 || '<div style="' || box_g || '"><strong style="font-size: 18px;">&#10003; Switch complete</strong><br><span style="font-size: 14px;">{{join_policy_text}}</span></div>'
 || '<p style="margin: 20px 0 6px 0;"><strong>Your holdings at the time of the switch</strong></p>'
 || '<table style="' || tbl || '">'
 || '<tr><td style="' || tdk || '">Bitcoin</td><td style="' || tdv || '">{{holdings_btc}} BTC</td></tr>'
 || '<tr><td style="' || tdk || '">Cash (USDT / USDPC)</td><td style="' || tdv || '">${{holdings_cash_usd}}</td></tr>'
 || '<tr><td style="' || tdk || '">Portfolio value</td><td style="' || tdv || '">${{nav_usd}}</td></tr>'
 || '</table>'
 || '<div style="' || box_b || '"><strong style="font-size: 18px;">{{next_headline}}</strong><br><span style="font-size: 14px;">{{next_detail}}</span></div>'
 || '<p style="margin: 20px 0 10px 0;"><strong>How the {{to_strategy_name}} works day to day</strong></p>'
 || '<p style="margin: 0 0 15px 0;">{{strategy_summary}}</p>'
 || '<p style="margin: 20px 0 10px 0;"><strong>What stays the same</strong></p>'
 || '<ul style="margin: 0 0 20px 0; padding-left: 20px;">'
 || '<li style="margin-bottom: 8px;">Your VALR account, deposit reference and banking details — nothing to re-do.</li>'
 || '<li style="margin-bottom: 8px;">Your fee plan and fee rates.</li>'
 || '<li style="margin-bottom: 8px;">Monthly statements and your customer portal access.{{usdpc_text}}</li>'
 || '</ul>'
 || '<div style="' || box_y || '">You will receive an email each time the strategy changes position (moves into Bitcoin, scales out, or moves to cash), so you always know what your portfolio is doing and why.</div>'
 || '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding: 20px 0;"><a href="{{portal_url}}" style="' || btn || '">View Your Portfolio &rarr;</a></td></tr></table>'
 || '<p style="font-size: 14px; color: #6b7280; margin: 20px 0 0 0;">Did not request this change? Reply to this email immediately or visit <a href="{{website_url}}" style="color: #3b82f6; text-decoration: none;">{{website_url}}</a>.</p>'
 || '<p style="margin: 30px 0 0 0;">Best regards,<br><strong>The BitWealth Team</strong></p>');
  INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
  VALUES ('strategy_switch_confirmation', 'Strategy Switch Confirmation (Customer)',
          'Sent by ef_switch_strategy after an admin switches a client to another strategy. Keys: first_name, from_strategy_name, to_strategy_name, switch_date, join_policy_text, holdings_btc, holdings_cash_usd, nav_usd, next_headline, next_detail, strategy_summary, usdpc_text, portal_url, website_url',
          'Your BitWealth portfolio now follows the {{to_strategy_name}}', body_html, true)
  ON CONFLICT (template_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, active = true, updated_at = now();

  -- ── 2. strategy_switch_admin_notification ────────────────────────────────
  body_html := pg_temp.tpl_wrap(pre, logo, suffix, 'Strategy switch completed', 'Internal admin notification',
    '<p style="margin: 0 0 15px 0;">A client''s strategy was switched in place (same exchange account, fee plan and history).</p>'
 || '<table style="' || tbl || '">'
 || '<tr><td style="' || tdk || '">Client</td><td style="' || tdv || '">{{first_name}} {{last_name}} (#{{customer_id}})</td></tr>'
 || '<tr><td style="' || tdk || '">Email</td><td style="' || tdv || '">{{email}}</td></tr>'
 || '<tr><td style="' || tdk || '">From &rarr; To</td><td style="' || tdv || '">{{from_strategy_code}} &rarr; {{to_strategy_code}}</td></tr>'
 || '<tr><td style="' || tdk || '">Options</td><td style="' || tdv || '">{{options_text}}</td></tr>'
 || '<tr><td style="' || tdk || '">Holdings at switch</td><td style="' || tdv || '">{{holdings_btc}} BTC · ${{holdings_cash_usd}} cash · NAV ${{nav_usd}}</td></tr>'
 || '<tr><td style="' || tdk || '">Changed by</td><td style="' || tdv || '">{{changed_by}} on {{switch_date}}</td></tr>'
 || '<tr><td style="' || tdk || '">Reason</td><td style="' || tdv || '">{{reason}}</td></tr>'
 || '<tr><td style="' || tdk || '">Client email</td><td style="' || tdv || '">{{client_email_status}}</td></tr>'
 || '</table>'
 || '<div style="' || box_b || '"><strong>Next run</strong><br><span style="font-size: 14px;">{{next_detail}}</span></div>'
 || '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding: 20px 0;"><a href="{{admin_portal_url}}" style="' || btn || '">Open Admin UI &rarr;</a></td></tr></table>'
 || '<p style="font-size: 12px; color: #6b7280; margin: 20px 0 0 0;">Internal admin notification — do not forward to customers.</p>');
  INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
  VALUES ('strategy_switch_admin_notification', 'Strategy Switch - Admin Notification',
          'Sent by ef_switch_strategy to ADMIN_EMAIL. Keys: first_name, last_name, customer_id, email, from_strategy_code, to_strategy_code, options_text, holdings_btc, holdings_cash_usd, nav_usd, changed_by, switch_date, reason, client_email_status, next_detail, admin_portal_url',
          'Strategy switch: {{first_name}} {{last_name}} (#{{customer_id}}) {{from_strategy_code}} → {{to_strategy_code}}', body_html, true)
  ON CONFLICT (template_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, active = true, updated_at = now();

  -- ── 3. registration_complete_welcome_sth_cb ──────────────────────────────
  body_html := pg_temp.tpl_wrap(pre, logo, suffix, '&#127881; Welcome! Your Account is Active', sub,
    '<p style="margin: 0 0 15px 0;">Hi {{first_name}},</p>'
 || '<p style="margin: 0 0 15px 0;"><strong>Great news!</strong> We''ve received your deposit and your BitWealth account is now active on the <strong>STH Cost Basis Strategy</strong>.</p>'
 || '<div style="' || box_g || '"><h2 style="margin: 0 0 10px 0;">{{amount}} {{asset}}</h2><p style="margin: 0; font-size: 14px;">Deposited on {{deposit_date}}</p></div>'
 || '<div style="' || box_b || '"><strong style="font-size: 18px;">{{strategy_state_headline}}</strong><br><span style="font-size: 14px;">{{strategy_state_detail}}</span></div>'
 || '<p style="margin: 20px 0 10px 0;"><strong>What happens next?</strong></p>'
 || '<ul style="margin: 0 0 20px 0; padding-left: 20px;">'
 || '<li style="margin-bottom: 8px;">Every day, once the on-chain data for the previous day is in (around 02:00 UTC), the strategy decides whether your portfolio should be in Bitcoin or in cash.</li>'
 || '<li style="margin-bottom: 8px;">When the strategy is in Bitcoin, all of your available cash is invested; near market extremes it may scale out in steps. When it is in cash, your money waits safely in USDT / USDPC for the next entry.</li>'
 || '<li style="margin-bottom: 8px;">You''ll get an email each time the strategy changes position, plus a monthly statement with your performance.</li>'
 || '<li style="margin-bottom: 8px;">Track your portfolio anytime via the customer portal.</li>'
 || '</ul>'
 || '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding: 20px 0;"><a href="{{portal_url}}" style="' || btn || '">Access Your Portfolio &rarr;</a></td></tr></table>'
 || '<p style="font-size: 14px; color: #6b7280; margin: 20px 0 0 0;">Questions? Reply to this email or visit <a href="{{website_url}}" style="color: #3b82f6; text-decoration: none;">{{website_url}}</a></p>'
 || '<p style="margin: 30px 0 0 0;">Welcome aboard!<br><strong>The BitWealth Team</strong></p>');
  INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
  VALUES ('registration_complete_welcome_sth_cb', 'Registration Complete - Welcome Email (STH CB)',
          'First-deposit welcome for STH_CB clients (ef_deposit_scan via templateKeyFor). Keys: first_name, amount, asset, deposit_date, strategy_state_headline, strategy_state_detail, portal_url, website_url',
          '🎉 Welcome to BitWealth - Your Account is Active!', body_html, true)
  ON CONFLICT (template_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, active = true, updated_at = now();

  -- ── 4. subsequent_deposit_notification_sth_cb ────────────────────────────
  body_html := pg_temp.tpl_wrap(pre, logo, suffix, 'Deposit Received', sub,
    '<p style="margin: 0 0 15px 0;">Hi {{first_name}},</p>'
 || '<p style="margin: 0 0 15px 0;"><strong>Great news!</strong> We''ve detected a deposit to your BitWealth account.</p>'
 || '<div style="' || box_g || '"><h2 style="margin: 0 0 10px 0;">{{amount}} {{asset}}</h2><p style="margin: 0; font-size: 14px;">Received on {{deposit_date}}</p></div>'
 || '<div style="' || box_b || '"><strong style="font-size: 18px;">{{strategy_state_headline}}</strong><br><span style="font-size: 14px;">{{strategy_state_detail}}</span></div>'
 || '<p style="margin: 20px 0 10px 0;"><strong>What happens next?</strong></p>'
 || '<ul style="margin: 0 0 20px 0; padding-left: 20px;">'
 || '<li style="margin-bottom: 8px;">If the strategy is currently in Bitcoin, your new cash is invested on the next daily run (around 02:00 UTC) so your whole portfolio stays aligned with the strategy.</li>'
 || '<li style="margin-bottom: 8px;">If the strategy is currently in cash, your deposit waits in USDT / USDPC and is invested together with the rest of your portfolio at the next entry signal.</li>'
 || '<li style="margin-bottom: 8px;">Track it in real time via the customer portal.</li>'
 || '</ul>'
 || '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding: 20px 0;"><a href="{{portal_url}}" style="' || btn || '">View Your Portfolio &rarr;</a></td></tr></table>'
 || '<p style="font-size: 14px; color: #6b7280; margin: 20px 0 0 0;">If you have any questions about your deposit or strategy, please don''t hesitate to reach out.</p>'
 || '<p style="margin: 30px 0 0 0;">Best regards,<br><strong>The BitWealth Team</strong></p>'
 || '<p style="font-size: 12px; color: #9ca3af; margin: 20px 0 0 0;">This email was sent to {{to_email}}</p>');
  INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
  VALUES ('subsequent_deposit_notification_sth_cb', 'Subsequent Deposit Notification (Customer, STH CB)',
          'Later deposits for STH_CB clients (ef_sync_valr_transactions via templateKeyFor). Keys: first_name, amount, asset, deposit_date, strategy_state_headline, strategy_state_detail, portal_url, website_url, to_email',
          'Deposit Received - {{amount}} {{asset}} Credited to Your Account', body_html, true)
  ON CONFLICT (template_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, active = true, updated_at = now();

  -- ── 5. sth_cb_position_change ────────────────────────────────────────────
  body_html := pg_temp.tpl_wrap(pre, logo, suffix, '{{action_headline}}', sub,
    '<p style="margin: 0 0 15px 0;">Hi {{first_name}},</p>'
 || '<p style="margin: 0 0 15px 0;">The STH Cost Basis Strategy changed position today, <strong>{{trade_date}}</strong>, and your portfolio has been adjusted to match.</p>'
 || '<div style="' || box_b || '"><strong style="font-size: 18px;">{{action_detail}}</strong><br><span style="font-size: 14px;">{{order_status_text}}</span></div>'
 || '<p style="margin: 20px 0 10px 0;"><strong>Why?</strong></p>'
 || '<p style="margin: 0 0 15px 0;">{{reason_text}}</p>'
 || '<p style="margin: 20px 0 10px 0;"><strong>What this means for you</strong></p>'
 || '<p style="margin: 0 0 15px 0;">{{implication_text}}</p>'
 || '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding: 20px 0;"><a href="{{portal_url}}" style="' || btn || '">View Your Portfolio &rarr;</a></td></tr></table>'
 || '<p style="font-size: 14px; color: #6b7280; margin: 20px 0 0 0;">Executed prices and fees appear in your portal transaction history once the trade has settled, and in your monthly statement. Questions? Reply to this email or visit <a href="{{website_url}}" style="color: #3b82f6; text-decoration: none;">{{website_url}}</a>.</p>'
 || '<p style="margin: 30px 0 0 0;">Best regards,<br><strong>The BitWealth Team</strong></p>');
  INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
  VALUES ('sth_cb_position_change', 'STH CB Position Change (Customer)',
          'Sent by ef_sth_cb_generate_decisions when a client has a BUY/SELL today. Keys: first_name, trade_date, action_headline, action_detail, order_status_text, reason_text, implication_text, portal_url, website_url',
          '{{action_headline}} — your BitWealth portfolio', body_html, true)
  ON CONFLICT (template_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, active = true, updated_at = now();

  -- ── 6/7. Brand-only clones of the LTH templates ──────────────────────────
  INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
  SELECT 'kyc_verified_notification_sth_cb', 'KYC Verified - Account Ready (STH CB)',
         'Clone of kyc_verified_notification with the strategy name swapped (ef_approve_kyc via templateKeyFor). Same keys.',
         t.subject, replace(replace(t.body_html, 'LTH PVR Bitcoin DCA Strategy', 'STH Cost Basis Strategy'), 'LTH PVR', 'STH Cost Basis'), true
  FROM public.email_templates t WHERE t.template_key = 'kyc_verified_notification'
  ON CONFLICT (template_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, active = true, updated_at = now();

  INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
  SELECT 'monthly_statement_sth_cb', 'Monthly Statement (STH CB)',
         'Clone of monthly_statement with the strategy name swapped (ef_monthly_statement_generator via templateKeyFor). Same keys.',
         t.subject, replace(replace(t.body_html, 'LTH PVR Bitcoin DCA Strategy', 'STH Cost Basis Strategy'), 'LTH PVR', 'STH Cost Basis'), true
  FROM public.email_templates t WHERE t.template_key = 'monthly_statement'
  ON CONFLICT (template_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, active = true, updated_at = now();
END $do$;

DROP FUNCTION IF EXISTS pg_temp.tpl_wrap(text, text, text, text, text, text);
