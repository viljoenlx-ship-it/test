import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = [
  join(import.meta.dirname, '../../../apps/web/src'),
  join(import.meta.dirname, '../../../apps/control-panel/src'),
  join(import.meta.dirname, '../src/copy.ts'),
];

const banned = [/openai/i, /\bgpt\b/i, /\bai\b/i, /chatgpt/i];

async function filesIn(path: string): Promise<string[]> {
  const stat = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!stat) {
    return [path];
  }
  const found: string[] = [];
  for (const entry of stat) {
    const next = join(path, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await filesIn(next)));
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      found.push(next);
    }
  }
  return found;
}

describe('user-facing wording', () => {
  it('does not mention a model or a provider', async () => {
    const paths = (await Promise.all(roots.map((root) => filesIn(root)))).flat();
    const hits: string[] = [];
    for (const path of paths) {
      const text = await readFile(path, 'utf8');
      for (const pattern of banned) {
        if (pattern.test(text)) {
          hits.push(`${path} matches ${pattern}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
