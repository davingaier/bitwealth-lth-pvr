# Risk Management and Compliance Programme (RMCP)

**Institution:** BitWealth (Pty) Ltd  
**Registration No.:** [COMPANY REGISTRATION NUMBER]  
**Registered Address:** [REGISTERED BUSINESS ADDRESS]  
**Classification:** Accountable Institution — Schedule 1, Item 22, Financial Intelligence Centre Act 38 of 2001 (Crypto Asset Service Provider)  
**Version:** 1.0  
**Date Approved:** [DATE OF BOARD/OWNER APPROVAL]  
**Approved By:** [OWNER / BOARD MEMBER NAME AND TITLE]  
**Compliance Officer:** [COMPLIANCE OFFICER FULL NAME]  
**Next Review Date:** [DATE — ANNUAL REVIEW REQUIRED]

---

## Document Control

| Version | Date | Author | Summary of Changes |
|---------|------|--------|--------------------|
| 1.0 | 2026-03-04 | [AUTHOR NAME] | Initial RMCP — first FIC registration |

---

## Table of Contents

1. [Introduction and Legal Framework](#1-introduction-and-legal-framework)
2. [Business Profile](#2-business-profile)
3. [Governance and Accountability](#3-governance-and-accountability)
4. [Institutional Risk Assessment](#4-institutional-risk-assessment)
5. [Customer Risk Rating Methodology](#5-customer-risk-rating-methodology)
6. [Customer Due Diligence (CDD) Procedures](#6-customer-due-diligence-cdd-procedures)
7. [Ongoing CDD and Transaction Monitoring](#7-ongoing-cdd-and-transaction-monitoring)
8. [Automated Transaction Monitoring System (ATMS)](#8-automated-transaction-monitoring-system-atms)
9. [Targeted Financial Sanctions (TFS) Screening](#9-targeted-financial-sanctions-tfs-screening)
10. [Record Keeping](#10-record-keeping)
11. [Regulatory Reporting Procedures](#11-regulatory-reporting-procedures)
12. [Staff Training Programme](#12-staff-training-programme)
13. [Internal Audit and Independent Assurance](#13-internal-audit-and-independent-assurance)
14. [RMCP Review and Maintenance](#14-rmcp-review-and-maintenance)
15. [Appendices](#15-appendices)

---

## 1. Introduction and Legal Framework

### 1.1 Purpose

This Risk Management and Compliance Programme (RMCP) sets out how BitWealth (Pty) Ltd ("BitWealth") identifies, assesses, monitors and manages its exposure to money laundering (ML) and terrorist financing (TF) risk. It establishes the policies, procedures and controls that ensure BitWealth meets all obligations imposed on it as an accountable institution under the Financial Intelligence Centre Act 38 of 2001 (FIC Act), as amended.

This RMCP is a living document. It must be reviewed at least annually and updated whenever there is a material change to the business, the regulatory environment, or the institution's risk profile.

### 1.2 Legal and Regulatory Framework

BitWealth's AML/CFT compliance programme is governed by the following legislation, regulations and guidance:

| Instrument | Key Obligations |
|-----------|----------------|
| Financial Intelligence Centre Act 38 of 2001 (FIC Act) | Core obligations: registration, CDD, record keeping, reporting, RMCP |
| Money Laundering and Terrorist Financing Control Regulations (MLTFCR) | Detailed CDD and record-keeping requirements |
| FIC Guidance Note 7 (General Guidance for Accountable Institutions) | Interpreting CDD and risk-based approach requirements |
| FIC Directive 1 — RMCP | Mandatory content of this document |
| FIC Directive 5 — ATMS | Automated transaction monitoring requirements |
| FIC Directive 6 — IT Systems | Technical controls for AML compliance |
| Protection of Constitutional Democracy Against Terrorist and Related Activities Act 33 of 2004 (POCDATARA) | TF offences and reporting |
| Financial Sector Regulation Act 9 of 2017 (FSRA) | FSCA oversight of BitWealth as a CASP |
| Crypto Assets Regulatory (CAR) Framework | FSCA CASP licence requirements |
| FATF Recommendations | International standards — South Africa's mutual evaluation standards |
| United Nations Targeted Financial Sanctions (TFS) Lists | Mandatory screening obligations (Section 28A, FIC Act) |

### 1.3 FIC Registration

BitWealth is registered (or in the process of registering) with the Financial Intelligence Centre as an accountable institution:

- **goAML Organisation Reference:** [FIC ORGANISATION REFERENCE — assigned upon registration]
- **Registration Date:** [DATE]
- **Reporting Entity Type:** Crypto Asset Service Provider (CASP)
- **FSCA CASP Licence Number:** [FSCA LICENCE NUMBER — pending / insert once issued]

---

## 2. Business Profile

### 2.1 Overview

BitWealth provides an automated Bitcoin Dollar-Cost Averaging (DCA) investment service to retail and corporate clients in South Africa. The core product is the **Long-Term Holder Profit-to-Volatility Ratio (LTH PVR) DCA Strategy**, which automatically purchases Bitcoin using client funds at intervals and price levels determined by an on-chain analytical signal.

BitWealth is not an exchange. It does not hold order books, facilitate peer-to-peer trades, or offer speculative or leveraged products. It acts as an investment service provider that uses a licensed crypto exchange (VALR) as its execution venue.

### 2.2 Products and Services

| Product / Service | Description |
|------------------|-------------|
| LTH PVR Automated DCA | Daily automated BTC buy strategy based on on-chain LTH PVR signal. Clients invest ZAR; the system converts to BTC over time. |
| Standard DCA | Fixed-interval DCA without on-chain signal (benchmark product) |
| Portfolio Reporting | Performance dashboards and reporting for client portfolios |

**Products currently in development (not yet live):**

| Product | Status |
|---------|--------|
| Additional DCA strategies | Development |
| Direct ZAR withdrawal to bank | Planned |

### 2.3 Client Base

| Client Type | Description |
|------------|-------------|
| Retail individuals | South African natural persons (FICA-compliant CDD required) |
| Companies | South African registered companies (Enhanced CDD, beneficial owner verification) |
| Trusts | South African inter vivos and testamentary trusts (Trustee and beneficiary KYC required) |

**Client geographic scope:** South Africa only (domestic clients). BitWealth does not currently market to or onboard foreign nationals residing outside South Africa, or entities registered in foreign jurisdictions. Any extension of geographic scope requires a formal risk assessment and RMCP update before implementation.

### 2.4 Delivery Channels

| Channel | Description | ML/TF Risk |
|---------|-------------|-----------|
| Online portal (web) | Client onboarding, KYC document upload, portfolio monitoring | Medium — no face-to-face verification |
| Automated pipeline | Daily BTC purchase pipeline (no client interaction) | Low — automated, pre-approved mandates |
| Email | Client communications only — no funds transfer instructions via email | Low |

BitWealth does **not** accept:
- Physical cash (coins or notes) in any form
- Cheque payments
- Third-party payments (funds must originate from the verified client's own bank account)
- Cryptocurrency deposits (ZAR EFT only for funding)

### 2.5 Funds Flow

```
Client's SA bank account
        │
        ▼ EFT (ZAR)
VALR omnibus holding account (BitWealth subaccount pool)
        │
        ▼ Per-client VALR subaccount (segregated ZAR balance)
        │
        ▼ Daily automated BTC purchase (LIMIT/MARKET order on VALR BTC/USDT pair)
        │
        ▼ BTC held in client's VALR subaccount
```

**Key controls in the funds flow:**
- VALR performs its own FICA/CASP KYC on clients at subaccount level
- BitWealth performs independent KYC (this RMCP)
- Client's bank account must be verified (bank confirmation letter required on KYC)
- No cash-to-crypto or peer-to-peer components

---

## 3. Governance and Accountability

### 3.1 Compliance Officer

BitWealth has designated a Compliance Officer responsible for the implementation and ongoing management of this RMCP, as required by Section 42A of the FIC Act.

**Compliance Officer:**  
Name: [COMPLIANCE OFFICER FULL NAME]  
Title: [JOB TITLE]  
Contact: [EMAIL ADDRESS]  
Phone: [PHONE NUMBER]  
Appointed: [DATE OF APPOINTMENT]  
FIC goAML User ID: [goAML USER ID]

**Deputy / Acting Compliance Officer (in cases of absence):**  
Name: [DEPUTY NAME OR "N/A — sole operator, see escalation procedure"]  
Contact: [EMAIL]

The Compliance Officer is responsible for:
- Maintaining and updating this RMCP
- Ensuring regulatory reports are submitted within statutory timeframes
- Managing goAML account and user access
- Responding to FIC information requests
- Supervising CDD completion and KYC quality
- Maintaining the TFS screening programme
- Overseeing the ATMS alerts triage process
- Reporting material compliance issues to the owner/board
- Maintaining training records

### 3.2 Responsibility Matrix

| Activity | Responsible | Accountable |
|----------|-------------|-------------|
| RMCP maintenance | Compliance Officer | Owner/Director |
| Customer onboarding approval | Compliance Officer | Compliance Officer |
| EDD sign-off (high-risk clients) | Compliance Officer | Owner/Director |
| STR/SAR/TFTR/TFAR/TPR filing | Compliance Officer | Owner/Director |
| TFS screening — automated | System (daily cron) | Compliance Officer |
| TFS screening — manual remediation | Compliance Officer | Owner/Director |
| ATMS alert triage | Compliance Officer | Compliance Officer |
| Training delivery | [TRAINER NAME / "External provider"] | Compliance Officer |
| Internal audit | [INTERNAL / "External auditor"] | Owner/Director |

---

## 4. Institutional Risk Assessment

### 4.1 Risk Assessment Methodology

BitWealth assesses its inherent ML/TF risk across four dimensions consistent with FATF Recommendation 1 and the FIC's risk-based approach guidance:

1. **Products and services risk**
2. **Customer risk**
3. **Geographic risk**
4. **Delivery channel risk**

Residual risk is determined by applying the mitigating controls in this RMCP to the inherent risk rating. The risk assessment is reviewed annually (or on material business change) and the findings are used to calibrate:
- The level of CDD applied at onboarding
- ATMS thresholds and rules
- TFS screening frequency
- Enhanced due diligence triggers

### 4.2 Products and Services Risk

| Product | Inherent Risk | Key ML/TF Vulnerabilities | Mitigating Controls | Residual Risk |
|---------|--------------|--------------------------|--------------------|----|
| LTH PVR Bitcoin DCA | **High** | Crypto is pseudonymous; BTC can be moved globally; client could use layering (buy BTC with criminal funds) | ZAR EFT only (traceable fiat on-ramp); bank account verification; VALR also performs KYC; automated pipeline (no manual cash handling) | **Medium** |
| Standard DCA | **High** | Same as above | Same as above | **Medium** |
| Portfolio reporting | **Low** | No funds movement | N/A | **Low** |

**Overall product risk rating: Medium**

### 4.3 Customer Risk

| Customer Segment | Inherent Risk | Key Risk Factors |
|-----------------|--------------|-----------------|
| Retail South African individuals | **Medium** | Cannot physically verify ID; online-only; small segment may be PEPs |
| South African companies | **High** | Complex ownership structures; potential for shell companies; nominee directors |
| Trusts | **High** | Opaque beneficial ownership; trustee discretion; potential for nominee arrangements |

**Elevated risk indicators (triggers for Enhanced Due Diligence):**
- Client is a current or former PEP, or is an immediate family member/close associate of a PEP
- Client is from a FATF grey-list or black-list jurisdiction (not applicable currently — SA-only, but assessed on dual nationals)
- Client's source of funds is unusual or inconsistent with their profile
- Client requests unusually large or frequent deposits
- Client shows reluctance to provide KYC documents
- Beneficial owner cannot be identified or verified for a company/trust

### 4.4 Geographic Risk

BitWealth currently serves **domestic South African clients only.**

| Geography | Risk Level | Rationale |
|-----------|-----------|-----------|
| South Africa (domestic) | **Medium** | South Africa is currently on the FATF grey list (as of October 2023, subject to review). South Africa has elevated ML/TF risk relative to FATF fully compliant jurisdictions. |
| International (not accepted) | N/A | BitWealth does not onboard foreign-domiciled clients |

**Note:** South Africa's FATF grey-list status means BitWealth must apply heightened domestic vigilance consistent with the FATF enhanced follow-up process until grey-listing is lifted (expected 2025—2027 depending on progress).

**High-risk country exposure (dual nationals, company directors):** Where a client holds dual nationality or a director is a national of a FATF grey-listed or black-listed country, Enhanced Due Diligence applies.

FATF grey-listed and black-listed countries are monitored at: [https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html](https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html)

**The Compliance Officer reviews the FATF list quarterly.**

### 4.5 Delivery Channel Risk

| Channel | Inherent Risk | Controls | Residual Risk |
|---------|--------------|----------|---------------|
| Online onboarding (no face-to-face) | **High** | Document upload + liveness checks (where implemented); bank account verification; VALR parallel KYC | **Medium** |
| Automated BTC purchase pipeline | **Low** | Pre-approved mandates; no client-initiated trade instructions; ATMS monitoring | **Low** |

### 4.6 Overall Institutional Risk Rating

| Dimension | Rating |
|-----------|--------|
| Products | Medium |
| Customers | Medium–High |
| Geography | Medium |
| Delivery Channel | Medium |
| **Overall Inherent Risk** | **Medium–High** |
| **Residual Risk (post-controls)** | **Medium** |

BitWealth's residual risk is **Medium**. This means:
- Standard CDD applies to all clients as a baseline
- Enhanced CDD is mandatory for companies, trusts, and all PEPs
- The ATMS is mandatory (FIC Directive 5 applies to medium and high-risk institutions)
- TFS screening is mandatory for all clients (non-risk-based)

---

## 5. Customer Risk Rating Methodology

### 5.1 Risk Rating Scale

Each client is assigned an individual risk rating at onboarding and reviewed at least annually or on material change.

| Rating | Score | Description |
|--------|-------|-------------|
| Low | 0–3 | Standard SA individual, salaried income, domestic address, no adverse indicators |
| Medium | 4–6 | Applies to most clients by default given medium institutional risk |
| High | 7–10 | Triggers Enhanced Due Diligence; must be approved by Compliance Officer |
| Prohibited | — | TFS confirmed match, or client type not accepted |

### 5.2 Risk Scoring Factors

| Factor | Low (0) | Medium (1) | High (2) |
|--------|---------|-----------|--------|
| Client type | Individual | Company | Trust |
| PEP status | Not PEP | Close associate of PEP | PEP or immediate family of PEP |
| Source of funds | Salary / employment | Business income | Unknown / cash business / offshore |
| Geography | SA domiciled | Dual national (benign jurisdiction) | Dual national (FATF grey/black list country) |
| Transaction size | < R50,000/month | R50,000–R500,000/month | > R500,000/month |
| Adverse media | None identified | Historical (resolved) | Current / ongoing |
| TFS screening | Clear | Possible match (resolved) | Confirmed match |

### 5.3 Risk Rating Actions

| Risk Rating | CDD Level | Approval Required | Review Frequency |
|-------------|-----------|------------------|-----------------|
| Low | Standard CDD | Not required | Annually |
| Medium | Standard CDD | Not required | Annually |
| High | Enhanced Due Diligence (EDD) | Compliance Officer | 6-monthly |
| Prohibited | Relationship not accepted / terminated | Owner/Director | N/A |

---

## 6. Customer Due Diligence (CDD) Procedures

### 6.1 Timing — When CDD Must Be Completed

CDD must be completed **before** a client is onboarded and before any funds are received or any transactions are executed on their behalf. No deposit, conversion or investment may proceed until CDD is complete and the client's `registration_status` is set to `active` in the BitWealth platform.

Exceptions to this timing rule are **not permitted.**

### 6.2 Standard CDD — Natural Persons (Individuals)

The following must be collected and verified for all individual clients:

**Identity:**
| Field | Document Accepted |
|-------|-----------------|
| Full legal names (first, middle, last) | SA Green ID Book / Smart ID Card / Passport |
| Date of birth | As above |
| ID number (SA) or passport number (foreign) | As above |
| Nationality | As above |
| Country of residence | As above |
| Gender | As above |

**Residential address:**
| Field | Document Accepted |
|-------|-----------------|
| Physical residential address | Utility bill / bank statement / municipality rates account (not older than 3 months) |

**Financial profile:**
| Field | Documentation |
|-------|-------------|
| Occupation / employment | Self-declaration (verbal / form) |
| Source of funds | Self-declaration — salary / business income / investments / inheritance / other |
| Source of income | Payslip, employment letter, or Business registration |
| Bank account in own name | Bank-stamped confirmation letter or certified statement |
| Tax reference number | Self-declaration (SARS income tax number) |

**Verification:**
- ID document must be verified against the Home Affairs DHA-4 system or equivalent document verification service, **OR** by certified copy from a commissioner of oaths, attorney, bank or accountant
- Proof of address must be a document from a recognised institution (bank, municipality, licensed insurer)
- Bank account must match the name of the account holder

**PEP screening:**
- Self-declaration on onboarding form: Is the client a current or former politically exposed person, or an immediate family member or close associate of a PEP?
- TFS screening must be completed before onboarding approval

### 6.3 Standard CDD — Companies

For South African registered companies, the following is required in addition to all natural person CDD for each beneficial owner:

**Entity identity:**
| Field | Document |
|-------|---------|
| Registered name | CIPC Company Registration Certificate (CoR14.3 or equivalent) |
| Registration number | As above |
| Registered address | As above |
| Trading name (if different) | Letterhead / CIPC records |
| Nature of business | CIPC records or company profile |
| Tax registration number | SARS Tax Clearance Certificate or SARS confirmation |
| Date of incorporation | CIPC Certificate |

**Beneficial owners and directors:**
The following individuals must undergo full natural person CDD:
1. All directors of the company
2. All natural persons who directly or indirectly own or control **25% or more** of the company's shares or voting rights
3. The person acting on behalf of the company (authorised signatory)

If the ownership chain includes another legal entity (e.g., a holding company), the beneficial owner identification must pierce through to the ultimate natural person controller(s).

**Entity documentation:**
| Document | Purpose |
|----------|---------|
| CIPC Certificate of Incorporation | Confirm legal existence |
| CIPC Director extract (current, not older than 3 months) | Confirm directors |
| Company resolution / board mandate | Authorise the signatory to act on behalf of the company |
| Share register or CIPC share disclosure | Confirm beneficial owners ≥ 25% |
| Proof of registered business address | CIPC / utility bill |

**Source of funds — company:**
- Nature of business and how income is generated
- If funds originate from a third party or holding company, the source must be traced to the ultimate natural person source

### 6.4 Standard CDD — Trusts

For South African trusts, the following is required:

**Trust documents:**
| Document | Purpose |
|----------|---------|
| Trust deed | Constitutive document — defines beneficiaries, trustees, powers |
| Letter of Authority from Master of the High Court | Confirms legal validity of trust |
| Master's register reference number | Confirms registration |
| Proof of address for trust's principal place of administration | |

**Persons requiring full natural person CDD:**
1. All **trustees** (including professional trustees)
2. All named **beneficiaries** (or class description if discretionary trust)
3. The **settlor / founder** of the trust
4. Any person with **effective control** over the trust assets
5. The **authorised signatory** on the trust's BitWealth account

### 6.5 Simplified CDD (Low-Risk)

BitWealth does not currently apply simplified CDD to any client segment. Given South Africa's FATF grey-list status and medium-high institutional risk rating, standard CDD applies as a minimum to all clients. This position will be reviewed if South Africa exits the FATF grey list and the institutional risk rating is revised.

### 6.6 Enhanced Due Diligence (EDD)

EDD is mandatory for the following categories:

| Trigger | EDD Requirements |
|---------|----------------|
| Politically Exposed Person (PEP) — domestic or foreign | Senior management sign-off; enhanced source of wealth documentation; 6-monthly review |
| Immediate family or close associate of a PEP | Risk assessment; at minimum, certified source of wealth documentation |
| Company or trust with complex ownership structure | Full ownership diagram; trace all layers to ultimate natural person |
| Client from or with connections to FATF grey/black list jurisdiction | Enhanced source of funds; additional adverse media search |
| Client with TFS possible match (not confirmed) | Full manual review; Director approval; FIC notified if required |
| Any high-risk scored client | Additional documentation; Compliance Officer sign-off; 6-monthly review |
| Existing client with material change in risk profile | Triggers re-CDD and re-rating |

**EDD additional documentation examples (as applicable):**
- Signed and notarised source of wealth declaration
- Bank statements for 6–12 months
- Tax assessment / SARS returns
- Audited financial statements (for companies)
- Additional adverse media and reputational checks
- Explanation of unusually large transactions or patterns
- Professional reference from attorney, accountant or banker

**EDD must be completed before the client is activated.** No exceptions.

### 6.7 Declining to Onboard

BitWealth will **not** onboard a client in the following circumstances:

- TFS confirmed match (mandatory — Section 28A, FIC Act)
- Client refuses to provide CDD information after reasonable notice
- CDD documents cannot be verified or are suspected to be fraudulent
- Client presents implausible or inconsistent source of funds
- Client is a natural person under the age of 18 (no minors)
- Client is domiciled outside South Africa (current policy)
- Client is a legal entity incorporated in a FATF black-listed jurisdiction
- Compliance Officer determines the client relationship poses unacceptable ML/TF risk

Where a client is declined, the decision must be documented in the client's file with reasons. If the declination is based on TFS status or ML/TF suspicion, the Compliance Officer must assess whether a TPR or STR must be submitted to the FIC.

### 6.8 Ongoing CDD

CDD is not a once-off exercise. Client profiles must be reviewed:

- **Annually** for low and medium risk clients
- **6-monthly** for high risk clients
- **Immediately** on becoming aware of a material change (e.g., client becomes a PEP, large unexplained deposits, adverse media)
- When an ATMS alert is raised that cannot be resolved without additional information

At each review, the KYC completeness score in `public.v_fic_kyc_completeness` must be at 100% (15/15) for the client to remain active.

---

## 7. Ongoing CDD and Transaction Monitoring

### 7.1 Principle

CDD does not end at onboarding. BitWealth must monitor client transactions on an ongoing basis to detect activity that is inconsistent with the client's known profile, source of funds, or expected behaviour.

### 7.2 Transaction Monitoring Overview

Transaction monitoring is performed through:

1. **Automated Transaction Monitoring System (ATMS)** — rule-based alerts (see Section 8)
2. **Manual review** by the Compliance Officer of flagged activity
3. **Annual KYC refresh** — re-verifying client information and re-scoring risk

### 7.3 Triggers for Immediate Manual Review

The Compliance Officer must manually review a client's transaction history immediately when any of the following occur:

- ATMS alert rated `high` or `critical`
- TFS screening returns `possible_match` or `confirmed_match`
- Client contacts BitWealth with suspicious information or requests
- Law enforcement request (Section 32 information request from FIC)
- Adverse media discovered about a client
- Client requests an unusual or unexplained withdrawal or change of bank account

---

## 8. Automated Transaction Monitoring System (ATMS)

### 8.1 Regulatory Basis

FIC Directive 5 requires all accountable institutions at medium risk and above to implement an Automated Transaction Monitoring System. BitWealth's ATMS is integrated into the platform via the `fic.compliance_alerts` table in the Supabase database, populated by the `ef_atms_monitor` edge function.

### 8.2 ATMS Rules

The following transaction monitoring rules are implemented (or planned):

| Rule Code | Description | Threshold | Risk Level |
|-----------|-------------|-----------|-----------|
| `ATMS-01` | Structuring — multiple deposits just below a round number in a 7-day window | ≥ 3 deposits, total > R45,000, individual < R15,000 | High |
| `ATMS-02` | Rapid deposit-to-BTC conversion — deposit converted to BTC within 24 hours | Any amount | Medium |
| `ATMS-03` | Large single deposit above typical profile | > R100,000 or > 3× average monthly deposit | High |
| `ATMS-04` | Velocity anomaly — deposit volume 5× above 90-day average in one month | Relative to client history | High |
| `ATMS-05` | Dormant account sudden large activity — inactive ≥ 90 days, then > R50,000 in one month | R50,000 in first active month | Medium |
| `ATMS-06` | Source of funds inconsistency — deposit far exceeds declared income capabilities | > 12× declared monthly income | High |
| `ATMS-07` | Same-day large deposit and request to withdraw BTC to external wallet | Any amount | Critical |
| `ATMS-08` | Multiple accounts suspected same beneficial owner | Pattern analysis — TBD | High |

**Note:** ATMS rules are calibrated to minimise false positives while detecting genuine ML indicators. Thresholds above are initial values and will be tuned after 90 days of operational data.

### 8.3 Alert Triage Process

1. Alert logged in `fic.compliance_alerts` with status `pending`
2. Compliance Officer reviews within **3 business days** (critical: within 24 hours)
3. Compliance Officer determines:
   - **Dismiss:** False positive — document reason
   - **Investigate:** Request additional information from client; extend to 15 business days
   - **Report:** Raise STR or SAR to FIC; link alert to `fic.regulatory_reports`
4. If investigation yields no resolution within 15 business days, default to filing STR

---

## 9. Targeted Financial Sanctions (TFS) Screening

### 9.1 Legal Basis

Section 28A of the FIC Act requires all accountable institutions to screen all clients against:
- The **FIC Consolidated TFS List** (compiled by the FIC from UNSC and SA designations)
- The **United Nations Security Council (UNSC) Consolidated Sanctions List**

TFS screening is **not risk-based** — it applies to all clients without exception, including test accounts and company directors.

### 9.2 Screening Programme

| Trigger | Action |
|---------|--------|
| New client onboarding | Screen before activation — block onboarding if result is not `clear` |
| Client data update (name, ID number change) | Re-screen immediately |
| FIC TFS list update | Re-screen all active clients within 24 hours |
| UNSC list update | Re-screen all active clients within 24 hours |
| Scheduled periodic screening | All active clients screened monthly |
| Manual trigger by Compliance Officer | Ad hoc screening at any time |

### 9.3 Screening Methodology

Screening is performed by the `ef_tfs_screen` edge function which:

1. Downloads the current FIC and UNSC XML list files
2. Compares each client's full names, date of birth, and ID number against all list entries
3. Applies a configurable fuzzy match threshold to detect phonetic/spelling variants
4. Returns a `result` of `clear`, `possible_match`, or `confirmed_match`
5. Logs every screening to `fic.tfs_screening_log`
6. Creates a `fic.compliance_alerts` record for any `possible_match` or `confirmed_match`

### 9.4 Match Resolution Procedure

**Possible match (pending human review):**
1. Compliance Officer notified immediately (system alert)
2. Client account suspended (no new purchases or withdrawals)
3. Compliance Officer manually compares client ID documents against the sanctions entry
4. If FALSE positive: document resolution → client re-activated; log updated
5. If confirmed match: follow confirmed match procedure below

**Confirmed match:**
1. Account immediately frozen — no transactions permitted
2. Compliance Officer notifies the FIC within **24 hours** via TPR (Terrorist Property Report)
3. Do NOT inform the client (tipping-off prohibition under FIC Act Section 29(2))
4. Director/Owner notified
5. FIC await instructions on asset handling (freeze, report, report to UNSC)

### 9.5 Record Keeping for TFS

All TFS screening records are retained in `fic.tfs_screening_log` for a minimum of **5 years** from the date of screening, regardless of whether the result was `clear` or a match.

---

## 10. Record Keeping

### 10.1 Legal Requirement

Section 22 and Section 23 of the FIC Act, read with Regulation 22 of the MLTFCR, require all accountable institutions to retain:

- CDD records (identity, verification, source of funds documents) — **5 years** from the date the business relationship ended
- Transaction records — **5 years** from the date of the transaction
- Regulatory report records (STRs, SARs, TPRs etc.) — **5 years** from the date of submission
- RMCP and training records — **5 years** from the date of each version

### 10.2 What is Retained

| Record Type | Storage Location | Retention Period |
|------------|-----------------|-----------------|
| KYC identity documents | Supabase Storage (secure bucket) | 5 years post-relationship end |
| Proof of address | Supabase Storage | 5 years post-relationship end |
| Source of income/wealth documents | Supabase Storage | 5 years post-relationship end |
| Customer profile data | `public.customer_details` (Supabase DB) | 5 years post-relationship end |
| Beneficial owner records | `fic.beneficial_owners` (Supabase DB) | 5 years post-relationship end |
| Transaction history (deposits, BTC buys) | `lth_pvr.ledger_lines`, `lth_pvr.order_fills` | 5 years from transaction date |
| TFS screening logs | `fic.tfs_screening_log` | 5 years from screening date |
| Compliance alerts | `fic.compliance_alerts` | 5 years from alert date |
| Regulatory reports | `fic.regulatory_reports`, `fic.report_submissions` | 5 years from submission date |
| RMCP versions | `docs/FIC Compliance/` (version controlled) | 5 years from supersession |
| Training records | [CLOUD STORAGE / SHAREPOINT FOLDER] | 5 years from training date |

### 10.3 Data Access Controls

- All compliance-related data in the `fic` schema is protected by Supabase Row Level Security
- KYC document storage bucket is **private** (not publicly accessible)
- goAML login credentials are restricted to the Compliance Officer
- Supabase admin access is restricted to the Owner and technical administrator

### 10.4 Data Deletion Policy

Client data may not be deleted before the end of the mandatory 5-year retention period, even if the client requests deletion under POPIA. The FIC Act record-keeping obligation takes precedence over a POPIA deletion request for the minimum retention period. After 5 years, a documented deletion procedure must be followed.

---

## 11. Regulatory Reporting Procedures

### 11.1 Reports Filed by BitWealth

BitWealth is required to file the following reports via the FIC's **goAML** platform:

| Report Type | When to File | Statutory Deadline |
|------------|-------------|-------------------|
| **STR** — Suspicious Transaction Report | When a transaction has been completed and there are grounds for suspicion of ML/TF | Within 15 days of forming the suspicion (after the transaction) |
| **SAR** — Suspicious Activity Report | When there is suspicious activity but no completed transaction | Within 15 days of forming the suspicion |
| **TFTR** — Terrorist Financing Transaction Report | When a completed transaction is suspected of being linked to terrorist financing | As soon as possible — do not delay |
| **TFAR** — Terrorist Financing Activity Report | When there is TF-related suspicious activity but no transaction | As soon as possible |
| **TPR** — Terrorist Property Report | When client or property is linked to a UNSC or FIC-designated person/entity | Within 24 hours of becoming aware |
| **AIFT** — Additional Information to FIC | When the FIC formally requests further information on a prior report | As stipulated by FIC in the request |

**CTR (Cash Transaction Report):** Not applicable — BitWealth does not handle physical cash (coins or notes). ZAR EFT and crypto assets are not "cash" for CTR purposes.

**IFTR (International Funds Transfer Report):** Not applicable — BitWealth is not an Authorised Dealer or ADLA.

### 11.2 Suspicion Indicators

The following (non-exhaustive) list of indicators may give rise to an obligation to file an STR or SAR:

| Category | Indicator |
|----------|-----------|
| **Client behaviour** | Client refuses CDD; provides inconsistent or implausible information; shows unusual knowledge of AML reporting requirements; expresses desire to avoid record-keeping |
| **Transaction patterns** | Structuring (multiple deposits just below thresholds); large round-number deposits inconsistent with profile; rapid BTC conversion after large deposit |
| **Source of funds** | Unable or unwilling to explain source; funds from third party with no explanation; source inconsistent with occupation or income |
| **Account activity** | Dormant account sudden large activity; frequent changes of bank account; multiple failed deposits followed by one large successful deposit |
| **Third-party involvement** | Requests for transactions on behalf of unnamed third parties; company client with opaque ownership |
| **Geographic** | Client or counterparty connected to high-risk jurisdictions not declared on onboarding |
| **Crypto-specific** | Large immediate withdrawal of BTC to external wallet; unusual conversion patterns |

### 11.3 Report Preparation Process

1. Compliance Officer identifies grounds for suspicion (from ATMS alert, manual review, or external tip)
2. Compliance Officer documents the suspicion and supporting evidence
3. Compliance Officer creates a draft record in `fic.regulatory_reports`
4. Owner/Director reviews and approves the report
5. Compliance Officer logs into goAML and submits the report (web form or XML batch)
6. Compliance Officer records the FIC reference number in `fic.report_submissions` and `fic.regulatory_reports`
7. All supporting documents are archived in the client's compliance file

### 11.4 Non-Disclosure Obligation (Tipping Off)

Once an STR, SAR, TFTR, TFAR, or TPR decision has been made, or an investigation is underway, **BitWealth staff must not disclose to the client or any third party that a report has been made or that the client is under suspicion.** This is a criminal offence under Section 29(2) of the FIC Act.

Where a client asks why their account has been suspended (pending TFS match resolution or active STR investigation), staff must respond only: *"Your account is under routine compliance review. We will notify you when it is resolved."*

### 11.5 Filing Deadlines — Checklist

| Report | Deadline | Notes |
|--------|---------|-------|
| STR | 15 business days from forming suspicion | Clock starts when Compliance Officer forms reasonable grounds |
| SAR | 15 business days | Same as STR |
| TFTR | Immediately / as soon as possible | No 15-day grace period for TF reports |
| TFAR | Immediately | Same as TFTR |
| TPR | 24 hours | Strictest deadline — non-compliance is a serious offence |
| AIFT | As specified by FIC | Respond within the stated deadline |

---

## 12. Staff Training Programme

### 12.1 Training Obligation

Section 43 of the FIC Act requires accountable institutions to provide staff with training on their AML/CFT obligations, the recognition of suspicious transactions, and the procedures in this RMCP.

### 12.2 Training Programme

| Training Module | Target Audience | Frequency | Format |
|----------------|----------------|-----------|---------|
| AML/CFT Fundamentals (FIC Act, ML/TF offences, accountable institution obligations) | All staff | On commencement, then annually | [ONLINE / CLASSROOM / WRITTEN TEST] |
| Customer Due Diligence Procedures | All client-facing staff and Compliance Officer | On commencement, then annually | [FORMAT] |
| Suspicious Transaction Identification | All staff | On commencement, then annually | [FORMAT] — Includes case studies |
| Targeted Financial Sanctions (TFS) Screening | Compliance Officer + admin staff | On commencement, then annually | [FORMAT] |
| goAML Reporting — Practical | Compliance Officer | On commencement; when goAML system changes | [FIC goAML training / practical] |
| RMCP Update Briefing | All staff | After each RMCP version update | [Email / meeting briefing] |

### 12.3 Training Records

The following must be recorded for each training event:
- Staff member full name and employee/contractor ID
- Training module and version
- Date completed
- Assessment score (if applicable)
- Trainer name (if facilitated)

Training records are retained for **5 years** and stored at: [CLOUD STORAGE / HR SYSTEM LOCATION]

---

## 13. Internal Audit and Independent Assurance

### 13.1 Legal Requirement

Accountable institutions are required to ensure their AML/CFT controls are subject to independent review. For small institutions, this may be achieved through a periodic external review by a qualified compliance professional, attorney, or auditor.

### 13.2 Audit Programme

| Review | Scope | Frequency | Conducted By |
|--------|-------|-----------|-------------|
| RMCP Effectiveness Review | CDD completeness, ATMS alert resolution rates, training records, report filings, TFS screening coverage | Annually (at minimum) | [EXTERNAL COMPLIANCE CONSULTANT / AUDITOR] |
| CDD File Quality Audit | Sample of 10–20% of client files reviewed for KYC completeness | Annually | [EXTERNAL OR COMPLIANCE OFFICER SELF-REVIEW] |
| Transaction Monitoring Review | ATMS rule effectiveness, false positive rate, missed alerts | Annually | [EXTERNAL] |
| Regulatory Report Review | Confirm all STR/SAR/TPR obligations were met on time | Annually | [EXTERNAL] |

### 13.3 Audit Findings

All audit findings and management responses must be documented and retained for **5 years**. Significant findings must be reported to the Owner/Director within **10 business days** of the audit report being issued. Remediation timelines must be agreed and tracked to completion.

---

## 14. RMCP Review and Maintenance

### 14.1 Annual Review

This RMCP must be reviewed at least annually. The Compliance Officer initiates the review by [DATE — TYPICALLY ANNIVERSARY OF LAST APPROVAL].

### 14.2 Triggers for Interim Review

An interim RMCP review and update must be conducted when:

- The business introduces a new product or service
- BitWealth starts onboarding a new category of client (e.g., expands to foreign clients)
- A new delivery channel is added
- South Africa's FATF status changes materially
- The FIC issues new guidance, directives or amendments to the FIC Act
- A serious reportable compliance failure occurs
- The Compliance Officer changes
- The internal audit identifies material deficiencies

### 14.3 Version Control

Each update to this RMCP must:
- Increment the version number (1.0 → 1.1 for minor updates; 1.x → 2.0 for major rewrites)
- Record the change in the Document Control table at the top of this document
- Be re-approved by the Owner/Director
- Be communicated to all staff within 10 business days of approval
- Supersede and replace all previous versions

---

## 15. Appendices

### Appendix A — Relevant Contacts

| Organisation | Contact |
|-------------|---------|
| Financial Intelligence Centre (FIC) | FICEMD@fic.gov.za; 012 641 6000 |
| FIC goAML Registration | goAML helpdesk: [FIC GOAML HELPDESK EMAIL — confirm on FIC website] |
| FIC Guidance Documents | https://www.fic.gov.za |
| FATF High-Risk Jurisdictions | https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html |
| UNSC Consolidated Sanctions List | https://www.un.org/securitycouncil/content/un-sc-consolidated-list |
| FIC Consolidated TFS List | https://www.fic.gov.za/Data/Sites/1/Documents/TFS/Consolidated_list_current.xml |
| FSCA CASP Enquiries | info@fsca.co.za; 0800 110 443 |
| BitWealth Compliance Officer | [EMAIL] |

### Appendix B — Glossary

| Term | Definition |
|------|-----------|
| ATMS | Automated Transaction Monitoring System |
| BTC | Bitcoin |
| CASP | Crypto Asset Service Provider |
| CDD | Customer Due Diligence |
| CTR | Cash Transaction Report |
| EDD | Enhanced Due Diligence |
| FIC | Financial Intelligence Centre |
| FATF | Financial Action Task Force |
| IFTR | International Funds Transfer Report |
| KYC | Know Your Customer |
| ML | Money Laundering |
| PEP | Politically Exposed Person |
| RMCP | Risk Management and Compliance Programme |
| SAR | Suspicious Activity Report |
| STR | Suspicious Transaction Report |
| TF | Terrorist Financing |
| TFAR | Terrorist Financing Activity Report |
| TFTR | Terrorist Financing Transaction Report |
| TFS | Targeted Financial Sanctions |
| TPR | Terrorist Property Report |
| UNSC | United Nations Security Council |
| ZAR | South African Rand |

### Appendix C — Document Checklist for Onboarding

**Individual Client CDD Checklist:**
- [ ] Certified copy of SA ID / Smart ID / Passport
- [ ] Proof of residential address (not older than 3 months)
- [ ] Bank-stamped account confirmation letter
- [ ] Completed KYC form (occupation, source of funds, PEP declaration)
- [ ] Tax reference number (self-declared)
- [ ] TFS screening completed — result: `clear`
- [ ] Risk rating assigned and documented
- [ ] Compliance Officer sign-off (if high risk)

**Company Client Additional Checklist:**
- [ ] CIPC Certificate of Incorporation
- [ ] Current CIPC director extract
- [ ] Shareholders register / beneficial ownership disclosure
- [ ] Company resolution authorising signatory
- [ ] Tax clearance certificate
- [ ] Full natural person CDD package for: each director / each ≥25% owner / authorised signatory

**Trust Client Additional Checklist:**
- [ ] Trust deed
- [ ] Master of the High Court Letter of Authority
- [ ] Full natural person CDD package for: each trustee / named beneficiaries / settlor / authorised signatory

---

*This RMCP has been approved as the official Risk Management and Compliance Programme of BitWealth (Pty) Ltd.*

**Signed:**

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

[OWNER / DIRECTOR FULL NAME]  
[TITLE]  
BitWealth (Pty) Ltd  
Date: [DATE]

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

[COMPLIANCE OFFICER FULL NAME]  
Compliance Officer  
BitWealth (Pty) Ltd  
Date: [DATE]
