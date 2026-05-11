# Privacy Policy - RentGuard NYC

**Last updated:** 2026-05-11

---

## 1. Introduction

### 1.1 Who we are

RentGuard NYC ("RentGuard," "we," "us," or "our") is operated by RentGuard NYC LLC. The current service at https://www.rentguard.cc provides free New York City building lookups, public-record risk reports, source links, saved buildings for signed-in users, and affiliate-link disclosures.

### 1.2 Scope

This Privacy Policy explains what information we collect, how we use it, who we share it with, how long we retain it, and the choices you have. It applies to RentGuard websites, accounts, building lookups, saved-building features, support communications, and affiliate-click flows.

### 1.3 Current product boundary

RentGuard does not currently offer lease upload, lease PDF review, paid subscriptions, Search Pass purchases, Stripe checkout, paid report unlocks, saved lease reports, FARE Act compliance determinations, complaint-letter generation, weekly alert emails, or law-firm client portals. If those products launch later, we will update this Privacy Policy before collecting the additional data needed for them.

---

## 2. Information We Collect

### 2.1 Information you provide

- **Account information.** Email address, password credentials handled by Supabase Auth, magic-link requests, and optional profile details you choose to provide.
- **Building lookup inputs.** Addresses, listing URLs, BBLs, borough details, or other text you enter to run a lookup.
- **Saved buildings.** Buildings you save to your account dashboard.
- **Support and correction messages.** Emails or messages you send to support, privacy, corrections, owners, security, or legal contact addresses.
- **Affiliate-click choices.** When you choose to continue to an affiliate partner, we may record the partner, timestamp, page, and anonymous or account-linked identifier needed for our reporting.

### 2.2 Information collected automatically

- **Usage data.** Pages viewed, lookup attempts, reports opened, tabs viewed, buttons clicked, errors, timestamps, and referring pages.
- **Device and log data.** IP address, browser type, operating system, device type, approximate location derived from IP, request headers, and security logs.
- **Session data.** Authentication cookies or tokens needed to keep you signed in, plus an anonymous browser identifier such as `anon_token` for free-lookup limits and fraud prevention.
- **Performance and diagnostic data.** Server logs, API timing, build/runtime errors, and related telemetry used to operate and debug the service.

### 2.3 Information from public sources

When you search a building, we retrieve public-record information from NYC sources such as HPD, DOB, 311, NYC Marshal records, HPD registration records, bedbug and lead-paint datasets, and the NYC Public Advocate Worst Landlord Watchlist. These records are generally about buildings, complaints, violations, registered owners, or public filings. We associate the retrieved report with your lookup only to provide the service, enforce limits, save buildings, debug, and improve report quality.

### 2.4 Information we do not collect in the current beta

We do not currently collect lease PDFs, extracted lease text, payment card numbers, Stripe customer IDs, subscription status, paid report unlocks, refund requests, law-firm client files, or DCWP complaint-letter drafts through the public product. We do not knowingly collect biometric data, health information, children's information, or data broker profiles.

### 2.5 Anonymous use

You can run limited building lookups without creating an account. Anonymous use may still be associated with an anonymous browser identifier, IP address, device logs, and lookup inputs so that we can operate the product, prevent abuse, and enforce free-lookup limits. If you later create an account from the same browser, some recent anonymous activity may become associated with that account where needed to provide continuity.

---

## 3. How We Use Information

We use information to:

- Provide building lookup, report rendering, saved-building, and dashboard features.
- Authenticate users with password sign-in, signup, and magic-link sign-in.
- Resolve addresses and listing URLs to BBLs.
- Retrieve, cache, and display public-record data.
- Generate AI summaries from public-record building data.
- Enforce free-lookup limits and prevent spam, scraping, fraud, and abuse.
- Respond to support, privacy, security, legal, owner, and correction requests.
- Record affiliate-click reporting and show required affiliate disclosures.
- Debug errors, monitor performance, maintain security, and improve reliability.
- Comply with legal obligations and enforce our Terms of Service.

We do not sell personal information. We do not use building lookups or account data to train, fine-tune, or improve AI models.

---

## 4. AI Processing

### 4.1 Current AI use

RentGuard currently uses AI to generate plain-English summaries of public-record building data. The current summary flow uses OpenAI models, including gpt-4o-mini or a comparable OpenAI model, hosted in the United States or regions supported by the provider.

### 4.2 Data sent for building summaries

For building reports, we may send public-record counts, public-record excerpts, source names, BBL, borough, and related building metadata to the AI provider. We design prompts to summarize the retrieved public records and cite source-derived facts. We do not currently send lease PDFs or payment data because those flows are not part of the live product.

### 4.3 No AI training

We do not use your account information, building searches, saved buildings, support messages, or public-record report requests to train or fine-tune AI models. We use providers under terms intended to prevent customer API inputs and outputs from being used for model training.

### 4.4 AI limitations

AI summaries can make mistakes, omit important context, misread patterns, or describe records unclearly. You should verify all cited records yourself and consult qualified professionals before relying on a report.

---

## 5. Sharing Information

### 5.1 Service providers

We share information with vendors that help us run RentGuard. These may include:

- Supabase for authentication, database, storage, and related account services.
- Hosting and deployment providers such as Vercel and Render.
- Email and domain-forwarding providers used to send authentication or support emails.
- OpenAI for building-report AI summaries.
- Logging, security, monitoring, and analytics providers used to operate and protect the service.
- Affiliate partners only when you click through to their sites, as described below.

Service providers process information for us under their own terms and agreements. A current sub-processor list is available by request at privacy@rentguard.cc.

### 5.2 Affiliate links

When you click an affiliate link to a partner such as Lemonade, Bellhop, or Moved, we may log the click and redirect you to the partner site. The affiliate URL may include a tracking identifier so the partner can credit RentGuard if you purchase or sign up. We do not intentionally send your RentGuard account password, saved-building list, or report notes through affiliate links. Once you leave RentGuard, the partner's privacy policy controls its collection and use of information.

### 5.3 Legal and safety disclosures

We may disclose information if required by law, subpoena, court order, or valid legal process; to protect the rights, property, or safety of RentGuard, users, service providers, or others; to investigate abuse or security incidents; or to enforce our Terms.

### 5.4 Business transfers

If RentGuard is involved in a merger, acquisition, financing, reorganization, bankruptcy, or sale of assets, information may be transferred as part of that transaction. We will require any successor to honor this Privacy Policy or provide notice of changes.

### 5.5 With your consent

We may share information for other purposes with your consent.

### 5.6 What we do not do

- We do not sell personal information.
- We do not share personal information with landlords, owners, managers, or brokers so they can target renters.
- We do not allow affiliate partners to change report content.
- We do not use third-party advertising cookies in the current product.

---

## 6. Data Retention

### 6.1 Default retention periods

| Data type | Retention |
|---|---|
| Account email and authentication records | While your account is active, plus 90 days after closure unless longer retention is required for security or legal reasons |
| Password credentials | Managed by Supabase Auth according to its security controls; RentGuard does not store plaintext passwords |
| Magic-link events | As needed for authentication, security, and abuse prevention |
| Building lookup history | Up to 12 months for abuse prevention, debugging, and product quality |
| Saved buildings | While your account is active or until you delete the saved building |
| Anonymous browser identifiers | Up to 12 months, unless reset earlier by browser controls or account deletion workflows |
| Affiliate-click logs | Up to 12 months for reporting, fraud prevention, and commission reconciliation |
| Support, correction, security, privacy, or legal emails | Up to 3 years, or longer if needed for legal, safety, or dispute reasons |
| Usage, security, and server logs | Up to 12 months, unless needed longer for security, abuse, or legal reasons |
| Backups | Up to 35 days from creation |

### 6.2 Deletion requests

You may request deletion of your account or personal information by emailing privacy@rentguard.cc. We may retain limited records where necessary for legal obligations, security, fraud prevention, dispute resolution, or legitimate business records.

### 6.3 Public records

Some building information in RentGuard reports comes from public sources that we do not control. Deleting your account does not delete the underlying public record from NYC.gov or other agency systems.

---

## 7. Data Security

We use administrative, technical, and physical safeguards designed to protect information from unauthorized access, acquisition, alteration, disclosure, or destruction. These safeguards include TLS in transit, access controls, authentication controls, vendor security practices, logging, and incident-response procedures.

No system is perfectly secure. If we learn of a breach that triggers legal notice obligations, we will notify affected users and regulators as required by applicable law.

---

## 8. Cookies and Similar Technologies

We use cookies, local storage, and similar technologies for:

- **Strictly necessary functions.** Authentication, session management, magic-link completion, free-lookup limits, CSRF/security protections, and keeping the service working.
- **Functional preferences.** Remembering recent searches, saved-building state, or UI preferences where applicable.
- **Analytics and diagnostics.** Understanding page views, errors, performance, and product usage so we can improve the service.
- **Affiliate reporting.** Recording that you chose to continue to a partner link after seeing a disclosure.

We do not use advertising cookies in the current product. Browser settings can block or delete cookies, but disabling necessary cookies may break sign-in, saved buildings, or lookup limits.

---

## 9. Your Rights and Choices

### 9.1 Rights available to all users

You may ask us to:

- Access the personal information we hold about you.
- Correct inaccurate personal information.
- Delete personal information, subject to limited exceptions.
- Export account-linked lookup history or saved-building information where technically feasible.
- Stop sending non-essential emails.

Email privacy@rentguard.cc with the request and the email address associated with your account. We may need additional information to verify your identity.

### 9.2 California residents

If you are a California resident, you may have additional rights under the California Consumer Privacy Act, as amended by the CPRA, including rights to know, access, correct, delete, and opt out of sale or sharing. We do not sell or share personal information as those terms are defined under the CPRA. To exercise rights, email privacy@rentguard.cc.

### 9.3 New York residents

The NY SHIELD Act governs our security obligations to New York residents. We extend the access, correction, deletion, and export choices described above to New York users on an operational basis.

### 9.4 EU/UK users

RentGuard is NYC-specific and is not marketed outside the United States. If you access the service from the EU or UK, your information is processed in the United States. Where applicable, we rely on contract performance, legitimate interests, consent, and legal obligations as lawful bases. You may email privacy@rentguard.cc to request access, correction, deletion, objection, restriction, or portability where required by law.

---

## 10. International Data Transfers

RentGuard is based in the United States and uses United States-based infrastructure and service providers. If you access RentGuard from outside the United States, your information may be transferred to and processed in the United States, where privacy laws may differ from those in your location.

---

## 11. Children's Privacy

RentGuard is not directed to children under 18, and we do not knowingly collect personal information from children under 18. If you believe a child provided personal information to RentGuard, contact privacy@rentguard.cc and we will take appropriate steps.

---

## 12. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will post the updated version with a new "Last updated" date. If we make material changes, we may notify account holders by email or another reasonable method.

---

## 13. Contact

Privacy questions or requests:

> RentGuard NYC LLC  
> Mailing address: to be provided before full public launch  
> Email: privacy@rentguard.cc

Security: security@rentguard.cc  
Support: support@rentguard.cc  
Corrections: corrections@rentguard.cc

---

*End of Privacy Policy.*
