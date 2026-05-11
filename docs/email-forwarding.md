# Email Forwarding Setup

All project email addresses on `rentguard.nyc` and `rentguard.cc` forward to
**dantino12@gmail.com** via [ForwardEmail.net](https://forwardemail.net).

## Addresses

| Address | Domain |
|---|---|
| support@rentguard.nyc | rentguard.nyc |
| privacy@rentguard.nyc | rentguard.nyc |
| legal@rentguard.nyc | rentguard.nyc |
| ops@rentguard.nyc | rentguard.nyc |
| corrections@rentguard.cc | rentguard.cc |
| owners@rentguard.cc | rentguard.cc |
| lease-review-waitlist@rentguard.cc | rentguard.cc |
| firms@rentguard.cc | rentguard.cc |
| noreply@rentguard.cc | rentguard.cc |

---

## One-time DNS setup (do this at your registrar for each domain)

### MX records (same for both domains)

| Type | Priority | Value |
|---|---|---|
| MX | 10 | mx1.forwardemail.net |
| MX | 20 | mx2.forwardemail.net |

Remove any existing MX records before adding these.

### TXT record — domain verification

ForwardEmail generates a unique verification token per domain. Get it from:

> **ForwardEmail dashboard → My Account → Domains → _your domain_ → DNS Records**

Add it as a TXT record on the root (`@`) of each domain:

```
"forward-email-site-verification=<token>"
```

### TXT record — catch-all fallback (optional)

If you want any unrecognised address on a domain to also forward (catch-all),
add a second TXT record on the root:

```
"forward-email=dantino12@gmail.com"
```

---

## Alias configuration (run once after DNS propagates)

1. Create a free ForwardEmail account at <https://forwardemail.net>.
2. Add both domains inside the dashboard and verify them.
3. Grab your API key from **My Account → Security**.
4. Set it in `backend/.env`:

   ```
   FORWARDEMAIL_API_KEY=your_key_here
   ```

5. Run the setup script from the `backend/` directory:

   ```bash
   npm run email:forwarding
   ```

   The script is idempotent — re-running it is safe (existing aliases return
   HTTP 409 and are counted as success).

---

## Verifying forwarding works

Send a test email to any address above from an external mail client. It should
arrive at dantino12@gmail.com within a few seconds. ForwardEmail's dashboard
also shows delivery logs per domain.

---

## Changing the forwarding destination

Pass `FORWARD_TO_EMAIL` when running the script:

```bash
FORWARD_TO_EMAIL=new@example.com npm run email:forwarding
```

This creates/updates all aliases to point to the new address.
