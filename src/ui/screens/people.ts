import { LIMITS, type Profile, type ProfileKind } from '../../core/model';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { createInvite } from '../invite';
import { observeSelf } from '../self';
import { screenBar } from '../bar';

/** People, for admins only (SPEC.md §7.8): the profiles with rename, archive and reactivate, a new profile, and the invite. */
export const renderPeople: WorldScreen = (ctx, root, { worldId }) => {
  const list = h('ul', { class: 'rows' });
  const invite = h('div', { class: 'stack' });
  let profiles: readonly Profile[] = [];
  /** The profile being renamed, if any; kept while the list is drawn again. */
  let renaming: string | null = null;

  const name = h('input', { type: 'text', required: true, maxLength: LIMITS.displayName, autocomplete: 'off' });
  const kind = h('select', {},
    h('option', { value: 'child' }, ctx.text('people.kindChild')),
    h('option', { value: 'adult' }, ctx.text('people.kindAdult')),
  );
  const symbol = h('select', {},
    h('option', { value: '' }, ctx.text('people.symbolNone')),
    ...ctx.theme.profileSymbols.map((emoji) => h('option', { value: emoji }, emoji)),
  );
  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('people.name'), name),
    h('label', {}, ctx.text('people.kind'), kind),
    h('label', {}, ctx.text('people.symbol'), symbol),
    h('button', { class: 'primary', type: 'submit' }, ctx.text('people.add')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const displayName = name.value.trim();
    if (!displayName) return;
    ctx.settle(ctx.store.worlds.createProfile(worldId, { displayName, kind: kind.value as ProfileKind, symbol: symbol.value || null }).settled);
    form.reset();
  });

  const renameRow = (profile: Profile) => {
    const input = h('input', { type: 'text', required: true, maxLength: LIMITS.displayName, autocomplete: 'off', value: profile.displayName, 'aria-label': ctx.text('people.name') });
    const row = h('form', { class: 'rename' },
      input,
      h('button', { class: 'primary', type: 'submit' }, ctx.text('people.renameSave')),
      h('button', { type: 'button', onClick: () => ((renaming = null), draw()) }, ctx.text('people.renameCancel')),
    );
    row.addEventListener('submit', (event) => {
      event.preventDefault();
      const displayName = input.value.trim();
      if (!displayName) return;
      renaming = null;
      ctx.settle(ctx.store.worlds.renameProfile(worldId, profile.id, displayName).settled);
      draw();
    });
    queueMicrotask(() => input.focus());
    return h('li', {}, row);
  };

  function draw(): void {
    list.replaceChildren(
      ...profiles.map((profile) =>
        profile.id === renaming
          ? renameRow(profile)
          : h('li', {},
              h('span', {}, profile.displayName, profile.archived && ` (${ctx.text('people.archivedTag')})`),
              h('button', { onClick: () => ((renaming = profile.id), draw()) }, ctx.text('people.rename')),
              // Only child profiles can be archived, so a world always keeps an admin (SPEC.md §4).
              profile.kind === 'child' &&
                h('button', {
                  onClick: () => ctx.settle(ctx.store.worlds.setProfileArchived(worldId, profile.id, !profile.archived).settled),
                }, ctx.text(profile.archived ? 'people.unarchive' : 'people.archive')),
            ),
      ),
    );
  }

  const inviteButton = h('button', {
    onClick: () => {
      if (invite.childElementCount > 0) return invite.replaceChildren();
      invite.replaceChildren(createInvite(ctx, worldId));
    },
  }, ctx.text('people.invite'));

  root.append(
    screenBar(ctx, { title: ctx.text('people.title'), back: { name: 'map' }, action: inviteButton }),
    invite,
    list,
    h('h2', {}, ctx.text('people.newProfile')),
    form,
  );

  const stopSelf = observeSelf(ctx, worldId, ({ profiles: value, isAdmin }) => {
    if (!isAdmin) {
      ctx.go({ name: 'map' }, { replace: true });
      return;
    }
    profiles = value;
    if (renaming === null || document.activeElement?.closest('.rename') === null) draw();
  });
  return stopSelf;
};
