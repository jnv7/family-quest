import { describe, expect, it } from 'vitest';
import { isSingleEmoji } from '../core/emoji';
import groups from './emoji.json';

describe('the emoji of the symbol picker', () => {
  const all = groups.flatMap((group) => group.emojis);

  it('has every group with emoji, and no repeats', () => {
    expect(groups.map((group) => group.id)).toEqual(['smileys', 'people', 'animals', 'food', 'travel', 'activities', 'objects', 'symbols']);
    expect(groups.every((group) => group.emojis.length > 50)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it('holds only single emoji, so any of them is accepted as a profile symbol', () => {
    expect(all.filter((emoji) => !isSingleEmoji(emoji))).toEqual([]);
  });

  it('has no skin tone variants or flags', () => {
    expect(all.filter((emoji) => /[\u{1F3FB}-\u{1F3FF}]/u.test(emoji))).toEqual([]);
    expect(all.filter((emoji) => /\p{Regional_Indicator}/u.test(emoji))).toEqual([]);
  });
});
