import { describe, expect, it } from 'vitest';
import { isNewerBuild, type Build } from './build';

const build = (builtAt: number): Build => ({ version: '0.10.0', builtAt, commit: 'abc1234' });

describe('isNewerBuild', () => {
  it('is true only for a build made after the running one', () => {
    expect(isNewerBuild(build(100), build(101))).toBe(true);
    expect(isNewerBuild(build(100), build(100))).toBe(false);
    expect(isNewerBuild(build(100), build(99))).toBe(false);
  });

  it('counts a newer build of the same version', () => {
    expect(isNewerBuild({ ...build(100), version: '0.10.5' }, { ...build(200), version: '0.10.5' })).toBe(true);
  });
});
