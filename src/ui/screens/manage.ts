import { LIMITS, type ProfileKind } from '../../core/model';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeSelf } from '../self';

/** Management, for admins only (SPEC.md §7.8): profiles now, task definitions later. */
export const renderManage: WorldScreen = (ctx, root, { worldId }) => {
  const list = h('ul', { class: 'rows' });

  const name = h('input', { type: 'text', required: true, maxLength: LIMITS.displayName, autocomplete: 'off' });
  const kind = h('select', {},
    h('option', { value: 'child' }, ctx.text('manage.kindChild')),
    h('option', { value: 'adult' }, ctx.text('manage.kindAdult')),
  );
  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('manage.name'), name),
    h('label', {}, ctx.text('manage.kind'), kind),
    h('button', { class: 'primary', type: 'submit' }, ctx.text('manage.add')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const displayName = name.value.trim();
    if (!displayName) return;
    ctx.settle(ctx.store.worlds.createProfile(worldId, { displayName, kind: kind.value as ProfileKind }).settled);
    form.reset();
  });

  root.append(
    h('h1', {}, ctx.text('manage.title')),
    h('h2', {}, ctx.text('manage.profiles')),
    list,
    h('h2', {}, ctx.text('manage.newProfile')),
    form,
    h('div', { class: 'stack' },
      h('button', { onClick: () => ctx.go({ name: 'share' }) }, ctx.text('manage.invite')),
      h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back')),
    ),
  );

  return observeSelf(ctx, worldId, ({ profiles, isAdmin }) => {
    if (!isAdmin) {
      ctx.go({ name: 'map' }, { replace: true });
      return;
    }
    list.replaceChildren(
      ...profiles.map((profile) =>
        h('li', {},
          h('span', {}, profile.displayName, profile.archived && ` (${ctx.text('manage.archivedTag')})`),
          // Only child profiles can be archived, so a world always keeps an admin (SPEC.md §4).
          profile.kind === 'child' &&
            h('button', {
              onClick: () => ctx.settle(ctx.store.worlds.setProfileArchived(worldId, profile.id, !profile.archived).settled),
            }, ctx.text(profile.archived ? 'manage.unarchive' : 'manage.archive')),
        ),
      ),
    );
  });
};
