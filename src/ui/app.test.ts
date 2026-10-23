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

/** Delayed calls (the undo window), run by the test instead of by real time. */
let timers: Array<{ run: () => void; ms: number; done: boolean }> = [];
const later = (run: () => void, ms: number) => {
  const timer = { run, ms, done: false };
  timers.push(timer);
  return () => void (timer.done = true);
};
/** Lets every pending undo window end. */
const runTimers = () => {
  for (const timer of timers.filter((t) => !t.done)) {
    timer.done = true;
    timer.run();
  }
};

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
  stops.push(await startApp({ root, store, theme: options.theme ?? theme, baseUrl: BASE_URL, world, clock, randomInt, navigation: memoryNavigation(options.hash ?? ''), installer: options.installer ?? fakeInstaller(), assetBase: '/family-quest/', later, launchTheme: options.launchTheme ?? null }));

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
  timers = [];
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

/** In the task form: ticks who the task is for. */
async function pickPeople(device: Awaited<ReturnType<typeof openDevice>>, ...names: string[]) {
  for (const name of names) await device.click('button.chip', name);
}

describe('managing recurring tasks', () => {
  /** Opens the management screen of a world with a child profile "Sam". */
  async function openRecurring() {
    const { admin, worldId } = await createFamily();
    await admin.click('button', 'Continuar');
    await admin.click('button', 'Gerir');
    await admin.type('Nome', 'Sam');
    admin.submit();
    await admin.see('Sam');
    return { admin, worldId };
  }

  it('creates a definition, dims it when deactivated, and brings it back', async () => {
    const { admin } = await openRecurring();
    await admin.see('Ainda não há tarefas recorrentes.');

    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Arrumar o quarto');
    await pickPeople(admin, 'Todos');
    await admin.click('button.chip', 'Todos os dias');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('Arrumar o quarto · Todos os dias');

    await admin.click('li button', 'Desativar');
    await admin.see('(desativada)');
    expect(admin.find('li.inactive', 'Arrumar o quarto')).toBeDefined();

    await admin.click('li button', 'Ativar');
    await admin.notSee('(desativada)');
  });

  it('assigns a definition to chosen profiles, and edits it without offering "once"', async () => {
    const { admin, worldId } = await openRecurring();
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Regar as plantas');
    await pickPeople(admin, 'Sam');
    await admin.click('button.chip', 'Todas as semanas');
    await admin.click('button.chip', 'Difícil');
    admin.submit();
    await admin.see('Regar as plantas · Todas as semanas');

    await admin.click('li button', 'Editar');
    await vi.waitFor(() => expect((admin.root.querySelector('input[type=text]') as HTMLInputElement).value).toBe('Regar as plantas'));
    expect(admin.find('button.chip[aria-pressed=true]', 'Sam')).toBeDefined();
    expect(admin.find('button.chip', 'Só uma vez')?.hidden).toBe(true);
    await admin.type('O que é para fazer?', 'Regar o jardim');
    await admin.enabled('Guardar');
    admin.submit();
    await admin.see('Regar o jardim');
    await admin.notSee('Regar as plantas');
    expect([...backend.state.get(worldId)!.taskDefs.values()]).toHaveLength(1);
  });
});

type Device = Awaited<ReturnType<typeof openDevice>>;

/** On the map of an admin device: creates a daily recurring task for everyone, and comes back to the map. */
async function addRecurring(device: Device, title: string) {
  await device.click('button', 'Gerir');
  await device.click('button', 'Nova tarefa');
  await device.type('O que é para fazer?', title);
  await pickPeople(device, 'Todos');
  await device.click('button.chip', 'Todos os dias');
  device.submit();
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
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Limpar a garagem');
    await pickPeople(admin, 'Todos');
    await admin.click('button.chip', 'Todos os meses');
    (admin.root.querySelector('label.check input') as HTMLInputElement).checked = true; // "big"
    admin.submit();
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
    expect(child.find('li.planned-soon')).toBeDefined();
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(alert()).toBe('soon'));

    await child.click('button.place', 'Quadro');
    await child.click('button', 'Mudar o plano');
    fill(child, 'Que dia?', '2026-10-20');
    submitPlan(child);
    await child.see('20 de outubro');
    expect(child.find('li.planned-due')).toBeDefined();
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(alert()).toBe('due'));

    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    runTimers();
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

  it('plans a big task that does not repeat, on any later day', async () => {
    const { admin, worldId } = await familyWithChild();
    await admin.click('button.place', 'Quadro');
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Pintar a cerca');
    await pickPeople(admin, 'Sam');
    (admin.root.querySelector('label.check input') as HTMLInputElement).checked = true; // "big", with "once" chosen
    admin.submit();
    await admin.see('As tuas tarefas');
    const stored = [...backend.state.get(worldId)!.tasks.values()][0]!;
    expect(stored).toMatchObject({ source: 'adhoc', big: true });

    const child = await openDevice('child-device', { savedWorld: worldId });
    await child.click('button.place', 'Quadro');
    await child.see('Pintar a cerca');
    await child.click('button', 'Planear');
    expect(child.root.querySelector<HTMLInputElement>('.plan-form input[type=date]')!.max).toBe(''); // no end of period
    fill(child, 'Que dia?', '2027-01-15');
    fill(child, 'Quando é que te lembras?', 'Nas férias');
    submitPlan(child);
    await child.see('15 de janeiro · Nas férias');
    expect(planOf(worldId)).toEqual({ date: '2027-01-15', trigger: 'Nas férias' });
  });

  it('offers neither "big" nor a plan to a child, and no plan on a one-off task that was not made big', async () => {
    const { admin, child } = await familyWithChild();
    await createTask(admin, 'Regar as plantas', 'Sam');
    await child.click('button.place', 'Quadro');
    await child.see('Regar as plantas');
    expect(child.find('button', 'Planear')).toBeUndefined();
    await child.click('button', 'Nova tarefa');
    await child.see('O que é para fazer?');
    expect(child.root.querySelector('label.check')).toBeNull();
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
  // An adult must choose who it is for; a child has no such choice.
  if (forWho) await pickPeople(device, forWho);
  await device.enabled('Criar tarefa');
  device.submit();
  await device.see('As tuas tarefas');
}

describe('the profile picker', () => {
  it('shows each profile with its emoji where the picture would be, or its initial, and the name alone', async () => {
    const { admin, worldId } = await familyWithChild();
    const sam = [...backend.state.get(worldId)!.profiles.values()].find((p) => p.displayName === 'Sam')!;
    sam.avatar.symbol = '🐬';
    await admin.click('button', 'Trocar de perfil');
    await vi.waitFor(() => expect(admin.root.querySelectorAll('button.profile')).toHaveLength(2));
    expect(admin.find('button.profile', 'Sam')?.querySelector('.avatar')?.textContent).toBe('🐬');
    expect(admin.find('button.profile', 'Sam')?.querySelector('.name')?.textContent).toBe('Sam');
    expect(admin.find('button.profile', 'Alex')?.querySelector('.avatar')?.textContent).toBe('A');
    expect(admin.root.querySelector('button.profile img')).toBeNull(); // no boat
  });
});

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
    await pickPeople(admin, 'Alex');
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
    await createTask(admin, 'Primeira', 'Alex');
    now += 60_000;
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Segunda');
    await pickPeople(admin, 'Alex');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('Segunda');
    expect([...admin.root.querySelectorAll('.tasks li .task-title')].map((el) => el.textContent)).toEqual(['Primeira', 'Segunda']);
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

    // The task is for the child, of the lowest difficulty (what a child invents never earns more) and without a question.
    const [stored] = [...backend.state.get(worldId)!.tasks.values()];
    expect(stored).toMatchObject({ title: 'Ler um livro', level: 'low', question: null, source: 'adhoc' });
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

describe('the one task form', () => {
  const stored = (worldId: string) => [...backend.state.get(worldId)!.tasks.values()];
  const defsOf = (worldId: string) => [...backend.state.get(worldId)!.taskDefs.values()];

  /** A world with an adult and two children, "Sam" and "Kim"; returns the admin device. */
  async function twoChildren() {
    const { admin, worldId } = await familyWithChild();
    await admin.click('button', 'Gerir');
    await admin.type('Nome', 'Kim');
    admin.submit();
    await vi.waitFor(() => expect(admin.root.querySelectorAll('ul.rows li').length).toBeGreaterThanOrEqual(3));
    await admin.click('button', 'Voltar');
    await admin.click('button.place', 'Quadro');
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Lavar a loiça');
    return { admin, worldId };
  }

  it('is disabled until someone is chosen', async () => {
    const { admin } = await twoChildren();
    await vi.waitFor(() => expect(admin.find('button.chip', 'Kim')).toBeDefined());
    expect((admin.find('button', 'Criar tarefa') as HTMLButtonElement).disabled).toBe(true);
    await pickPeople(admin, 'Kim');
    await admin.enabled('Criar tarefa');
  });

  it('makes one task for each chosen child when it happens once', async () => {
    const { admin, worldId } = await twoChildren();
    await pickPeople(admin, 'Sam', 'Kim');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('As tuas tarefas');
    expect(stored(worldId)).toHaveLength(2);
    expect(new Set(stored(worldId).map((t) => t.profileId)).size).toBe(2);
    expect(stored(worldId).every((t) => t.source === 'adhoc' && t.title === 'Lavar a loiça')).toBe(true);
    expect(defsOf(worldId)).toHaveLength(0);
  });

  it('makes a task for every active profile when "everyone" is chosen once', async () => {
    const { admin, worldId } = await twoChildren();
    await pickPeople(admin, 'Todos');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('As tuas tarefas');
    expect(stored(worldId)).toHaveLength(3); // Alex, Sam and Kim
  });

  it('makes one definition for the chosen children when it repeats', async () => {
    const { admin, worldId } = await twoChildren();
    await pickPeople(admin, 'Sam', 'Kim');
    await admin.click('button.chip', 'Todas as semanas');
    admin.submit();
    await admin.see('Lavar a loiça · Todas as semanas');
    expect(stored(worldId)).toHaveLength(0);
    expect(defsOf(worldId)).toHaveLength(1);
    expect(defsOf(worldId)[0]!.assignedTo).toHaveLength(2);
  });

  it('keeps an empty list for "everyone" in a repeating task, and says it includes new profiles', async () => {
    const { admin, worldId } = await twoChildren();
    await pickPeople(admin, 'Todos');
    expect(admin.find('small', 'perfis que vierem a ser criados')?.hidden).toBe(true); // once: no hint
    await admin.click('button.chip', 'Todos os dias');
    expect(admin.find('small', 'perfis que vierem a ser criados')?.hidden).toBe(false);
    admin.submit();
    await admin.see('Lavar a loiça · Todos os dias');
    expect(defsOf(worldId)[0]!.assignedTo).toEqual([]);
  });
});

describe('the one task card', () => {
  const cards = (device: Awaited<ReturnType<typeof openDevice>>) =>
    [...device.root.querySelectorAll('li.task-card')].map((li) => ({
      title: li.querySelector('.task-title')?.textContent,
      tags: [...li.querySelectorAll('.tag')].map((tag) => tag.textContent),
    }));

  it('shows the same cards in the same order on the board and in the check-in, and the board cannot complete anything', async () => {
    const { admin, worldId } = await familyWithChild();
    await admin.click('button.place', 'Quadro');
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Primeiro');
    await admin.click('button', '+ Juntar uma pergunta');
    await admin.type('Pergunta de verificação', 'Já está?');
    await pickPeople(admin, 'Sam');
    admin.submit();
    await admin.see('As tuas tarefas');
    now += 60_000;
    await admin.click('button', 'Voltar');
    await addRecurring(admin, 'Segundo');

    const child = await openDevice('child-device', { savedWorld: worldId }); // generates today’s task
    await child.click('button.place', 'Quadro');
    await child.see('Segundo');
    const expected = [
      { title: 'Primeiro', tags: [] },
      { title: 'Segundo', tags: ['↻ Todos os dias'] }, // no "?" chip for a question
    ];
    expect(cards(child)).toEqual(expected);
    expect(child.root.querySelectorAll('li.task-card button')).toHaveLength(0); // a task is completed only at the check-in

    await child.click('button', 'Voltar');
    await child.click('button.place', 'Registo');
    await child.see('Segundo');
    expect(cards(child)).toEqual(expected);
  });
});

describe('the board alert for new tasks', () => {
  const alert = (device: Awaited<ReturnType<typeof openDevice>>) => device.find('button.place', 'Quadro')?.getAttribute('data-alert') ?? null;

  it('lights when an adult gives the child a task, marks it "novo", and goes out once the child opens the board', async () => {
    const { admin, child } = await familyWithChild();
    await child.click('button.place', 'Quadro'); // the first visit only records the time
    await child.see('Nada por fazer');
    await child.click('button', 'Voltar');
    expect(alert(child)).toBeNull();

    now += 60_000;
    await createTask(admin, 'Arrumar o quarto', 'Sam');
    await vi.waitFor(() => expect(alert(child)).toBe('new'));
    expect(child.find('button.place', 'Quadro')?.textContent).not.toMatch(/\d/); // a dot, never a number

    await child.click('button.place', 'Quadro');
    await child.see('Arrumar o quarto');
    expect(child.find('li.task-card .tag.new')?.textContent).toBe('novo');
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(alert(child)).toBeNull());
  });

  it('does not light for a task the child made, nor for the daily repeat of a known definition', async () => {
    const { admin, child } = await familyWithChild();
    await child.click('button.place', 'Quadro');
    await child.click('button', 'Nova tarefa');
    await child.type('O que é para fazer?', 'Ler um livro');
    await child.enabled('Criar tarefa');
    child.submit();
    await child.see('Ler um livro');
    await child.click('button', 'Voltar');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(alert(child)).toBeNull();
    expect(admin.root).toBeDefined();
  });
});

describe('the adults’ view of the family', () => {
  it('lists the open and recently done tasks of a chosen profile, with no counts, and nothing of the others', async () => {
    const { admin, child } = await familyWithChild();
    await admin.click('button', 'Gerir');
    await admin.type('Nome', 'Kim');
    admin.submit();
    await vi.waitFor(() => expect(admin.root.querySelectorAll('ul.rows li').length).toBeGreaterThanOrEqual(3));
    await admin.click('button', 'Voltar');
    await createTask(admin, 'Arrumar o quarto', 'Sam');
    await admin.click('button', 'Voltar');
    await createTask(admin, 'Pôr a mesa', 'Sam');
    await admin.click('button', 'Voltar');
    await createTask(admin, 'Regar as plantas', 'Kim');
    await admin.click('button', 'Voltar');

    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    runTimers();
    await child.see('Nada para concluir').catch(() => {});
    await vi.waitFor(() => expect([...backend.state.get(admin.world.get()!)!.tasks.values()].some((t) => t.status === 'done')).toBe(true));

    await admin.click('button', 'Gerir');
    await admin.see('Tarefas por perfil');
    expect(admin.root.textContent).not.toContain('Arrumar o quarto'); // nobody chosen yet
    await admin.click('button.chip', 'Sam');
    await admin.see('Feitas nos últimos dias');
    await vi.waitFor(() => expect(admin.root.querySelectorAll('li.task-card')).toHaveLength(1)); // one still open
    expect(admin.root.querySelector('li.task-card .task-actions')).toBeNull(); // nothing to complete here
    expect([...admin.root.querySelectorAll('li.task-card button')].map((b) => b.className)).toEqual(['more']); // only the retire menu
    expect(admin.root.textContent).not.toContain('Regar as plantas');
    const doneItems = [...admin.root.querySelectorAll('ul.rows li:not(.task-card)')].filter((li) => li.querySelector('small'));
    expect(doneItems.some((li) => li.textContent?.includes('20 de outubro'))).toBe(true);

    await admin.click('button.chip', 'Kim');
    await admin.see('Regar as plantas');
    expect(admin.root.textContent).not.toContain('Pôr a mesa');
    expect(admin.root.textContent).not.toMatch(/\b\d+ (tarefas|feitas)/i); // no counts

    await admin.click('button.chip', 'Kim'); // tapping the chosen one again lets go of it
    await admin.notSee('Regar as plantas');
    expect(admin.find('button.chip[aria-pressed=true]')).toBeUndefined();
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

const state = (worldId: string) => backend.state.get(worldId)!;
const profileSam = (worldId: string) => [...state(worldId).profiles.values()].find((p) => p.displayName === 'Sam')!;
const profileNamed = (worldId: string, name: string) => [...state(worldId).profiles.values()].find((p) => p.displayName === name)!;
/** The committed token balance of a profile. */
const balanceOf = (worldId: string, name: string) => state(worldId).balances.get(profileNamed(worldId, name).id) ?? 0;
/** Gives a profile a balance directly, before its screen is opened. */
const giveTokens = (worldId: string, name: string, tokens: number) => void state(worldId).balances.set(profileNamed(worldId, name).id, tokens);

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
    runTimers();

    await child.notSee('Arrumar o quarto');
    expect(lines.congrats).toContain(bubble(child));
    expect(storedTask(worldId)).toMatchObject({ status: 'done', doneAt: now, weekKey: '2026-W43', answer: null, talkFlag: false });
    // A normal task earns 2 tokens: shown as icons, never as a number, and no reward is created.
    expect(storedTask(worldId)).toMatchObject({ tokens: 2 });
    expect(balanceOf(worldId, 'Sam')).toBe(2);
    expect(backend.state.get(worldId)!.rewards.size).toBe(0);
    const earned = child.root.querySelector('.earned')!;
    expect(earned.querySelectorAll('.token-art')).toHaveLength(2);
    expect(earned.getAttribute('aria-label')).toBe(`Ganhaste 2 ${theme.roles.token.plural}`);
    expect(earned.textContent).not.toMatch(/\d/);
  });

  it('earns 1, 2 or 4 by the level of the task, and nothing on undo or on "no"', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Difícil', 'Sam');
    const task = [...state(worldId).tasks.values()][0]!;
    state(worldId).tasks.set(task.id, { ...task, level: 'high' });
    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    await child.click('button', 'Desfazer');
    runTimers();
    expect(balanceOf(worldId, 'Sam')).toBe(0);
    await child.click('button', 'Feito');
    runTimers();
    await vi.waitFor(() => expect(balanceOf(worldId, 'Sam')).toBe(4));
  });

  it('gives a child’s own task 1 token', async () => {
    const { child, worldId } = await familyWithChild();
    await child.click('button.place', 'Quadro');
    await child.click('button', 'Nova tarefa');
    await child.type('O que é para fazer?', 'Ideia minha');
    await child.enabled('Criar tarefa');
    child.submit();
    await child.see('As tuas tarefas');
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    runTimers();
    await vi.waitFor(() => expect(balanceOf(worldId, 'Sam')).toBe(1));
  });

  it('shows no balance on the map, the board, the check-in, the home or the adults’ view', async () => {
    const { admin, child, worldId } = await familyWithChild();
    giveTokens(worldId, 'Sam', 37);
    giveTokens(worldId, 'Alex', 41);
    const digits = (device: typeof child) => device.root.textContent!.replace(/\d{4}|\d+ ?(out|nov)\./g, '');
    expect(child.root.textContent).not.toContain('37');
    for (const place of ['Quadro', 'Registo', 'Casa']) {
      await child.click('button.place', place);
      await vi.waitFor(() => expect(child.find('button', 'Voltar')).toBeDefined());
      expect(digits(child)).not.toContain('37');
      await child.click('button', 'Voltar');
    }
    await admin.click('button', 'Gerir');
    await admin.see('Tarefas por perfil');
    await admin.click('button.chip', 'Sam');
    expect(digits(admin)).not.toContain('37');
    expect(digits(admin)).not.toContain('41');
  });

  it('shows the question, completes on yes, and on no leaves the task open with a friendly line', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await admin.click('button.place', 'Quadro');
    await admin.click('button', 'Nova tarefa');
    await admin.type('O que é para fazer?', 'Lavar os dentes');
    await admin.click('button', '+ Juntar uma pergunta');
    await admin.type('Pergunta de verificação', 'Lavaste mesmo?');
    await pickPeople(admin, 'Sam');
    await admin.enabled('Criar tarefa');
    admin.submit();
    await admin.see('As tuas tarefas');

    await child.click('button.place', 'Registo');
    await child.see('Lavar os dentes');
    expect(child.root.textContent).not.toContain('Lavaste mesmo?'); // "done" comes first; the question after it
    expect(child.find('button', 'Sim')).toBeUndefined();

    await child.click('button', 'Feito');
    await child.see('Lavaste mesmo?');
    expect(child.find('button', 'Feito')).toBeUndefined(); // now it is the character's turn

    await child.click('button', 'Não');
    expect(lines.doubt).toContain(bubble(child));
    expect(storedTask(worldId)).toMatchObject({ status: 'open', answer: null }); // nothing is recorded
    expect(child.root.textContent).not.toContain('Lavaste mesmo?'); // back to "done"
    expect(child.find('button', 'Feito')).toBeDefined();

    await child.click('button', 'Feito');
    await child.click('button', 'Sim');
    runTimers();
    await child.notSee('Lavaste mesmo?');
    expect(storedTask(worldId)).toMatchObject({ status: 'done', answer: 'yes' });
  });

  it('gives four seconds to undo: nothing is written before, and "Desfazer" writes nothing at all', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Arrumar o quarto', 'Sam');
    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    await child.see('Desfazer');
    expect(timers.at(-1)!.ms).toBe(4000);
    expect(lines.congrats).toContain(bubble(child)); // the character already congratulates
    expect(storedTask(worldId)).toMatchObject({ status: 'open' });

    await child.click('button', 'Desfazer');
    runTimers();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(storedTask(worldId)).toMatchObject({ status: 'open' });
    expect(balanceOf(worldId, 'Sam')).toBe(0);
    expect(child.root.querySelector('.earned')).toBeNull();
    await child.see('Feito'); // the card is back

    await child.click('button', 'Feito');
    runTimers();
    await vi.waitFor(() => expect(storedTask(worldId)).toMatchObject({ status: 'done' }));
  });

  it('writes at once when the page is hidden or the screen is left, and writes two completions in a row', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Primeira', 'Sam');
    await admin.click('button', 'Voltar');
    await createTask(admin, 'Segunda', 'Sam');
    await child.click('button.place', 'Registo');
    await child.see('Segunda');
    await child.click('button', 'Feito');
    await child.click('button', 'Feito');
    const done = () => [...backend.state.get(worldId)!.tasks.values()].filter((t) => t.status === 'done').length;
    expect(done()).toBe(0);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await vi.waitFor(() => expect(done()).toBe(2));
    expect(balanceOf(worldId, 'Sam')).toBe(4);
  });

  it('writes a pending completion when the person leaves the check-in', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Primeira', 'Sam');
    await child.click('button.place', 'Registo');
    await child.click('button', 'Feito');
    await child.click('button', 'Voltar');
    await vi.waitFor(() => expect(storedTask(worldId)).toMatchObject({ status: 'done' }));
  });

  it('puts the button in front of the task, and a static note before the list instead of a button for "I did better"', async () => {
    const { admin, child } = await familyWithChild();
    await createTask(admin, 'Ler um capítulo', 'Sam');

    await child.click('button.place', 'Registo');
    await child.see('Ler um capítulo');
    const row = child.find('li.checkin-task')!;
    expect(row.querySelector('button')?.textContent).toBe('Feito'); // the button comes first
    expect(row.querySelector('.task-title')?.textContent).toBe('Ler um capítulo');
    const note = child.find('p.hint', 'fala com os teus pais')!;
    expect(note.textContent).toBe('Se achas que fizeste uma tarefa melhor do que o esperado, fala com os teus pais.');
    expect(note.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // before the list
    expect(child.find('button', 'Acho que fiz melhor')).toBeUndefined();
    expect(child.root.querySelectorAll('li.checkin-task button')).toHaveLength(1); // nothing but the completing button
  });

  it('says goodbye when there is nothing to complete, and never shows other people’s tasks', async () => {
    const { admin, child } = await familyWithChild();
    await createTask(admin, 'Só para mim', 'Alex'); // Alex's own task
    await child.click('button.place', 'Registo');
    await child.see('Nada para concluir');
    expect(lines.farewell).toContain(bubble(child));
    expect(child.root.textContent).not.toContain('Só para mim');
  });
});

/** Stores unopened rewards from before 0.9 for a profile, as the 0.8 completion left them. */
function giveLegacyRewards(worldId: string, name: string, count: number, tier: Tier = 'mid') {
  const profileId = profileNamed(worldId, name).id;
  for (let i = 0; i < count; i++) {
    const id = `legacy-${name}-${i}`;
    state(worldId).rewards.set(id, { schemaVersion: 1, createdAt: now + i, id, profileId, weekKey: '2026-W43', tier, openedAt: null });
  }
}

describe('retiring a task', () => {
  const more = (device: Device) => device.root.querySelectorAll('li.task-card .more');
  const taskNamed = (worldId: string, title: string) => [...state(worldId).tasks.values()].find((t) => t.title === title)!;

  it('shows "⋯" to a child only on an ad hoc task they made for themselves', async () => {
    const { admin, child } = await familyWithChild();
    await createTask(admin, 'Dada pelos pais', 'Sam');
    await child.click('button.place', 'Quadro');
    await child.click('button', 'Nova tarefa');
    await child.type('O que é para fazer?', 'Ideia minha');
    await child.enabled('Criar tarefa');
    child.submit();
    await child.see('As tuas tarefas');
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Registo');
    await child.see('Ideia minha');
    await child.see('Dada pelos pais');
    expect(child.find('li.task-card', 'Ideia minha')!.querySelector('.more')).not.toBeNull();
    expect(child.find('li.task-card', 'Dada pelos pais')!.querySelector('.more')).toBeNull();
    // Never next to "done", and not on the board.
    expect(child.find('li.task-card', 'Ideia minha')!.querySelector('.task-actions .more')).toBeNull();
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Quadro');
    await child.see('Ideia minha');
    expect(more(child)).toHaveLength(0);
  });

  it('asks once, then retires: the card leaves, nothing is earned, and it stays stored', async () => {
    const { admin, child, worldId } = await familyWithChild();
    await createTask(admin, 'Por engano', 'Sam');
    await child.click('button.place', 'Registo');
    await child.see('Por engano');
    expect(more(child)).toHaveLength(0); // an adult gave it: the child cannot retire it

    await admin.click('button', 'Voltar');
    await admin.click('button', 'Gerir');
    await admin.see('Tarefas por perfil');
    await admin.click('button.chip', 'Sam');
    await admin.see('Por engano');
    await admin.click('li.task-card .more', '');
    await admin.click('button[role="menuitem"]', 'Retirar tarefa');
    await admin.see('Retirar? Não volta a aparecer.');
    await admin.click('button', 'Cancelar');
    expect(taskNamed(worldId, 'Por engano').status).toBe('open');

    await admin.click('li.task-card .more', '');
    await admin.click('button[role="menuitem"]', 'Retirar tarefa');
    await admin.click('button.primary', 'Retirar');
    await vi.waitFor(() => expect(taskNamed(worldId, 'Por engano')).toMatchObject({ status: 'retired', retiredAt: now, retiredBy: profileNamed(worldId, 'Alex').id }));
    expect(taskNamed(worldId, 'Por engano').tokens).toBeUndefined();
    await vi.waitFor(() => expect(admin.root.querySelectorAll('li.task-card')).toHaveLength(0));
    await vi.waitFor(() => expect(child.root.textContent).not.toContain('Por engano'));
    // It is not in "done in the last days" either.
    expect(admin.root.textContent).not.toContain('Por engano');
  });

  it('lets an adult retire their own task from the check-in', async () => {
    const { admin, worldId } = await familyWithChild();
    await createTask(admin, 'Minha', 'Alex');
    await admin.click('button', 'Voltar');
    await admin.click('button.place', 'Registo');
    await admin.see('Minha');
    await admin.click('li.task-card .more', '');
    await admin.click('button[role="menuitem"]', 'Retirar tarefa');
    await admin.click('button.primary', 'Retirar');
    await vi.waitFor(() => expect(taskNamed(worldId, 'Minha').status).toBe('retired'));
    await admin.notSee('Minha');
  });

  it('does not bring a retired daily task back today, and brings the next one tomorrow', async () => {
    const { admin, worldId } = await familyWithChild();
    await addRecurring(admin, 'Regar');
    const tasks = () => [...state(worldId).tasks.values()].filter((t) => t.title === 'Regar' && t.profileId === profileNamed(worldId, 'Alex').id);
    const reopen = async () => {
      const device = await openDevice('admin-device', { savedWorld: worldId });
      await device.click('button.place', 'Registo');
      return device;
    };
    const first = await reopen();
    await first.see('Regar');
    await first.click('li.task-card .more', '');
    await first.click('button[role="menuitem"]', 'Retirar tarefa');
    await first.click('button.primary', 'Retirar');
    await vi.waitFor(() => expect(tasks()[0]!.status).toBe('retired'));

    const sameDay = await reopen();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(tasks()).toHaveLength(1);
    expect(sameDay.root.textContent).not.toContain('Regar');

    now += 24 * 3_600_000;
    const nextDay = await reopen();
    await nextDay.see('Regar');
    expect(tasks().map((t) => t.status).sort()).toEqual(['open', 'retired']);
  });
});

describe('the vault', () => {
  type Device = Awaited<ReturnType<typeof openDevice>>;
  const tier = (device: Device, which: Tier) => device.find(`button.tier[data-tier="${which}"]`) as HTMLButtonElement;

  /** A child with `tokens`, standing in the vault. */
  async function childWithTokens(tokens: number) {
    const family = await familyWithChild();
    giveTokens(family.worldId, 'Sam', tokens);
    await family.child.click('button.place', 'Cofre');
    return family;
  }

  it('shows the balance at the top, with a text alternative, and the three tiers with their invite and price', async () => {
    const { child } = await childWithTokens(12);
    await vi.waitFor(() => expect(child.root.querySelector('.balance strong')?.textContent).toBe('12'));
    expect(child.root.querySelector('.balance [role="img"]')?.getAttribute('aria-label')).toBe(`Tens 12 ${theme.roles.token.plural}`);
    for (const [which, price] of [['low', '5'], ['mid', '12'], ['high', '25']] as const) {
      const button = tier(child, which);
      expect(button.querySelector('.invite')?.textContent).toBe(theme.vault.invite[which]);
      expect(button.querySelector('.price')?.textContent?.endsWith(price)).toBe(true);
      const art = theme.rewardArt[which];
      expect(button.querySelector('.reward-art')?.textContent).toBe('emoji' in art ? art.emoji : '');
    }
  });

  it('lays the tiers out on the theme’s background when it has spots, and stacks them when it has not', async () => {
    const { child } = await childWithTokens(0);
    await vi.waitFor(() => expect(tier(child, 'low')).toBeDefined());
    const hasSpots = theme.vault.spots !== undefined;
    expect(child.root.querySelector(hasSpots ? '.depth.placed' : '.depth.stacked')).not.toBeNull();
    if (theme.vault.spots) expect(tier(child, 'high').style.top).toBe(`${theme.vault.spots.high.y}%`);
  });

  it('lets a tier be chosen when affordable, dims one that is not, and a tap on it does nothing', async () => {
    const { child } = await childWithTokens(12);
    await vi.waitFor(() => expect(tier(child, 'mid')).toBeDefined());
    expect(tier(child, 'low').getAttribute('aria-disabled')).toBe('false');
    expect(tier(child, 'mid').getAttribute('aria-disabled')).toBe('false');
    expect(tier(child, 'high').getAttribute('aria-disabled')).toBe('true');
    expect(tier(child, 'high').textContent).toContain('Ainda não tens');

    tier(child, 'high').click();
    expect(child.find('button.open-for')).toBeUndefined();
    expect(tier(child, 'high').classList.contains('selected')).toBe(false);

    tier(child, 'mid').click();
    expect(child.find('button.open-for')?.textContent).toContain('Abrir por 12');
    tier(child, 'low').click(); // another tier changes the choice
    expect(child.find('button.open-for')?.textContent).toContain('Abrir por 5');
    expect(tier(child, 'mid').classList.contains('selected')).toBe(false);
    child.root.querySelector<HTMLElement>('.balance')!.click(); // anywhere else cancels it
    expect(child.find('button.open-for')).toBeUndefined();
  });

  it('buys with "Abrir por 12": takes the price, reveals a collectible of that tier, pending, opened at once', async () => {
    const { child, worldId } = await childWithTokens(12);
    await vi.waitFor(() => expect(tier(child, 'mid')).toBeDefined());
    tier(child, 'mid').click();
    (child.find('button.open-for') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(1));
    expect(balanceOf(worldId, 'Sam')).toBe(0);
    const collectible = [...state(worldId).collectibles.values()][0]!;
    const reward = [...state(worldId).rewards.values()][0]!;
    expect(collectible).toMatchObject({ tier: 'mid', reserveAt: null, id: reward.id });
    expect(reward).toMatchObject({ price: 12, tier: 'mid' });
    expect(reward.openedAt).not.toBeNull();
    const entry = theme.catalog.slots.find((slot) => slot.slot === collectible.slot)!;
    expect(entry.tier).toBe('mid');

    await child.see('Saiu um cromo!');
    await child.see(entry.name);
    await vi.waitFor(() => expect(child.root.querySelector('.balance strong')?.textContent).toBe('0'));
    expect(child.find('button.open-for')).toBeUndefined();
    // Everything is dimmed now, and the new creature can be named at once.
    expect(tier(child, 'low').getAttribute('aria-disabled')).toBe('true');
    expect(child.find('.reveal button.name-tag', 'dá-lhe um nome')).toBeDefined();
  });

  it('sends the new collectible straight to the reserve with "let it go", and keeps it pending with "later"', async () => {
    const { child, worldId } = await childWithTokens(10);
    await vi.waitFor(() => expect(tier(child, 'low')).toBeDefined());
    tier(child, 'low').click();
    (child.find('button.open-for') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(1));
    await child.click('button', 'Enviar para');
    await vi.waitFor(() => expect([...state(worldId).collectibles.values()][0]!.reserveAt).toBe(now));
    expect(profileSam(worldId).partyIds).toEqual([]);
    await child.notSee('Saiu um cromo!');

    tier(child, 'low').click();
    (child.find('button.open-for') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(2));
    await child.click('button', 'Mais tarde');
    await child.see('Recentes');
    expect([...state(worldId).collectibles.values()].filter((c) => c.reserveAt === null)).toHaveLength(1);
  });

  it('says the tokens were spent elsewhere when the server refuses, and loses nothing', async () => {
    const { child, worldId } = await childWithTokens(25);
    await vi.waitFor(() => expect(tier(child, 'high')).toBeDefined());
    // Another device of the same profile spends the tokens first.
    const other = await openDevice('child-device-2', { hash: `#/join/${worldId}` });
    await other.click('button.profile', 'Sam');
    await other.click('button.place', 'Cofre');
    await vi.waitFor(() => expect(tier(other, 'high')).toBeDefined());

    tier(child, 'high').click();
    const buyHere = child.find('button.open-for') as HTMLButtonElement;
    tier(other, 'high').click();
    // Both press in the same moment: the first to reach the backend wins.
    buyHere.click();
    (other.find('button.open-for') as HTMLButtonElement).click();

    // The second to reach the backend is refused: its reveal goes away and a line says why.
    await vi.waitFor(() => expect(other.root.textContent).toContain('já tinham sido gastas noutro aparelho'));
    expect(child.root.textContent).not.toContain('já tinham sido gastas');
    expect(balanceOf(worldId, 'Sam')).toBe(0);
    expect(state(worldId).collectibles.size).toBe(1);
    await vi.waitFor(() => expect(other.root.querySelectorAll('.reveal')).toHaveLength(0));
    expect(child.root.querySelectorAll('.reveal')).toHaveLength(1);
  });

  it('shows no balance in the vault of an adult who has none, only zero', async () => {
    const { admin } = await familyWithChild();
    await admin.click('button.place', 'Cofre');
    await vi.waitFor(() => expect(admin.root.querySelector('.balance strong')?.textContent).toBe('0'));
  });
});

describe('rewards found before 0.9', () => {
  it('lists the rewards of the active profile only, under "Já encontrados", with no weeks and no counts', async () => {
    const { admin, child, worldId } = await familyWithChild();
    giveLegacyRewards(worldId, 'Sam', 2, 'high');
    giveLegacyRewards(worldId, 'Alex', 1);
    await child.click('button.place', 'Cofre');
    await child.see('Já encontrados');
    await vi.waitFor(() => expect(child.root.querySelectorAll('li.reward')).toHaveLength(2));
    expect(child.root.textContent).not.toMatch(/Semana|W\d|a partir de/);
    for (const item of child.root.querySelectorAll<HTMLElement>('li.reward')) {
      const art = theme.rewardArt[item.dataset.tier as Tier];
      expect(item.querySelector('.reward-art')?.textContent).toBe('emoji' in art ? art.emoji : '');
    }
    // The adult's own vault holds only the adult's reward.
    await admin.click('button.place', 'Cofre');
    await vi.waitFor(() => expect(admin.root.querySelectorAll('li.reward')).toHaveLength(1));
  });

  it('shows nothing about them when there are none', async () => {
    const { child } = await familyWithChild();
    await child.click('button.place', 'Cofre');
    await vi.waitFor(() => expect(child.root.querySelector('.balance')).not.toBeNull());
    expect(child.root.textContent).not.toContain('Já encontrados');
  });

  it('opens for free on a Wednesday, with a reveal of the reward’s tier', async () => {
    const { child, worldId } = await familyWithChild();
    giveLegacyRewards(worldId, 'Sam', 1, 'mid');
    now = Date.parse('2026-10-21T10:00:00Z'); // Wednesday
    await child.click('button.place', 'Cofre');
    await child.click('button', 'Abrir');
    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(1));
    const collectible = [...state(worldId).collectibles.values()][0]!;
    expect(collectible).toMatchObject({ tier: 'mid', obtainedAt: now, reserveAt: null });
    expect(balanceOf(worldId, 'Sam')).toBe(0);
    const entry = theme.catalog.slots.find((slot) => slot.slot === collectible.slot)!;
    await child.see('Saiu um cromo!');
    await child.see(entry.name);
    expect(child.root.querySelectorAll('li.reward')).toHaveLength(0);
    await child.click('button', 'Mais tarde');
    await child.see('Recentes');
  });

  it('offers "Abrir todos" only with two or more, and shows the reveals one after the other', async () => {
    const { child, worldId } = await childWithRewards(1);
    expect(child.find('button', 'Abrir todos')).toBeUndefined();
    giveLegacyRewards(worldId, 'Sam', 4); // ids 0 to 3: the first is the one already there
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Cofre');
    await vi.waitFor(() => expect(child.root.querySelectorAll('li.reward')).toHaveLength(4));
    await child.click('button.primary', 'Abrir todos');
    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(4));
    await vi.waitFor(() => expect(child.root.querySelectorAll('.reveal')).toHaveLength(4));
    expect(child.find('button', 'Abrir todos')).toBeUndefined();
  });

  it('ends with one collectible when another device of the same profile opened the reward first', async () => {
    const { child, worldId } = await childWithRewards(1);
    await child.see('Abrir');

    const second = await openDevice('child-device-2', { hash: `#/join/${worldId}` });
    const profileId = profileSam(worldId).id;
    await second.click('button.profile', 'Sam');
    await second.click('button.place', 'Cofre');
    await second.click('button', 'Abrir');
    await vi.waitFor(() => expect(state(worldId).collectibles.size).toBe(1));
    expect([...state(worldId).collectibles.values()][0]!.profileId).toBe(profileId);

    // The first device was still showing the reward: it leaves the list, and nothing is duplicated.
    await vi.waitFor(() => expect(child.find('button', 'Abrir')).toBeUndefined());
    expect(state(worldId).collectibles.size).toBe(1);
  });
});

const SUNDAY = Date.parse('2026-10-25T10:00:00Z');

/** A child with `count` rewards from before 0.9, standing in the vault. */
async function childWithRewards(count: number) {
  const { admin, child, worldId } = await familyWithChild();
  giveLegacyRewards(worldId, 'Sam', count, 'low');
  now = SUNDAY;
  await child.click('button.place', 'Cofre');
  return { admin, child, worldId };
}

const openAll = async (child: Awaited<ReturnType<typeof openDevice>>, worldId: string, count: number) => {
  for (let i = 0; i < count; i++) {
    await child.click('li.reward button', 'Abrir');
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
  type HomeDevice = Awaited<ReturnType<typeof openDevice>>;
  /** The small buttons of the party, and the card that a tap on one opens. */
  const members = (device: HomeDevice) => [...device.root.querySelectorAll<HTMLElement>('.showcase-item')];
  const partyCard = (device: HomeDevice) => device.root.querySelector<HTMLElement>('.party-card');
  const openMember = async (device: HomeDevice) => {
    await vi.waitFor(() => expect(members(device)).toHaveLength(1));
    if (!partyCard(device)) members(device)[0]!.click();
    await vi.waitFor(() => expect(partyCard(device)).not.toBeNull());
  };

  it('shows the profile with the look of its kind, the button to choose a symbol, the party and the pending collectibles, with no counts', async () => {
    const { child } = await childAtHome();
    await child.see('Sam');
    await child.see('Escolher o meu símbolo');
    expect(child.root.textContent).not.toContain('avatar');
    await child.see('que andam contigo');
    expect(child.root.textContent).not.toContain('Aqui descansam'); // no reserve on the profile
    expect(child.root.querySelector('.home-art')?.textContent).toBe('emoji' in theme.homeVariants.child ? theme.homeVariants.child.emoji : '');
    await vi.waitFor(() => expect(members(child)).toHaveLength(1));
    expect(partyCard(child)).toBeNull(); // the card opens on a tap
    expect(child.root.querySelectorAll('li.collectible-card')).toHaveLength(1); // the pending one
    expect(child.root.textContent).not.toMatch(/\d+ (de|na|no|em)\b/);
  });

  it('renames a collectible, then shows the catalogue name again when the name is cleared', async () => {
    const { child, worldId, first } = await childAtHome();
    const catalogueName = () => partyCard(child)?.querySelector('.name-tag .tag-name')?.textContent;
    await openMember(child);
    const original = catalogueName();
    await child.click('button.name-tag', 'dar um nome');
    await child.type('Nome', 'Bolinhas');
    child.submit();
    await vi.waitFor(() => expect(state(worldId).collectibles.get(first)!.nickname).toBe('Bolinhas'));
    await vi.waitFor(() => expect(catalogueName()).toBe('Bolinhas'));

    await child.click('button.name-tag', 'Bolinhas');
    await child.type('Nome', '   ');
    child.submit();
    await vi.waitFor(() => expect(state(worldId).collectibles.get(first)!.nickname).toBeNull());
    await vi.waitFor(() => expect(catalogueName()).toBe(original));
  });

  it('edits the name tag in place: Escape cancels, leaving the field saves, a long name is refused, and the catalogue name stays under a nickname', async () => {
    const { child, worldId, first } = await childAtHome();
    await openMember(child);
    const field = () => partyCard(child)!.querySelector('input') as HTMLInputElement | null;
    const original = partyCard(child)!.querySelector('.tag-name')!.textContent;

    await child.click('button.name-tag', 'dar um nome');
    await vi.waitFor(() => expect(field()).not.toBeNull());
    field()!.value = 'Nunca guardado';
    field()!.dispatchEvent(new Event('input'));
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect(field()).toBeNull());
    expect(state(worldId).collectibles.get(first)!.nickname).toBeNull();

    await child.click('button.name-tag', 'dar um nome');
    await vi.waitFor(() => expect(field()).not.toBeNull());
    field()!.value = 'Salvo ao sair';
    field()!.dispatchEvent(new Event('input'));
    field()!.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(state(worldId).collectibles.get(first)!.nickname).toBe('Salvo ao sair'));
    await vi.waitFor(() => expect(partyCard(child)!.querySelector('.tag-catalogue')?.textContent).toBe(original));

    await child.click('button.name-tag', 'Salvo ao sair');
    await vi.waitFor(() => expect(field()).not.toBeNull());
    field()!.maxLength = 500; // a pasted text can exceed what the field allows
    field()!.value = 'x'.repeat(31);
    field()!.dispatchEvent(new Event('input'));
    child.submit();
    await child.see('O nome é demasiado comprido');
    expect(state(worldId).collectibles.get(first)!.nickname).toBe('Salvo ao sair');
  });

  it('sends a party member away: it leaves the profile and shows in the showcase, and is not deleted', async () => {
    const { child, worldId, first } = await childAtHome();
    await openMember(child);
    await child.click('button', 'Enviar para a reserva');
    await vi.waitFor(() => expect(profileSam(worldId).partyIds).toEqual([]));
    expect(state(worldId).collectibles.get(first)!.reserveAt).toBe(now);
    await vi.waitFor(() => expect(members(child)).toHaveLength(0));
    expect(partyCard(child)).toBeNull();
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
    await vi.waitFor(() => expect(members(child)[0]!.querySelector('span')?.textContent).toBe(theme.tiers[tier]));
    await openMember(child);
    expect(partyCard(child)!.querySelector('.tag-name')?.textContent).toBe(theme.tiers[tier]);
  });

  it('closes the card with "Fechar", and shows only small buttons again', async () => {
    const { child } = await childAtHome();
    await openMember(child);
    await child.click('.party-card button', 'Fechar');
    await vi.waitFor(() => expect(partyCard(child)).toBeNull());
    expect(members(child)).toHaveLength(1);
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

  it('lets a person bring one of their own back into the party from here', async () => {
    const { child, worldId } = await reserveOfTheChild();
    await child.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(child)).toHaveLength(2));
    (items(child)[0] as HTMLElement).click();
    await child.click('button.primary', 'Trazer de volta');
    await vi.waitFor(() => expect(profileSam(worldId).partyIds).toHaveLength(1));
    const id = profileSam(worldId).partyIds[0]!;
    expect(state(worldId).collectibles.get(id)!.reserveAt).toBeNull();
    await vi.waitFor(() => expect(items(child)).toHaveLength(1)); // it left the showcase
    expect(state(worldId).collectibles.size).toBe(2); // nothing deleted
  });

  it('lets anyone take one into their own party, whoever it came from: it changes owner and keeps its name', async () => {
    const { admin, worldId } = await reserveOfTheChild();
    const [named] = [...state(worldId).collectibles.values()];
    state(worldId).collectibles.set(named!.id, { ...named!, nickname: 'Batizado' });
    await admin.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(admin)).toHaveLength(2));
    const item = items(admin).find((el) => el.textContent?.includes('Batizado')) as HTMLElement;
    item.click();
    await admin.click('button.primary', 'Trazer de volta');
    const alex = profileNamed(worldId, 'Alex');
    await vi.waitFor(() => expect(profileNamed(worldId, 'Alex').partyIds).toEqual([named!.id]));
    expect(state(worldId).collectibles.get(named!.id)).toMatchObject({ profileId: alex.id, reserveAt: null, nickname: 'Batizado' });
    await vi.waitFor(() => expect(items(admin)).toHaveLength(1));
    expect(admin.root.textContent).not.toMatch(/Sam/); // still no owner shown
  });

  it('says someone was faster when another person took it first', async () => {
    const { admin, child, worldId } = await reserveOfTheChild();
    await admin.click('button.place', 'Vitrina');
    await child.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(admin)).toHaveLength(2));
    await vi.waitFor(() => expect(items(child)).toHaveLength(2));
    (items(admin)[0] as HTMLElement).click();
    (items(child)[0] as HTMLElement).click();
    await admin.click('button.primary', 'Trazer de volta');
    child.find('button.primary', 'Trazer de volta')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Alguém foi mais rápido.'));
    expect(profileNamed(worldId, 'Alex').partyIds).toHaveLength(1);
    expect(profileSam(worldId).partyIds).toHaveLength(0);
  });

  it('lets an admin rename an item, and not a child', async () => {
    const { admin, child, worldId } = await reserveOfTheChild();
    await child.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(child)).toHaveLength(2));
    (items(child)[0] as HTMLElement).click();
    await child.see('Fechar');
    expect(child.find('button.name-tag')).toBeUndefined(); // a child cannot rename someone else's

    await admin.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(admin)).toHaveLength(2));
    (items(admin)[0] as HTMLElement).click();
    await admin.click('button.name-tag', 'dar um nome');
    await admin.type('Nome', 'Moderado');
    admin.submit();
    await vi.waitFor(() => expect([...state(worldId).collectibles.values()].some((c) => c.nickname === 'Moderado')).toBe(true));
    await vi.waitFor(() => expect(items(admin).some((el) => el.textContent?.includes('Moderado'))).toBe(true));
  });

  it('shows the newest ten of the world; the others stay stored, out of reach, until an admin makes room', async () => {
    const { admin, child, worldId } = await reserveOfTheChild();
    const mine = [...state(worldId).collectibles.values()];
    const template = mine[0]!;
    // Ten newer ones, so the two original items are the oldest of twelve.
    for (let i = 0; i < 10; i++) {
      const id = `extra-${i}`;
      state(worldId).collectibles.set(id, { ...template, id, reserveAt: template.reserveAt! + 1000 + i });
    }
    await child.click('button.place', 'Vitrina');
    await vi.waitFor(() => expect(items(child)).toHaveLength(10));
    const shownIds = items(child).map((el) => el.getAttribute('data-id'));
    expect(shownIds.every((id) => id?.startsWith('extra-'))).toBe(true); // the two oldest are not offered
    expect(child.find('button', 'Trazer de volta')).toBeUndefined();
    expect(child.root.textContent).not.toMatch(/\d/); // and nothing says that something left
    expect(state(worldId).collectibles.size).toBe(12); // nothing deleted

    // An admin changes the size in management, and the showcase of the other device follows.
    await admin.click('button', 'Gerir');
    await admin.type('Lugares', '3');
    const field = [...admin.root.querySelectorAll('label')].find((l) => l.textContent?.includes('Lugares'))!;
    field.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(state(worldId).world.ruleset.showcaseSize).toBe(3));
    await vi.waitFor(() => expect(items(child)).toHaveLength(3));
    expect(state(worldId).collectibles.size).toBe(12);
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

  it('shows the adults’ symbols on the big ship at the pier, to everyone, and not the children’s', async () => {
    const { worldId } = await seed([{ name: 'Sam', symbol: CRAB }]);
    const admin = await asAdult(worldId);
    await admin.click('button.place', 'Casa');
    await admin.click('button', 'Escolher o meu símbolo');
    (admin.root.querySelector('.symbol-panel [data-emoji="🐬"]') as HTMLElement).click();
    await admin.click('button', 'Voltar');
    const onShip = (device: typeof admin) => [...device.root.querySelectorAll('button.place .place-slot .boat-symbol')].map((el) => el.textContent);
    await vi.waitFor(() => expect(onShip(admin)).toEqual(['🐬']));
    const child = await asChild(worldId, 'Sam');
    await vi.waitFor(() => expect(boats(child)).toHaveLength(1));
    await vi.waitFor(() => expect(onShip(child)).toEqual(['🐬'])); // the child sees the adult's symbol, not their own
  });

  it('shares the sail between several adults, in creation order, and skips an adult without a symbol', async () => {
    const { worldId } = await seed([]);
    const store = createMemoryStore(backend, { uid: 'seed', clock, randomInt });
    await store.session.signIn();
    const alex = [...backend.state.get(worldId)!.profiles.values()][0]!;
    await store.worlds.setProfileSymbol(worldId, alex.id, '🐬').settled;
    now += 1000;
    await store.worlds.createProfile(worldId, { displayName: 'Robin', kind: 'adult', symbol: '🦀' }).settled;
    now += 1000;
    await store.worlds.createProfile(worldId, { displayName: 'Kim', kind: 'adult' }).settled;
    now += 1000;
    await store.worlds.createProfile(worldId, { displayName: 'Lee', kind: 'adult', symbol: '🐙' }).settled;
    const admin = await asAdult(worldId);
    await vi.waitFor(() => expect([...admin.root.querySelectorAll('button.place .place-slot .boat-symbol')].map((el) => el.textContent)).toEqual(['🐬', '🦀', '🐙']));
    expect(admin.root.querySelector('.map')!.textContent).not.toMatch(/Robin|Kim|Lee/);
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

describe('the token rules', () => {
  const rulesOf = (worldId: string) => backend.state.get(worldId)!.world.ruleset;
  type Device = Awaited<ReturnType<typeof openDevice>>;
  /** The token rules form is the one with a fieldset: six inputs, three amounts then three prices. */
  const rulesForm = (device: Device) => [...device.root.querySelectorAll('form')].find((form) => form.querySelector('fieldset'))!;
  const inputs = (device: Device) => [...rulesForm(device).querySelectorAll<HTMLInputElement>('input')];
  const submit = (device: Device) => rulesForm(device).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const fill = (device: Device, values: number[]) => inputs(device).forEach((input, i) => (input.value = String(values[i])));

  it('shows the rules of the world, saves new ones, and refuses prices that do not rise or values out of range', async () => {
    const { admin, worldId } = await familyWithChild();
    await admin.click('button', 'Gerir');
    await admin.see('Recompensas');
    await vi.waitFor(() => expect(inputs(admin).map((input) => input.value)).toEqual(['1', '2', '4', '5', '12', '25']));

    fill(admin, [2, 3, 5, 6, 10, 30]);
    submit(admin);
    await vi.waitFor(() => expect(rulesOf(worldId).tokensPerLevel).toEqual({ low: 2, mid: 3, high: 5 }));
    expect(rulesOf(worldId).tokenPrices).toEqual({ low: 6, mid: 10, high: 30 });

    fill(admin, [2, 3, 5, 5, 5, 25]);
    submit(admin);
    await admin.see('Os preços têm de subir');
    expect(rulesOf(worldId).tokenPrices).toEqual({ low: 6, mid: 10, high: 30 });

    fill(admin, [0, 3, 5, 6, 10, 30]);
    submit(admin);
    await admin.see('de 1 a 10');
    fill(admin, [2, 3, 11, 6, 10, 30]);
    submit(admin);
    await admin.see('de 1 a 10');
    expect(rulesOf(worldId).tokensPerLevel).toEqual({ low: 2, mid: 3, high: 5 });
  });

  it('shows the token icon beside every value and the themed noun in the explanation', async () => {
    const { admin } = await familyWithChild();
    await admin.click('button', 'Gerir');
    await admin.see('Recompensas');
    expect(rulesForm(admin).querySelectorAll('.token-art')).toHaveLength(6);
    await admin.see(theme.roles.token.plural);
  });
});

describe('the size of the party', () => {
  it('is saved by an admin and refuses 0 and 11', async () => {
    const { admin, worldId } = await familyWithChild();
    await admin.click('button', 'Gerir');
    const input = () => [...admin.root.querySelectorAll('label')].find((l) => l.textContent?.includes('Tamanho'))!.querySelector('input')!;
    const form = () => input().closest('form')!;
    await vi.waitFor(() => expect(input().value).toBe('5'));
    for (const bad of ['0', '11']) {
      input().value = bad;
      form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      await admin.see('de 1 a 10');
      expect(backend.state.get(worldId)!.world.ruleset.partySize).toBe(5);
    }
    input().value = '2';
    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(backend.state.get(worldId)!.world.ruleset.partySize).toBe(2));
  });

  it('lowered below a party of 3: the party keeps all three, nobody joins, and one can still leave', async () => {
    const { admin, child, worldId } = await childWithRewards(4);
    await openAll(child, worldId, 4);
    const recent = () => [...child.root.querySelectorAll<HTMLButtonElement>('.recent-card button.primary')];
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(recent().length).toBeGreaterThan(0));
      recent()[0]!.click();
      await vi.waitFor(() => expect(profileSam(worldId).partyIds).toHaveLength(i + 1));
    }

    await admin.click('button', 'Gerir');
    const input = () => [...admin.root.querySelectorAll('label')].find((l) => l.textContent?.includes('Tamanho'))!.querySelector('input')!;
    await vi.waitFor(() => expect(input().value).toBe('5'));
    input().value = '2';
    input().closest('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(state(worldId).world.ruleset.partySize).toBe(2));

    // The party keeps its three, and the fourth cannot join.
    expect(profileSam(worldId).partyIds).toHaveLength(3);
    await child.see('acima do limite');
    expect(child.find('button', 'Pôr na')).toBeUndefined();
    expect(profileSam(worldId).partyIds).toHaveLength(3);

    // Leaving is still possible, from the home.
    await child.click('button', 'Voltar');
    await child.click('button.place', 'Casa');
    await child.click('button.showcase-item', '');
    await child.click('button', 'Enviar para');
    await vi.waitFor(() => expect(profileSam(worldId).partyIds).toHaveLength(2));
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
