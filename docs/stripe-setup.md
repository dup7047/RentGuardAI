# Stripe account + product setup — checklist (Phase 0.4)

The script at `backend/scripts/stripe-setup.ts` does almost all of this for
you — once you have a test-mode secret key, it creates the products, prices,
Customer Portal config, and webhook endpoint. What you have to do manually is
the part Stripe legally requires a human for: account creation and TOS
acceptance.

## Why I can't auto-create the Stripe account

Stripe requires the account holder to:

- Accept the [Stripe Services Agreement](https://stripe.com/legal/ssa) and
  the [Connected Account Agreement](https://stripe.com/legal/connect-account)
  in their own person.
- Verify identity (email + phone) via codes Stripe sends.
- For payouts in production: bank account, legal entity name, address, SSN
  last 4 digits or full SSN, possibly EIN.

These are not technical hurdles — they're the legal anchor that Stripe holds
the account holder to. So you have to do the signup. Test mode is light: just
email + password + email-verification, no business info needed yet. You can
collect production-mode details later when you're ready to actually take
money (Phase 4-ish).

## Manual steps (10 minutes)

### 1. Create the account

1. Go to https://dashboard.stripe.com/register.
2. Email: your project email address.
3. Password: use the randomly-generated password from your local
   `docs/credentials-to-set.md` (gitignored, never committed) or your
   password manager. **Save it in your password manager before you leave the
   page.** Stripe's password-reset flow works but locking yourself out is
   annoying.
4. Country: United States.
5. Open the verification email Stripe sends and click the link.
6. When Stripe asks for an account name, use `RentGuard NYC` (this is the
   Stripe account display name — separate from the legal entity which you can
   fill in later).

### 2. Stay in test mode

The toggle is in the top-right of the dashboard ("Test mode" / "Live mode").
Make sure it says **Test mode** (orange-ish badge). The setup script refuses
to run with a `sk_live_…` key as a guardrail.

### 3. Grab the test secret key

Dashboard → Developers → API keys → Standard keys. Reveal the **Secret key**
(starts with `sk_test_`). Copy it.

### 4. Run the setup script

```bash
cd backend
# Optional: dry-run to see what it'll do (with no API key, prints intent only)
npm run stripe:setup:dry-run

# Actually create the resources
STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup
```

Expected output (abridged):

```
RentGuard Stripe setup — LIVE WRITE (test mode)

Products & prices:
  created product prod_… (Lease Review)
  created price price_… ($29.00 one_time)
  created product prod_… (Search Pass Monthly)
  created price price_… ($14.99 month)

Customer Portal configuration:
  created portal config bpc_…

Webhook endpoint (https://rentguard-backend.onrender.com/webhooks/stripe):
  created webhook we_… → https://rentguard-backend.onrender.com/webhooks/stripe

----- copy into Render env vars (DO NOT COMMIT) -----
STRIPE_LEASE_REVIEW_PRICE_ID=price_…
STRIPE_SEARCH_PASS_PRICE_ID=price_…
STRIPE_PORTAL_CONFIG_ID=bpc_…
STRIPE_WEBHOOK_ID=we_…
STRIPE_WEBHOOK_SECRET=whsec_…
----- end -----
```

The script is **idempotent** — re-running it picks up existing resources
instead of creating duplicates. If a price's amount drifts from the spec
(e.g. someone hand-edits in the dashboard), the script will refuse to
proceed and tell you to bump the `lookupKey` version.

### 5. Save the env vars

The five lines after `----- copy into Render env vars -----` are what the
backend will need at runtime. Stash them in:

- **Local dev:** `backend/.env` (gitignored).
- **Render staging:** Service → Environment tab → add each as a key/value pair.
- **Stripe webhook signing secret:** if the script reused an existing webhook
  endpoint it can't show the secret again — go to Dashboard → Developers →
  Webhooks → click the endpoint → "Signing secret" → reveal.

### 6. Validate via the dashboard

- Dashboard → Products: should show **Lease Review** ($29 USD) and **Search
  Pass Monthly** ($14.99 USD/month).
- Dashboard → Settings → Customer portal: a configuration with
  "Customers can cancel subscriptions" enabled.
- Dashboard → Developers → Webhooks: an endpoint pointing to
  `https://rentguard-backend.onrender.com/webhooks/stripe` with 10 events.

### 7. End-to-end test (acceptance criterion)

The roadmap acceptance test:

> Stripe Checkout URL works in test mode; canceling a test subscription via
> Customer Portal fires the expected webhook; secrets are in Render env vars,
> not committed.

To run this end-to-end requires the backend (Phase 1.x) — but you can do the
Stripe-only half today:

1. **Test the Search Pass price (creates a Checkout session via the CLI):**

   ```bash
   curl https://api.stripe.com/v1/checkout/sessions \
     -u sk_test_…: \
     -d mode=subscription \
     -d "line_items[0][price]=$STRIPE_SEARCH_PASS_PRICE_ID" \
     -d "line_items[0][quantity]=1" \
     -d success_url=https://www.rentguard.cc/success \
     -d cancel_url=https://www.rentguard.cc/cancel
   ```

   Open the `url` from the response in a browser. You should see a Stripe
   Checkout page for "Search Pass Monthly — $14.99/mo". Use card
   `4242 4242 4242 4242` (any future expiry, any CVC, any ZIP).

2. **Subscribe, then cancel via the Customer Portal.** Once you've completed
   the checkout, in another tab open
   `https://billing.stripe.com/p/login/test_…` with the customer email,
   then cancel the subscription. The webhook endpoint will receive
   `customer.subscription.deleted` — visible under Developers → Webhooks →
   click the endpoint → recent events.

3. **Confirm the webhook events were sent** (you'll see `200 OK` once the
   backend handler ships in Phase 1.x; for now, you'll see attempts that
   timed out trying to reach the placeholder URL — that's fine for 0.4).

## Acceptance criteria (Phase 0.4 from the roadmap)

> Stripe Checkout URL works in test mode; canceling a test subscription via
> Customer Portal fires the expected webhook; secrets are in Render env vars,
> not committed.

The script + this checklist handle every part of that:

- "Stripe Checkout URL works in test mode" — step 7.1 above.
- "Canceling a test subscription via Customer Portal fires the expected
  webhook" — step 7.2 above.
- "Secrets are in Render env vars, not committed" — step 5 above. The
  script's output explicitly says "DO NOT COMMIT", and `backend/.env.example`
  ships with placeholder values only.
