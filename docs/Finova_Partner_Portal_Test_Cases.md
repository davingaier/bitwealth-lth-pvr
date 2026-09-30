# Finova Partner Portal — Joint Test Cases

**Version 1.0 · 30 September 2026 · BitWealth & Finova**

> Source file for `Finova_Partner_Portal_Test_Cases.docx`. Re-render with:
> `.venv\Scripts\python.exe tools/render_finova_spec.py docs/Finova_Partner_Portal_Test_Cases.md docs/Finova_Partner_Portal_Test_Cases.docx --landscape`

## How to use this document

Each test lists **who** performs it, the **steps**, and the **expected result**. Record **PASS**, **FAIL** or **SKIP** in the Result column and add any notes (screenshots help for failures).

| Code | Who | Uses |
|---|---|---|
| **BW** | BitWealth (Davin) | Admin UI → Partners tab, Supabase |
| **FN** | Finova user (Guy, Gavin or Robert) | Partner portal `bitwealth.co.za/partner` and Finova's VALR corporate account |
| **CL** | Test client | BitWealth customer portal and their email inbox |

## Before you start

| # | Preparation | Owner | Done |
|---|---|---|---|
| P1 | Finova supplies email addresses for Guy Algeo, Gavin McCarter and Robert North | FN | |
| P2 | Each Finova user has an authenticator app (Microsoft/Google Authenticator, Authy) on their phone | FN | |
| P3 | Agree one **test client** (an individual — ideally a Finova staff member) who will deposit a small amount, e.g. R500, and later withdraw R100 | BW + FN | |
| P4 | Test client completes BitWealth registration and Finova KYC as normal | CL | |
| P5 | BitWealth confirms `bitwealth@finova.co.za` is set in Admin → Partners → Partner Settings | BW | |

## A. Portal access and security

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| PA-01 | BW | Admin → Partners → Partner Portal Logins: create a login for each Finova user (name, email, partner `finova`, role Both) | Each user listed as Active; each receives an invitation email | | |
| PA-02 | FN | Open the invitation email and set a password | Password accepted; user is taken to two-factor set-up | | |
| PA-03 | FN | Scan the QR code with the authenticator app and enter the 6-digit code | Enrolment succeeds; portal opens showing tabs Subaccount Requests, Withdrawals, Fee Invoices, Activity Log | | |
| PA-04 | FN | Log out, log in again and enter a **wrong** 6-digit code | Access refused; a correct code then succeeds | | |
| PA-05 | FN | Browse to `bitwealth.co.za/partner` | Redirects to the partner login page | | |
| PA-06 | BW | For one user click **Reset password** | User receives a reset email and can set a new password | | |
| PA-07 | BW | For one user click **Reset 2FA** | User must scan a new QR code at next login | | |
| PA-08 | BW | **Disable** one user, then ask them to refresh the portal / log in | User is signed out and cannot log in. **Enable** restores access | | |
| PA-09 | FN | Review all tabs | Only Finova-custody clients appear. No other BitWealth clients are visible | | |
| PA-10 | FN | Perform any action, then open **Activity Log** | Each action shows user email, time and IP address | | |

## B. New client — request raised

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| OB-01 | BW | Admin → Customer Maintenance: verify the test client's KYC and choose **🤝 Finova Omnibus** | Client moves to VALR Setup; message shows the subaccount name for Finova | | |
| OB-02 | BW | Admin → Partners → Subaccount Requests | One **Provision** request, status *pending*, name `BW Surname Firstname` | | |
| OB-03 | FN | Check `bitwealth@finova.co.za` (within 10 minutes) | Email "new client subaccount required" with client name, BitWealth reference, subaccount name, target of 1 business day, and steps A–C. **No credentials or bank details** | | |
| OB-04 | FN | Portal → Subaccount Requests | Request listed with the exact name; **Copy** puts the name on the clipboard | | |
| OB-05 | BW | (Optional, entity) Repeat OB-01 for an entity such as "Test Holdings (Pty) Ltd" | Suggested name has punctuation removed: `BW Test Holdings Pty Ltd` | | |

## C. Subaccount set-up and submission

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| SA-01 | FN | In VALR create the subaccount using the copied name | VALR accepts the name | | |
| SA-02 | FN | Link the client's bank account to the subaccount and **generate the ZAR deposit reference** | Reference available in VALR | | |
| SA-03 | FN | On the **subaccount**, create an API key with View, Trade and Internal Transfer (no Withdraw). Note the key name, key and secret | Key created | | |
| SA-04 | FN | Portal → **Submit details**; try to submit with the bank-linked box unticked or any field blank | Form will not submit | | |
| SA-05 | FN | Submit with a deliberately **wrong secret** | Red message: VALR rejected the key. Request shows *submitted* with the error. BitWealth receives a "submission failed" email | | |
| SA-06 | FN | (Optional) Create a second key **with Withdraw** and submit it | Rejected: key has Withdraw permission. Nothing stored. Delete that key in VALR afterwards | | |
| SA-07 | FN | (Optional) Submit a key created on Finova's **primary** account | Rejected: key belongs to the primary account | | |
| SA-08 | FN | Submit the correct details from SA-01 to SA-03 | Green message: verified and linked, client sent deposit instructions. Request shows *verified* | | |
| SA-09 | BW | Check inbox and Admin → Partners | "Finova subaccount verified" email received; request *verified* with ZAR reference shown | | |
| SA-10 | CL | Check the test client's inbox | Deposit instructions email: **ZAR bank transfer only**, VALR banking details and the reference from SA-02. No crypto deposit option | | |
| SA-11 | FN | Re-open the portal request | API key and secret are never shown again | | |

## D. Deposit and trading

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| DT-01 | CL | Deposit the agreed ZAR amount to VALR using the reference | Funds arrive in the client's subaccount (Finova can see this in VALR) | | |
| DT-02 | BW | Within ~1 hour check Admin UI | Deposit detected and client becomes Active; ZAR converted to USDT **inside the subaccount** (automatically, or via Administration → Pending ZAR Conversions) | | |
| DT-03 | FN | In VALR review the subaccount's trade history over the next trading days | BitWealth's orders appear in the client subaccount only — nothing in Finova's main account | | |
| DT-04 | CL | Log in to the BitWealth customer portal | Balances match the VALR subaccount | | |

## E. Client withdrawal

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| WD-01 | CL | Customer portal → Withdraw: request R100 (ZAR) | Request accepted. BTC/USDT withdrawal to an external wallet is **not** offered | | |
| WD-02 | BW | Within ~15 minutes: Admin → Partners → Partner Withdrawals | Status *awaiting_partner* with the net ZAR amount | | |
| WD-03 | FN | Check `bitwealth@finova.co.za` and the portal Withdrawals tab | Email "withdrawal awaiting payout" with exact amount, subaccount and target of 3 business days. Portal shows **Mark as paid** | | |
| WD-04 | FN | Click Mark as paid and try to submit without a reference | Blocked — reference is required | | |
| WD-05 | FN | Perform internal authorisation and verify the request. In VALR withdraw the **exact** amount from the subaccount to the linked bank account. Then Mark as paid with the payment reference | Message: payout confirmed, or recorded and awaiting confirmation | | |
| WD-06 | BW | Within 30 minutes check Partner Withdrawals | Status *completed*, reconciliation *matched* | | |
| WD-07 | CL | Check inbox and bank account | "Withdrawal completed" email; funds received in the bank | | |
| WD-08 | CL | Customer portal → Transactions | Withdrawal shown and balance reduced | | |
| WD-09 | BW | (Optional control) Ask FN to mark a second small withdrawal paid **before** paying it; wait 30 minutes | Reconciliation *unmatched* and a critical BitWealth alert. After FN pays it, the next sync completes it | | |

## F. Bank account change

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| BR-01 | BW | Admin → Partners → enter the test client's ID → **Raise bank re-link** | Bank re-link request (*pending*) listed | | |
| BR-02 | FN | Check email and portal | Email "bank re-link required". Portal shows the request marked *(bank re-link)* with **Confirm re-linked** | | |
| BR-03 | CL + FN | Client requests another small ZAR withdrawal while the re-link is open | In the portal the withdrawal shows *on hold — bank re-link* and cannot be marked paid | | |
| BR-04 | FN | Update the linked bank in VALR (or confirm unchanged for the test) and click **Confirm re-linked** | Request *verified*; the withdrawal becomes payable; Activity Log records the confirmation | | |
| BR-05 | FN | Complete the held withdrawal as in WD-05 | Completes as normal | | |

## G. Turnaround reminders and settings

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| SL-01 | BW + FN | Leave a request open for more than 1 business day (or BitWealth back-dates a test request) | One reminder email "overdue"; BitWealth warning alert. No repeat reminders | | |
| SL-02 | BW + FN | Leave a withdrawal awaiting payout for more than 3 business days (or back-dated test) | One reminder email; BitWealth warning alert | | |
| SL-03 | BW | Admin → Partner Settings: change the notification email to a test address and Save; raise a test task; then restore `bitwealth@finova.co.za` | Email goes to the new address; setting persists after refresh | | |

## H. Fees and monthly invoice

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| FE-01 | BW | After the client's first fee (platform fee on deposit, or month-end fees) check fee transfers | A fee record to `partner_main` exists; status *deferred* (held in subaccount) or *completed* (moved automatically) | | |
| FE-02 | BW | Check BitWealth's own VALR main account | No fee arrives there and no BTC→USDT conversion runs for this client | | |
| FE-03 | BW | Admin → Partners → Partner Fee Invoices: choose the month, click **Preview** | Line count, held count and totals shown; nothing emailed | | |
| FE-04 | BW | Click **Issue & email** | Invoice `BW-FINOVA-YYYYMM` created and emailed | | |
| FE-05 | FN | Check email and portal → Fee Invoices → **Details** | Invoice lists client, subaccount, fee type, amount and location (held / in main account) with totals per currency | | |
| FE-06 | BW | Click Issue & email again for the same month, then **Resend** | First says already issued; Resend emails it again | | |
| FE-07 | FN | In VALR transfer each **held** fee from the subaccount to Finova's main account, then click **Confirm held fees transferred** | Invoice shows *held fees transferred*; Activity Log records it | | |
| FE-08 | BW | On the 1st of next month, 06:30 UTC | Previous month's invoice is issued automatically | | |

## I. Security checks

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| SE-01 | FN | Try to sign in to the BitWealth customer portal or admin UI with the partner login | No client or admin data is shown | | |
| SE-02 | CL | Try to open `bitwealth.co.za/partner-portal.html` with the client login | Access refused | | |
| SE-03 | FN | Log in with password but close the browser before entering the 2FA code, then open the portal URL directly | Redirected to login / 2FA; no data shown | | |
| SE-04 | BW | Call partner and admin functions with only the public website key | All refused (401 / permission denied). **Pre-executed 30 Sep 2026: PASS** | PASS | |
| SE-05 | BW + FN | Review every email received during testing | None contains API keys, secrets or client bank details | | |

## J. Existing BitWealth clients (regression)

| ID | Who | Steps | Expected result | Result | Notes |
|---|---|---|---|---|---|
| RG-01 | BW | Check the daily pipeline on the days after go-live | Existing personal-account clients trade normally; no new alerts | | |
| RG-02 | BW | Admin → VALR Setup: **Resend deposit email** for an existing client | Email sends successfully | | |
| RG-03 | BW | Admin → convert accumulated BTC platform fees | Conversion runs (requires being signed in as admin) | | |

## Results summary

| Section | Total | Pass | Fail | Skip |
|---|---|---|---|---|
| A. Portal access | 10 | | | |
| B. Request raised | 5 | | | |
| C. Subaccount submission | 11 | | | |
| D. Deposit and trading | 4 | | | |
| E. Withdrawal | 9 | | | |
| F. Bank change | 5 | | | |
| G. Reminders and settings | 3 | | | |
| H. Fees and invoice | 8 | | | |
| I. Security | 5 | | | |
| J. Regression | 3 | | | |

## Sign-off

| Party | Name | Signature | Date |
|---|---|---|---|
| BitWealth | | | |
| Finova | | | |
