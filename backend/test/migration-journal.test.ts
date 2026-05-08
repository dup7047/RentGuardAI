import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JOURNAL_PATH = resolve(HERE, '../drizzle/meta/_journal.json');

describe('drizzle migration journal', () => {
  it('includes the value-score column migration used by lookup routes', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string }>;
    };

    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0017_value_score_columns',
    );
  });
});
