// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRandomInt } from '../core/random';
import { DataStoreError, type DataStore } from '../data/DataStore';
import { createMemoryBackend, createMemoryStore } from '../data/memory';
import { loadTheme } from '../theme';
import { startApp } from './app';
import type { Installer, InstallMode, Platform } from './install';
import { memoryNavigation } from './navigation';
import { createWorldMemory } from './worldMemory';

const BASE_URL = 'https://example.org/family-quest/';
const randomInt = createRandomInt((array) => crypto.getRandomValues(array));
const theme = loadTheme('minimal');

/** One clock for every device, so tests can move time. */
let now = Date.parse('2026-10-20T10:00:00Z');
const clock = () => now;

/** An installer that lets a test choose the platform and what can be offered. */
function fakeInstaller(mode: InstallMode = 'none', platform: Partial<Platform> = {}) {
  const installer: Installer & { prompt: ReturnType<typeof vi.fn> } = {
    platform: { isIos: false, isStandalone: false, ...platform },
    mode: () => mode,
    prompt: vi.fn(async () => {}),
    onChange: () => () => {},
  };
  return installer;
}

let backend = createMemoryBackend();
let stops: Array<() => void> = [];

/** One device: its own store, remembered world and screen, sharing the backend. */
async function openDevice(
  uid: string,
  options: { hash?: string; savedWorld?: string; savedTheme?: string; launchTheme?: string; wrap?: (store: DataStore) => DataStore; installer?: Installer } = {},
) {
  const storage = new Map<string, string>();
  const world = createWorldMemory({
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => void storage.set(k, v),
    removeItem: (k) => void storage.delete(k),
  });
  if (options.savedWorld) world.set(options.savedWorld);
  if (options.savedTheme) world.setTheme(options.savedTheme);
  const root = document.createElement('main');
  document.body.append(root);
  const store = (options.wrap ?? ((s) => s))(createMemoryStore(backend, { uid, clock, randomInt }));
  stops.push(await startApp({ root, store, theme, baseUrl: BASE_URL, world, clock, randomInt, navigation: memoryNavigation(options.hash ?? ''), installer: options.installer ?? fakeInstaller(), assetBase: '/family-quest/', launchTheme: options.launchTheme ?? null }));

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
    await vi.waitFor(() => expect(child.find('button.profile', 'Alex')).toBeDefined());
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
    await vi.waitFor(() => expect(other.find('button.profile', 'Alex')).toBeDefined());
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
  it('lays out the five places of the theme, and only the board and the check-in lead somewhere yet', async () => {
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
    expect(places.filter((p) => !p.disabled).map((p) => p.querySelector('.place-name')?.textContent)).toEqual(['Quadro', 'Registo']);
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

  it('lets a child create tasks only for themselves, and only name them', async () => {
    const { child, worldId } = await familyWithChild();
    await child.click('button.place', 'Quadro');
    await child.click('button', 'Nova tarefa');
    await child.type('O que é para fazer?', 'Ler um livro');
    await child.enabled('Criar tarefa');
    // A child only names the task: no difficulty, question or "for whom".
    expect(child.root.querySelectorAll('label')).toHaveLength(1);
    for (const field of ['Dificuldade', 'Pergunta', 'Para quem']) expect(child.root.textContent).not.toContain(field);
    child.submit();
    await child.see('Ler um livro');

    // The task is for the child, of normal difficulty and without a question.
    const [stored] = [...backend.state.get(worldId)!.tasks.values()];
    expect(stored).toMatchObject({ title: 'Ler um livro', level: 'mid', question: null, source: 'adhoc' });
    expect(stored?.profileId).toBe(stored?.createdBy);
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

describe('the check-in', () => {
  const lines = theme.character.lines;
  const bubble = (device: Awaited<ReturnType<typeof openDevice>>) => device.root.querySelector('.bubble')?.textContent ?? '';
  const storedTask = (worldId: string) => [...backend.state.get(worldId)!.tasks.values()].at(-1)!;

  it('completes a task in two taps from the map, and the character congratulates', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Arrumar o quarto', 'Sam');
    await child.see('Olá, Sam!');

    await child.click('button.place', 'Registo'); // tap 1
    await child.see('Arrumar o quarto');
    expect(lines.greeting).toContain(bubble(child));
    await child.click('button', 'Feito'); // tap 2

    await child.notSee('Arrumar o quarto');
    expect(lines.congrats).toContain(bubble(child));
    expect(storedTask(worldId)).toMatchObject({ status: 'done', doneAt: now, weekKey: '2026-W43', answer: null, talkFlag: false });
  });

  it('shows the question, completes on yes, and on no leaves the task open with a friendly line', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await admin.click('button.place', 'Quadro');
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Lavar os dentes');
    await admin.type('Pergunta de verificação', 'Lavaste mesmo?');
    await admin.choose('Para quem', 'Sam');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('As tuas tarefas');

    await child.click('button.place', 'Registo');
    await child.see('Lavaste mesmo?');
    expect(child.find('button', 'Feito')).toBeUndefined(); // a question needs an answer

    await child.click('button', 'Não');
    expect(lines.doubt).toContain(bubble(child));
    expect(storedTask(worldId)).toMatchObject({ status: 'open', answer: null }); // nothing is recorded
    expect(child.root.textContent).toContain('Lavaste mesmo?');

    await child.click('button', 'Sim');
    await child.notSee('Lavaste mesmo?');
    expect(storedTask(worldId)).toMatchObject({ status: 'done', answer: 'yes' });
  });

  it('keeps "I think I did better" on the task, and it is there when the task is completed', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Ler um capítulo', 'Sam');

    await child.click('button.place', 'Registo');
    await child.click('button.better', 'Acho que fiz melhor');
    await vi.waitFor(() => expect(storedTask(worldId).talkFlag).toBe(true));
    await vi.waitFor(() => expect(child.find('button.better')?.getAttribute('aria-pressed')).toBe('true'));

    await child.click('button', 'Feito');
    await child.notSee('Ler um capítulo');
    expect(storedTask(worldId)).toMatchObject({ status: 'done', talkFlag: true });
  });

  it('says goodbye when there is nothing to complete, and never shows other people’s tasks', async () => {
    const { admin, child } = await familyWithChild();
    await createTask(admin, 'Só para mim'); // Alex's own task
    await child.click('button.place', 'Registo');
    await child.see('Nada para concluir');
    expect(lines.farewell).toContain(bubble(child));
    expect(child.root.textContent).not.toContain('Só para mim');
  });
});

describe('the theme of the world', () => {
  const FARM = 'minimal-farm';
  const manifest = () => document.head.querySelector('link[rel="manifest"]')?.getAttribute('href');

  /** Creates a world with the farm theme, from the create screen. */
  async function createFarm(installer?: Installer) {
    const admin = await openDevice('admin-device', { installer });
    await admin.click('button', 'Criar uma família');
    await admin.choose('Tema', 'Tema quinta');
    await admin.see('Criar uma quinta'); // the names follow the choice at once
    await admin.type('Nome da quinta', 'Casa');
    await admin.type('O teu nome', 'Alex');
    admin.submit();
    await admin.see('Convidar');
    return { admin, worldId: admin.world.get()! };
  }

  it('is chosen when creating the world, fixed for it, and drives the names and the installed app', async () => {
    const { admin, worldId } = await createFarm();
    expect(backend.state.get(worldId)?.world.themeId).toBe(FARM);
    expect(manifest()).toBe('/family-quest/manifest-minimal-farm.webmanifest');
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
      '/family-quest/themes/minimal-farm/apple-touch-icon.png',
    );
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('Quinta');

    await admin.click('button', 'Continuar');
    await admin.see('Painel'); // the farm's name for the board
    expect(admin.world.getTheme()).toBe(FARM);
  });

  it('puts the theme in the join link, so a joining device looks like the world before it joins', async () => {
    const { worldId } = await createFarm();
    const device = await openDevice('other-device', { hash: `#/join/${worldId}/${FARM}` });
    await device.see('Quem és tu?');
    expect(manifest()).toBe('/family-quest/manifest-minimal-farm.webmanifest');
    await device.click('button.profile', 'Alex');
    await device.see('Painel');
    expect(device.world.getTheme()).toBe(FARM);
  });

  it('is remembered, so the next launch has the right names from the first frame', async () => {
    const { admin, worldId } = await createFarm();
    await admin.click('button', 'Continuar');
    stops.pop()!();
    const again = await openDevice('admin-device', { savedWorld: worldId, savedTheme: FARM });
    expect(again.root.textContent).not.toContain('A carregar');
    await again.see('Painel');
  });

  it('is the one an installed app was launched with, even before there is a world', async () => {
    const device = await openDevice('device', { launchTheme: FARM });
    await device.see('Criar uma quinta'); // the farm's name, from the very first screen
    await device.click('button', 'Criar uma quinta');
    await device.see('Nome da quinta');
    expect(manifest()).toBe('/family-quest/manifest-minimal-farm.webmanifest');
  });

  it('ignores a theme id this build does not have', async () => {
    const { worldId } = await createFarm();
    const device = await openDevice('other-device', { hash: `#/join/${worldId}/unknown-theme` });
    await device.see('Quem és tu?'); // the join still works, with the world's own theme afterwards
  });
});

describe('installing the app', () => {
  it('offers nothing from the bare address, even when the browser could install it', async () => {
    const device = await openDevice('device', { installer: fakeInstaller('prompt') });
    await device.see('Criar uma família');
    expect(device.find('button', 'Instalar')).toBeUndefined();
  });

  it('offers the browser install button once the theme is known, and uses the browser dialog', async () => {
    const installer = fakeInstaller('prompt');
    const admin = await openDevice('admin-device', { installer });
    await admin.click('button', 'Criar uma família');
    await admin.type('Nome da família', 'Casa');
    await admin.type('O teu nome', 'Alex');
    admin.submit();
    await admin.see('Convidar');

    await admin.click('button', 'Instalar a app');
    expect(installer.prompt).toHaveBeenCalledTimes(1);

    await admin.click('button', 'Continuar');
    await admin.see('Olá, Alex!');
    expect(admin.find('.bar-actions button', 'Instalar')).toBeDefined();
  });

  it('shows the iOS steps with the name of the themed app, and hides the offer once installed', async () => {
    const admin = await openDevice('admin-device', { installer: fakeInstaller('ios', { isIos: true }) });
    await admin.click('button', 'Criar uma família');
    await admin.type('Nome da família', 'Casa');
    await admin.type('O teu nome', 'Alex');
    admin.submit();
    await admin.see('Para instalar «Família»: toca em Partilhar');
    stops.pop()!();

    const installed = await openDevice('admin-device', { installer: fakeInstaller('installed', { isIos: true, isStandalone: true }), savedWorld: admin.world.get()!, savedTheme: 'minimal' });
    await installed.see('Olá, Alex!');
    expect(installed.find('.bar-actions button', 'Instalar')).toBeUndefined();
  });

  it('on iOS in a browser tab, does not join: it explains, and offers to copy the link', async () => {
    const { admin, worldId } = await createFamily();
    await admin.click('button', 'Continuar');
    const members = () => backend.state.get(worldId)!.members.size;
    const before = members();

    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
    const safari = await openDevice('iphone', {
      hash: `#/join/${worldId}/minimal`,
      installer: fakeInstaller('ios', { isIos: true }),
    });
    await safari.see('instala primeiro a app');
    expect(safari.root.textContent).toContain('Para instalar «Família»'); // themed from the link
    expect(safari.world.get()).toBeNull();
    expect(members()).toBe(before);

    await safari.click('button', 'Copiar o link');
    await safari.see('Link copiado');
    expect(copied[0]).toContain(`#/join/${worldId}/minimal`);
  });

  it('on iOS in the installed app, joins as usual; and a pasted link joins too', async () => {
    const { admin, worldId } = await createFamily();
    await admin.click('button', 'Continuar');
    const standalone = fakeInstaller('installed', { isIos: true, isStandalone: true });

    const viaLink = await openDevice('iphone-1', { hash: `#/join/${worldId}/minimal`, installer: standalone });
    await viaLink.see('Quem és tu?');

    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: async () => `https://example.org/family-quest/#/join/${worldId}/minimal` },
      configurable: true,
    });
    const viaPaste = await openDevice('iphone-2', { hash: '#/join', installer: standalone });
    await viaPaste.click('button', 'Colar');
    await viaPaste.see('Quem és tu?');
    expect(viaPaste.world.get()).toBe(worldId);
  });
});
