# SEO Cost Optimization — Deferred (Phase 3.10b)

## Current approach (Phase 3.10)

Every `/v1/building/:bbl` request generates a real-time AI summary if none exists in `building_lookups`. This is fine for the first few hundred buildings but becomes expensive at scale.

**Trigger for this runbook:** Archive ≥ 1,000 buildings AND monthly OpenAI spend ≥ $50.

---

## Deferred: Batch API approach

Once the archive is large enough, switch the SEO summary path to the **OpenAI Batch API** (`/v1/batches`):

- Cost: 50% off vs real-time Chat Completions (`$0.075/M input`, `$0.30/M output`)
- Turnaround: up to 24h (acceptable for ISR pages)
- Daily cron (4:00 UTC, via `pg_cron`) queues BBLs without summaries

### Pseudocode

```ts
// cron-seed-summaries.ts (Phase 3.10b)
// Finds up to 500 BBLs without an ai_summary in building_lookups.
// Uploads a JSONL batch file to OpenAI /v1/files.
// Creates /v1/batches job.
// Stores batch_id in a new batch_jobs table.
// A second cron (hourly) polls status and writes results back to building_lookups.

async function queueBatch() {
  const bbls = await db.query(`
    SELECT b.bbl, b.address, b.borough
    FROM buildings b
    LEFT JOIN building_lookups l ON l.building_bbl = b.bbl AND l.ai_summary IS NOT NULL
    WHERE l.id IS NULL
    LIMIT 500
  `);
  if (bbls.length === 0) return;

  const lines = bbls.map((b, i) => JSON.stringify({
    custom_id: b.bbl,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(b) },
      ],
      max_completion_tokens: 1000,
      response_format: { type: 'json_object' },
    },
  }));

  // Upload JSONL file
  const file = await openai.files.create({ purpose: 'batch', file: lines.join('\n') });
  const batch = await openai.batches.create({ input_file_id: file.id, endpoint: '/v1/chat/completions', completion_window: '24h' });
  await db.query('INSERT INTO batch_jobs (batch_id, status, bbl_count) VALUES ($1, $2, $3)', [batch.id, 'pending', bbls.length]);
}
```

### Schema additions (Phase 3.10b)

```sql
CREATE TABLE public.batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending', -- pending, completed, failed
  bbl_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
```

### Cost estimate at 10,000 BBLs

- avg prompt: ~400 tokens · avg completion: ~250 tokens
- batch pricing: $0.075/M input + $0.30/M output
- 10k BBLs: (400k × 0.075/1M) + (250k × 0.30/1M) = $0.03 + $0.075 = **$0.105 total**

At 1,000 new BBLs/month this adds ~$0.01/month indefinitely — negligible.

---

## Implementation checklist (when trigger fires)

- [ ] Create `batch_jobs` table migration (0010)
- [ ] `backend/scripts/queue-batch.ts` — queues nightly batch
- [ ] `backend/scripts/poll-batch.ts` — writes results to building_lookups
- [ ] Add pg_cron schedules for both scripts
- [ ] Update verify-restore.ts to assert batch_jobs table
- [ ] Update RUNBOOK.md §10 with batch cost monitoring
