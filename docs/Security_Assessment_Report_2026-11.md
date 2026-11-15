# BitWealth — Application Security Assessment

**Prepared for:** Finova (partner cyber-risk assessment)
**Platform:** BitWealth automated Bitcoin investment service
**Assessment date:** 15 November 2026
**Assessment type:** Authenticated & unauthenticated application-layer authorization test (grey-box), plus a review of transport and platform security controls
**Performed by:** BitWealth engineering (internal, authorised)
**Environment:** Production

> This report describes BitWealth's security posture and the results of a controlled security test. It deliberately omits all proprietary investment-strategy logic, trading parameters, and secret material. It is written for a third-party cyber-risk reviewer.

---

## 1. Executive summary

BitWealth is a cloud-native application built on a managed Postgres backend (Supabase), stateless serverless functions, and a static front-end hosted on a CDN. Customer funds are custodied at a regulated South African exchange (VALR); BitWealth never holds customer fiat or crypto directly and cannot move customer assets to any destination outside each customer's own exchange account.

A controlled authorization assessment was performed against the production application on 15 November 2026. The test exercised 30+ discrete attack cases across unauthenticated access, cross-customer data isolation, privilege escalation, parameter tampering, injection, and transport security. The great majority of controls behaved correctly on the first pass. **Two genuine vulnerabilities were identified and remediated the same day**, and both were verified fixed by re-test:

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| F-1 | Broken access control via a three-valued-logic ("NULL") flaw in four privileged database functions | **Critical** | ✅ Fixed & re-tested |
| F-2 | Seven internal serverless functions callable without authentication | **High** | ✅ Fixed & re-tested |
| F-3 | No CAPTCHA / rate limiting on two public submission endpoints | Low | Open (recommendation) |
| F-4 | Content-Security-Policy header absent on the web front-end | Low | Open (recommendation) |
| F-5 | Platform "leaked/compromised password" protection not enabled | Low | Open (one-click toggle) |

No customer funds were at risk from any finding, and no evidence of external exploitation was found. The test itself moved no funds and made no destructive changes; the single incidental data change it produced (a test-induced strategy setting on one account) was reverted within minutes.

Overall, the platform demonstrates a **mature, defence-in-depth security model** — row-level database security on every table, per-request identity checks on privileged operations, server-side signing of all exchange requests with secrets held in a dedicated vault, a withdrawal allow-list and kill-switch, and real-time security alerting. The two findings were implementation defects within that model rather than an absence of controls, and both were closed quickly.

---

## 2. Scope and methodology

**In scope**
- The public REST/data API (PostgREST) and all remotely-callable stored procedures.
- All serverless ("edge") functions.
- Customer data isolation between tenants/customers.
- The customer web portal and administrative console authentication.
- Transport security and HTTP security headers of the public web properties.
- Platform authentication configuration.

**Out of scope / not tested**
- Denial-of-service stress testing against the managed platform (prohibited by the hosting provider's terms).
- The exchange's own infrastructure.
- Social engineering and physical security.

**Method.** A grey-box approach was used: the tester had the public application key (which ships in the website and is intentionally public) and could mint a normal, low-privilege customer session. Test cases were executed with (a) no credentials, (b) the public key only, (c) a non-privileged customer session, (d) an administrator session, and (e) the internal service credential, comparing the actual authorization decision against the expected one for each. All testing was read-only or non-destructive; where a test produced a side effect it was reverted immediately and recorded.

**Tooling note for the reviewer.** The assessment was a targeted authorization test written specifically for this architecture, because the real risk surface of a Supabase/PostgREST/serverless application is database row-level security, stored-procedure authorization, and per-function caller checks — areas that generic web-vulnerability scanners do not meaningfully exercise. Teams wishing to add automated coverage can run free, reputable tools such as **OWASP ZAP** (web proxy/scanner) and **Nuclei** (template-based checks) against the front-end and public endpoints; these complement, but do not replace, the authorization-focused testing above.

---

## 3. Security architecture (controls in place)

The assessment confirmed the following controls are implemented and, after remediation, effective:

1. **Row-Level Security (RLS) on every data table.** Every table in the application database enforces row-level security. The public (unauthenticated) role has **no** table, view, or sequence access whatsoever; customers can read only their own rows; administrative access is mediated by explicit policies tied to verified organisation membership.
2. **Least-privilege data API.** The unauthenticated web role can call only a small, explicitly allow-listed set of read-only endpoints that return non-sensitive marketing/benchmark data. Every sensitive table, view, and stored procedure rejects unauthenticated access.
3. **Per-request authorization on privileged operations.** Administrative and customer-scoped stored procedures verify the caller's identity on every call (organisation-admin membership, or ownership of the specific customer record). An automated check is run after every database change to confirm no privileged procedure is left unguarded.
4. **Server-side exchange request signing.** All requests to the custody exchange are cryptographically signed inside the trusted backend using secrets held in a managed secrets vault. Secrets are never exposed to the browser or to application tables.
5. **Withdrawal controls.** Customer withdrawals are constrained by an address allow-list, a velocity cap, a manual-approval state for new destinations, and a global kill-switch, with an alert raised on every withdrawal request.
6. **Secrets management.** Application and exchange secrets live only in a managed vault / platform secret store. A prior incident response (documented separately) removed all secrets from application-readable tables and rotated keys.
7. **Transport security.** HTTPS is enforced on all web properties with HTTP Strict Transport Security (HSTS), clickjacking protection (`X-Frame-Options: DENY`), MIME-sniffing protection (`X-Content-Type-Options: nosniff`), and a referrer policy.
8. **Real-time security alerting.** Anomalous credential-access patterns and privileged actions raise immediate alerts to the operator.
9. **Separation of custody.** BitWealth cannot transfer customer assets to any third-party destination; funds remain within each customer's own exchange account/sub-account, materially limiting the blast radius of any application compromise.

---

## 4. Findings

### F-1 — Broken access control via NULL three-valued logic (Critical, fixed)

**Description.** Four privileged database functions authorised the caller with a conditional of the form "deny unless the caller is an organisation administrator **or** an internal service call." The internal-service portion of that condition relied on a request attribute that the current data-API layer no longer populates, so it evaluated to SQL `NULL`. Because of SQL's three-valued logic (`FALSE OR NULL = NULL`, `NOT NULL = NULL`) and the procedural language's treatment of a `NULL` condition as "not true," the deny branch was never taken — the authorization check was effectively inert for all callers.

**Impact.** A standard authenticated customer could invoke these functions outside their own scope. The most serious of the four allowed one customer to change **another customer's** account configuration; the others allowed reading another customer's account status. No function in this group can move funds or alter balances, and no secrets were exposed. Confirmed by controlled test using a non-privileged customer session acting on a different customer's record.

**Remediation (completed).** A dedicated, hardened helper now determines internal-service calls from the authoritative request context and can never return `NULL`; and every affected authorization expression was rewritten to **fail closed** (any indeterminate result is treated as "deny"). Re-testing confirmed: a non-privileged customer is now denied on all four functions while still able to read their own data, and legitimate administrator and internal calls succeed. An automated scan confirmed no other function uses the vulnerable pattern.

**Root-cause class.** CWE-670 (incorrect/Null handling) leading to CWE-285/CWE-863 (improper/incorrect authorization).

### F-2 — Unauthenticated internal serverless functions (High, fixed)

**Description.** Seven back-office serverless functions — which orchestrate the daily automated process, place/settle exchange orders, perform internal currency conversions, refresh cached marketing content, and generate an internal balance preview — were reachable without authentication. They are intended to be called only by the internal scheduler, by other backend functions, or by an authenticated administrator.

**Impact.** A party possessing only the public web key could trigger these internal operations. None accepts a parameter that could redirect funds to an attacker (orders and conversions operate strictly within customers' own exchange accounts). The practical risks were: unwanted triggering of trading/conversion activity (timing abuse), exhaustion of exchange rate limits, and — for the balance-preview function — disclosure of customer balance figures. Confirmed by sending the public key to each function.

**Remediation (completed).** All seven functions now enforce the standard caller check (internal-service credential **or** verified administrator). The internal scheduler and backend orchestrators (which present the service credential) and the administrative console (which presents an administrator session) continue to work unchanged; unauthenticated and ordinary-customer callers are now rejected (HTTP 401/403). Verified by re-test across all four caller types.

**Root-cause class.** CWE-306 (missing authentication for a critical function).

### F-3 — No CAPTCHA / rate limiting on two public submission endpoints (Low, open)

Two genuinely public endpoints (prospect lead capture and customer self-registration) accept submissions without a CAPTCHA or rate limit, allowing automated spam or resource abuse. No data exposure. **Recommendation:** add the same CAPTCHA/verification already used on other public forms, and/or a per-IP rate limit.

### F-4 — Content-Security-Policy header absent (Low, open)

The web front-end sets HSTS, `X-Frame-Options`, `X-Content-Type-Options`, and a referrer policy, but not a Content-Security-Policy (CSP). CSP is defence-in-depth against cross-site scripting. **Recommendation:** add a restrictive CSP at the CDN/hosting layer.

### F-5 — Platform compromised-password protection disabled (Low, open)

The identity platform offers an optional check that rejects passwords known to be breached (HaveIBeenPwned). It is currently off. **Recommendation:** enable it (one setting; no code change).

---

## 5. Remediation summary

| Finding | Severity | Fixed | Verified by re-test |
|---------|----------|-------|---------------------|
| F-1 NULL-logic authorization bypass | Critical | ✅ same day | ✅ customer denied, admin/service allowed, 0 residual patterns |
| F-2 Unauthenticated internal functions | High | ✅ same day | ✅ anon/customer denied, scheduler/admin allowed |
| F-3 Public form abuse | Low | Open | Recommendation |
| F-4 Missing CSP header | Low | Open | Recommendation |
| F-5 Compromised-password check | Low | Open | Recommendation |

Both material findings (F-1, F-2) were remediated and re-verified on the day of discovery. The three low-severity items are hardening recommendations with no associated data exposure.

---

## 6. Assurance context

- **Custody model:** customer assets remain in customer-owned accounts at a regulated exchange; BitWealth has no capability to send customer assets to arbitrary external destinations.
- **Secrets:** held in a managed vault; not present in application tables or the browser; rotated under a documented incident-response process.
- **Monitoring:** privileged actions and anomalous credential access raise real-time alerts.
- **Change control:** every database change is followed by an automated authorization-coverage check; security findings are tracked to closure in the solution design record.
- **Testing cadence:** this authorization assessment is repeatable and is recommended to be re-run after significant backend changes and at least quarterly.

---

*Prepared by BitWealth engineering. Proprietary investment-strategy logic, trading parameters, internal identifiers, and secret material have been intentionally excluded from this document.*
