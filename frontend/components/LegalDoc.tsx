import { promises as fs } from 'node:fs';
import path from 'node:path';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type LegalSlug = 'terms' | 'privacy' | 'disclaimer';

const LEGAL_DIR = path.join(process.cwd(), '..', 'docs', 'legal');

export async function LegalDoc({ slug }: { slug: LegalSlug }) {
  const md = await fs.readFile(path.join(LEGAL_DIR, `${slug}.md`), 'utf8');
  return (
    <article className="legal-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </article>
  );
}
