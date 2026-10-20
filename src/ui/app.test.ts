// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tier } from '../core/model';
import { createRandomInt } from '../core/random';
import { DataStoreError, type DataStore } from '../data/DataStore';
import { createMemoryBackend, createMemoryStore } from '../data/memory';
import { loadTheme, type Theme } from '../theme';
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
  options: { theme?: Theme; hash?: string; savedWorld?: string; savedTheme?: string; launchTheme?: string; wrap?: (store: DataStore) => DataStore; installer?: Installer } = {},
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
  stops.push(await startApp({ root, store, theme: options.theme ?? theme, baseUrl: BASE_URL, world, clock, randomInt, navigation: memoryNavigation(options.hash ?? ''), installer: options.installer ?? fakeInstaller(), assetBase: '/family-quest/', launchTheme: options.launchTheme ?? null }));

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

describe('managing recurring tasks', () => {
  /** Opens the management screen of a world with a child profile "Sam", and returns the recurring-task form helpers. */
  async function openRecurring() {
    const { admin, worldId } = await createFamily();
    await admin.click('button', 'Continuar');
    await admin.click('button', 'Gerir');
    await admin.type('Nome', 'Sam');
    admin.submit();
    await admin.see('Sam');
    const form = () => admin.root.querySelectorAll('form')[1]!;
    const save = () => form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return { admin, worldId, form, save };
  }

  it('creates a definition, dims it when deactivated, and brings it back', async () => {
    const { admin, form, save } = await openRecurring();
    await admin.see('Ainda não há tarefas recorrentes.');

    await admin.click('button', 'Nova tarefa recorrente');
    expect(form().hidden).toBe(false);
    await admin.type('O que é para fazer?', 'Arrumar o quarto');
    save();
    await admin.see('Arrumar o quarto · Todos os dias');
    expect(form().hidden).toBe(true);

    await admin.click('li button', 'Desativar');
    await admin.see('(desativada)');
    expect(admin.find('li.inactive', 'Arrumar o quarto')).toBeDefined();

    await admin.click('li button', 'Ativar');
    await admin.notSee('(desativada)');
  });

  it('assigns a definition to chosen profiles, and edits it', async () => {
    const { admin, form, save } = await openRecurring();
    await admin.click('button', 'Nova tarefa recorrente');
    await admin.type('O que é para fazer?', 'Regar as plantas');
    await admin.choose('Repete', 'Todas as semanas');
    await admin.choose('Dificuldade', 'Difícil');
    const sam = [...form().querySelectorAll('label.check')].find((l) => l.textContent?.includes('Sam'))!;
    (sam.querySelector('input') as HTMLInputElement).checked = true;
    save();
    await admin.see('Regar as plantas · Todas as semanas');

    await admin.click('li button', 'Editar');
    expect((form().querySelector('input[type=text]') as HTMLInputElement).value).toBe('Regar as plantas');
    expect(((form().querySelector('label.check input[value]:checked') as HTMLInputElement | null)?.parentElement?.textContent) ?? '').toContain('Sam');
    await admin.type('O que é para fazer?', 'Regar o jardim');
    save();
    await admin.see('Regar o jardim');
    await admin.notSee('Regar as plantas');
  });
});

type Device = Awaited<ReturnType<typeof openDevice>>;

/** On the map of an admin device: creates a daily recurring task for everyone, and comes back to the map. */
async function addRecurring(device: Device, title: string) {
  await device.click('button', 'Gerir');
  await device.click('button', 'Nova tarefa recorrente');
  await device.type('O que é para fazer?', title);
  device.root.querySelectorAll('form')[1]!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await device.see(`${title} · Todos os dias`);
  await device.click('button', 'Voltar');
}

describe('recurring tasks on the board', () => {
  const tasksOf = (worldId: string) => [...backend.state.get(worldId)!.tasks.values()];

  it('creates today’s task once when the app opens, and opening it again creates nothing', async () => {
    const { admin, worldId } = await familyWithChild();
    await addRecurring(admin, 'Arrumar o quarto');
    expect(tasksOf(worldId)).toHaveLength(0); // generated on open and on profile switch, not while editing

    const first = await openDevice('child-device', { savedWorld: worldId });
    await first.click('button.place', 'Quadro');
    await first.see('Arrumar o quarto');
    expect(tasksOf(worldId)).toHaveLength(1);
    expect(tasksOf(worldId)[0]).toMatchObject({ source: 'recurring', periodKey: '2026-10-20', status: 'open' });

    const again = await openDevice('child-device', { savedWorld: worldId });
    await again.click('button.place', 'Quadro');
    await again.see('Arrumar o quarto');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tasksOf(worldId)).toHaveLength(1);
  });

  it('generates the tasks of the profile the device switches to', async () => {
    const { admin, worldId } = await familyWithChild();
    await addRecurring(admin, 'Regar as plantas');
    const profileIds = [...backend.state.get(worldId)!.profiles.values()];
    const sam = profileIds.find((p) => p.displayName === 'Sam')!;
    const alex = profileIds.find((p) => p.displayName === 'Alex')!;

    await admin.click('button', 'Trocar de perfil');
    await admin.click('button.profile', 'Sam');
    await vi.waitFor(() => expect(tasksOf(worldId).map((t) => t.profileId)).toEqual([sam.id]));

    await admin.click('button', 'Trocar de perfil');
    await admin.click('button.profile', 'Alex');
    await vi.waitFor(() => expect(tasksOf(worldId).map((t) => t.profileId).sort()).toEqual([alex.id, sam.id].sort()));
  });

  it('shows only the oldest open task of a definition, on the board and in the check-in', async () => {
    const { admin, worldId } = await familyWithChild();
    await addRecurring(admin, 'Fazer a cama');
    const ws = backend.state.get(worldId)!;
    const defId = [...ws.taskDefs.keys()][0]!;
    const sam = [...ws.profiles.values()].find((p) => p.displayName === 'Sam')!;

    // A device whose cache missed the first task generated a second one for a later period.
    const extra = createMemoryStore(backend, { uid: 'child-device', clock, randomInt });
    await extra.session.signIn();
    const task = (periodKey: string) => ({ id: `${defId}_${periodKey}_${sam.id}`, defId, periodKey, profileId: sam.id, title: 'Fazer a cama', level: 'mid' as const, question: null });
    now -= 86_400_000;
    await extra.tasks.createRecurringTasks(worldId, [task('2026-10-19')]).settled;
    now += 86_400_000;
    await extra.tasks.createRecurringTasks(worldId, [task('2026-10-20')]).settled;
    expect(tasksOf(worldId)).toHaveLength(2);

    const child = await openDevice('child-device', { savedWorld: worldId });
    await child.click('button.place', 'Quadro');
    await child.see('Fazer a cama');
    expect(child.root.querySelectorAll('ul.tasks li')).toHaveLength(1);

    await child.click('button', 'Voltar');
    await child.click('button.place', 'Registo');
    await child.see('Fazer a cama');
    expect(child.root.querySelectorAll('li.checkin-task')).toHaveLength(1);
  });
});

describe('planning a big task', () => {
  /** A monthly big definition, so the task has until the end of the month (2026-10-31). */
  async function bigTaskFamily() {
    const { admin, worldId } = await familyWithChild();
    await admin.click('button', 'Gerir');
    await admin.click('button', 'Nova tarefa recorrente');
    await admin.type('O que é para fazer?', 'Limpar a garagem');
    await admin.choose('Repete', 'Todos os meses');
    (admin.root.querySelector('label.check input') as HTMLInputElement).checked = true; // "big"
    admin.root.querySelectorAll('form')[1]!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await admin.see('Limpar a garagem');
    const child = await openDevice('child-device', { savedWorld: worldId });
    await child.click('button.place', 'Quadro');
    await child.see('Limpar a garagem');
    return { admin, child, worldId };
  }

  const planOf = (worldId: string) => [...backend.state.get(worldId)!.tasks.values()][0]!.plan;
  const fill = (device: Device, label: string, value: string) => {
    const field = [...device.root.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;
    field.value = value;
  };
  const submitPlan = (device: Device) =>
    device.root.querySelector('form.plan-form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

  it('sets, shows, changes and clears a plan, with a suggested trigger', async () => {
    const { child, worldId } = await bigTaskFamily();

    await child.click('button', 'Planear');
    fill(child, 'Que dia?', '2026-10-28');
    await child.click('.suggestions button', 'Depois do jantar');
    submitPlan(child);
    await child.see('28 de outubro · Depois do jantar');
    expect(planOf(worldId)).toEqual({ date: '2026-10-28', trigger: 'Depois do jantar' });

    await child.click('button', 'Mudar o plano');
    fill(child, 'Que dia?', '2026-10-30');
    submitPlan(child);
    await child.see('30 de outubro');
    expect(planOf(worldId)?.date).toBe('2026-10-30');

    await child.click('button', 'Mudar o plano');
    await child.click('button', 'Tirar o plano');
    await child.notSee('30 de outubro');
    expect(planOf(worldId)).toBeNull();
  });

  it('lights the board on the map when a plan is due today or tomorrow, and stops once the task is done', async () => {
    const { child } = await bigTaskFamily();
    const alert = () => child.find('button.place', 'Quadro')?.getAttribute('data-alert') ?? null;

    await child.click('button', 'Planear');
    fill(child, 'Que dia?', '2026-10-21'); // tomorrow: the clock says 2026-10-20
    await child.click('.suggestions button', 'Depois do jantar');
    submitPlan(child);
    await child.see('21 de outubro');
    await child.notSee('Planeada'); // no scolding text, only the light
    expect(child.find('li.planned-tomorrow')).toBeDefined();
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(alert()).toBe('tomorrow'));

    await child.click('button.place', 'Quadro');
    await child.click('button', 'Mudar o plano');
    fill(child, 'Que dia?', '2026-10-20');
    submitPlan(child);
    await child.see('20 de outubro');
    expect(child.find('li.planned-today')).toBeDefined();
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(alert()).toBe('today'));

    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(alert()).toBeNull());
  });

  it('does not save a day after the end of the period', async () => {
    const { child, worldId } = await bigTaskFamily();
    await child.click('button', 'Planear');
    fill(child, 'Que dia?', '2026-11-02');
    fill(child, 'Quando é que te lembras?', 'Depois do jantar');
    submitPlan(child);
    expect(planOf(worldId)).toBeNull();
  });

  it('offers no plan on a task that is not big', async () => {
    const { admin } = await familyWithChild();
    await addRecurring(admin, 'Arrumar o quarto');
    const child = await openDevice('child-device', { savedWorld: admin.world.get()! });
    await child.click('button.place', 'Quadro');
    await child.see('Arrumar o quarto');
    expect(child.find('button', 'Planear')).toBeUndefined();
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
  it('lays out the five places of the theme, and every place leads somewhere', async () => {
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
    expect(places.filter((p) => !p.disabled).map((p) => p.querySelector('.place-name')?.textContent)).toEqual(['Quadro', 'Registo', 'Casa', 'Cofre', 'Vitrina']);
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
    // The reward went to the vault, and the same tap said so.
    await child.see('Ganhaste um prémio! Foi para o cofre.');
    const reward = [...backend.state.get(worldId)!.rewards.values()][0]!;
    expect(reward).toMatchObject({ weekKey: '2026-W43', openedAt: null });
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

describe('the vault', () => {
  it('lists the unopened rewards of the active profile only, with the art of their tier, grouped by week', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Arrumar o quarto', 'Sam');
    await admin.click('button', 'Voltar');
    await createTask(admin, 'Regar as plantas', 'Sam');
    await admin.click('button', 'Voltar');

    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    await vi.waitFor(() => expect(backend.state.get(worldId)!.rewards.size).toBe(1));
    now += 7 * 86_400_000; // the next week
    await child.click('button', 'Feito');
    await vi.waitFor(() => expect(backend.state.get(worldId)!.rewards.size).toBe(2));

    await child.click('button', 'Voltar');
    await child.click('button.place', 'Cofre');
    await vi.waitFor(() => expect(child.root.querySelectorAll('li.reward')).toHaveLength(2));
    expect([...child.root.querySelectorAll('.vault-week h2')].map((el) => el.textContent)).toEqual(['Semana 43', 'Semana 44']);
    for (const item of child.root.querySelectorAll<HTMLElement>('li.reward')) {
      const art = theme.rewardArt[item.dataset.tier as Tier];
      expect(item.querySelector('.reward-art')?.textContent).toBe('emoji' in art ? art.emoji : '');
    }
    // The adult's own vault holds none of the child's rewards.
    await admin.click('button.place', 'Cofre');
    await admin.see('Ainda não tens prémios para abrir.');
  });
});

describe('opening rewards', () => {
  const SUNDAY = Date.parse('2026-10-25T10:00:00Z');

  /** A child with one reward earned on Tuesday, standing in the vault. */
  async function childWithReward() {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Arrumar o quarto', 'Sam');
    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    await vi.waitFor(() => expect(backend.state.get(worldId)!.rewards.size).toBe(1));
    await child.click('button', 'Voltar');
    return { admin, child, worldId };
  }

  it('waits for the opening day with a calm line, and opens from Sunday with a reveal of the drawn tier', async () => {
    const { child, worldId } = await childWithReward();

    await child.click('button.place', 'Cofre');
    await child.see('Abre a partir de domingo.');
    expect(child.find('button', 'Abrir')).toBeUndefined();

    now = SUNDAY;
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Cofre');
    await child.click('button', 'Abrir');

    const reward = [...backend.state.get(worldId)!.rewards.values()][0]!;
    await vi.waitFor(() => expect(backend.state.get(worldId)!.collectibles.size).toBe(1));
    const collectible = [...backend.state.get(worldId)!.collectibles.values()][0]!;
    expect(collectible).toMatchObject({ tier: reward.tier, profileId: reward.profileId, obtainedAt: SUNDAY, reserveAt: null });
    const entry = theme.catalog.slots.find((slot) => slot.slot === collectible.slot)!;
    expect(entry.tier).toBe(reward.tier);

    await child.see(`Saiu um cromo!`);
    await child.see(entry.name);
    await child.see(theme.tiers[reward.tier]);
    expect(child.root.querySelectorAll('li.reward')).toHaveLength(0);

    // The new collectible is pending: "later" closes the reveal, and it waits among the recent ones.
    await child.click('button', 'Mais tarde');
    await child.see('Recentes');
    await child.see(entry.name);
  });

  it('opens a reward from a closed week at any time', async () => {
    const { child, worldId } = await childWithReward();
    now = Date.parse('2026-10-26T08:00:00Z'); // Monday of the next week
    await child.click('button.place', 'Cofre');
    await child.click('button', 'Abrir');
    await vi.waitFor(() => expect(backend.state.get(worldId)!.collectibles.size).toBe(1));
  });

  it('ends with one collectible when another device of the same profile opened the reward first', async () => {
    const { child, worldId } = await childWithReward();
    now = SUNDAY;
    await child.click('button.place', 'Cofre');
    await child.see('Abrir');

    const second = await openDevice('child-device-2', { hash: `#/join/${worldId}` });
    const profileId = [...backend.state.get(worldId)!.profiles.values()].find((p) => p.displayName === 'Sam')!.id;
    await second.click('button.profile', 'Sam');
    await second.click('button.place', 'Cofre');
    await second.click('button', 'Abrir');
    await vi.waitFor(() => expect(backend.state.get(worldId)!.collectibles.size).toBe(1));
    const stored = [...backend.state.get(worldId)!.collectibles.values()][0]!;
    expect(stored.profileId).toBe(profileId);

    // The first device was still showing the reward: it leaves the list, and nothing is duplicated.
    await vi.waitFor(() => expect(child.find('button', 'Abrir')).toBeUndefined());
    expect(backend.state.get(worldId)!.collectibles.size).toBe(1);
  });
});

const SUNDAY = Date.parse('2026-10-25T10:00:00Z');
const state = (worldId: string) => backend.state.get(worldId)!;
const profileSam = (worldId: string) => [...state(worldId).profiles.values()].find((p) => p.displayName === 'Sam')!;

/** A child who earned `count` rewards in a closed week, standing in the vault. */
async function childWithRewards(count: number) {
  const { admin, child, worldId } = await familyWithChild();
  for (let i = 0; i < count; i++) {
    await createTask(admin, `Tarefa ${i}`, 'Sam');
    await admin.click('button', 'Voltar');
  }
  await child.click('button.place', 'Registo');
  for (let i = 0; i < count; i++) {
    await child.click('button', 'Feito');
    await vi.waitFor(() => expect(state(worldId).rewards.size).toBe(i + 1));
  }
  await child.click('button', 'Voltar');
  now = SUNDAY;
  await child.click('button.place', 'Cofre');
  return { admin, child, worldId };
}

const openAll = async (child: Awaited<ReturnType<typeof openDevice>>, worldId: string, count: number) => {
  for (let i = 0; i < count; i++) {
    await child.click('button', 'Abrir');
    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(i + 1));
    await child.click('button', 'Mais tarde');
  }
};


describe('the party and the reserve', () => {
  it('puts a new collectible in the party when there is room, from the reveal', async () => {
    const { child, worldId } = await childWithRewards(1);
    await child.click('button', 'Abrir');
    await child.click('button', 'Pôr na equipa');
    const id = [...state(worldId).collectibles.keys()][0]!;
    await vi.waitFor(() => expect(profileSam(worldId).partyIds).toEqual([id]));
    expect([...state(worldId).collectibles.values()][0]!.reserveAt).toBeNull();
    await child.notSee('Pôr na equipa');
  });

  it('asks who leaves when the party is full, sends that one to the reserve, and never offers to delete', async () => {
    const { child, worldId } = await childWithRewards(6);
    await openAll(child, worldId, 5);
    const recent = () => [...child.root.querySelectorAll<HTMLButtonElement>('.recent-card button.primary')];
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(recent().length).toBeGreaterThan(0));
      recent()[0]!.click();
      await vi.waitFor(() => expect(profileSam(worldId).partyIds).toHaveLength(i + 1));
    }

    await child.click('button', 'Abrir');
    await child.see('Quem sai?');
    const partyBefore = [...profileSam(worldId).partyIds];
    const newcomer = [...state(worldId).collectibles.values()].find((c) => !partyBefore.includes(c.id))!;
    await child.click('button.swap', 'Trocar por');
    await vi.waitFor(() => expect(profileSam(worldId).partyIds).toContain(newcomer.id));
    const party = profileSam(worldId).partyIds;
    expect(party).toHaveLength(5);
    const left = partyBefore.find((id) => !party.includes(id))!;
    expect(state(worldId).collectibles.get(left)!.reserveAt).toBe(now);
    expect(state(worldId).collectibles.size).toBe(6);
    expect([...child.root.querySelectorAll('button')].map((b) => b.textContent).join(' ')).not.toMatch(/apagar|eliminar|largar|libertar/i);
  });

  it('moves a collectible left pending to the reserve on the first app open of the next day, and not before', async () => {
    const { child, worldId } = await childWithRewards(1);
    await child.click('button', 'Abrir');
    await child.click('button', 'Mais tarde');
    const id = [...state(worldId).collectibles.keys()][0]!;
    expect(state(worldId).collectibles.get(id)!.reserveAt).toBeNull();

    // The same day, the app is opened again: it is still pending.
    now = SUNDAY + 3 * 3_600_000;
    const sameDay = await openDevice('child-device', { savedWorld: worldId });
    await sameDay.see('Olá, Sam!');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state(worldId).collectibles.get(id)!.reserveAt).toBeNull();

    // The next day, the first open puts it in the reserve, without any screen asking.
    now = SUNDAY + 24 * 3_600_000;
    const nextDay = await openDevice('child-device', { savedWorld: worldId });
    await nextDay.see('Olá, Sam!');
    await vi.waitFor(() => expect(state(worldId).collectibles.get(id)!.reserveAt).toBe(now));
    expect(profileSam(worldId).partyIds).toEqual([]);
    expect(state(worldId).collectibles.size).toBe(1);
  });
});

describe('the home', () => {
  /** A child with one collectible in the party and one left pending, standing on the home. */
  async function childAtHome() {
    const { child, worldId } = await childWithRewards(2);
    await openAll(child, worldId, 2);
    const [first, second] = [...state(worldId).collectibles.keys()] as [string, string];
    const party = [...child.root.querySelectorAll<HTMLButtonElement>('.recent-card button.primary')];
    party[0]!.click();
    await vi.waitFor(() => expect(profileSam(worldId).partyIds).toHaveLength(1));
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Casa');
    return { child, worldId, first, second };
  }
  const cards = (device: Awaited<ReturnType<typeof openDevice>>, section: number) =>
    [...device.root.querySelectorAll('section.stack')[section]!.querySelectorAll('li.collectible-card')];

  it('shows the profile with the look of its kind, the button to choose a symbol, the party and the pending collectibles, with no counts', async () => {
    const { child } = await childAtHome();
    await child.see('Sam');
    await child.see('Escolher o meu símbolo');
    expect(child.root.textContent).not.toContain('avatar');
    await child.see('que andam contigo');
    expect(child.root.textContent).not.toContain('Aqui descansam'); // no reserve on the profile
    expect(child.root.querySelector('.home-art')?.textContent).toBe('emoji' in theme.homeVariants.child ? theme.homeVariants.child.emoji : '');
    await vi.waitFor(() => expect(cards(child, 0)).toHaveLength(1));
    expect(cards(child, 1)).toHaveLength(1);
    expect(child.root.textContent).not.toMatch(/\d+ (de|na|no|em)\b/);
  });

  it('renames a collectible, then shows the catalogue name again when the name is cleared', async () => {
    const { child, worldId, first } = await childAtHome();
    const catalogueName = () => cards(child, 0)[0]?.querySelector('.reveal-name')?.textContent;
    await vi.waitFor(() => expect(cards(child, 0)).toHaveLength(1));
    const original = catalogueName();
    await child.click('button', 'Mudar o nome');
    await child.type('Nome', 'Bolinhas');
    child.submit();
    await vi.waitFor(() => expect(state(worldId).collectibles.get(first)!.nickname).toBe('Bolinhas'));
    await vi.waitFor(() => expect(catalogueName()).toBe('Bolinhas'));

    await child.click('button', 'Mudar o nome');
    await child.type('Nome', '   ');
    child.submit();
    await vi.waitFor(() => expect(state(worldId).collectibles.get(first)!.nickname).toBeNull());
    await vi.waitFor(() => expect(catalogueName()).toBe(original));
  });

  it('sends a party member away: it leaves the profile and shows in the showcase, and is not deleted', async () => {
    const { child, worldId, first } = await childAtHome();
    await child.click('button', 'Enviar para a vitrina');
    await vi.waitFor(() => expect(profileSam(worldId).partyIds).toEqual([]));
    expect(state(worldId).collectibles.get(first)!.reserveAt).toBe(now);
    await vi.waitFor(() => expect(cards(child, 0)).toHaveLength(0));
    expect(child.root.querySelectorAll('li.collectible-card')).toHaveLength(1); // only the pending one is left
    expect(state(worldId).collectibles.size).toBe(2);

    await child.click('button', 'Voltar');
    await child.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(child.root.querySelectorAll('.showcase-item')).toHaveLength(1));
  });

  it('shows the tier name instead of crashing when the theme lacks the slot of a collectible', async () => {
    const { child, worldId, first } = await childAtHome();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    state(worldId).collectibles.get(first)!.slot = 'no-such-slot';
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Casa');
    const tier = state(worldId).collectibles.get(first)!.tier;
    await vi.waitFor(() => expect(cards(child, 0)[0]!.querySelector('.reveal-name')?.textContent).toBe(theme.tiers[tier]));
  });
});

describe('the showcase', () => {
  /** A child with two collectibles in the reserve, one of them nicknamed, and the admin on the map. */
  async function reserveOfTheChild() {
    const { admin, child, worldId } = await childWithRewards(2);
    await openAll(child, worldId, 2);
    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(2));
    await child.click('button', 'Voltar');
    // The first day after: the app opens, and the pending collectibles go to the reserve.
    now = SUNDAY + 24 * 3_600_000;
    const next = await openDevice('child-device', { savedWorld: worldId });
    await next.see('Olá, Sam!');
    await vi.waitFor(() => expect([...state(worldId).collectibles.values()].every((c) => c.reserveAt !== null)).toBe(true));
    return { admin, child: next, worldId };
  }
  const items = (device: Awaited<ReturnType<typeof openDevice>>) => [...device.root.querySelectorAll('.showcase-item')];

  it('shows the reserve of the family without owner, date or count, and shows an item larger on a tap', async () => {
    const { admin, child, worldId } = await reserveOfTheChild();
    await admin.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(admin)).toHaveLength(2));
    // The same view on the child's phone.
    await child.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(child)).toHaveLength(2));
    expect(child.root.textContent).not.toMatch(/Sam|Alex/);
    expect(admin.root.textContent).not.toMatch(/Sam/);
    expect(child.root.textContent).not.toMatch(/\d/);

    (items(child)[0] as HTMLElement).click();
    const tier = [...state(worldId).collectibles.values()].sort((a, b) => b.reserveAt! - a.reserveAt! || (a.id < b.id ? 1 : -1))[0]!.tier;
    await vi.waitFor(() => expect(child.root.querySelector('.reveal-tier')?.textContent).toBe(theme.tiers[tier]));
    expect(child.root.querySelector('.rename, form')).toBeNull();
    await child.click('button', 'Fechar');
  });

  it('lets an admin rename an item, and not a child', async () => {
    const { admin, child, worldId } = await reserveOfTheChild();
    await child.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(child)).toHaveLength(2));
    (items(child)[0] as HTMLElement).click();
    await child.see('Fechar');
    await child.notSee('Mudar o nome');

    await admin.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(admin)).toHaveLength(2));
    (items(admin)[0] as HTMLElement).click();
    await admin.click('button', 'Mudar o nome');
    await admin.type('Nome', 'Moderado');
    admin.submit();
    await vi.waitFor(() => expect([...state(worldId).collectibles.values()].some((c) => c.nickname === 'Moderado')).toBe(true));
    await vi.waitFor(() => expect(items(admin).some((el) => el.textContent?.includes('Moderado'))).toBe(true));
  });

  it('is empty at first, and says so without a count', async () => {
    const { admin } = await familyWithChild();
    await admin.click('button.place', 'Vitrina');
    await admin.see('Ainda não há nada');
  });
});

describe('moorings and symbols', () => {
  /**
   * A test theme with moorings, so no real theme's vocabulary appears here. Its id is not a bundled
   * theme, so the app keeps the theme it was given (as for any theme id this build does not have).
   */
  const THEME_ID = 'harbour-test';
  const base = loadTheme('minimal');
  const SYMBOLS = ['🐬', '🦀', '🐙', '🐢', '🐳', '🦊', '🐼', '🦁', '🐸', '🦉', '🦋', '🐝'];
  const harbour: Theme = {
    ...base,
    id: THEME_ID,
    profileSymbols: SYMBOLS,
    homeSymbolAt: { child: { x: 50, y: 40, size: 40 } },
    places: { ...base.places, home: { ...base.places.home, art: base.homeVariants.adult, symbolAt: { x: 50, y: 40, size: 40 } } },
    map: {
      ...base.map,
      moorings: {
        child: {
          spots: Array.from({ length: 4 }, (_, i) => ({ x: 10 + i * 20, y: 85, width: 8, height: 6 })),
          symbolAt: { x: 50, y: 40, size: 30 },
        },
      },
    },
  };
  const spots = harbour.map.moorings!.child!.spots;
  const [DOLPHIN, CRAB, OCTOPUS] = SYMBOLS as [string, string, string];
  /** A world with the test theme, seeded through the store: the adult "Alex" and the given children. */
  async function seed(children: Array<{ name: string; symbol?: string | null; archived?: boolean }>) {
    const store = createMemoryStore(backend, { uid: 'seed', clock, randomInt });
    await store.session.signIn();
    const created = store.worlds.createWorld({ name: 'Casa', themeId: THEME_ID, creatorDisplayName: 'Alex' });
    await created.settled;
    const { worldId } = created.result;
    const ids: Record<string, string> = {};
    for (const child of children) {
      now += 1000; // a distinct creation time per profile
      const profile = store.worlds.createProfile(worldId, { displayName: child.name, kind: 'child', symbol: child.symbol ?? null });
      await profile.settled;
      ids[child.name] = profile.result.profileId;
      if (child.archived) await store.worlds.setProfileArchived(worldId, profile.result.profileId, true).settled;
    }
    return { worldId, ids };
  }
  const asAdult = async (worldId: string) => {
    const admin = await openDevice('seed', { theme: harbour, savedWorld: worldId });
    await admin.see('Olá, Alex!');
    return admin;
  };
  const asChild = async (worldId: string, name: string, uid = 'child-device') => {
    const device = await openDevice(uid, { theme: harbour, hash: `#/join/${worldId}` });
    await device.click('button.profile', name);
    await device.see(`Olá, ${name}!`);
    return device;
  };
  const boats = (device: Awaited<ReturnType<typeof openDevice>>) => [...device.root.querySelectorAll<HTMLElement>('.boat')];

  it('draws no boat for no children', async () => {
    const { worldId } = await seed([]);
    const admin = await asAdult(worldId);
    expect(admin.root.querySelector('.boats')).not.toBeNull();
    expect(boats(admin)).toHaveLength(0);
  });

  it('moors one boat per child in creation order, with its symbol on the sail', async () => {
    const { worldId } = await seed([{ name: 'Sam', symbol: DOLPHIN }, { name: 'Robin', symbol: CRAB }, { name: 'Kim' }]);
    const admin = await asAdult(worldId);
    await vi.waitFor(() => expect(boats(admin)).toHaveLength(3));
    expect(boats(admin).map((boat) => boat.querySelector('.boat-symbol')?.textContent ?? null)).toEqual([DOLPHIN, CRAB, null]);
    boats(admin).forEach((boat, i) => {
      expect(boat.style.left).toBe(`${spots[i]!.x}%`);
      expect(boat.style.top).toBe(`${spots[i]!.y}%`);
    });
  });

  it('draws only as many boats as there are spots, in creation order, and skips an archived child', async () => {
    const names = Array.from({ length: spots.length + 2 }, (_, i) => ({ name: `Criança ${i}`, symbol: null as string | null }));
    names[0] = { ...names[0]!, archived: true } as never;
    const { worldId } = await seed(names);
    const admin = await asAdult(worldId);
    await vi.waitFor(() => expect(boats(admin)).toHaveLength(spots.length));
    expect(boats(admin).map((boat) => boat.style.left)).toEqual(spots.map((spot) => `${spot.x}%`));
  });

  it('draws the same layout on two devices', async () => {
    const { worldId } = await seed([{ name: 'Sam', symbol: DOLPHIN }, { name: 'Robin', symbol: CRAB }]);
    const admin = await asAdult(worldId);
    const child = await asChild(worldId, 'Sam');
    await vi.waitFor(() => expect(boats(admin)).toHaveLength(2));
    await vi.waitFor(() => expect(boats(child)).toHaveLength(2));
    const layout = (device: typeof admin) => boats(device).map((boat) => [boat.style.left, boat.style.top, boat.querySelector('.boat-symbol')?.textContent]);
    expect(layout(child)).toEqual(layout(admin));
  });

  it('shows no name on the map, and keeps the other boats out of reach', async () => {
    const { worldId } = await seed([{ name: 'Sam', symbol: DOLPHIN }, { name: 'Robin', symbol: CRAB }]);
    const child = await asChild(worldId, 'Sam');
    await vi.waitFor(() => expect(boats(child)).toHaveLength(2));
    expect(child.root.querySelector('.map')!.textContent).not.toContain('Robin');
    expect(child.root.querySelector('.map')!.innerHTML).not.toContain('Robin');
    const [own, other] = boats(child) as [HTMLElement, HTMLElement];
    expect(own.tagName).toBe('BUTTON');
    expect(own.getAttribute('aria-label')).toBe('Abrir a casa');
    expect(other.tagName).toBe('DIV');
    expect(other.getAttribute('aria-hidden')).toBe('true');
    other.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(child.root.querySelector('.map')).not.toBeNull(); // still on the map
  });

  it('opens the home when the own boat is tapped, and follows the profile when it changes', async () => {
    const { worldId } = await seed([{ name: 'Sam', symbol: DOLPHIN }, { name: 'Robin', symbol: CRAB }]);
    const child = await asChild(worldId, 'Robin');
    await vi.waitFor(() => expect(boats(child)).toHaveLength(2));
    expect(boats(child).map((boat) => boat.tagName)).toEqual(['DIV', 'BUTTON']); // Robin is the second boat
    (boats(child)[1] as HTMLElement).click();
    await child.see('Escolher o meu símbolo');
    await child.click('button', 'Voltar');
    await child.click('button', 'Trocar de perfil');
    await child.click('button.profile', 'Sam');
    await vi.waitFor(() => expect(boats(child).map((boat) => boat.tagName)).toEqual(['BUTTON', 'DIV']));
  });

  it('leaves the map as it was for a theme without moorings', async () => {
    const { admin } = await createFamily();
    await admin.click('button', 'Continuar');
    await admin.see('Olá, Alex!');
    expect(admin.root.querySelector('.boats')).toBeNull();
    expect(admin.root.querySelector('.boat')).toBeNull();
  });

  it('opens a panel with the suggestions and the animals, puts the chosen one on the sail of the home boat and on the map, and clears it', async () => {
    const { worldId, ids } = await seed([{ name: 'Sam' }]);
    const child = await asChild(worldId, 'Sam');
    await child.click('button.boat', '');
    await child.click('button', 'Escolher o meu símbolo');
    await child.see('Sugestões');
    // Not among the theme's suggestions, but among the animals; nothing else is offered.
    const ELEPHANT = '🐘';
    expect(SYMBOLS).not.toContain(ELEPHANT);
    const offered = [...child.root.querySelectorAll<HTMLElement>('.symbol-panel [data-emoji]')].map((el) => el.dataset.emoji!);
    expect(offered.length).toBeGreaterThan(100);
    expect(offered).not.toContain('🚀');
    expect(offered.slice(0, SYMBOLS.length)).toEqual(SYMBOLS); // the theme's suggestions come first
    (child.root.querySelector(`.symbol-panel [data-emoji="${ELEPHANT}"]`) as HTMLElement).click();
    await vi.waitFor(() => expect(backend.state.get(worldId)!.profiles.get(ids.Sam!)!.avatar.symbol).toBe(ELEPHANT));
    await vi.waitFor(() => expect(child.root.querySelector('.home-boat .boat-symbol')?.textContent).toBe(ELEPHANT));
    expect(child.root.querySelector('.symbol-panel')!.hasAttribute('hidden')).toBe(true); // closed after choosing
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(child.root.querySelector('.boat-symbol')?.textContent).toBe(ELEPHANT));
    await child.click('button.boat', '');
    await child.click('button', 'Escolher o meu símbolo');
    await child.click('button', 'Sem símbolo');
    await vi.waitFor(() => expect(backend.state.get(worldId)!.profiles.get(ids.Sam!)!.avatar.symbol).toBeNull());
  });

  it('shows the adult symbol on the big ship at the pier, and not the child symbol', async () => {
    const { worldId } = await seed([{ name: 'Sam', symbol: CRAB }]);
    const admin = await asAdult(worldId);
    await admin.click('button.place', 'Casa');
    await admin.click('button', 'Escolher o meu símbolo');
    (admin.root.querySelector('.symbol-panel [data-emoji="🐬"]') as HTMLElement).click();
    await admin.click('button', 'Voltar');
    await vi.waitFor(() => expect(admin.find('button.place .place-slot .boat-symbol')?.textContent).toBe('🐬'));
    const child = await asChild(worldId, 'Sam');
    await vi.waitFor(() => expect(boats(child)).toHaveLength(1));
    expect(child.root.querySelector('button.place .place-slot .boat-symbol')).toBeNull(); // the child has a boat of their own
  });

  it('shows the symbol next to the name when the theme gives no place for it on the home art', async () => {
    const { worldId } = await seed([]);
    const admin = await asAdult(worldId); // the test theme places the symbol for children only
    await admin.click('button.place', 'Casa');
    await admin.click('button', 'Escolher o meu símbolo');
    (admin.root.querySelector('.symbol-panel [data-emoji="🐬"]') as HTMLElement).click();
    await vi.waitFor(() => expect(admin.find('.home-header .reveal-name')?.textContent).toBe('Alex 🐬'));
    expect(admin.root.querySelector('.home-boat .boat-symbol')).toBeNull();
  });

  it('lets an admin choose the symbol of a new profile in the management screen', async () => {
    const { worldId } = await seed([]);
    const admin = await asAdult(worldId);
    await admin.click('button', 'Gerir');
    await admin.type('Nome', 'Sam');
    await admin.choose('Símbolo', DOLPHIN);
    admin.submit();
    await vi.waitFor(() => {
      const sam = [...backend.state.get(worldId)!.profiles.values()].find((p) => p.displayName === 'Sam');
      expect(sam?.avatar.symbol).toBe(DOLPHIN);
    });
  });
});

describe('the reward odds', () => {
  const worldOdds = (worldId: string) => backend.state.get(worldId)!.world.ruleset.tierOdds;
  const oddsInputs = (device: Awaited<ReturnType<typeof openDevice>>) =>
    [...[...device.root.querySelectorAll('form')].at(-1)!.querySelectorAll<HTMLInputElement>('input')];
  const submitLast = (device: Awaited<ReturnType<typeof openDevice>>) =>
    [...device.root.querySelectorAll('form')].at(-1)!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

  it('shows the odds of the world, saves new ones, and refuses a row that does not sum to 100', async () => {
    const { admin, worldId } = await familyWithChild();
    await admin.click('button', 'Gerir');
    await admin.see('Probabilidades dos prémios');
    await vi.waitFor(() => expect(oddsInputs(admin).map((input) => input.value).slice(0, 3)).toEqual(['80', '17', '3']));

    const fields = oddsInputs(admin);
    [fields[0]!.value, fields[1]!.value, fields[2]!.value] = ['70', '25', '5'];
    submitLast(admin);
    await vi.waitFor(() => expect(worldOdds(worldId).low).toEqual({ low: 70, mid: 25, high: 5 }));
    expect(worldOdds(worldId).high).toEqual({ low: 45, mid: 35, high: 20 });

    fields[0]!.value = '10';
    submitLast(admin);
    await admin.see('somam 100');
    expect(worldOdds(worldId).low).toEqual({ low: 70, mid: 25, high: 5 });
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
