# Business Case: Application for Financial Services Provider Licence
## [COMPANY NAME] (Pty) Ltd
### Submission to the Financial Sector Conduct Authority (FSCA)
### In terms of Section 8 of the Financial Advisory and Intermediary Services Act, 37 of 2002 (FAIS Act)

---

**Document Version:** 1.0  
**Date:** [DATE]  
**Prepared by:** [YOUR NAME], [TITLE]  
**FSP Application Reference:** [TO BE ASSIGNED BY FSCA]  
**Company Registration No.:** [CIPC REGISTRATION NUMBER]  

---

## Table of Contents

1. Executive Summary
2. Company Overview
3. Financial Services to be Rendered
4. Products and Financial Products
5. Target Market and Client Profile
6. Organisational Structure
7. Key Individual(s) and Representatives
8. Compliance Framework
9. Risk Management Framework
10. Technology and Infrastructure
11. Outsourcing Arrangements
12. Conflict of Interest Management
13. Complaints Handling
14. Record Keeping
15. Financial Position and Projections
16. Professional Indemnity Insurance
17. Transformation and B-BBEE
18. Declaration

---

## 1. Executive Summary

[COMPANY NAME] (Pty) Ltd ("the Company") hereby applies for authorisation as a Financial Services Provider (FSP) under the FAIS Act, 37 of 2002, as amended, and the Financial Sector Regulation Act, 9 of 2017.

The Company intends to render **discretionary portfolio management services** in respect of **crypto assets**, utilising a proprietary signal-driven Bitcoin Dollar-Cost Averaging strategy known as the Long-Term Holder Price-to-Value Ratio (LTH PVR) methodology.

The Company will operate under a **Category II** licence for discretionary investment management, and additionally applies for authorisation as a **Crypto Asset Service Provider (CASP)** as contemplated in the FSCA's declaration of crypto assets as financial products (Government Notice 1877 of 19 October 2022).

The Company's model is fully automated, rules-based, and algorithmically executed, with day-to-day investment decisions made by the system rather than by manual human instruction, under the oversight of the registered Key Individual.

**Licence categories applied for:**
- Category II: Discretionary FSP (Crypto Assets)
- CASP: Crypto Asset Service Provider

---

## 2. Company Overview

### 2.1 Company Details

| Field | Detail |
|---|---|
| Registered Name | [COMPANY NAME] (Pty) Ltd |
| Trading Name | BitWealth (or as applicable) |
| Registration Number | [CIPC NUMBER] |
| Registered Address | [PHYSICAL ADDRESS] |
| Postal Address | [POSTAL ADDRESS] |
| Contact Number | [PHONE] |
| Email Address | [EMAIL] |
| Website | [URL] |
| VAT Registration Number | [VAT NUMBER or "Not yet registered"] |

### 2.2 History and Background

[COMPANY NAME] was incorporated on [DATE] in the Republic of South Africa. The Company was established by [YOUR NAME] with the purpose of providing regulated, technology-driven Bitcoin accumulation services to retail and high-net-worth investors.

The founder has [X] years of experience in [technology/finance/crypto]. The Company has been developing its proprietary LTH PVR strategy since [YEAR], which was back-tested against [X] years of historical Bitcoin price and on-chain data.

The Company operated as a Representative under [ROCKETX FSP NAME], FSP No. [ROCKETX FSP NUMBER], from [START DATE], during which period [X] clients were successfully onboarded and the strategy was validated in a live trading environment.

### 2.3 Shareholding Structure

| Shareholder | % Held | Role |
|---|---|---|
| [YOUR NAME] | [X]% | Director and Founder |
| [OTHER SHAREHOLDER IF ANY] | [X]% | [ROLE] |

### 2.4 Board of Directors

| Name | Designation | ID Number |
|---|---|---|
| [YOUR NAME] | Executive Director | [ID NUMBER] |
| [OTHER DIRECTOR IF ANY] | [DESIGNATION] | [ID NUMBER] |

---

## 3. Financial Services to be Rendered

The Company intends to render the following financial services in terms of Section 8(1)(b) of the FAIS Act:

### 3.1 Category of Authorisation

**Category II — Discretionary Financial Services Provider**

A Category II authorisation permits the Company to make investment decisions and execute transactions on behalf of clients without requiring specific client approval for each individual transaction, subject to the parameters of the signed mandate agreement.

### 3.2 Nature of Services

The Company will render the following financial services:

1. **Discretionary portfolio management of crypto assets** — specifically Bitcoin (BTC) accumulation via a systematic Dollar-Cost Averaging strategy modulated by on-chain signal data
2. **Financial advice** in relation to the LTH PVR strategy, its risk profile, and suitability for individual client circumstances
3. **Execution of buy and sell orders** on behalf of clients on regulated cryptocurrency exchanges via API integration

### 3.3 Services NOT to be Rendered

The Company does not intend to render:
- Category I (non-discretionary advice) as a standalone service
- Category III (investment management for collective investment schemes)
- Category IV (administration of retirement funds)
- Forex or derivative trading
- Custody services (custody remains with the exchange)

---

## 4. Products and Financial Products

### 4.1 Financial Products

In terms of the FAIS Act as amended by Government Notice 1877 of October 2022, **crypto assets are declared financial products**. The Company will render services exclusively in relation to:

| Financial Product | Description |
|---|---|
| Bitcoin (BTC) | The primary accumulation asset |
| USDT / Stablecoins | Used as the base currency and holding vehicle during signal-driven pauses |

### 4.2 Strategy Description

The LTH PVR strategy operates as follows:

- **Signal source:** Daily on-chain data from ChartInspect API — specifically the Long-Term Holder Profit-to-Volatility Ratio (LTH PVR) sigma band model
- **Decision logic:** The strategy compares the current Bitcoin price to predefined sigma bands to determine the optimal daily buy size or partial sell instruction
- **Execution:** Orders are placed automatically via exchange API integration at 03:00–05:00 UTC each trading day
- **Buy tiers (B1–B5):** Increasing position sizes as Bitcoin approaches undervalued sigma bands
- **Sell tiers (S6–S11):** Partial position liquidation as Bitcoin approaches overvalued sigma bands
- **Bear Market Pause:** Full pause in accumulation when extreme overvaluation is detected

All execution is fully automated and rules-based. No manual discretionary overrides are made without client notification.

### 4.3 Exchange and Custody

Client funds are held at [EXCHANGE NAME] (e.g., VALR / Binance). The Company does not take custody of client funds at any time. Each client has a dedicated sub-account or exchange account connected to the Company's execution system via trade-only API keys. Withdrawal permissions are explicitly excluded from all API configurations with the exception of performance and platform fee withdrawals to the Company's designated account.

---

## 5. Target Market and Client Profile

### 5.1 Target Market

The Company targets the following client segments:

| Segment | Description | Min. Investment |
|---|---|---|
| Retail Investors | South African residents aged 25–60 seeking long-term Bitcoin accumulation | R 15,000 (lump sum) and/or R 1,500/month |
| High-Net-Worth Individuals | Investors with discretionary capital above R 500,000 seeking regulated crypto exposure | [TBD] |
| Professional Investors | [IF APPLICABLE] | [TBD] |

### 5.2 Client Suitability

Prior to rendering services, the Company will conduct a formal needs analysis and suitability assessment for each prospective client, covering:

- Investment objectives and time horizon
- Risk tolerance and capacity for loss
- Existing financial position and dependants
- Crypto asset experience and knowledge
- Source of funds (FICA compliance)

Clients who do not meet the minimum suitability criteria will not be accepted.

### 5.3 Geographic Scope

Services will be rendered exclusively to clients who are resident in the Republic of South Africa, subject to SARB exchange control regulations. Cross-border services are not contemplated at this stage.

---

## 6. Organisational Structure

### 6.1 Organogram

```
Board of Directors
    └── Executive Director / Founder ([YOUR NAME])
              ├── Key Individual: [KI NAME]
              │         └── Representatives: [REP NAME(S)]
              ├── Operations / Technology: [YOUR NAME or STAFF]
              └── Compliance (Outsourced): [COMPLIANCE FIRM NAME]
```

### 6.2 Staffing Plan

| Role | Name | Employment Status |
|---|---|---|
| Executive Director | [YOUR NAME] | Full-time employee |
| Key Individual | [KI NAME] | [Full-time / Part-time / Contract] |
| Representative | [REP NAME] | [As applicable] |
| Compliance Officer | [NAME / FIRM] | Outsourced |

---

## 7. Key Individual(s) and Representatives

### 7.1 Key Individual

**Name:** [KI FULL NAME]  
**ID Number:** [ID NUMBER]  
**FSCA Approval Status:** Previously approved as KI under FSP No. [EXISTING FSP NUMBER]  
**Date of Approval:** [DATE]

#### Qualifications

| Qualification | Institution | Year |
|---|---|---|
| [QUALIFICATION NAME] | [INSTITUTION] | [YEAR] |
| [QUALIFICATION NAME] | [INSTITUTION] | [YEAR] |

#### Relevant Experience

| Period | Organisation | Role |
|---|---|---|
| [DATES] | [ORGANISATION] | [ROLE] |
| [DATES] | [ORGANISATION] | [ROLE] |

#### Fit and Proper Declaration

The Key Individual confirms compliance with the fit and proper requirements as prescribed in the Fit and Proper Requirements for Financial Services Providers Notice (Board Notice 194 of 2017), including:

- [ ] Honesty and integrity
- [ ] Competency and capability
- [ ] Operational ability
- [ ] Financial soundness

*[Signed declaration to be attached as Annexure A]*

### 7.2 Representatives

| Name | ID Number | Authorisation Level | Products |
|---|---|---|---|
| [YOUR NAME] | [ID] | [Cat I / Cat II] | Crypto Assets |
| [OTHER REP] | [ID] | [Cat I / Cat II] | [PRODUCTS] |

### 7.3 Supervision Arrangements

The Key Individual will supervise all Representatives in terms of Section 13(2) of the FAIS Act. Supervision will include:

- Monthly review of all client portfolios and strategy performance
- Quarterly compliance meetings with each Representative
- Review and sign-off of all new client mandates prior to activation
- Annual competency and fit-and-proper assessment of each Representative

---

## 8. Compliance Framework

### 8.1 Regulatory Framework

The Company will comply with the following legislation and subordinate regulation:

| Legislation | Relevant Obligation |
|---|---|
| FAIS Act 37 of 2002 | Core FSP obligations, disclosure, complaints |
| Financial Sector Regulation Act 9 of 2017 | FSCA oversight, reporting |
| FICA 38 of 2001 | KYC, AML, transaction monitoring |
| POPIA 4 of 2013 | Client data protection and privacy |
| TCF (Treating Customers Fairly) | Outcomes-based client conduct |
| FSCA General Code of Conduct (BN80/2003) | Day-to-day conduct standards |
| SARB Exchange Control Regulations | Cross-border capital flows |
| FSCA CASP Declaration (GN 1877/2022) | Crypto asset specific obligations |

### 8.2 Compliance Monitoring Plan

A detailed Compliance Monitoring Plan (CMP) will be implemented and reviewed annually, covering:

- Client file audits (quarterly)
- Transaction monitoring (monthly)
- Disclosure document reviews (bi-annually)
- TCF outcome measurement (quarterly)
- FICA risk and control assessment (annually)
- Key Individual supervision log (monthly)

### 8.3 Compliance Officer

**Name:** [COMPLIANCE OFFICER NAME or FIRM]  
**Qualification:** [QUALIFICATION]  
**Contact:** [EMAIL / PHONE]  
**Appointment basis:** [Employed / Outsourced]

*Outsourcing agreement attached as Annexure B (if outsourced)*

### 8.4 Mandatory Disclosure Documents

The Company will maintain and provide to each client the following disclosure documents prior to rendering any financial service:

1. FSP Disclosure Document (Section 4 of the General Code)
2. Client Agreement and Mandate
3. Risk Disclosure Statement (crypto-asset specific)
4. Conflict of Interest Declaration
5. POPIA Privacy Notice
6. FICA Terms (source of funds, PEP screening)

### 8.5 Treating Customers Fairly (TCF)

The Company subscribes to the six TCF outcomes. The following controls are in place:

| TCF Outcome | Control |
|---|---|
| 1. Confident of fair treatment | Company culture and tone from the top; KI oversight |
| 2. Products meet client needs | Suitability assessment before onboarding |
| 3. Clear information | Plain-language disclosure documents; performance dashboards |
| 4. Advice suitable to circumstances | Individual needs analysis for each client |
| 5. Products perform as expected | Back-tested and live performance reporting; automated strategy |
| 6. No post-sale barriers | Free withdrawal policy; no lock-in periods |

---

## 9. Risk Management Framework

### 9.1 Key Risks

| Risk | Likelihood | Impact | Mitigant |
|---|---|---|---|
| Crypto market volatility | High | High | Client suitability assessment; HWM fee model; conservative allocation tiers |
| Technology failure (API/system outage) | Medium | High | Automated monitoring; alert system; 10-min polling fallback; manual override procedure |
| Exchange insolvency/hack | Low | High | Trade-only API keys (no withdrawal access); client funds on regulated exchange |
| Regulatory non-compliance | Low | High | Outsourced compliance officer; annual audits |
| Key person dependency | Medium | Medium | KI succession plan; documented strategy and procedures |
| Signal data failure (ChartInspect outage) | Low | Medium | Automated guard mechanism; pipeline halts and alerts if data unavailable; no trades executed on incomplete data |
| Money laundering / FICA breach | Low | High | Full KYC/AML at onboarding; source of funds verified; FICA risk assessment |
| Data breach (POPIA) | Low | High | Encrypted infrastructure; no client funds accessed by Company; Supabase/cloud security controls |

### 9.2 Business Continuity

The Company maintains the following business continuity provisions:

- Cloud-based infrastructure (no single point of failure for trading systems)
- Daily automated backup of all transaction and client data
- KI succession plan: [DESCRIBE SUCCESSOR OR ARRANGEMENT]
- Manual override procedure documented for technology failures
- PI insurance coverage for operational failures

---

## 10. Technology and Infrastructure

### 10.1 Systems Overview

The Company operates a fully automated trading infrastructure:

| System Component | Description |
|---|---|
| Strategy Engine | Deno-based edge functions hosted on Supabase (cloud) |
| Database | PostgreSQL via Supabase — stores all decisions, orders, fills, and client state |
| Signal Source | ChartInspect API (on-chain LTH PVR data) |
| Exchange Integration | [EXCHANGE NAME] REST API with HMAC authentication |
| Order Management | Limit orders with 5-minute fallback to market orders |
| Monitoring | Automated alert system; daily email digest; WebSocket real-time monitoring |
| Client Reporting | [PORTAL/DASHBOARD URL or DESCRIPTION] |

### 10.2 Security Controls

- API keys are trade-only (withdrawal rights explicitly excluded with the exception of fee withdrawals to the Company's account)
- All credentials stored in encrypted environment variables (not in codebase)
- HMAC-SHA512 signed API requests
- Supabase Row Level Security enforces data isolation between clients
- No client funds are accessible by Company systems — execution only

### 10.3 Data Storage and POPIA

All client personal information is stored in [JURISDICTION] on Supabase (hosted on AWS). Data processing is governed by the Company's POPIA Privacy Notice. No personal data is shared with third parties except as required by law or with client consent.

---

## 11. Outsourcing Arrangements

The Company makes use of the following outsourced service providers:

| Service | Provider | Regulatory Relevance |
|---|---|---|
| Compliance Officer | [FIRM NAME] | FAIS compliance monitoring |
| Cloud Infrastructure | Supabase / AWS | Data hosting and processing |
| On-chain Data | ChartInspect | Signal source for strategy |
| Exchange Execution | [EXCHANGE NAME] | Order execution and custody |
| Email / Alerting | Resend | Operational alerting |

All material outsourcing arrangements are documented in written agreements that include provisions for data protection, service levels, audit rights, and termination.

---

## 12. Conflict of Interest Management

### 12.1 Policy

The Company maintains a Conflict of Interest Management Policy in terms of Section 3A of the General Code of Conduct. Key provisions:

- The Company earns fees exclusively on a **performance basis** (10% of profits above High Watermark) — there is no incentive to churn trades or increase volume
- No third-party commissions, kickbacks, or referral fees are accepted in connection with client portfolios
- The Company will disclose all material conflicts of interest to clients in writing prior to rendering services
- A Conflict of Interest Register is maintained and reviewed quarterly

### 12.2 Related Party Transactions

| Relationship | Nature | Management |
|---|---|---|
| [KI NAME] — Key Individual | [SHAREHOLDING / REVENUE SHARE IF ANY] | Disclosed to clients; arm's-length basis |
| [ROCKETX IF STILL RELEVANT] | Representative arrangement (historic) | Disclosed and documented |

---

## 13. Complaints Handling

### 13.1 Complaints Procedure

In terms of Section 18 of the General Code, the Company maintains a formal complaints handling procedure:

1. Complaint received (written or verbal) → logged in Complaints Register within 1 business day
2. Acknowledgement to client within **2 business days**
3. Investigation and response within **30 days**
4. If not resolved → client informed of right to escalate to FAIS Ombud

### 13.2 FAIS Ombud Contact

Clients are informed of their right to approach the FAIS Ombud:  
**FAIS Ombud:** www.faisombud.co.za | 0860 FAIS OMBUD (0860 3247 66283)

### 13.3 Complaints Register

A Complaints Register is maintained recording: date received, nature of complaint, client details, action taken, resolution date, and outcome.

---

## 14. Record Keeping

In terms of Section 18(1) of the FAIS Act, the Company will retain the following records for a minimum of **5 years**:

| Record Type | Storage Location | Retention Period |
|---|---|---|
| Client mandate agreements | Supabase / encrypted cloud storage | 5 years minimum |
| Needs analysis and suitability assessments | Supabase / cloud | 5 years minimum |
| Disclosure documents (signed) | Supabase / cloud | 5 years minimum |
| Transaction records / order history | Supabase database | 5 years minimum |
| Complaints register | Supabase / cloud | 5 years minimum |
| FICA records (KYC documents) | Supabase / encrypted | 5 years from client exit |
| KI supervision logs | Supabase / cloud | 5 years minimum |

---

## 15. Financial Position and Projections

### 15.1 Current Financial Position

| Item | Amount (ZAR) |
|---|---|
| Share capital | [R AMOUNT] |
| Retained earnings / (deficit) | [R AMOUNT] |
| Total net asset value | [R AMOUNT] |

*Opening balance sheet / latest management accounts attached as Annexure C*

### 15.2 Minimum Capital Requirements

For a Category II FSP with crypto asset authorisation, the Company is aware of the FSCA's minimum financial requirements. The Company confirms its net asset value exceeds the statutory minimum and will maintain this position on an ongoing basis.

*[Note: Confirm current minimum with your compliance officer — typically a minimum net asset value requirement applies, and/or a performance bond may be required]*

### 15.3 Revenue Projections (3-Year)

| Year | Projected Clients | Avg AUM per Client (ZAR) | Total AUM | Performance Fee (10%) | Revenue (Est.) |
|---|---|---|---|---|---|
| Year 1 | [X] | [R AMOUNT] | [R AMOUNT] | [ASSUMED ANNUAL RETURN %] | [R AMOUNT] |
| Year 2 | [X] | [R AMOUNT] | [R AMOUNT] | [ASSUMED ANNUAL RETURN %] | [R AMOUNT] |
| Year 3 | [X] | [R AMOUNT] | [R AMOUNT] | [ASSUMED ANNUAL RETURN %] | [R AMOUNT] |

### 15.4 Cost Structure

| Expense Item | Monthly (ZAR) |
|---|---|
| Compliance officer (outsourced) | [R AMOUNT] |
| Infrastructure (Supabase, CryptoQuant, etc.) | [R AMOUNT] |
| Professional Indemnity insurance | [R AMOUNT / 12] |
| Exchange trading fees | [Variable — estimated] |
| Marketing and client acquisition | [R AMOUNT] |
| Legal / accounting | [R AMOUNT] |
| **Total monthly overhead** | **[R AMOUNT]** |

---

## 16. Professional Indemnity Insurance

The Company will maintain a Professional Indemnity (PI) insurance policy as required by the FAIS Act and the Short-term Insurance Act, providing coverage for:

- Professional errors and omissions
- Losses arising from system failures
- Third-party claims by clients

| Coverage Item | Amount |
|---|---|
| Insurer | [INSURER NAME] |
| Policy Number | [POLICY NUMBER] |
| Coverage Amount | R [AMOUNT] |
| Annual Premium | R [AMOUNT] |
| Policy Period | [START DATE] to [END DATE] |

*PI insurance certificate attached as Annexure D*

---

## 17. Transformation and B-BBEE

| B-BBEE Element | Detail |
|---|---|
| B-BBEE Status Level | [LEVEL or "To be assessed"] |
| Ownership | [% Black Ownership] |
| Management Control | [% Black Management] |
| B-BBEE Certificate / Affidavit | [Attached as Annexure E / To be obtained] |

The Company is committed to the principles of broad-based black economic empowerment and will obtain a formal B-BBEE assessment as the business scales.

---

## 18. Declaration

I, the undersigned, being a duly authorised representative of [COMPANY NAME] (Pty) Ltd, hereby declare that:

1. All information contained in this Business Case is true, correct, and complete to the best of my knowledge and belief
2. The Company and all Key Individuals and Representatives meet the fit and proper requirements as prescribed under the FAIS Act
3. The Company will comply with all conditions attached to any licence granted by the FSCA
4. The Company will notify the FSCA of any material changes to the information provided herein within the prescribed timeframe

**Signed at** _________________________ **on this** _______ **day of** _____________ **2026**

| | |
|---|---|
| **Signature:** | _________________________ |
| **Full Name:** | [YOUR FULL NAME] |
| **Capacity:** | Director |
| **Date:** | [DATE] |

---

## Annexures

| Annexure | Description | Included |
|---|---|---|
| A | Fit and Proper Declarations — KI and Representatives | [ ] |
| B | Compliance Officer Outsourcing Agreement | [ ] |
| C | Opening Balance Sheet / Management Accounts | [ ] |
| D | Professional Indemnity Insurance Certificate | [ ] |
| E | B-BBEE Certificate / Affidavit | [ ] |
| F | Company Registration Documents (CIPC) | [ ] |
| G | KI Qualifications and CV | [ ] |
| H | Representative Qualifications and CVs | [ ] |
| I | Client Mandate Agreement Template | [ ] |
| J | Needs Analysis / Suitability Assessment Template | [ ] |
| K | Complaints Handling Procedure | [ ] |
| L | Conflict of Interest Management Policy | [ ] |
| M | FICA Risk and Compliance Policy | [ ] |
| N | POPIA Privacy Notice | [ ] |
| O | Business Continuity Plan | [ ] |
| P | Compliance Monitoring Plan | [ ] |

---

*This business case was prepared in accordance with the requirements of the Financial Advisory and Intermediary Services Act, 37 of 2002, the Financial Sector Regulation Act, 9 of 2017, and related subordinate legislation. The applicant acknowledges that the FSCA may request additional information or documentation during the assessment process.*
