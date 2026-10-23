import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, recurringTaskId } from './model';
import { tokenRulesProblem } from './tokens';

describe('recurringTaskId', () => {
  it('joins definition, period and profile', () => {
    expect(recurringTaskId('defA', '2026-W53', 'p1')).toBe('defA_2026-W53_p1');
  });
});

describe('DEFAULT_RULESET', () => {
  it('has token rules that tokenRulesProblem accepts', () => {
    expect(tokenRulesProblem(DEFAULT_RULESET)).toBeNull();
  });
});
