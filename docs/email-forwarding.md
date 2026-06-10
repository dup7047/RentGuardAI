# Email Forwarding Setup

Project email addresses on `rentguard.cc` forward to the destination inbox (configured via `FORWARD_TO_EMAIL`) through Cloudflare Email Routing.

## Addresses

| Address | Domain |
|---|---|
| support@rentguard.cc | rentguard.cc |
| privacy@rentguard.cc | rentguard.cc |
| legal@rentguard.cc | rentguard.cc |
| ops@rentguard.cc | rentguard.cc |
| security@rentguard.cc | rentguard.cc |
| corrections@rentguard.cc | rentguard.cc |
| owners@rentguard.cc | rentguard.cc |
| lease-review-waitlist@rentguard.cc | rentguard.cc |
| search-pass-waitlist@rentguard.cc | rentguard.cc |
| firms@rentguard.cc | rentguard.cc |
| noreply@rentguard.cc | rentguard.cc |

---

## One-time Cloudflare setup

1. Add `rentguard.cc` to Cloudflare and confirm it uses Cloudflare nameservers.
2. Open **Email → Email Routing** for the zone and enable routing.
3. Add and verify the destination address (the inbox you set in `FORWARD_TO_EMAIL`).
4. Create an API token with **Zone → Email Routing Rules → Edit** scoped to `rentguard.cc`.

## Alias configuration

Set the API token in `backend/.env`:

```bash
CLOUDFLARE_API_TOKEN=your_token_here
```

Run the setup script from the `backend/` directory:

```bash
npm run email:forwarding
```

The script is idempotent. Existing aliases are treated as success.

## Verifying forwarding works

Send a test email to any address above from an external mail client. It should arrive at the destination inbox within a few seconds. Cloudflare's Email Routing dashboard also shows routing events for the domain.

## Changing the forwarding destination

Pass `FORWARD_TO_EMAIL` when running the script:

```bash
FORWARD_TO_EMAIL=new@example.com npm run email:forwarding
```

This creates or updates all aliases to point to the new address.
