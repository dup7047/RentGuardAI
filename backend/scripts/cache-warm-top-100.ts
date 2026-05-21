/**
 * Warm the building-by-bbl cache for the top 100 BBLs.
 *
 * Reads BBLs from backend/scripts/top-100-bbls.txt (one per line) and hits
 * `${BACKEND_URL}/v1/building/<bbl>` for each. Throttles 1 req/sec to stay
 * under the AI provider's rate limit on first generation.
 *
 * Exits 0 when ≥95% of attempts succeed, 1 otherwise.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type BuildingResponse = {
  kind: string;
  summary?: string | null;
  stats?: { hpd_violations_open?: number };
};

async function main() {
  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8080';
  const filePath = resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    'top-100-bbls.txt',
  );
  const bbls = readFileSync(filePath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  let okCount = 0;
  for (const bbl of bbls) {
    try {
      const res = await fetch(`${backendUrl}/v1/building/${bbl}`);
      if (!res.ok) {
        console.log(`[FAIL] ${bbl} · HTTP ${res.status}`);
      } else {
        const body = (await res.json()) as BuildingResponse;
        if (
          body.kind === 'success' &&
          body.stats?.hpd_violations_open != null &&
          body.summary != null
        ) {
          const violations = body.stats.hpd_violations_open;
          const grade =
            violations < 5
              ? 'A'
              : violations < 20
                ? 'B'
                : violations < 50
                  ? 'C'
                  : violations < 100
                    ? 'D'
                    : 'F';
          okCount += 1;
          console.log(`[OK] ${bbl} · grade=${grade} · violations=${violations}`);
        } else {
          console.log(`[FAIL] ${bbl} · missing fields (kind=${body.kind})`);
        }
      }
    } catch (err) {
      console.log(`[FAIL] ${bbl} · ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const total = bbls.length;
  const ratio = total === 0 ? 0 : okCount / total;
  console.log(`\n${okCount}/${total} succeeded (${(ratio * 100).toFixed(0)}%)`);
  if (ratio < 0.95) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
