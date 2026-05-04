# Trading Mandate — DRAFT v0.1

> **STATUS: UNREVIEWED FIRST DRAFT.** This document has **not** been reviewed by a legal practitioner. Do not present it to customers in this form. It is intended as a starting point for review by a South African attorney familiar with the **FAIS Act (Act 37 of 2002)**, **POPIA**, **FICA**, and the **FSCA Crypto Asset Declaration (2022)**. Items in `[BRACKETS]` are placeholders or open questions for the lawyer.

---

## 1. Parties

1.1 **BitWealth** — `[Full registered legal entity name]`, a `[company / sole proprietor / other]` registered in the Republic of South Africa under registration number `[REG NO]`, with its principal place of business at `[ADDRESS]` ("**BitWealth**", "**we**", "**us**").

1.2 **The Customer** — the natural person or juristic entity identified in the BitWealth account profile and who has accepted this Mandate electronically ("**Customer**", "**you**").

1.3 BitWealth and the Customer are referred to individually as a "**Party**" and collectively as the "**Parties**".

---

## 2. Definitions

- **"Strategy"** means the *Long-Term Holder Profit-to-Volatility Ratio (LTH PVR)* Bitcoin trading strategy as published by BitWealth at https://bitwealth.co.za/lth-pvr and as updated from time to time in accordance with clause 11.
- **"Exchange"** means VALR (Pty) Ltd, a South African crypto asset service provider, or any successor or replacement venue notified to the Customer in writing.
- **"Subaccount"** means the dedicated VALR subaccount registered in the Customer's name and linked to the Customer's BitWealth profile.
- **"BTC"** means Bitcoin.
- **"ZAR"** means South African Rand.
- **"Order"** means any buy or sell instruction placed on the Exchange by BitWealth pursuant to this Mandate.
- **"Strategy Rules"** means the published parameters of the Strategy, including but not limited to the on-chain bands, momentum filters, retrace logic, order types, sizing logic, and execution windows.

---

## 3. Appointment and Scope of Authority

3.1 The Customer hereby authorises and appoints BitWealth, on a **limited, non-exclusive, and revocable** basis, to place Orders on the Customer's Subaccount **strictly in accordance with the Strategy Rules**.

3.2 The authority granted under this Mandate is **limited to**:

  (a) buying and selling **BTC against USDT and/or ZAR** on the Exchange;
  
  (b) placing **LIMIT** orders, and **MARKET** orders only as a fallback after a LIMIT order has remained unfilled for the period defined in the Strategy Rules (currently 5 minutes);
  
  (c) cancelling and replacing such Orders as required by the Strategy Rules; and
  
  (d) reading account balances, order status, and trade history from the Subaccount for the purposes of executing and reporting on the Strategy.

3.3 BitWealth shall **not**, under this Mandate:

  (a) trade any asset other than BTC;
  
  (b) use leverage, margin, derivatives, futures, or any form of borrowing;
  
  (c) transfer, withdraw, or move any funds or crypto assets out of the Subaccount;
  
  (d) deviate from the published Strategy Rules without the Customer's prior re-acceptance of an updated Mandate; or
  
  (e) provide individualised financial advice within the meaning of the FAIS Act.

3.4 BitWealth's role is to **execute a pre-defined, rules-based strategy** that the Customer has independently elected to follow. This Mandate does not constitute the rendering of *intermediary services* or *advice* as contemplated in section 1 of the FAIS Act, save to the extent that any applicable licensing or registration requirements are held by BitWealth and disclosed to the Customer at `[URL]`. **`[LEGAL: confirm characterisation and FSP status disclosure.]`**

---

## 4. Custody of Funds

4.1 The Customer retains **sole legal and beneficial ownership** of all ZAR and crypto assets held in the Subaccount at all times.

4.2 BitWealth **does not take custody** of Customer funds. All funds remain at the Exchange in the Subaccount registered in the Customer's name.

4.3 BitWealth's access to the Subaccount is limited to the API permissions described in clause 3.2. BitWealth confirms that withdrawal permissions on the API key/subaccount linkage are **disabled** insofar as it is technically able to enforce this.

4.4 The Customer remains responsible for completing the Exchange's own onboarding, KYC, and FICA requirements directly with the Exchange.

---

## 5. Customer Acknowledgements and Risk Disclosure

5.1 The Customer acknowledges that:

  (a) crypto assets are **highly volatile** and the value of BTC may decline substantially or to zero;
  
  (b) past performance of the Strategy (including any back-tested results) is **not indicative of future performance**;
  
  (c) the Strategy may underperform a simple buy-and-hold or standard DCA approach over any given period;
  
  (d) execution risks exist, including but not limited to Exchange downtime, API outages, network latency, slippage, partial fills, adverse price movement between signal and execution, and software defects;
  
  (e) crypto assets are **not** regulated as legal tender in South Africa and are **not** guaranteed by any government, central bank, or deposit insurance scheme;
  
  (f) the Customer has read and accepted the BitWealth **Investment Disclaimer**, **Terms of Service**, and **Privacy Policy**, which are incorporated into this Mandate by reference; and
  
  (g) the Customer is investing only such amounts as they can **afford to lose in full**.

5.2 The Customer warrants that:

  (a) they are at least 18 years of age and have full legal capacity to enter into this Mandate;
  
  (b) they are not a person prohibited from using the Exchange or BitWealth services under any applicable sanctions regime;
  
  (c) the funds deposited into the Subaccount are derived from lawful sources; and
  
  (d) they have not relied on any representation by BitWealth other than those expressly contained in this Mandate or the documents incorporated by reference.

---

## 6. Fees

6.1 BitWealth's fees for executing the Strategy are set out in the Fee Schedule published at https://bitwealth.co.za/lth-pvr and incorporated into this Mandate by reference.

6.2 The Customer authorises BitWealth to **deduct fees** from the Subaccount in the manner described in the Fee Schedule (e.g., via periodic ZAR debit, performance fee on realised gains, or BTC-denominated fee — `[LEGAL/FINANCE: confirm mechanism]`).

6.3 Exchange trading fees, withdrawal fees, network fees, and any taxes are for the Customer's account and are levied by the Exchange or applicable authority directly.

6.4 BitWealth shall give the Customer **at least 30 days' written notice** of any change to the Fee Schedule. Continued use of the service after the effective date constitutes acceptance.

---

## 7. Reporting

7.1 The Customer will have access to a real-time dashboard reflecting Orders, fills, balances, NAV, and performance against the Strategy benchmark and a Standard DCA benchmark.

7.2 BitWealth will make available monthly and annual statements via the dashboard and by email.

7.3 The Customer is responsible for verifying their statements and notifying BitWealth in writing of any disputed entry within 30 days of the statement date, failing which the statement is deemed accepted.

---

## 8. Tax

8.1 The Customer is **solely responsible** for the determination, declaration, and payment of all taxes (including income tax, capital gains tax, and VAT where applicable) arising from activity in the Subaccount.

8.2 BitWealth does **not** provide tax advice. The Customer should consult a qualified tax practitioner.

---

## 9. Revocation, Pause, and Termination

9.1 The Customer may **revoke this Mandate at any time**, with immediate effect, by:

  (a) using the "Pause Strategy" or "Terminate Mandate" function in the BitWealth dashboard; or
  
  (b) notifying BitWealth in writing at admin@bitwealth.co.za.

9.2 On revocation:

  (a) BitWealth will cease placing new Orders as soon as reasonably practicable (and in any event before the next scheduled execution window);
  
  (b) any open Orders may, at BitWealth's discretion, be left to fill, cancelled, or `[other — confirm]`;
  
  (c) the Customer remains liable for fees accrued up to the effective date of revocation; and
  
  (d) the Subaccount and its contents remain under the Customer's sole control.

9.3 BitWealth may **suspend or terminate** this Mandate on `[X]` days' written notice, or immediately if:

  (a) the Customer breaches a material term;
  
  (b) BitWealth reasonably suspects fraud, money laundering, sanctions evasion, or other unlawful activity;
  
  (c) the Exchange suspends or terminates the Subaccount; or
  
  (d) BitWealth ceases to operate the Strategy or the service.

---

## 10. Limitation of Liability

10.1 To the **maximum extent permitted by law**, and save in respect of liability that cannot lawfully be excluded (including liability for fraud, wilful misconduct, gross negligence, or death/personal injury), BitWealth shall not be liable for any:

  (a) loss arising from market movements, slippage, or the operation of the Strategy in accordance with the Strategy Rules;
  
  (b) loss arising from Exchange downtime, outage, hack, insolvency, or breach by the Exchange;
  
  (c) loss arising from third-party service failures (cloud providers, data providers, internet service providers);
  
  (d) indirect, consequential, special, punitive, or incidental damages, including loss of profit or loss of opportunity.

10.2 BitWealth's **aggregate liability** under or in connection with this Mandate, however arising, shall not exceed the **total fees** paid by the Customer to BitWealth in the **`[12]` months** preceding the event giving rise to the claim. **`[LEGAL: confirm cap is enforceable and aligned with CPA where applicable.]`**

10.3 Nothing in this clause limits the Customer's rights under the **Consumer Protection Act, 2008** to the extent that Act applies.

---

## 11. Variation of the Strategy or this Mandate

11.1 BitWealth may from time to time update the **Strategy Rules** or the terms of this Mandate.

11.2 Where a change is **material** (including, without limitation, a change to the asset universe, venue, order types, fee model, or risk parameters), BitWealth will:

  (a) notify the Customer by email and via the dashboard at least `[30]` days before the effective date; and
  
  (b) require the Customer to **re-accept** this Mandate (or the relevant updated document) before further Orders are placed on the Customer's behalf.

11.3 Where the Customer does not re-accept within the period stipulated in the notice, BitWealth will **pause** Order execution on the Subaccount until acceptance is recorded or the Mandate is revoked.

11.4 Non-material changes (e.g., typographical corrections, clarifications) may be made on notice without re-acceptance.

---

## 12. Data Protection

12.1 BitWealth's processing of the Customer's personal information is governed by the **Privacy Policy** at `[URL]`, which complies with the **Protection of Personal Information Act, 2013 (POPIA)**.

12.2 The Customer consents to BitWealth sharing such personal and account information with the Exchange as is necessary to operate the Subaccount and execute Orders.

---

## 13. Conflicts of Interest

13.1 BitWealth shall maintain and publish a **Conflicts of Interest Policy** at `[URL]`. The Customer acknowledges receipt of, and consents to, that policy.

13.2 BitWealth confirms that it does **not** receive rebates or undisclosed inducements from the Exchange in connection with Customer Orders. **`[LEGAL/COMMERCIAL: confirm true; if any rebates exist they must be disclosed.]`**

---

## 14. Complaints and Dispute Resolution

14.1 Complaints may be lodged with BitWealth at `[email]`. BitWealth will acknowledge within `[X]` business days and respond substantively within `[Y]` business days.

14.2 Unresolved complaints may be referred to `[the FAIS Ombud / other applicable forum — LEGAL to confirm]`.

14.3 Any dispute not resolved through the complaints process shall be referred to **arbitration** in `[Johannesburg / Cape Town]` under the rules of the `[Arbitration Foundation of Southern Africa (AFSA)]`, before a single arbitrator. **`[LEGAL: confirm preferred forum; consider small-claims/CPA carve-outs.]`**

---

## 15. General

15.1 **Governing law.** This Mandate is governed by the laws of the **Republic of South Africa**.

15.2 **Jurisdiction.** Subject to clause 14.3, the Parties consent to the non-exclusive jurisdiction of the `[High Court of South Africa, Gauteng Division]`.

15.3 **Severability.** If any provision is held invalid or unenforceable, the remaining provisions continue in full force.

15.4 **Whole agreement.** This Mandate, together with the Privacy Policy, Terms of Service, Investment Disclaimer, and Fee Schedule, constitutes the whole agreement between the Parties in relation to its subject matter.

15.5 **Electronic acceptance.** The Parties agree that electronic acceptance of this Mandate (by ticking the relevant checkbox during onboarding or re-acceptance) constitutes a valid signature for the purposes of the **Electronic Communications and Transactions Act, 2002 (ECTA)**.

15.6 **Notices.** Notices to the Customer will be sent to the email address on file. Notices to BitWealth must be sent to `[email]`.

15.7 **No assignment.** The Customer may not assign or cede any rights under this Mandate without BitWealth's prior written consent. BitWealth may assign or cede its rights to a successor entity on notice to the Customer.

---

## 16. Acceptance Record (system-generated, do not edit)

| Field | Value |
|---|---|
| Customer ID | `[populated at acceptance]` |
| Mandate version | `v0.1-DRAFT` |
| Document hash (SHA-256) | `[populated at acceptance]` |
| Accepted at (UTC) | `[populated at acceptance]` |
| IP address | `[populated at acceptance]` |
| User-agent | `[populated at acceptance]` |

---

## Open Questions for Legal Review

1. **FSP licensing.** Does BitWealth's role — automated execution of a published, rules-based strategy on the customer's own subaccount — fall within "intermediary services" under FAIS? If yes, what category of FSP licence is required, and how should clauses 3.4 and 13 be revised?
2. **Crypto asset FSP regime.** The FSCA's October 2022 declaration brought crypto assets into the FAIS net. Confirm BitWealth's status under this regime and whether any disclosures or representative obligations apply.
3. **Discretionary vs. execution-only.** We have framed the service as execution of a pre-defined strategy the customer elects (not discretionary management). Confirm this framing holds given that BitWealth (not the customer) decides per-day buy/sell/hold within the strategy boundaries.
4. **Fee deduction mechanism.** Confirm permissible mechanisms for fee deduction from a customer subaccount given Exchange terms and any FSP rules on segregation.
5. **Liability cap.** Confirm enforceability of the 12-month-fees cap in clause 10.2 against the CPA and FAIS Act.
6. **Complaints forum.** Confirm correct ombud (FAIS Ombud vs. National Consumer Tribunal vs. other) given the service characterisation.
7. **Cross-border customers.** If non-SA customers will be onboarded, do we need separate mandate variants and tax/regulatory disclosures?
8. **Spousal / matrimonial property.** For SA customers married in community of property, do we need spousal consent under section 15 of the Matrimonial Property Act for amounts above a threshold?
9. **FICA.** Confirm BitWealth's own FICA obligations as an accountable institution, if applicable, and whether KYC done by VALR is sufficient or whether BitWealth must independently KYC.
10. **Re-acceptance trigger.** Confirm what counts as a "material" strategy change requiring re-acceptance vs. notice-only. Suggest a clear, objective list (e.g., any change to fees, asset universe, venue, max drawdown limit).

---

*End of draft.*
