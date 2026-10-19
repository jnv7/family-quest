/**
 * Domain ↔ Firestore documents (docs/architecture.md §5).
 *
 * `encode*` drops the id (it is the document id) and turns `Millis` into
 * `Timestamp`. `decode*` does the reverse, and returns null, after reporting
 * the path with `console.error`, for a document whose `schemaVersion` it does
 * not know. It never coerces such a document.
 */
import { Timestamp, type DocumentData, type DocumentSnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import { SCHEMA_VERSION, type Member, type Millis, type Profile, type Task, type TaskDef, type World } from '../../core/model';

type Snapshot = DocumentSnapshot | QueryDocumentSnapshot;

const toTimestamp = (millis: Millis): Timestamp => Timestamp.fromMillis(millis);
const toMillis = (value: unknown): Millis => (value as Timestamp).toMillis();

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _dropped, ...rest } = value;
  return rest;
}

/** The snapshot's data, or null if it is missing or has an unknown schema version. */
function readKnown(snapshot: Snapshot): DocumentData | null {
  const data = snapshot.data();
  if (!data) return null;
  if (data.schemaVersion !== SCHEMA_VERSION) {
    console.error(`Skipping ${snapshot.ref.path}: unknown schemaVersion ${String(data.schemaVersion)}`);
    return null;
  }
  return data;
}

export function encodeWorld(world: World): DocumentData {
  return { ...withoutKey(world, 'id'), createdAt: toTimestamp(world.createdAt) };
}

export function decodeWorld(snapshot: Snapshot): World | null {
  const data = readKnown(snapshot);
  return data && ({ ...data, id: snapshot.id, createdAt: toMillis(data.createdAt) } as World);
}

export function encodeMember(member: Member): DocumentData {
  return { ...withoutKey(member, 'uid'), createdAt: toTimestamp(member.createdAt) };
}

export function decodeMember(snapshot: Snapshot): Member | null {
  const data = readKnown(snapshot);
  return data && ({ ...data, uid: snapshot.id, createdAt: toMillis(data.createdAt) } as Member);
}

export function encodeProfile(profile: Profile): DocumentData {
  return { ...withoutKey(profile, 'id'), createdAt: toTimestamp(profile.createdAt) };
}

export function decodeProfile(snapshot: Snapshot): Profile | null {
  const data = readKnown(snapshot);
  return data && ({ ...data, id: snapshot.id, createdAt: toMillis(data.createdAt) } as Profile);
}

export function encodeTask(task: Task): DocumentData {
  return {
    ...withoutKey(task, 'id'),
    createdAt: toTimestamp(task.createdAt),
    doneAt: task.doneAt === null ? null : toTimestamp(task.doneAt),
  };
}

export function decodeTask(snapshot: Snapshot): Task | null {
  const data = readKnown(snapshot);
  return (
    data &&
    ({
      ...data,
      id: snapshot.id,
      createdAt: toMillis(data.createdAt),
      doneAt: data.doneAt === null ? null : toMillis(data.doneAt),
    } as Task)
  );
}

export function encodeTaskDef(def: TaskDef): DocumentData {
  return { ...withoutKey(def, 'id'), createdAt: toTimestamp(def.createdAt) };
}

export function decodeTaskDef(snapshot: Snapshot): TaskDef | null {
  const data = readKnown(snapshot);
  return data && ({ ...data, id: snapshot.id, createdAt: toMillis(data.createdAt) } as TaskDef);
}

/** Fields written when a task is completed. */
export function encodeTaskCompletion(fields: {
  doneAt: Millis;
  answer: Task['answer'];
  talkFlag: boolean;
  weekKey: string;
}): DocumentData {
  return { status: 'done', ...fields, doneAt: toTimestamp(fields.doneAt) };
}

export function decodeAll<T>(docs: readonly QueryDocumentSnapshot[], decode: (snapshot: Snapshot) => T | null): T[] {
  return docs.flatMap((snapshot) => {
    const value = decode(snapshot);
    return value === null ? [] : [value];
  });
}
