import { describe, expect, it } from 'vitest';
import { formatWith } from './format';
import { formatMessage, loadTheme, renderNoun } from './index';
import { ROLES } from './placeholders';
import type { Noun, Theme } from './types';
import themeSchema from '../../schemas/theme.schema.json';

const theme = loadTheme('minimal');

const masculine: Noun = { singular: 'cofre', plural: 'cofres', gender: 'm' };
const feminine: Noun = { singular: 'casa', plural: 'casas', gender: 'f' };

describe('renderNoun', () => {
  it.each([
    ['singular', 'cofre', 'casa'],
    ['plural', 'cofres', 'casas'],
    ['the', 'o cofre', 'a casa'],
    ['thePlural', 'os cofres', 'as casas'],
    ['a', 'um cofre', 'uma casa'],
    ['of', 'do cofre', 'da casa'],
    ['ofPlural', 'dos cofres', 'das casas'],
    ['in', 'no cofre', 'na casa'],
    ['inPlural', 'nos cofres', 'nas casas'],
  ] as const)('%s', (form, m, f) => {
    expect(renderNoun(masculine, form)).toBe(m);
    expect(renderNoun(feminine, form)).toBe(f);
  });
});

const withRoles = (reward: Noun): Theme => ({ ...theme, roles: { ...theme.roles, reward } });

describe('formatWith', () => {
  const messages = {
    'a.plain': '{@reward}',
    'a.the': '{@reward.the}',
    'a.cap': '{^@reward.the} chegou',
    'a.param': 'Olá, {name}!',
    'a.capParam': '{^name}',
    'a.number': 'Dia {day}',
    'b.unknownRole': '{@dragon.the}',
    'b.unknownForm': '{@reward.whenever}',
    'b.missing': 'Olá, {name}!',
    'b.malformed': '{@reward.the',
    'b.stray': 'olá }',
  };

  it('uses the noun gender', () => {
    expect(formatWith(messages, withRoles(masculine), 'a.the')).toBe('o cofre');
    expect(formatWith(messages, withRoles(feminine), 'a.the')).toBe('a casa');
    expect(formatWith(messages, withRoles(feminine), 'a.plain')).toBe('casa');
  });

  it('capitalises the first letter with ^', () => {
    expect(formatWith(messages, withRoles(masculine), 'a.cap')).toBe('O cofre chegou');
    expect(formatWith(messages, theme, 'a.capParam', { name: 'rita' })).toBe('Rita');
  });

  it('fills runtime params', () => {
    expect(formatWith(messages, theme, 'a.param', { name: 'Rita' })).toBe('Olá, Rita!');
    expect(formatWith(messages, theme, 'a.number', { day: 7 })).toBe('Dia 7');
  });

  it.each([
    ['unknown key', 'nope.nothing', 'Unknown message key "nope.nothing"'],
    ['unknown role', 'b.unknownRole', 'Unknown role "dragon"'],
    ['unknown form', 'b.unknownForm', 'Unknown form "whenever"'],
    ['missing param', 'b.missing', 'Missing param "name"'],
    ['unclosed placeholder', 'b.malformed', 'Unbalanced braces'],
    ['stray brace', 'b.stray', 'Unbalanced braces'],
  ])('throws for %s, naming the key', (_label, key, reason) => {
    expect(() => formatWith(messages, theme, key)).toThrow(key);
    expect(() => formatWith(messages, theme, key)).toThrow(reason);
  });
});

describe('formatMessage', () => {
  it('formats the start page messages with the minimal theme', () => {
    expect(formatMessage(theme, 'app.name')).toBe('Missões da família');
    expect(formatMessage(theme, 'app.underConstruction')).toBe(
      'Em construção. Em breve poderás ver o quadro e abrir o cofre.',
    );
    expect(formatMessage(theme, 'app.version', { version: '0.1.6' })).toBe('Versão 0.1.6');
  });
});

describe('loadTheme', () => {
  it('returns the theme with its catalogue', () => {
    expect(theme.id).toBe('minimal');
    expect(theme.catalog.slots.length).toBeGreaterThanOrEqual(9);
  });

  it('fails explicitly for an unknown theme', () => {
    expect(() => loadTheme('nope')).toThrow('Unknown theme "nope"');
  });

  it('names exactly the roles of the theme schema', () => {
    expect([...ROLES].sort()).toEqual([...themeSchema.properties.roles.required].sort());
  });
});
