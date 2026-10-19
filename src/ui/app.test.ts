// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRandomInt } from '../core/random';
import { DataStoreError, type DataStore } from '../data/DataStore';
import { createMemoryBackend, createMemoryStore } from '../data/memory';
import { loadTheme } from '../theme';
import { startApp } from './app';
import { memoryNavigation } from './navigation';
import { createWorldMemory } from './worldMemory';

const BASE_URL = 'https://example.org/family-quest/';
const randomInt = createRandomInt((array) => crypto.getRandomValues(array));
const theme = loadTheme('minimal');

/** One clock for every device, so tests can move time. */
let now = Date.parse('2026-10-20T10:00:00Z');
const clock = () => now;

let backend = createMemoryBackend();
let stops: Array<() => void> = [];

/** One device: its own store, remembered world and screen, sharing the backend. */
async function openDevice(
  uid: string,
  options: { hash?: string; savedWorld?: string; wrap?: (store: DataStore) => DataStore } = {},
) {
  const storage = new Map<string, string>();
  const world = createWorldMemory({
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => void storage.set(k, v),
    removeItem: (k) => void storage.delete(k),
  });
  if (options.savedWorld) world.set(options.savedWorld);
  const root = document.createElement('main');
  document.body.append(root);
  const store = (options.wrap ?? ((s) => s))(createMemoryStore(backend, { uid, clock, randomInt }));
  stops.push(await startApp({ root, store, theme, baseUrl: BASE_URL, world, clock, navigation: memoryNavigation(options.hash ?? '') }));

  const find = (selector: string, text?: string) =>
    [...root.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || el.textContent?.includes(text));
  return {
    root,
    world,
    find,
    click: async (selector: string, text: string) => {
      await vi.waitFor(() => expect(find(selector, text), `${selector} "${text}"`).toBeDefined());
      find(selector, text)!.click();
    },
    type: async (label: string, value: string) => {
      const field = () => [...root.querySelectorAll('label')].find((l) => l.textContent?.includes(label))?.querySelector('input');
      await vi.waitFor(() => expect(field(), `field "${label}"`).toBeTruthy());
      field()!.value = value;
    },
    choose: async (label: string, value: string) => {
      const field = () => [...root.querySelectorAll('label')].find((l) => l.textContent?.includes(label))?.querySelector('select');
      await vi.waitFor(() => expect(field(), `select "${label}"`).toBeTruthy());
      const option = [...field()!.options].find((o) => o.textContent === value);
      if (!option) throw new Error(`No option "${value}" in "${label}"`);
      field()!.value = option.value;
      field()!.dispatchEvent(new Event('change'));
    },
    enabled: (text: string) =>
      vi.waitFor(() => expect((find('button', text) as HTMLButtonElement | undefined)?.disabled, `button "${text}"`).toBe(false)),
    submit: () => root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })),
    see: (text: string) => vi.waitFor(() => expect(root.textContent).toContain(text)),
    notSee: (text: string) => vi.waitFor(() => expect(root.textContent).not.toContain(text)),
  };
}

beforeEach(() => {
  now = Date.parse('2026-10-20T10:00:00Z');
  backend = createMemoryBackend();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Creates a world as "Alex" and returns the device and the world id. */
async function createFamily() {
  const admin = await openDevice('admin-device');
  await admin.click('button', 'Criar uma família');
  await admin.type('Nome da família', 'Casa');
  await admin.type('O teu nome', 'Alex');
  admin.submit();
  await admin.see('Convidar');
  const worldId = admin.world.get()!;
  return { admin, worldId };
}

describe('creating a world', () => {
  it('shows the join link as a QR code and the code, then lands on the home of the new adult profile', async () => {
    const { admin, worldId } = await createFamily();

    expect(worldId.length).toBeGreaterThanOrEqual(24);
    expect(admin.root.querySelector('svg[role="img"]')).not.toBeNull();
    expect(admin.root.textContent).toContain(`Código: ${worldId}`);

    await admin.click('button', 'Continuar');
    await admin.see('Olá, Alex!');
    expect(admin.find('button', 'Gerir')).toBeDefined(); // the creator is admin at once
  });
});

describe('joining a world', () => {
  it('lets a second device join by link, pick a profile and see no management', async () => {
    const { admin, worldId } = await createFamily();
    await admin.click('button', 'Continuar');
    await admin.click('button', 'Gerir');
    await admin.type('Nome', 'Sam');
    admin.submit();
    await admin.see('Sam');

    const child = await openDevice('child-device', { hash: `#/join/${worldId}` });
    await child.see('Quem és tu?');
    expect(child.find('button.profile', 'Alex')).toBeDefined();
    await child.click('button.profile', 'Sam');
    await child.see('Olá, Sam!');
    expect(child.find('button', 'Gerir')).toBeUndefined();
    expect(child.world.get()).toBe(worldId);
  });

  it('accepts a typed code, and rejects text that is not a code', async () => {
    const { worldId } = await createFamily();
    const device = await openDevice('other-device', { hash: '#/join' });

    await device.type('Link ou código', 'curto');
    device.submit();
    await device.see('não parece válido');

    await device.type('Link ou código', `${BASE_URL}#/join/${worldId}`);
    device.submit();
    await device.see('Quem és tu?');
  });

  it('says so when the code does not exist', async () => {
    const device = await openDevice('other-device', { hash: `#/join/${'x'.repeat(28)}` });
    await device.see('Esse código não existe');
    expect(device.world.get()).toBeNull();
  });
});

describe('managing profiles', () => {
  it('hides an archived child profile from the picker, and brings it back when reactivated', async () => {
    const { admin, worldId } = await createFamily();
    await admin.click('button', 'Continuar');
    await admin.click('button', 'Gerir');
    await admin.type('Nome', 'Sam');
    admin.submit();
    await admin.see('Sam');

    await admin.click('li button', 'Arquivar');
    await admin.see('(arquivado)');
    // Adult profiles cannot be archived: only the child row has the button.
    expect(admin.root.querySelectorAll('li button')).toHaveLength(1);

    const other = await openDevice('other-device', { hash: `#/join/${worldId}` });
    await other.see('Quem és tu?');
    expect(other.find('button.profile', 'Sam')).toBeUndefined();

    await admin.click('li button', 'Reativar');
    await other.see('Sam');
  });
});

describe('coming back', () => {
  it('goes straight to the home of the remembered profile', async () => {
    const { admin, worldId } = await createFamily();
    await admin.click('button', 'Continuar');
    await admin.see('Olá, Alex!');
    stops.pop()!();

    const again = await openDevice('admin-device', { savedWorld: worldId });
    await again.see('Olá, Alex!');
  });

  it('forgets a world this device is no longer a member of', async () => {
    const device = await openDevice('stranger-device', { savedWorld: 'y'.repeat(28) });
    await device.see('Criar uma família');
    expect(device.world.get()).toBeNull();
  });
});

/** A world with an admin ("Alex") on one device and a child profile ("Sam") on another. */
async function familyWithChild() {
  const { admin, worldId } = await createFamily();
  await admin.click('button', 'Continuar');
  await admin.click('button', 'Gerir');
  await admin.type('Nome', 'Sam');
  admin.submit();
  await admin.see('Sam');
  await admin.click('button', 'Voltar');

  const child = await openDevice('child-device', { hash: `#/join/${worldId}` });
  await child.click('button.profile', 'Sam');
  await child.see('Olá, Sam!');
  return { admin, child, worldId };
}

/** Opens the board and the new-task form, fills it and creates the task. */
async function createTask(device: Awaited<ReturnType<typeof openDevice>>, title: string, forWho?: string) {
  await device.click('button.place', 'Quadro');
  await device.click('button', 'Nova tarefa');
  await device.type('O que é para fazer?', title);
  if (forWho) await device.choose('Para quem', forWho);
  await device.enabled('Criar tarefa');
  device.submit();
  await device.see('As tuas tarefas');
}

describe('the map', () => {
  it('lays out the five places of the theme, and only the board leads somewhere yet', async () => {
    const { admin } = await createFamily();
    await admin.click('button', 'Continuar');
    await admin.see('Olá, Alex!');

    const places = [...admin.root.querySelectorAll<HTMLButtonElement>('button.place')];
    expect(places.map((p) => p.querySelector('.place-name')?.textContent)).toEqual([
      'Quadro',
      'Registo',
      'Casa',
      'Cofre',
      'Vitrina',
    ]);
    expect(places.filter((p) => !p.disabled).map((p) => p.textContent)).toEqual([expect.stringContaining('Quadro')]);
    expect(places[0]!.style.left).toBe('8%'); // position comes from theme.json

    await admin.click('button.place', 'Quadro');
    await admin.see('As tuas tarefas'); // after the short animation
  });
});

describe('the board and ad hoc tasks', () => {
  it('shows a task an adult creates for themself, and says when there is nothing to do', async () => {
    const { admin } = await familyWithChild();
    await admin.click('button.place', 'Quadro');
    await admin.see('Nada por fazer');

    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Regar as plantas');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('Regar as plantas');
    await admin.notSee('Nada por fazer');
    expect(document.body.textContent).toContain('Tarefa criada.');
  });

  it('lets an adult create a task for a child, who sees it on their own device', async () => {
    const { admin, child } = await familyWithChild();
    await createTask(admin, 'Arrumar o quarto', 'Sam');
    await admin.notSee('Arrumar o quarto'); // it is Sam's task, not Alex's

    await child.click('button.place', 'Quadro');
    await child.see('Arrumar o quarto');
  });

  it('lists the oldest task first', async () => {
    const { admin } = await familyWithChild();
    await createTask(admin, 'Primeira');
    now += 60_000;
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Segunda');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('Segunda');
    expect([...admin.root.querySelectorAll('.tasks li')].map((li) => li.textContent)).toEqual(['Primeira', 'Segunda']);
  });

  it('lets a child create tasks only for themselves', async () => {
    const { child } = await familyWithChild();
    await child.click('button.place', 'Quadro');
    await child.click('button', 'Nova tarefa');
    await child.type('O que é para fazer?', 'Ler um livro');
    expect([...child.root.querySelectorAll('label')].some((l) => l.textContent?.includes('Para quem') && !l.hidden)).toBe(false);
    await child.enabled('Criar tarefa');
    child.submit();
    await child.see('Ler um livro');
  });

  it('stops a child after three tasks in a day, and allows more the next day', async () => {
    const { admin, child } = await familyWithChild();
    await createTask(admin, 'Do adulto', 'Sam'); // created by an admin: does not count

    await child.click('button.place', 'Quadro');
    for (const title of ['Uma', 'Duas', 'Três']) {
      await child.click('button', 'Nova tarefa');
      await child.type('O que é para fazer?', title);
      await child.enabled('Criar tarefa');
      child.submit();
      await child.see(title);
    }

    await child.click('button', 'Nova tarefa');
    await child.see('Hoje já criaste as tuas tarefas');
    expect(child.root.querySelector('form')?.hidden).toBe(true);
    expect(child.root.textContent).not.toMatch(/\d/); // no counts are shown

    now += 24 * 3_600_000; // the next day in Lisbon
    await child.click('button', 'Voltar');
    await child.click('button', 'Nova tarefa');
    await child.type('O que é para fazer?', 'Quarta');
    await child.enabled('Criar tarefa');
    child.submit();
    await child.see('Quarta');
  });
});

describe('when data cannot be loaded', () => {
  /** A store whose first read of the open tasks fails, as when the server lacks an index. */
  const failingOnce =
    (code: 'unavailable' | 'permission-denied') =>
    (store: DataStore): DataStore => {
      let failed = false;
      return {
        ...store,
        tasks: {
          ...store.tasks,
          observeOpenTasks: (worldId, profileId, onValue, onError) => {
            if (failed) return store.tasks.observeOpenTasks(worldId, profileId, onValue, onError);
            failed = true;
            queueMicrotask(() => onError?.(new DataStoreError(code, 'The query requires an index')));
            return () => {};
          },
        },
      };
    };

  it('keeps the board on screen with a message and a retry, instead of leaving it', async () => {
    const { admin } = await createFamily();
    stops.pop()!();
    const worldId = admin.world.get()!;
    const device = await openDevice('admin-device', { savedWorld: worldId, wrap: failingOnce('unavailable') });
    await device.see('Olá, Alex!');

    await device.click('button.place', 'Quadro');
    await device.see('Não foi possível carregar');
    expect(device.root.textContent).toContain('As tuas tarefas'); // still the board
    expect(device.find('button', 'Nova tarefa')).toBeDefined(); // and a task can still be created

    await device.click('button', 'Tentar de novo');
    await device.see('Nada por fazer');
    await device.notSee('Não foi possível carregar');
  });

  it('does not forget the world on an error that is not about access', async () => {
    const { admin } = await createFamily();
    stops.pop()!();
    const worldId = admin.world.get()!;
    const device = await openDevice('admin-device', { savedWorld: worldId, wrap: failingOnce('unavailable') });
    await device.click('button.place', 'Quadro');
    await device.see('Não foi possível carregar');
    expect(device.world.get()).toBe(worldId);
  });
});
