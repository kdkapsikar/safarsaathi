import { readFileSync } from 'node:fs';

export interface HelpTopic {
  title: string;
  keywords: string[];
  body: string;
}

const HELP_FILE = new URL('../../../docs/site-help.md', import.meta.url);

/** Parses docs/site-help.md: "## Title", a "keywords:" line, then the body. */
export function parseHelp(markdown: string): HelpTopic[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [title, ...rest] = section.split('\n');
      const kwLine = rest.find((l) => l.startsWith('keywords:')) ?? '';
      const body = rest
        .filter((l) => !l.startsWith('keywords:'))
        .join('\n')
        .trim();
      return {
        title: title!.trim(),
        keywords: kwLine
          .replace('keywords:', '')
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
        body,
      };
    });
}

let cached: HelpTopic[] | null = null;
export function loadHelp(): HelpTopic[] {
  cached ??= parseHelp(readFileSync(HELP_FILE, 'utf8'));
  return cached;
}

/** Best-matching topics for a free-text query. */
export function searchHelp(query: string, topics = loadHelp(), limit = 2): HelpTopic[] {
  const q = query.toLowerCase();
  const words = q.split(/\W+/).filter((w) => w.length > 2);
  return topics
    .map((t) => ({
      t,
      score:
        t.keywords.reduce((n, k) => n + (q.includes(k) ? 3 : 0), 0) +
        words.reduce((n, w) => n + (t.title.toLowerCase().includes(w) ? 1 : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}
