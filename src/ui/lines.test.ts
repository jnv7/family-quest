import { describe, expect, it } from 'vitest';
import { pickLine } from './lines';

describe('pickLine', () => {
  it('picks the line at the random index', () => {
    expect(pickLine(['a', 'b', 'c'], () => 2)).toBe('c');
  });

  it('asks for an index within the number of lines', () => {
    let asked = 0;
    pickLine(['a', 'b'], (max) => ((asked = max), 0));
    expect(asked).toBe(2);
  });

  it('fails explicitly when there is nothing to say', () => {
    expect(() => pickLine([], () => 0)).toThrow('no line');
  });
});
