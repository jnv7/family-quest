/**
 * Theme independence check (CLAUDE.md rule 1, docs/architecture.md §6).
 * Run with `npm run lint:theme-leak`.
 *
 * Scans `src/` (except `src/themes/`), `firebase/`, `schemas/` and `.github/`
 * for the forbidden terms of every theme, as whole words, ignoring case.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Leak {
  file: string;
  line: number;
  term: string;
}

const SCANNED = ['src', 'firebase', 'schemas', '.github'];
const SKIPPED = [join('src', 'themes') + sep];
const IGNORED_NAMES = new Set(['node_modules', '.DS_Store']);

function filesIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return []; // a folder that does not exist has nothing to leak
  }
  return names.flatMap((name) => {
    if (IGNORED_NAMES.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

/** A whole-word matcher: letters (accents included), digits and `_` do not border the term. */
function matcherFor(term: string): RegExp {
  const escaped = term.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
}

/** `terms` maps a theme id to its forbidden terms. */
export function findLeaks(root: string, terms: Record<string, string[]>): Leak[] {
  const matchers = Object.values(terms)
    .flat()
    .map((term) => ({ term, regex: matcherFor(term) }));
  const leaks: Leak[] = [];
  for (const folder of SCANNED) {
    for (const path of filesIn(join(root, folder))) {
      const file = relative(root, path);
      if (SKIPPED.some((skipped) => file.startsWith(skipped))) continue;
      const content = readFileSync(path, 'utf8');
      if (content.includes('\0')) continue; // binary
      content
        .normalize('NFC')
        .split('\n')
        .forEach((text, index) => {
          for (const { term, regex } of matchers) if (regex.test(text)) leaks.push({ file, line: index + 1, term });
        });
    }
  }
  return leaks;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const terms = JSON.parse(readFileSync(join('scripts', 'theme-leak-terms.json'), 'utf8')) as Record<string, string[]>;
  const leaks = findLeaks(process.argv[2] ?? process.cwd(), terms);
  for (const leak of leaks) console.error(`${leak.file}:${leak.line}: theme term "${leak.term}"`);
  if (leaks.length > 0) process.exit(1);
  console.log('lint:theme-leak passed');
}
