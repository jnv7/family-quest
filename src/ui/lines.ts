import type { RandomInt } from '../core/model';

/** One of the character's lines, picked at random. A theme always has at least one of each kind (schema). */
export function pickLine(lines: readonly string[], randomInt: RandomInt): string {
  const line = lines[randomInt(lines.length)];
  if (line === undefined) throw new Error('The theme has no line to say');
  return line;
}
