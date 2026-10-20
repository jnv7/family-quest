/**
 * True when `text` is exactly one emoji (one grapheme cluster that is pictographic), which is
 * what a profile symbol must be (SPEC.md §4). Plain `Intl.Segmenter`, so it needs no emoji list.
 */
export function isSingleEmoji(text: string): boolean {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
  return graphemes.length === 1 && (/\p{Extended_Pictographic}/u.test(text) || /^[0-9#*]\uFE0F?\u20E3$/u.test(text));
}
