import { describe, expect, it } from 'vitest';
import { isSingleEmoji } from './emoji';

describe('isSingleEmoji', () => {
  it.each(['🐬', '⭐', '🏴‍☠️', '🗺️', '👨‍👩‍👧', '❤️', '1️⃣', '#️⃣'])('accepts %s', (symbol) => expect(isSingleEmoji(symbol)).toBe(true));
  it.each(['', 'x', '1', 'ab', '🐬🦀', '🐬 ', ' ', 'ok🐬'])('refuses "%s"', (symbol) => expect(isSingleEmoji(symbol)).toBe(false));
});
