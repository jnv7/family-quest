import { Timestamp, type DocumentSnapshot } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET } from '../../core/model';
import { decodeProfile, decodeTask, decodeWorld } from './converters';

const snapshot = (id: string, data: Record<string, unknown>) =>
  ({ id, data: () => data, ref: { path: `worlds/w/x/${id}` } }) as unknown as DocumentSnapshot;
const meta = { schemaVersion: 1, createdAt: Timestamp.fromMillis(5) };

describe('decodeWorld', () => {
  const { tokensPerLevel: _a, tokenPrices: _b, ...stored } = DEFAULT_RULESET;

  it('fills in the token rules of a world stored before 0.9', () => {
    const world = decodeWorld(snapshot('w', { name: 'Home', themeId: 'x', createdBy: 'u', ruleset: stored, ...meta }));
    expect(world?.ruleset).toEqual(DEFAULT_RULESET);
  });

  it('keeps the token rules a world has', () => {
    const tokenPrices = { low: 6, mid: 10, high: 30 };
    const world = decodeWorld(snapshot('w', { name: 'Home', themeId: 'x', createdBy: 'u', ruleset: { ...stored, tokenPrices }, ...meta }));
    expect(world?.ruleset.tokenPrices).toEqual(tokenPrices);
  });
});

describe('decodeProfile', () => {
  it('drops the balance and its reasons, which only observeBalance reads', () => {
    const profile = decodeProfile(
      snapshot('p', {
        displayName: 'Sam',
        kind: 'child',
        avatar: {},
        partyIds: [],
        archived: false,
        tokens: 7,
        tokensFrom: 't1',
        tokensFor: 'r1',
        ...meta,
      }),
    );
    expect(profile).not.toHaveProperty('tokens');
    expect(profile).not.toHaveProperty('tokensFrom');
    expect(profile).not.toHaveProperty('tokensFor');
    expect(profile).toMatchObject({ id: 'p', displayName: 'Sam' });
  });
});

describe('decodeTask', () => {
  it('reads a retired task', () => {
    const task = decodeTask(
      snapshot('t', { status: 'retired', doneAt: null, retiredAt: Timestamp.fromMillis(9), retiredBy: 'p', ...meta }),
    );
    expect(task).toMatchObject({ status: 'retired', retiredAt: 9, retiredBy: 'p' });
  });

  it('reads the tokens of a done task', () => {
    const task = decodeTask(snapshot('t', { status: 'done', doneAt: Timestamp.fromMillis(9), tokens: 2, ...meta }));
    expect(task).toMatchObject({ status: 'done', tokens: 2, doneAt: 9 });
  });
});
