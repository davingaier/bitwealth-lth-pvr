# FSCA CASP FSP Licence — Compliance Action Plan
## BitWealth (Pty) Ltd

**Document Version:** 1.0  
**Prepared:** 2025-01-14  
**Based on:** Analysis of 25 FSCA FAIS application documents, FAIS Act No. 37 of 2002, Board Notice 194 of 2017, Conduct Standard 3A of 2023, FIC Directive 9, and CMS Expert Guide to Crypto Regulation in South Africa  
**Applicable Licence Category:** Category I FSP — Sub-product 1.27 Crypto Assets  
**Filing email:** fais.newlicense@fsca.co.za  
**Online portal:** https://www.fsca.co.za/Regulated%20Entities/Pages/ES-FAIS-New-License-Applications.aspx

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [BitWealth Business Model vs Licence Requirements](#2-bitwealth-business-model-vs-licence-requirements)
3. [Critical Blockers — Address First](#3-critical-blockers--address-first)
4. [Phase 0: Corporate Pre-requisites](#4-phase-0-corporate-pre-requisites)
5. [Phase 1: Key Individual Qualifications & Examinations](#5-phase-1-key-individual-qualifications--examinations)
6. [Phase 2: Compliance Officer Appointment](#6-phase-2-compliance-officer-appointment)
7. [Phase 3: Prepare All Required Documents](#7-phase-3-prepare-all-required-documents)
8. [Phase 4: Online Portal Registration, Fee Payment & Submission](#8-phase-4-online-portal-registration-fee-payment--submission)
9. [Phase 5: Post-Submission](#9-phase-5-post-submission)
10. [Phase 6: Post-Licence Ongoing Obligations](#10-phase-6-post-licence-ongoing-obligations)
11. [Risk Register](#11-risk-register)
12. [Fees and Timeline Summary](#12-fees-and-timeline-summary)
13. [Forms Checklist](#13-forms-checklist)
14. [Key Contacts & Resources](#14-key-contacts--resources)

---

## 1. Executive Summary

BitWealth (Pty) Ltd operates an automated Bitcoin DCA service using the LTH PVR strategy. The business:
- Receives ZAR from clients
- Manages each client in a dedicated VALR subaccount (omnibus model)
- Executes daily BTC buy/sell decisions via an automated algorithm
- Does NOT receive per-trade client instructions — the system acts autonomously

Under the **FAIS Act (No. 37 of 2002)**, BitWealth is providing:
1. **Advice** — recommending and implementing a specific investment strategy (LTH PVR DCA) on behalf of clients
2. **Intermediary services** — executing BTC purchases on behalf of clients via VALR; administering and safekeeping crypto assets in VALR subaccounts

Both activities in respect of crypto assets (sub-product 1.27) require a **Category I FSP licence** from the FSCA. BitWealth may also need to assess whether the discretionary management of client portfolios (automated rebalancing, no per-trade instruction) triggers a requirement for a **Category II FSP licence** — this should be confirmed with an FAIS compliance attorney.

**The application can be submitted at any time** — CASP applications opened 1 June 2023. Processing takes up to 6 months, with a known backlog. The application fee is **ZAR 2,697** for Category I. The primary time-consumer is NOT the paperwork — it is getting key individuals through their **RE 1 regulatory examination** and sourcing a **Phase 1 approved compliance officer**.

**Dual regulatory obligation:**  BitWealth is ALSO subject to FICA registration as a CASP (with the Financial Intelligence Centre). This is a separate, parallel obligation covered in the FIC Compliance Action Plan.

---

## 2. BitWealth Business Model vs Licence Requirements

| BitWealth Activity | FAIS Classification | Form Required | Notes |
|---|---|---|---|
| Recommending LTH PVR strategy to clients | Advice (Category I) | FSP 2 — tick Advice for sub-product 1.27 | |
| Automated DCA order execution via VALR | Intermediary Services (Category I) | FSP 2 — tick Intermediary Services for sub-product 1.27 | |
| Algorithm-driven portfolio decisions with no per-trade instruction | **Possibly Category II** (Discretionary FSP) | FSP 2 — may need to tick Category II | Seek legal advice on this classification |
| Automated order execution via Supabase Edge Functions | Automated Advice | FSP 2 — tick Section 3 (Automated Advice) | LTH PVR algorithm = automated advice |
| VALR subaccount custody | Intermediary Services — Safekeeping | FSP 2 — already captured above | Must document in FSP 1 Section 7 and FSP 7 |
| No clients receiving manual, human-sourced recommendations | N/A | — | Does NOT reduce FAIS obligation |

**Conclusion:** BitWealth requires, at minimum:
- **Category I FSP licence** (sub-product 1.27 Crypto Assets; Advice + Intermediary Services + Automated Advice)
- Confirm with legal counsel whether Category II is triggered (adds ZAR 16,313 application fee if so)

---

## 3. Critical Blockers — Address First

These items block the application or take the longest time. Start immediately.

### Blocker 1 — RE 1 Regulatory Examination (Key Individuals)
Every person who will be a **key individual** of the FSP (i.e., any director/manager responsible for overseeing BitWealth's financial services activities) MUST pass the **RE 1 examination** before they can be approved.

- Offered by: Insurance Institute of South Africa (IISA), First ExaM, INSETA others
- Cost: ~ZAR 900–1,500 per attempt
- Prep time: estimated 6–12 weeks depending on background
- **Action: Register for RE 1 immediately**

### Blocker 2 — Phase 1 Approved Compliance Officer
BitWealth will have at least one representative and/or more than one key individual. Section 17 of the FAIS Act mandates a compliance officer in that case. The compliance officer must be **individually approved by the FSCA (Phase 1 approval)** before BitWealth can appoint them.

The compliance officer does NOT need to be employed internally. An external compliance practice is recommended for a start-up. Numerous South African firms specialise in CASP compliance (e.g., Masthead, DotCompliance, Compli-Serve, Rand Compliance).

- **Action: Contact 2–3 external compliance practices immediately for quotes**
- An external compliance practice with an existing Phase 1 approval can be appointed much faster than obtaining Phase 1 approval yourself

### Blocker 3 — Client Asset Segregation Documentation (VALR Subaccount Model)
BitWealth's model means client ZAR flows **directly between the client's bank and their VALR subaccount** — it never passes through a BitWealth bank account. This eliminates the need for a separate BitWealth client trust/money bank account.

However, BitWealth **does** hold client *crypto assets*: each client's BTC is held in a dedicated VALR subaccount under BitWealth's master account (directly administrable via the VALR API). FSP 1 Section 7 must therefore still be answered **YES** (holding client assets), with the asset type specified as crypto assets (BTC) in VALR subaccounts, not ZAR in a BitWealth bank account.

**What this means for the application:**
- No dedicated BitWealth client money bank account is required — the VALR subaccount per client IS the segregation mechanism
- FSP 1 Section 7: answer YES for client assets; specify BTC in VALR subaccounts; name each client's subaccount ID as the segregated holding
- FSP 7 Section 2 (Outsourcing): the VALR relationship must be documented as the custody/asset-management outsourcing arrangement; describe how it is supervised and managed
- Attach a written description of the VALR subaccount model showing each client has their own identifiable subaccount

**Action: Prepare a one-page VALR Subaccount Structure document** describing: (a) master account held by BitWealth; (b) dedicated subaccount per client; (c) client assets identifiable and segregated at subaccount level; (d) client fiat deposit/withdrawal flow bypasses BitWealth entirely.

### Blocker 4 — FIC Registration (FICA)
BitWealth must be registered with the Financial Intelligence Centre as a CASP accountable institution **within 90 days of commencing business**. If this has not been done, it must be addressed immediately and in parallel.

- **Action: Refer to FIC_COMPLIANCE_ACTION_PLAN.md**

---

## 4. Phase 0: Corporate Pre-requisites

Complete these before or during the application preparation. None require special regulatory engagement — they are administrative.

| # | Task | Owner | Notes |
|---|------|-------|-------|
| 0.1 | Confirm BitWealth (Pty) Ltd CIPC registration is active and annual returns are up to date | Director | FSCA will verify; CIPC registration number required on FSP 1 |
| 0.2 | Obtain B-BBEE status certificate or sworn affidavit (for FSP 1) | Director | Level 4 exemption affidavit available if turnover < ZAR 10M |
| 0.3 | Prepare a written VALR Subaccount Structure document describing the client asset custody model | Director | BitWealth does NOT hold client ZAR in its own bank account — client fiat flows directly to/from VALR. A separate BitWealth client bank account is NOT required. Client crypto assets are segregated at VALR subaccount level. Document this clearly for FSP 1 Section 7 and FSP 7 Section 2. |
| 0.4 | Confirm tax compliance: SARS income tax registration + VAT registration (if applicable) | Director / Accountant | FSCA may request financial information |
| 0.5 | Confirm registered address for FSCA correspondence | Director | Must match CIPC records |
| 0.6 | Ensure all directors and shareholders have valid SA ID documents (certified copies will be required) | All directors | Certification must be recent (< 3 months old at time of submission) |
| 0.7 | Confirm whether any director has been convicted of financial crime, prohibited by law, subject to sequestration — the 23-question honesty assessment (FSP 4A and FSP 4B) applies to the company AND every director | All directors | Respond honestly; prior issues must be disclosed with full explanation |
| 0.8 | Determine whether FICA registration is completed (else refer to FIC_COMPLIANCE_ACTION_PLAN.md) | Director | FICA policy and procedures will be referenced in FSP 7 Section 6 |
| 0.9 | Obtain Professional Indemnity (PI) and Fidelity Insurance (FSP 7 Section 7) | Director / Broker | Specialist CASP PI cover available; Bryte, Guardrisk, Camargue, and others offer this. PI cover is reviewed/attached to the application |
| 0.10 | Confirm SARS tax clearance (current) | Accountant | May be required by FSCA during processing |

---

## 5. Phase 1: Key Individual Qualifications & Examinations

### 5.1 Who is a Key Individual?

Any natural person who is responsible for **managing or overseeing** the activities of BitWealth relating to the rendering of financial services is a key individual. This includes:
- Managing directors / founders who set strategy and oversee operations
- Any person in senior management who oversees the investment decisions or client service activities

Every key individual must submit **FSP 4D** (Fitness and Propriety — Key Individuals).

### 5.2 Requirements per Key Individual

Each key individual completing FSP 4D must demonstrate:

| Requirement | Detail | Action |
|---|---|---|
| **Honesty & Integrity** | 23-question assessment (same as FSP 4A and 4B) | Answer honestly; attach explanation for any YES answers |
| **Regulatory Examinations** | RE 1 (Category I Key Individuals) must be passed | Register and sit RE 1 exam; attach certificate |
| **Qualifications** | Must hold a qualification from the FSCA List of Recognised Qualifications (Board Notice 194/2017) | Obtain a recognised qualification if not held; check list at fsca.co.za |
| **Class of Business Training** | Training for the Investments class of business (applicable to crypto assets) | Complete class of business training course; attach certificate |
| **Experience** | Relevant experience managing/overseeing financial services; must complete experience tables per Category (Table A for Category I) | Document all experience; experience in managing/overseeing crypto asset services is ideal; submit CV, reference letters |
| **Crypto Assets Section (FSP 4D Section 5 = YES)** | Must demonstrate adequate skills, knowledge and expertise for crypto assets under section 6A of the FAIS Act | Write a comprehensive narrative: blockchain technology knowledge, BTC market dynamics, risk management, DCA strategy, regulatory awareness |
| **Operational Ability** | FSP 4D Section 13: confirm permanent employment by BitWealth, not multi-FSP KI (initially), demonstrate capacity | Complete all sub-questions; sign joint confirmation with BitWealth |

> **Note on the Compliance Officer:** Appointing a compliance officer (Phase 2 / FSP 6) is an entirely separate and independent requirement from the key individual's personal fit and proper requirements. The CO's role is to monitor and ensure BitWealth's regulatory compliance — it does NOT substitute for or exempt the KI from their own RE 1 examination, recognised qualification, class of business training, or experience requirements. Every KI must personally satisfy all of the above regardless of whether a CO is appointed.

### 5.3 Regulatory Examination (RE 1) — Detailed Steps

1. Register at an accredited exam body:
   - Insurance Institute of South Africa (IISA): www.iisa.co.za
   - First ExaM: www.firstexam.co.za
   - INSETA: www.inseta.org.za
2. Purchase study material (available from the exam body or FSCA website)
3. Study: RE 1 covers FAIS Act, Codes of Conduct, General Code, fit and proper requirements (~60–80 hours of preparation recommended)
4. Sit the computer-based exam at an accredited testing centre
5. Pass mark: 65%
6. Certificate is issued within ~4 weeks; attach to FSP 4D Section 9

### 5.4 Qualifications

Check the FSCA List of Recognised Qualifications (updated periodically):
- Available at: www.fsca.co.za → Compliance → Fit and Proper → Recognised Qualifications
- If the founder holds a commerce/finance degree, it is likely on the list
- If no recognised qualification is held: the FSCA may accept an exemption application (FSP 13) but this should be avoided — complete a short FSCA-recognised course if needed
- Minimum qualification for Category I advice: typically NQF Level 4 (Matric + basic financial services qualification) — however crypto assets may require higher

### 5.5 Experience Requirements

For Category I crypto assets (sub-product 1.27):
- Document months of experience rendering advice and intermediary services in crypto assets
- In Table A of FSP 4D Section 11.3: enter months of Advice experience and months of Intermediary Services experience
- Experience from operating BitWealth itself counts if services commenced before licence application
- Provide reference letters from senior officials confirming the experience
- Experience in **managing** BTC DCA services (LTH PVR system) is highly relevant for the crypto assets general skills section

### 5.6 Key Individual Representative Overlap

If any key individual also **personally advises clients** or executes trades on their behalf (rather than the algorithm doing it), they must ALSO submit FSP 5 as a representative. Mark "yes" in FSP 4D Section 14 in that case.

---

## 6. Phase 2: Compliance Officer Appointment

### 6.1 Why Required

Section 17 of the FAIS Act: If BitWealth has more than one key individual OR one or more representatives, it MUST appoint a compliance officer. In practice, BitWealth will always require one.

### 6.2 Options

| Option | Pros | Cons | Recommended? |
|---|---|---|---|
| **External compliance practice** | Already Phase 1 approved; specialist CASP knowledge; handles regulatory submissions | Ongoing cost (ZAR 5,000–20,000/month depending on scope) | **YES — recommended for a start-up** |
| **Internal compliance officer** | Lower ongoing cost | Must have 3+ years compliance/risk experience; must pass their own Phase 1 FSCA approval; risk of conflict of interest | Only if suitable person already exists |
| **Director renders compliance under supervision** | Can start immediately | Needs an approved supervisor; not ideal long-term | Temporary option while building capacity |

### 6.3 Steps

| # | Task | Notes |
|---|------|-------|
| 6.1 | Contact external compliance practices specialising in CASPs for quotes | Masthead, DotCompliance, Compli-Serve, Rand Compliance, Finlaw Compliance — ask specifically about CASP FSP compliance experience |
| 6.2 | Confirm the practice holds Phase 1 FSCA approval for Category I (and potentially Category II) | Ask for their Phase 1 approval number |
| 6.3 | Agree scope of services: licensing support, compliance monitoring visits, reporting, annual compliance report to FSCA | |
| 6.4 | Execute compliance services agreement | The compliance officer must sign a declaration (FSP 6 Section 5) |
| 6.5 | Complete FSP 12 if using a new compliance officer (not yet Phase 1 approved) | Phase 1 approval for a new compliance officer takes 2–4 months — engage early |
| 6.6 | Complete FSP 6 (Phase 2 — appointment to BitWealth specifically): internal vs external declaration; provide Phase 1 approval number; provide required annexure on resources, independence, monitoring plan | |

---

## 7. Phase 3: Prepare All Required Documents

### 7.1 Application Forms (submitted via FSCA Online Portal)

| Form | Purpose | Completed By | Key Fields for BitWealth |
|---|---|---|---|
| **FSP 1** | Business information | BitWealth | Company name, CIPC no., financial year end, number of KIs, directors, compliance officer, **Section 7: YES to holding client assets** — specify asset type as BTC crypto assets held in dedicated VALR subaccounts per client. Clarify that client ZAR deposits/withdrawals are made directly to/from VALR (not through a BitWealth bank account) and that no BitWealth client money bank account exists. Attach the VALR Subaccount Structure document. |
| **FSP 2** | Licence categories | BitWealth | Category I; sub-product **1.27 Crypto Assets**; tick both **Advice** AND **Intermediary Services**; tick **Section 3: Automated Advice** (LTH PVR algorithm); assess whether Category II is required |
| **FSP 3** | Directors and shareholders | BitWealth | List all directors with full personal details; each director must separately complete FSP 4B |
| **FSP 4A** | Fitness & propriety — BitWealth (Pty) Ltd | BitWealth | 23 honesty/integrity questions about the company; sign and submit |
| **FSP 4B** | Fitness & propriety — each director | Every director | 23 questions per director; plus qualifications, RE exams, experience tables, Class of Business training; crypto assets general skills section |
| **FSP 4D** | Fitness & propriety — each key individual | Every KI | 23 questions + qualifications + RE 1 + experience tables + **Section 5 crypto assets = YES** + Section 12 written crypto skills narrative + Section 13 operational ability |
| **FSP 5** | Representatives | BitWealth (per rep) | One form per person who personally renders services; if founders only act in a management/oversight capacity, FSP 5 may not be required for them; confirm with compliance officer |
| **FSP 6** | Compliance officer Phase 2 | BitWealth + compliance officer | Internal vs external; Phase 1 approval number; independence annexure |
| **FSP 7** | Operational ability | BitWealth | Confirm all 13 policy documents are attached; **Section 2 (Outsourcing): document VALR as the custody/asset-management outsourcing arrangement** — describe the subaccount model, how BitWealth supervises VALR, and the API-based control mechanism; FICA compliance confirmation; PI/Fidelity insurance confirmation |
| **FSP 8** | Financial soundness | BitWealth (CFO or equivalent) | First year: projections + financial position statement + auditor/accounting officer confirmation; confirm assets > liabilities; complete liquidity section if holding client assets |
| **FSP 9** | External auditor | BitWealth + auditor | Name, practice no., responsible partner, confirmation letter from audit partner |
| **FSP 12** | Compliance officer Phase 1 (only if CO not already approved) | Compliance officer | Only if engaging a CO who is not yet Phase 1 FSCA approved |

### 7.2 Policy Documents Required by FSP 7 (Operational Ability)

All 13 documents must be prepared. They may be combined into fewer documents (e.g., a single Operations Manual) as long as all required content is covered. For each document, record which page number addresses which requirement (FSP 7 cross-reference).

| # | Document | Key Content for BitWealth |
|---|---|---|
| (a) | **3-Year Business Plan** | BitWealth business model; LTH PVR strategy explanation; target market (BTC long-term holders); projected client numbers and AUM; fee structure; growth assumptions; Supabase/VALR technology summary |
| (b) | **Risk Management Policy** | Strategy/market risk; execution risk (VALR API failure, Supabase downtime); counterparty risk (VALR); regulatory risk; cybersecurity risk; client concentration risk; liquidity risk; methods: identification, assessment, prioritisation, mitigation, monitoring, reporting |
| (c) | **Governance Structure** | Board composition; decision-making framework; oversight of key individual activities; controls over the automated algorithm; change management process for modifying the DCA strategy |
| (d) | **Remuneration Policy** | How transaction fees, management fees, or performance fees are structured; must show alignment with client interests; must not incentivise excessive risk-taking; must not lead to unfair client treatment |
| (e) | **Resolution Plan** | What happens if BitWealth cannot continue to operate: client notification; BTC transfer back to clients; wind-down of VALR subaccounts; ZAR in client trust account; timeline |
| (f) | **Financial Recovery Plan** | Strategy to restore financial soundness if the business deteriorates: capital injection; cost reduction; capital raise; orderly wind-down if recovery not possible |
| (g) | **Disaster Recovery Plan** | Technical disaster response: Supabase outage; AWS/cloud failure; VALR API outage; edge function failure; pg_cron failures; data recovery; backup data strategy; RTO/RPO targets; incident escalation |
| (h) | **Compliance Management Framework** | How compliance is monitored; role of the compliance officer; frequency of compliance monitoring visits and reports; regulatory change management; training programme |
| (i) | **Business Continuity Policy** | Key person risk (what if the founding director becomes incapacitated or dies?); succession plan; documented system handover; source code and infrastructure documentation; insurance cover |
| (j) | **Conflict of Interest Management Policy** | BitWealth vs client interests; VALR relationships; any referral arrangements; management of conflicts between different clients' needs; disclosure obligations |
| (k) | **Complaints Management Framework** | How client complaints are received (email, portal?); response timelines; escalation; FCSA Ombud referral process; record-keeping of complaints; annual reporting of complaint stats |
| (l) | **Other Policies** (as needed) | KYC/FICA policy; data protection/POPIA policy; cybersecurity policy; advertising and communication policy |
| (m) | **Automated Advice Policies** | Algorithm description (LTH PVR methodology); how the automated system meets client suitability requirements; model governance; version control; back-testing methodology; monitoring for model drift; client disclosure about automation |

### 7.3 Key Supporting Documents

| Document | Where Attached | Notes |
|---|---|---|
| CIPC company registration certificate | FSP 1 | Recent good-standing certificate |
| Copy of company's MOI/Articles of Incorporation | FSP 1 | |
| Certified ID copies for all directors | FSP 3 / FSP 4B | SA ID book, smart ID card, or passport; certification by Commissioner of Oaths (< 3 months old) |
| RE 1 certificates for each key individual | FSP 4D | Per KI |
| Qualification certificates for KIs (certified) | FSP 4D | Per KI; from FSCA recognised qualifications list |
| Class of Business training certificates | FSP 4D | Per KI |
| CVs for all key individuals | FSP 4D | Includes all positions since career inception |
| Reference letters confirming experience | FSP 4D | From senior officials at prior or current employers |
| Crypto Assets skills narrative (per KI) | FSP 4D Section 12 | Written document per KI |
| B-BBEE certificate or affidavit | FSP 1 | |
| VALR Subaccount Structure document | FSP 1 Section 7 + FSP 7 Section 2 | Written description of: BitWealth master VALR account; dedicated subaccount per client; BTC asset segregation at subaccount level; client fiat deposit/withdrawal flow (direct to/from VALR, not BitWealth); VALR API control mechanism |
| Financial projections (first year) | FSP 8 | Income statement + balance sheet for 12 months |
| Auditor/accounting officer confirmation letter | FSP 8 | Confirms first year; confirms assets exceed liabilities |
| Liquid assets proof (Annexure 6 Form A) | FSP 8 | Complete Form A from Board Notice 194/2017 |
| Audit firm confirmation letter | FSP 9 | From responsible audit partner; see FSP 9 Section 3 requirements |
| PI/Fidelity Insurance certificate | FSP 7 | Copy of current policy |
| Compliance officer services agreement | FSP 6 | Signed agreement between BitWealth and CO |
| Independence and monitoring plan annexure | FSP 6 Section 4 | Resources matrix, visit frequency, reporting frequency, conflict management |
| FICA compliance policy | FSP 7 Section 6 | Reference which page covers FICA procedures |
| Proof of FSCA fee payment | Portal submission | PRN as payment reference |

---

## 8. Phase 4: Online Portal Registration, Fee Payment & Submission

### 8.1 FSCA Online Portal Registration

1. Go to: www.fsca.co.za → FAIS → Registration → New License Applications → FAIS Online License Applications
2. Click **"Register"**
3. Enter email, name, surname → password sent immediately to email
4. Log in → change password

### 8.2 Create the Application

1. Click **"New Application"**
2. Enter applicant name: **BitWealth (Pty) Ltd**
3. Select legal capacity: **Juristic person (company)**
4. Click **Submit** → receive reference number (sent to email) → **this reference number IS the PRN (Payment Reference Number)**

### 8.3 Calculate and Pay the Fee

| Scenario | Fee |
|---|---|
| Category I only (sub-product 1.27 Crypto Assets) | **ZAR 2,697** |
| Category I + Category II (if required) | ZAR 2,697 + ZAR 16,313 × 90% = **~ZAR 17,399** |

**Payment process:**
1. Use the built-in fee calculator in the portal to confirm the exact amount
2. Transfer the exact amount to the FSCA bank account by EFT using the PRN as the payment reference
3. Save proof of payment (bank confirmation slip)

### 8.4 Complete All Forms in the Portal

For each FSP form tab:
1. Click the form tab (FSP 1, FSP 2, etc.)
2. Complete all required fields
3. **Click SAVE before moving to the next form** (data is not auto-saved — unsaved data is lost)
4. Upload all supporting documents per form tab using the **"Upload Attachment"** button (NOT just file browsing — use the upload button or the document is not attached)
5. Attach proof of payment under the general attachments tab

### 8.5 Validate and Submit

1. Click **"Validate"** — resolve all validation errors before proceeding
2. Once all validations pass, click **"Submit"**
3. Note: **information cannot be amended after submission** — review everything carefully before clicking Submit
4. A confirmation with a temporary reference number will be issued

### 8.6 After Submission

- FSCA may send queries requiring additional information; respond promptly (within the timeframe specified)
- Processing time: up to **6 months** (potentially longer for CASPs given backlog)
- Track the application via the FSCA e-Portal

---

## 9. Phase 5: Post-Submission

| Task | Detail |
|---|---|
| Monitor FSCA queries | FSCA may email queries; respond promptly |
| Do not operate unlicensed | If already rendering financial services, seek legal advice on operating status during the pending period. FSCA may allow continued operation under a "pending application" status for CASPs — confirm with compliance officer |
| Prepare any additional documents requested | Have all policy documents and personnel records accessible for rapid retrieval |
| Complete outstanding KI training | If class of business training or CPD is in progress, complete and submit when available |

---

## 10. Phase 6: Post-Licence Ongoing Obligations

Once the FSP licence is granted:

| Obligation | Frequency | Details |
|---|---|---|
| **Representative Register** | Within 15 days of ANY change | Submit changes only (not full register) on the FAIS Rep Register spreadsheet sent to reps@fsca.co.za; format must follow FSCA guidelines exactly |
| **Annual Register Update as at 31 August** | Annual | Levies are invoiced based on representatives and KIs registered as at 31 August each year |
| **Annual Compliance Report** | Annual | Compliance officer submits to FSCA |
| **Audited Financial Statements** | Within 6 months of financial year end | Must confirm client money held; confirm client money segregated from FSP money; report to FSCA |
| **CPD (Continuing Professional Development)** | Ongoing | Key individuals must complete ongoing CPD; compliance officer may set targets |
| **Record Keeping** | 5-year minimum | Records of: premature cancellations; complaints; compliance status; non-compliance events; representative compliance |
| **Client Disclosures** | Ongoing | Required disclosures under the FAIS Code of Conduct: FSP name, licence number, services rendered, conflict of interest, fees, risk disclosures. All crypto advertising must include: "Investing in crypto assets may result in the loss of capital" |
| **Suspicious Transaction Reports (STRs)** | As arising | File with FIC via goAML portal (see FIC Compliance Action Plan) |
| **Cash Transaction Reports (CTRs)** | As arising | Transactions > ZAR 49,999.99 must be reported to FIC |
| **Travel Rule (Directive 9) compliance** | Per transaction (from 30 April 2025) | Collect and transmit originator + beneficiary info for all crypto transfers; threshold: ZAR 5,000 for full verification |
| **Notify FSCA of material changes** | Within 15 days | Changes to directors, KIs, compliance officer, address, business model, ownership |
| **Annual Levy** | Annual invoice | Invoiced based on 31 August register; pay promptly to avoid suspension |
| **FSP Licence Conditions** | Ongoing | Check if FSCA imposed any conditions on the licence; comply with all conditions |
| **Conduct Standard 3A (2023) compliance** | Ongoing | CASP-specific requirements including: enhanced KYC/AML, safekeeping standards, disclosure requirements, client risk profiling, cybersecurity requirements — review the full Conduct Standard |

---

## 11. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| **Operating without a licence** | Critical | High (if not yet applied) | Apply immediately; obtain legal advice on interim operating status; consider a conditional exemption under section 41 of FAIS while application is pending |
| **Key Individual fails RE 1** | High | Medium | Register multiple attempts; use accredited study material; RE 1 has a 65% pass mark; most candidates pass on second attempt |
| **No Phase 1 approved CO available** | High | Low | Engage 2–3 external compliance practices; they are Phase 1 approved and can be appointed immediately |
| **Client assets not properly segregated** | High | Low | BitWealth uses dedicated VALR subaccounts per client — client crypto is identifiable and segregated at subaccount level. No BitWealth bank account holds client ZAR (fiat flows directly to/from VALR). Document the subaccount model clearly in FSP 1 Section 7 and FSP 7 Section 2. Main residual risk is VALR counterparty/custody risk — mitigate by documenting the VALR subaccount model and monitoring VALR's own regulatory status. |
| **FICA non-registration** | High | Medium | Addressed in FIC Compliance Action Plan; prioritise alongside this plan |
| **Travel Rule (Directive 9) non-compliance** | High | High (deadline was 30 April 2025) | Collect originator and beneficiary details at onboarding; implement Travel Rule data exchange with VALR; update KYC forms |
| **Category II licence required (not applied for)** | High | Medium | Seek legal opinion on whether automated DCA = discretionary management; apply for Category II simultaneously if required |
| **VALR subaccount = improper segregation** | Medium | Low | Document the subaccount model clearly in FSP 1 Section 7 and FSP 7; each client has their own subaccount at VALR; this should satisfy segregation requirements |
| **Omnibus model scrutiny** | Medium | Medium | Prepare a detailed description of the VALR subaccount structure; show that each client's assets are separately identifiable at the subaccount level |
| **No PI/Fidelity Insurance** | Medium | Medium | Engage a specialist CASP-aware insurance broker (Bryte, Guardrisk, Camargue); obtain quotes early as underwriting may take time |
| **Advertising non-compliance** | Low | Medium | All marketing, website, app, emails: include "Investing in crypto assets may result in the loss of capital" |
| **POPIA / data protection** | Medium | Medium | Ensure POPIA-compliant privacy policy; client data consent mechanisms; data breach response procedures |
| **Conduct Standard 3A unknown requirements** | Medium | Medium | Obtain and read Conduct Standard 3A of 2023 in full; ensure all specific CASP requirements are built into the policy documents |

---

## 12. Fees and Timeline Summary

### Application Fees

| Item | Amount (ZAR) |
|---|---|
| Category I FSP application (sub-product 1.27 Crypto Assets) | 2,697 |
| Category II FSP application (if required; 10% discount not applicable if first-time) | 16,313 |
| Compliance officer Phase 1 approval (if new CO) | Confirm with FSCA |
| RE 1 examination (per key individual) | ~900–1,500 |
| Recognised qualification (if required) | Varies |

### Annual Ongoing Costs (estimated)

| Item | Annual Cost (ZAR) |
|---|---|
| FSCA Annual Levy (per KI + per rep; invoiced Aug) | ~3,000–15,000 (depends on scale) |
| External compliance practice | ~60,000–240,000 |
| Professional Indemnity / Fidelity Insurance | ~20,000–80,000 (CASP-specific; varies widely) |
| Audited financial statements | ~20,000–50,000 |

### Indicative Timeline

| Phase | Estimated Duration | Bottleneck |
|---|---|---|
| Phase 0: Corporate pre-requisites | 4–8 weeks | Bank account opening; B-BBEE certificate |
| Phase 1: RE 1 exam preparation + exam | 8–16 weeks | Exam schedule availability; study time |
| Phase 2: Compliance officer engagement | 2–6 weeks | Finding and contracting an external practice |
| Phase 3: Policy document preparation | 4–8 weeks | 13 required policy documents; business plan |
| Phase 4: Application submission | 1–2 weeks | Portal completion; payment processing |
| FSCA processing (post-submission) | 3–6 months (possibly longer for CASPs) | FSCA backlog and query rounds |
| **Total to licence grant** | **~6–12 months** | |

---

## 13. Forms Checklist

Use this checklist when preparing the application package.

### Application Forms
- [ ] **FSP 1** — Business Information (BitWealth)
- [ ] **FSP 2** — Licence Categories (Category I, sub-product 1.27, Advice + Intermediary + Automated Advice)
- [ ] **FSP 3** — Directors and Shareholders
- [ ] **FSP 4A** — Fitness & Propriety — BitWealth (Pty) Ltd (company)
- [ ] **FSP 4B** — Fitness & Propriety — Director 1
- [ ] **FSP 4B** — Fitness & Propriety — Director 2 (repeat per director)
- [ ] **FSP 4D** — Fitness & Propriety — Key Individual 1
- [ ] **FSP 4D** — Fitness & Propriety — Key Individual 2 (repeat per KI)
- [ ] **FSP 5** — Representative details (per representative, if any)
- [ ] **FSP 6** — Compliance Officer (Phase 2)
- [ ] **FSP 7** — Operational Ability (with all 13 policy documents attached)
- [ ] **FSP 8** — Financial Soundness
- [ ] **FSP 9** — External Auditor
- [ ] **FSP 12** — Compliance Officer Phase 1 (only if new CO)
- [ ] **FSP 13** — Exemption (only if needed)

### Supporting Documents
- [ ] CIPC registration certificate (current; good standing)
- [ ] Company MOI / Memorandum of Incorporation
- [ ] B-BBEE certificate or sworn affidavit
- [ ] Certified ID copies — all directors (< 3 months old)
- [ ] RE 1 certificates — all key individuals
- [ ] Qualification certificates (certified) — all key individuals
- [ ] Class of Business training certificates — all key individuals
- [ ] CVs — all key individuals (full career history)
- [ ] Reference letters confirming experience — all key individuals
- [ ] Crypto assets general skills narrative (written) — all key individuals
- [ ] Financial projections (Year 1 income statement + balance sheet)
- [ ] Accounting officer / auditor confirmation letter (first year)
- [ ] Liquid assets proof (Form A, Annexure 6, Board Notice 194/2017)
- [ ] Audit firm appointment confirmation letter (per FSP 9 Section 3)
- [ ] VALR Subaccount Structure document (describing per-client subaccount custody model and direct fiat flow)
- [ ] Professional Indemnity Insurance certificate
- [ ] Fidelity Insurance certificate
- [ ] Compliance officer services agreement (signed)
- [ ] Compliance officer independence and monitoring plan annexure (FSP 6 Section 4)
- [ ] FICA compliance policy (with page references for procedures)
- [ ] 13 policy/operational documents (per FSP 7 Section 1.4)
- [ ] Proof of FSCA fee payment (bank EFT confirmation)
- [ ] FAIS Representative Register (XLSX template — blank at submission; to be populated once licensed)

---

## 14. Key Contacts & Resources

| Resource | URL / Contact |
|---|---|
| FSCA FAIS New Licence Applications portal | www.fsca.co.za → FAIS → Registration → New License Applications |
| FSCA application email | fais.newlicense@fsca.co.za |
| FSCA physical address | Riverwalk Office Park, Block B, 41 Matroosberg Road, Ashlea Gardens Ext 6, Menlo Park, Pretoria, 0081 |
| FSCA representative register updates | reps@fsca.co.za (after linking FSP number) |
| RE 1 exam — IISA | www.iisa.co.za |
| RE 1 exam — First ExaM | www.firstexam.co.za |
| FSCA List of Recognised Qualifications | www.fsca.co.za → Compliance → Fit and Proper |
| Board Notice 194 of 2017 (Fit and Proper Requirements) | www.fsca.co.za → Legislation → Board Notices |
| Conduct Standard 3A of 2023 (CASP requirements) | Obtain from FSCA website → Legislation → Conduct Standards |
| FIC CASP registration (parallel obligation) | www.fic.gov.za → Registration |
| FAIS Ombud (client complaints escalation) | www.faisombud.co.za |
| CMS Law Firm — Crypto Regulation Guide | Reference document in docs/FSCA Compliance/ |

---

*This document was prepared based on analysis of 25 FSCA FAIS guidance documents, the FAIS Act No. 37 of 2002, Board Notice 194 of 2017, and the CMS Expert Guide to Crypto Regulation in South Africa (June 2025). It is a practical planning guide and does not constitute legal advice. BitWealth should engage a FAIS compliance attorney or specialist compliance practice to validate this plan before submitting the application.*
