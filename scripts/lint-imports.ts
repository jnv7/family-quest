/**
 * Layer check (docs/architecture.md §1): no file outside `src/data/firestore/`
 * may import `firebase/*`. Run with `npm run lint:imports`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Violation {
  file: string;
  line: number;
  text: string;
}

const ALLOWED_DIR = join('src', 'data', 'firestore') + sep;
const FIREBASE_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]firebase(?:\/[^'"]*)?['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

/** Scans `<root>/src` and returns every forbidden import. */
export function findViolations(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const path of sourceFiles(join(root, 'src'))) {
    const file = relative(root, path);
    if (file.startsWith(ALLOWED_DIR)) continue;
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        if (FIREBASE_IMPORT.test(text)) violations.push({ file, line: index + 1, text: text.trim() });
      });
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = findViolations(process.argv[2] ?? process.cwd());
  for (const v of violations) console.error(`${v.file}:${v.line}: imports firebase outside src/data/firestore/: ${v.text}`);
  if (violations.length > 0) process.exit(1);
  console.log('lint:imports passed');
}
