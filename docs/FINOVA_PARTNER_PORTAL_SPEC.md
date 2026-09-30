# BitWealth Partner Portal — Specification for Finova

**Version 0.4 (agreed with Finova) · 30 September 2026**

> **Source of truth.** This markdown file is the editable master. The Word version
> shared with Finova (`FINOVA_PARTNER_PORTAL_SPEC.docx`) is generated from it by
> `tools/render_finova_spec.py`. Edit this file, then re-run the renderer.
> v0.4 incorporates Finova's comments on v0.3 (returned 30 Sep 2026).

## Purpose

BitWealth operates a Bitcoin dollar-cost-averaging investment strategy. Where Finova is the responsible FSP, client assets will be held in **subaccounts under Finova's VALR omnibus account**.

Finova will not be asked to share omnibus API credentials. Instead, Finova creates each client subaccount manually and provides BitWealth with an API key limited to that single subaccount. BitWealth uses that key to trade the client's portfolio; **Finova retains sole control of all withdrawals.**

This document covers only the parts Finova interacts with.

## Confirmed by Finova

| Item | Agreed |
|---|---|
| API key permissions | **View**, **Trade** and **Internal Transfer**. **Withdraw is never granted.** |
| Portal users | Guy Algeo, Gavin McCarter, Robert North (email addresses to be supplied) |
| Notification mailbox | `bitwealth@finova.co.za` |
| Turnaround — new subaccounts | 1 business day |
| Turnaround — withdrawals | 3 business days |

## Subaccount naming

VALR permits only letters, numbers and spaces in subaccount names — no underscores, commas, full stops, ampersands or brackets. The agreed convention is therefore:

| Client type | Format | Example |
|---|---|---|
| Individual | `BW Surname First name` | `BW Smith John` |
| Entity | `BW Entity name` | `BW BitWealth Test Entity Pty Ltd` |

Punctuation in company names such as `(Pty) Ltd` is simply removed. **The portal displays the exact name to use for each client, ready to copy** — Finova does not need to apply these rules manually.

## What Finova gets

A secure web portal (`bitwealth.co.za/partner`), separate from BitWealth's client and admin systems.

- Individual named logins — no shared accounts
- **Two-factor authentication is mandatory** (authenticator app)
- Every action is logged with user, timestamp and IP, and is visible to Finova
- An email to `bitwealth@finova.co.za` for every new task, and one reminder if a task passes the agreed turnaround

## Workflow 1 — New client subaccount

**Trigger.** A client completes Finova KYC and BitWealth confirms their strategy. BitWealth emails `bitwealth@finova.co.za`; the task also appears in the portal.

**What Finova sees:** client name, BitWealth client reference, individual or entity, date requested, and the exact subaccount name to use.

**What Finova does — three parts, all required:**

**A. Create the subaccount in VALR**, using the name shown in the portal.

**B. Link the client's bank account** to that subaccount within Finova's VALR corporate account, using the bank details Finova holds from onboarding, and **generate the ZAR deposit reference**. Without the link, ZAR payouts cannot be made later.

**C. Complete the portal form:**

| Field | Notes |
|---|---|
| Subaccount name | As created |
| ZAR deposit reference | Generated in step B. BitWealth cannot see this in VALR, so we pass it to the client. |
| API key name | As created in VALR |
| API key | Created on the subaccount: View + Trade + Internal Transfer, no Withdraw |
| API secret | Entered once, never displayed again |
| Bank account linked | Confirmation tick |

**What happens next — automatically, within seconds:**

- BitWealth tests the key against VALR, confirms the permissions, and **rejects the key if Withdraw is enabled** or if it belongs to Finova's primary account rather than the subaccount
- BitWealth confirms the key is not already linked to a different client
- The key and secret are encrypted at rest and never displayed again, to anyone
- Finova sees a clear pass or fail message immediately; BitWealth is notified either way
- On a pass, BitWealth emails the client VALR's banking details together with the unique deposit reference

## Workflow 2 — Client withdrawal

**Trigger.** A client requests a withdrawal in the BitWealth portal. **All withdrawals are ZAR to the client's own bank account.** Clients cannot send cryptocurrency to external wallets.

**BitWealth does automatically:** applies any fees due, sells the required Bitcoin/USDT and converts to ZAR inside the client's subaccount. Finova is then emailed and the item appears in the portal, showing: client name, BitWealth client reference, subaccount name, exact ZAR amount to pay, and date ready.

**What Finova does:**

1. Perform normal internal authorisation and verify the request
2. In VALR, withdraw the stated ZAR amount from that subaccount to the client's linked bank account
3. Mark the item paid in the portal, with Finova's payment reference

**What happens next — automatically:** BitWealth queries VALR, confirms a matching ZAR withdrawal of the expected amount, updates the client's records and notifies the client. If no matching withdrawal is found, BitWealth raises an internal alert and contacts Finova.

Client banking details are not shown in the portal, as Finova already holds them from onboarding and links them at setup.

## Bank account changes

If a client changes bank account, BitWealth raises a re-link task (emailed and shown in the portal). Finova updates the linked account in VALR and clicks **Confirm re-linked**. That client's withdrawals are held until this is done.

## Fees

BitWealth's management, performance and platform fees are moved from each client's subaccount to Finova's main account using the Internal Transfer permission. Where VALR does not allow BitWealth to move a fee automatically, the fee remains in the client's subaccount and is marked **held**.

On the 1st of each month BitWealth emails Finova a **single consolidated invoice** covering all clients (also viewable in the portal). For any **held** fees, Finova transfers each amount from the subaccount shown to its main account, then clicks **Confirm held fees transferred** on that invoice.

## Security summary

| Control | Measure |
|---|---|
| Withdraw permission on API keys | Never requested; keys with it are rejected |
| Credential storage | Encrypted at rest; never displayed after entry; never emailed |
| Portal access | Named logins, mandatory 2FA |
| Audit | Every action logged (user, time, IP) and visible to Finova |
| Control of client funds | Remains entirely with Finova at all times |

## Still needed from Finova

| Item | Needed |
|---|---|
| Portal logins | Email addresses for Guy Algeo, Gavin McCarter and Robert North |
| Joint testing | One test client, run through the shared test-case document |

*Prepared by BitWealth for Finova. Version 0.4 reflects Finova's comments on v0.3.*
