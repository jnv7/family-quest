/**
 * Grammar of the placeholders in interface messages (docs/architecture.md §6).
 *
 * This file has no imports besides types, so `scripts/validate-theme.ts` can
 * run it directly with Node and share the exact same parser as the app.
 */

export const ROLES = [
  'world',
  'profile',
  'board',
  'checkin',
  'home',
  'vault',
  'showcase',
  'reward',
  'collectible',
  'party',
  'reserve',
  'token',
] as const;
export type Role = (typeof ROLES)[number];

/** `singular` is the default form of `{@role}`. */
export const NOUN_FORMS = ['singular', 'plural', 'the', 'thePlural', 'a', 'of', 'ofPlural', 'in', 'inPlural'] as const;
export type NounForm = (typeof NOUN_FORMS)[number];

export type Placeholder = { capitalise: boolean } & (
  | { kind: 'param'; name: string }
  | { kind: 'role'; role: Role; form: NounForm }
);

export class PlaceholderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaceholderError';
  }
}

const PARAM_NAME = /^[a-z][A-Za-z0-9]*$/;

/** Parses the text between the braces, such as `^@reward.the` or `name`. */
export function parsePlaceholder(body: string): Placeholder {
  const capitalise = body.startsWith('^');
  const text = capitalise ? body.slice(1) : body;

  if (text.startsWith('@')) {
    const [role, form = 'singular', ...extra] = text.slice(1).split('.');
    if (extra.length > 0) throw new PlaceholderError(`Malformed placeholder "{${body}}"`);
    if (!(ROLES as readonly string[]).includes(role ?? '')) throw new PlaceholderError(`Unknown role "${role}" in "{${body}}"`);
    if (!(NOUN_FORMS as readonly string[]).includes(form)) {
      throw new PlaceholderError(`Unknown form "${form}" for role "${role}" in "{${body}}"`);
    }
    return { kind: 'role', capitalise, role: role as Role, form: form as NounForm };
  }
  if (PARAM_NAME.test(text)) return { kind: 'param', capitalise, name: text };
  throw new PlaceholderError(`Malformed placeholder "{${body}}"`);
}

/** The bodies of every `{...}` in a template. Stray braces are an error. */
export function placeholderBodies(template: string): string[] {
  const bodies: string[] = [];
  const rest = template.replace(/\{([^{}]*)\}/g, (_match, body: string) => {
    bodies.push(body);
    return '';
  });
  if (/[{}]/.test(rest)) throw new PlaceholderError(`Unbalanced braces in "${template}"`);
  return bodies;
}
