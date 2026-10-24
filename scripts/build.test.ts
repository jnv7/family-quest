import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { createBuild } from './build-info';

describe('createBuild', () => {
  it('reads the version, stamps the time, and shortens the commit', () => {
    expect(createBuild({ packageJson: 'package.json', env: { GITHUB_SHA: 'abcdef0123456' }, now: () => 42 })).toMatchObject({
      builtAt: 42,
      commit: 'abcdef0',
    });
  });

  it('says `local` outside CI', () => {
    expect(createBuild({ packageJson: 'package.json', env: {}, now: () => 1 }).commit).toBe('local');
  });
});

describe('a real build', () => {
  const out = mkdtempSync(join(tmpdir(), 'fq-build-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('publishes version.json, injects the same build, and keeps the file out of the precache', async () => {
    await viteBuild({ logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });

    const published = JSON.parse(readFileSync(join(out, 'version.json'), 'utf8')) as { version: string; builtAt: number; commit: string };
    expect(published.version).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
    expect(Number.isInteger(published.builtAt)).toBe(true);

    const scripts = readdirSync(join(out, 'assets')).filter((name) => name.endsWith('.js'));
    const code = scripts.map((name) => readFileSync(join(out, 'assets', name), 'utf8')).join('\n');
    expect(code).toContain(String(published.builtAt));

    const worker = readFileSync(join(out, 'sw.js'), 'utf8');
    expect(worker).not.toContain('version.json');
  }, 120_000);
});
