# BitWealth Partner Portal — Specification for Finova

**Version 0.3 (draft for Finova review) · 30 August 2026**

> **Source of truth.** This markdown file is the editable master. The Word version
> shared with Finova (`FINOVA_PARTNER_PORTAL_SPEC.docx`) is generated from it by
> `tools/render_finova_spec.py`. Edit this file, then re-run the renderer.

## Purpose

BitWealth operates a Bitcoin dollar-cost-averaging investment strategy. Where Finova is the responsible FSP, client assets will be held in **subaccounts under Finova's VALR omnibus account**.

Finova will not be asked to share omnibus API credentials. Instead, Finova creates each client subaccount manually and provides BitWealth with an API key limited to that single subaccount. BitWealth uses that key to trade the client's portfolio; **Finova retains sole control of all withdrawals.**

This document covers only the parts Finova interacts with.

## Please confirm these points

1. **Permissions.** We require **View**, **Trade** and **Transfer** on each key. We ask that **Withdraw is NOT granted** — this is what guarantees only Finova can move client money out.
2. **How many Finova staff need portal logins,** and their names and email addresses.
3. **Turnaround times** for new subaccounts and for withdrawals (see final section).

## Subaccount naming

VALR permits only letters, numbers and spaces in subaccount names — no underscores, commas, full stops, ampersands or brackets. The agreed convention is therefore:

| Client type | Format | Example |
|---|---|---|
| Individual | `BW Surname First name` | `BW Smith John` |
| Entity | `BW Entity name` | `BW BitWealth Test Entity Pty Ltd` |

Punctuation in company names such as `(Pty) Ltd` is simply removed. **The portal will display the exact name to use for each client, ready to copy** — Finova does not need to apply these rules manually.

## What Finova gets

A secure web portal (`portal.bitwealth.co.za/partner`), separate from BitWealth's client and admin systems.

- Individual named logins — no shared accounts
- **Two-factor authentication is mandatory** (authenticator app)
- Finova sees **only clients held in Finova's omnibus account**. Other BitWealth clients are not visible and are technically inaccessible.
- Every action is logged with user, timestamp and IP, and is visible to Finova

## Workflow 1 — New client subaccount

**Trigger.** A client completes Finova KYC, BitWealth confirms their strategy, and the client's bank confirmation is on file. BitWealth emails Finova's nominated address; the task also appears in the portal.

**What Finova sees:** client name, BitWealth client reference, individual or entity, date requested, and the exact subaccount name to use.

**What Finova does — three parts, all required:**

**A. Create the subaccount in VALR**, using the name shown in the portal.

**B. Link the client's bank account** to that subaccount within Finova's VALR corporate account, using the bank details Finova holds from onboarding. Without this, ZAR payouts cannot be made later.

**C. Complete the portal form:**

| Field | Notes |
|---|---|
| Subaccount name | As created |
| ZAR deposit reference | The reference the client must use when depositing ZAR. **BitWealth cannot see this** — it exists only inside Finova's VALR account. We pass it to the client. |
| API key name | As created in VALR |
| API key | View + Trade + Transfer, no Withdraw |
| API secret | Entered once, never displayed again |
| Bank account linked | Confirmation tick |

The form cannot be submitted until every field is complete.

**What happens next — automatically, within seconds:**

- BitWealth tests the key against VALR to confirm it works
- BitWealth confirms permissions are correct, and **rejects the key if Withdraw is enabled**
- BitWealth confirms the key is not already linked to a different client
- The key and secret are encrypted at rest and never displayed again, to anyone
- Finova sees a clear pass or fail message immediately; BitWealth is notified either way

The client cannot receive deposit instructions until this step succeeds. Once it does, BitWealth issues the client Finova's VALR banking details together with the deposit reference Finova supplied.

## Workflow 2 — Client withdrawal

**Trigger.** A client requests a withdrawal in the BitWealth portal. **All withdrawals are ZAR to the client's own bank account.** Clients cannot send cryptocurrency to external wallets.

**BitWealth does automatically:** applies any fees due, sells the required Bitcoin/USDT and converts to ZAR inside the client's subaccount. The ZAR then sits in that subaccount awaiting Finova.

**Finova is emailed and the item appears in the portal**, showing: client name, BitWealth client reference, subaccount name, exact ZAR amount to pay, and date requested.

**What Finova does:**

1. Perform normal internal authorisation
2. In VALR, withdraw the stated ZAR amount from that subaccount to the client's linked bank account
3. Mark the item complete in the portal

**What happens next — automatically:** BitWealth queries VALR, confirms a matching ZAR withdrawal of the expected amount, updates the client's records and notifies the client. If no matching withdrawal is found, BitWealth raises an internal alert and contacts Finova — **the item is not closed on Finova's word alone.**

Client banking details are not shown in the portal, as Finova already holds them from onboarding and links them at setup.

## Bank account changes

If a client changes bank account, BitWealth raises a re-link task in the portal. Finova updates the linked account in VALR and confirms. Withdrawals are held until this is done.

## Fees

BitWealth's management and performance fees are transferred automatically from each client subaccount to Finova's main account using the Transfer permission. BitWealth then issues Finova a **single consolidated invoice each month** covering all clients.

## Security summary

| Control | Measure |
|---|---|
| Withdraw permission on API keys | Never requested; keys with it are rejected |
| Credential storage | Encrypted at rest; never displayed after entry; never emailed |
| Portal access | Named logins, mandatory 2FA, Finova clients only |
| Audit | Every action logged and visible to Finova |
| Control of client funds | Remains entirely with Finova at all times |

## What we need to agree

| Item | Needed from Finova |
|---|---|
| The three confirmation points above | Confirmation |
| Email address for notifications | One shared mailbox recommended |
| Turnaround — new subaccounts | Proposed: 1 business day |
| Turnaround — withdrawals | Proposed: 1 business day |

*Prepared by BitWealth for Finova. Draft for comment — please return changes before development begins.*
