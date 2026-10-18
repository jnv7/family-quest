import messagesFile from '../i18n/pt-PT.json';
import { parsePlaceholder, placeholderBodies, type NounForm } from './placeholders';
import type { Gender, LocaleFile, Noun, Theme } from './types';

type Articles = Record<'the' | 'thePlural' | 'a' | 'of' | 'ofPlural' | 'in' | 'inPlural', string>;

const ARTICLES: Record<Gender, Articles> = {
  m: { the: 'o', thePlural: 'os', a: 'um', of: 'do', ofPlural: 'dos', in: 'no', inPlural: 'nos' },
  f: { the: 'a', thePlural: 'as', a: 'uma', of: 'da', ofPlural: 'das', in: 'na', inPlural: 'nas' },
};

/** A noun in one grammatical form; articles and contractions come from its gender. */
export function renderNoun(noun: Noun, form: NounForm): string {
  switch (form) {
    case 'singular':
      return noun.singular;
    case 'plural':
      return noun.plural;
    case 'the':
    case 'a':
    case 'of':
    case 'in':
      return `${ARTICLES[noun.gender][form]} ${noun.singular}`;
    case 'thePlural':
    case 'ofPlural':
    case 'inPlural':
      return `${ARTICLES[noun.gender][form]} ${noun.plural}`;
  }
}

const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export type MessageParams = Record<string, string | number>;

/** Formats `key` from `messages`. Every failure throws an `Error` that names the key. */
export function formatWith(
  messages: LocaleFile['messages'],
  theme: Theme,
  key: string,
  params: MessageParams = {},
): string {
  const template = Object.hasOwn(messages, key) ? messages[key] : undefined;
  if (template === undefined) throw new Error(`Unknown message key "${key}"`);

  try {
    placeholderBodies(template); // rejects stray braces before anything is replaced
    return template.replace(/\{([^{}]*)\}/g, (_match, body: string) => {
      const placeholder = parsePlaceholder(body);
      let text: string;
      if (placeholder.kind === 'role') {
        text = renderNoun(theme.roles[placeholder.role], placeholder.form);
      } else {
        const value = Object.hasOwn(params, placeholder.name) ? params[placeholder.name] : undefined;
        if (value === undefined) throw new Error(`Missing param "${placeholder.name}"`);
        text = String(value);
      }
      return placeholder.capitalise ? upperFirst(text) : text;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot format message "${key}": ${reason}`, { cause: error });
  }
}

/** Formats a neutral interface message with the theme's names (`src/i18n/pt-PT.json`). */
export function formatMessage(theme: Theme, key: string, params?: MessageParams): string {
  return formatWith((messagesFile as LocaleFile).messages, theme, key, params);
}
