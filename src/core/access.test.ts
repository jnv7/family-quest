import { describe, expect, it } from 'vitest';
import { activeProfileOf, isAdmin } from './access';
import type { Member, Profile } from './model';

const meta = { schemaVersion: 1, createdAt: 0 } as const;
const profile = (id: string, kind: Profile['kind'], archived = false): Profile => ({
  ...meta,
  id,
  displayName: id,
  kind,
  avatar: { body: 0, hair: 0, outfit: 0, accessory: 0 },
  partyIds: [],
  archived,
});
const member = (uid: string, profileId: string | null): Member => ({ ...meta, uid, profileId });

describe('isAdmin', () => {
  it('is true only for a non-archived adult profile', () => {
    expect(isAdmin(profile('a', 'adult'))).toBe(true);
    expect(isAdmin(profile('a', 'adult', true))).toBe(false);
    expect(isAdmin(profile('c', 'child'))).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

describe('activeProfileOf', () => {
  const profiles = [profile('a', 'adult'), profile('c', 'child')];

  it('finds the profile chosen by the device', () => {
    expect(activeProfileOf('u1', [member('u1', 'c'), member('u2', 'a')], profiles)?.id).toBe('c');
  });

  it('is null without a membership, without a choice, or with an unknown profile', () => {
    expect(activeProfileOf('u1', [], profiles)).toBeNull();
    expect(activeProfileOf('u1', [member('u1', null)], profiles)).toBeNull();
    expect(activeProfileOf('u1', [member('u1', 'gone')], profiles)).toBeNull();
  });
});
