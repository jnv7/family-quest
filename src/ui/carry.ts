import type { WorldId } from '../core/model';
import type { AppContext, Dispose } from './context';
import type { Carry } from './routes';
import { observeSelf } from './self';

/** What the page's address should carry for the home screen app, or null for nothing (ADR 0014). */
export type CarryWriter = (carry: (Carry & { themeId: string }) | null) => void;

/**
 * On an iPhone, a home screen app has storage of its own, so one added from Safari starts with no world. What it
 * does start with is the address the page had when it was added. So, in a browser tab on iOS, this keeps the
 * address carrying the world and the active profile of this device (`?join=`), and the theme (`?theme=`); the
 * installed app reads it once and joins by itself. Everywhere else it does nothing.
 */
export function createCarryKeeper(ctx: AppContext, write: CarryWriter): { follow(worldId: WorldId | null): void; stop: Dispose } {
  const { platform } = ctx.installer;
  const active = platform.isIos && !platform.isStandalone;
  let watched: WorldId | null = null;
  let stopSelf: Dispose = () => {};

  return {
    follow(worldId) {
      if (!active || worldId === watched) return;
      stopSelf();
      watched = worldId;
      if (worldId === null) return write(null);
      stopSelf = observeSelf(ctx, worldId, ({ profile }) =>
        write(profile ? { worldId, profileId: profile.id, themeId: ctx.theme.id } : null),
      );
    },
    stop() {
      stopSelf();
    },
  };
}
