# BitWealth — FIC Compliance Action Plan
**Last Updated:** 2026-03-04  
**Source Documents:** 15 FIC/goAML guides (goAML V5.4, issued 2024–2025)  
**Prepared by:** GitHub Copilot (based on full read of all provided FIC documentation)

---

## Critical Finding: Legal Structure Must Be Resolved First

**This is the single most important blocker before any FIC registration or client onboarding can happen.**

You are partnering with someone who holds an FSP licence and extending it to CASP. The FIC goAML registration must be under the **regulated legal entity's name** — not BitWealth's unless BitWealth itself is the licensed entity. The accountable institution is the regulated legal entity, not the platform operator.

**You and your FSP partner must agree on:**
1. Which legal entity is the accountable institution (the FSP partner's entity, or a new jointly-owned entity)?
2. Who is the designated Compliance Officer of that entity?
3. Is BitWealth then the technology platform operator *for* that regulated entity?

Until this is settled, no goAML registration can occur and clients cannot legally be onboarded.

---

## What Type of Institution BitWealth Is

**Schedule 1, Item 22 of the FIC Act — Crypto Asset Service Provider (CASP)**

The business model of receiving ZAR, purchasing BTC on behalf of clients, and managing crypto custody via VALR subaccounts within an omnibus corporate account squarely places BitWealth under this category.

**Clients are NOT accountable institutions** — they are the subjects of KYC. BitWealth (or the regulated entity) is responsible for all FIC obligations.

---

## Which Reports Will Actually Apply

| Report | Applicable? | Trigger |
|--------|-------------|---------|
| **STR** — Suspicious Transaction Report | ✅ YES | Completed transaction suspected of ML/TF/proceeds of crime |
| **SAR** — Suspicious Activity Report | ✅ YES | Suspicious behaviour WITHOUT a completed transaction |
| **TFTR** — Terrorist Financing Transaction Report | ✅ YES | Completed transaction with specific TF suspicion |
| **TFAR** — Terrorist Financing Activity Report | ✅ YES | TF-related suspicious activity without a completed transaction |
| **TPR** — Terrorist Property Report | ✅ YES | Client found on UNSC/TFS sanctions list (crypto = "property" under FIC Act) |
| **CTR** — Cash Threshold Report | ❌ Unlikely | Physical cash (coins/notes) only > R49,999. ZAR EFT and crypto are NOT "cash" |
| **IFTR** — International Funds Transfer Report | ❌ No | Only for Authorised Dealers and ADLAs — BitWealth is not one |
| **AIFT** — Additional Information File Transaction | ⚠️ On request | Only when FIC formally requests additional information on a prior report |

---

## All Mandatory Compliance Obligations (in priority order)

1. **Registration on goAML** — prerequisite for all reporting (free, online)
2. **Designate a Compliance Officer** — senior, competent, named individual; required for goAML registration
3. **TFS Screening** — screen EVERY client against FIC TFS list + UNSC Consolidated List on onboarding AND when lists are updated; not risk-based; no exceptions
4. **Write your RMCP** (Risk Management and Compliance Programme) — unique to your business; documented; legally required under Section 42
5. **Full KYC before onboarding** — collect and verify all mandatory identity fields (see Phase 2)
6. **Beneficial owner identification** — for any corporate/trust client: identify all directors and anyone with >25% ownership
7. **Ongoing transaction monitoring** — every transaction must be checked against client profile; Directive 5 requires an Automated Transaction Monitoring System (ATMS)
8. **Submit regulatory reports** — STR/SAR/TFTR/TFAR/TPR via goAML only; no email or fax
9. **Record keeping — 5 years** — client ID records (from end of relationship), transaction records (from transaction date), submitted reports (from submission date)
10. **Staff training** — enable all relevant employees to comply with FIC Act and RMCP
11. **Compliance function** — Compliance Officer must be able to respond to FIC, supervisory body oversight

**Penalties:** Administrative sanctions up to R10m (natural persons) or R50m (legal entities) for serious offences under the FIC Act.

---

## Step-by-Step Action Plan

---

### 🔴 Phase 0 — Legal/Structural (Blockers — Do These First, No Code Required)

| # | Action | Notes |
|---|--------|-------|
| **0.1** | Agree with FSP partner: which legal entity is the accountable institution? | This entity's name goes on the goAML registration |
| **0.2** | Confirm FSP licence extension to CASP with FSCA (Conduct Standard 3A of 2023) | Your partner's attorney handles this |
| **0.3** | Designate the Compliance Officer — must be a named, senior person; obtain their full legal name and 13-digit SA ID number | They sign the goAML authorisation letter |
| **0.4** | Draft the RMCP — unique to BitWealth's business model; documented and written | Strongly recommend a qualified AML compliance consultant |
| **0.5** | **Immediately** screen all existing customers against the FIC TFS list (www.fic.gov.za) and the UNSC Consolidated List (un.org/securitycouncil/content/un-sc-consolidated-list) | This obligation is live NOW if you have any active clients; do this manually until automation is built |

---

### 🟡 Phase 1 — goAML Registration (Once Entity & Compliance Officer Are Confirmed)

| # | Action | Detail |
|---|--------|--------|
| **1.1** | Prepare Compliance Officer's documents | Certified copy of SA ID + signed authorisation letter on entity letterhead stating: name, ID number, occupation, role |
| **1.2** | Register the Reporting Entity on goAML | URL: https://goweb.fic.gov.za/goAMLWeb_PRD → "Reporting Entity" tile |
| **1.3** | Complete the entity registration form | Entity name, trading name, email, address, phone + Compliance Officer tab |
| **1.4** | Upload both required attachments | Certified ID copy + authorisation letter |
| **1.5** | Submit and note the SHREG reference number | Issued immediately; used for tracking FIC enquiries |
| **1.6** | Await FIC email approval and Org ID | No fixed SLA; FIC reviews manually |
| **1.7** | Register the Compliance Officer as a goAML User | Use "User (Reporting Entity)" tile; enter the Org ID received in 1.6 |
| **1.8** | Set up 2FA using Google Authenticator or Microsoft Authenticator | Scan the QR code shown on first login |
| **1.9** | Download the goAML XML Schema (XSD file) from the platform | Accessible in the platform documentation section after login — needed for Phase 6 development |
| **1.10** | Locate and note the FIC UAT/staging environment URL | Used for testing automated XML report submissions before going live |

---

### 🟢 Phase 2 — KYC Data Foundation (Development — Can Start Now, Parallel to Phase 0)

**Objective:** Ensure the database captures every field required by FIC for goAML reports and ongoing compliance.

**Missing fields added to `public.customer_details`:**

| Field | FIC Purpose |
|-------|-------------|
| `date_of_birth` | Mandatory for all goAML report party records |
| `middle_name` | Required in goAML person records |
| `gender` | Required in goAML person records |
| `tax_number` | SARS income tax reference — FIC CDD requirement |
| `occupation` | FIC CDD requirement (distinct from income source) |
| `nationality` | Primary nationality (goAML mandatory) |
| `nationality_secondary` | Second nationality for dual nationals |
| `country_of_residence` | Current country of residence |
| `country_of_origin` | Country of origin |
| `id_type` | Type of identity document (SA ID / passport / permit / refugee) |
| `id_issuing_country` | Issuing country for non-SA documents |
| `id_passport_number` | Passport or foreign ID number (separate from SA `id_number`) |
| `id_issue_date` | Date the identity document was issued |
| `id_expiry_date` | Date the identity document expires |
| `is_pep` | Politically Exposed Person flag (boolean) |
| `pep_details` | Description of PEP role/connection |
| `fic_source_of_funds` | Explicit "where does the money invested come from" (distinct from `kyc_source_of_income` which is employment type) |

**New `fic` schema tables:**

| Table | Purpose |
|-------|---------|
| `fic.tfs_screening_log` | Records every TFS/UNSC screening run per customer — date, list version, result, match details |
| `fic.beneficial_owners` | For corporate/trust clients: all directors and >25% beneficial owners with full KYC fields |
| `fic.compliance_alerts` | ATMS-generated suspicious activity alerts awaiting Compliance Officer review |
| `fic.regulatory_reports` | Queue of STR/SAR/TFTR/TFAR/TPR reports: draft → approved → submitted |
| `fic.report_submissions` | Audit log of every goAML submission, FIC Report ID, and outcome |

---

### ✅ Phase 3 — TFS Screening Automation (Complete — 2026-03-04)

| # | Action | Status |
|---|--------|--------|
| **3.1** | Source the FIC TFS list and UNSC list in machine-readable format; identify update frequency and format | ✅ UNSC public XML confirmed. FIC TFS XML attempted with graceful fallback. |
| **3.2** | Build `ef_tfs_screen` edge function — screens customers against both lists; fuzzy name matching (Levenshtein) + exact ID + name+DOB; writes to `fic.tfs_screening_log` | ✅ Deployed 2026-03-04 |
| **3.3** | Trigger screening on every new customer onboarding — pass `{ customer_id }` in POST body | ✅ Supported via `trigger: "onboarding"` mode |
| **3.4** | Daily cron re-screen — `fic_tfs_screen_daily` at 02:00 UTC; screens all customers not screened in 30 days | ✅ Cron job active |
| **3.5** | Automatic response to positive match: create `fic.compliance_alerts` (severity: critical); escalate confirmed matches to `lth_pvr.alert_events` for daily digest email | ✅ Implemented — `possible_match` = high alert; `confirmed_match` = critical alert + digest notification |
| **3.6** | Test customers (`is_test = TRUE`) always skipped — never appear in screening log | ✅ `is_test` column added to `customer_details` |

---

### 🟢 Phase 4 — ATMS (Automated Transaction Monitoring System — Development)

**Directive 5 of the FIC Act requires an ATMS.** Your existing Supabase pipeline is the foundation.

**Starter monitoring rules to implement:**

| Rule | Description |
|------|-------------|
| R1 — Rapid round-trip | Deposit followed by withdrawal request within X days |
| R2 — Profile mismatch | Deposit amount grossly inconsistent with stated occupation/source of funds |
| R3 — Structuring pattern | Multiple deposits just below a round threshold within a short window |
| R4 — New client large deposit | First-90-day client deposits above a risk threshold |
| R5 — Sudden volume spike | Client with low historic activity suddenly makes large/frequent deposits |
| R6 — Incomplete KYC transacting | Active transactions while KYC fields are incomplete |

Each triggered rule creates a record in `fic.compliance_alerts` for the Compliance Officer to review.

---

### 🟢 Phase 5 — Compliance Admin UI Module (Development)

Add a **"Compliance"** module to `ui/Advanced BTC DCA Strategy.html` containing:

| Panel | Function |
|-------|----------|
| **KYC Completeness** | Shows which active clients are missing FIC-required fields |
| **TFS Screening** | Manual rescan button; log of all screens; highlighted matches |
| **ATMS Alerts** | List of flags with dismiss/escalate buttons; audit trail of decisions |
| **Regulatory Reports** | Draft STR/SAR/TFTR/TPR; review; approve; export goAML-compliant XML; track submitted reports and FIC reference numbers |

---

### 🔵 Phase 6 — goAML XML Report Automation (Development — After Getting XSD from FIC)

| # | Action |
|---|--------|
| **6.1** | Obtain the official goAML XSD schema from the platform after registration (Phase 1.9) |
| **6.2** | Build XML generator edge function for each report type: STR, SAR, TFTR, TFAR, TPR — maps DB fields to goAML schema |
| **6.3** | Validate generated XML against the XSD before submission |
| **6.4** | Test all report types in the FIC UAT/staging environment with dummy data |
| **6.5** | Build one-click "Generate XML → Download" button in the Compliance UI for manual upload to goAML web |
| **6.6** | Store every FIC Report ID returned after successful submission in `fic.report_submissions` |
| **6.7** | Implement remediation workflow: if a report is rejected by FIC, allow correction and resubmission with original FIC Ref Number in the `fiu_ref_number` field |

---

## Key Thresholds Reference

| Report | Threshold | Direction |
|--------|-----------|-----------|
| CTR | > R49,999.99 (physical cash only) | Cash received OR paid |
| IFTR | > R19,999.99 (ADs/ADLAs only — not BitWealth) | Cross-border electronic transfers |
| STR/SAR | None — suspicion-based | Any amount |
| TFTR/TFAR | None — suspicion-based | Any amount |
| TPR | None — sanctions-based | Any property (incl. crypto) |

## Mandatory KYC Fields Reference (FIC Act / Guidance Note 7)

### For Natural Person Clients
- Full legal first name, middle name, surname
- Date of birth
- 13-digit RSA ID number (or passport number + issuing country for non-SA nationals)
- Residential/physical address
- Contact phone and email
- Occupation / job title
- Source of funds (where does the invested money originate from)
- Tax number (SARS reference)
- Primary nationality (and secondary if dual national)
- Country of residence, country of origin
- PEP status (politically exposed person)
- TFS list screening result

### For Legal Entity / Corporate Clients (Additional)
- CIPC registration number and legal name
- Incorporation date, country, legal form
- Business activities description
- Registered business address
- Tax number
- Full details for all directors (as per natural person above)
- Full details for all natural persons owning >25% (beneficial owners)

---

## goAML Submission Methods

| Method | How | When |
|--------|-----|------|
| **Web form** | Login to goAML → New Reports → Web Reports | Low volume; immediate use after registration |
| **XML batch upload** | Generate XML conforming to XSD schema → upload via goAML | Automated; requires Phase 6 development |

**No REST API exists.** All submissions are via the goAML web interface (manual) or XML batch upload (automated).

---

## FIC Contact Details

- **FIC website:** www.fic.gov.za
- **goAML Production:** https://goweb.fic.gov.za/goAMLWeb_PRD
- **Compliance contact centre:** 012 641 6000 (option 1)
- **Register/Report link:** www.fic.gov.za → "Register or Report"
- **TFS list:** www.fic.gov.za → Targeted Financial Sanctions

---

## Development Phases Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Legal/structural resolution | ⏳ Pending (requires FSP partner) |
| Phase 1 | goAML registration | ⏳ Blocked on Phase 0 |
| Phase 2 | DB — KYC fields + compliance schema | ✅ Migration applied 2026-03-04 |
| Phase 3 | TFS screening automation | ✅ Complete 2026-03-04 |
| Phase 4 | ATMS rules | ⏸️ Not started |
| Phase 5 | Compliance Admin UI module | ⏸️ Not started |
| Phase 6 | goAML XML report generator | ⏸️ Blocked on Phase 1 (needs XSD) |
