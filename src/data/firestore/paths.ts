/** The only place that knows where documents live (docs/architecture.md §5). */
import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { ProfileId, TaskId, Uid, WorldId } from '../../core/model';

export const worldDoc = (db: Firestore, worldId: WorldId): DocumentReference => doc(db, 'worlds', worldId);

const worldCollection = (db: Firestore, worldId: WorldId, name: string): CollectionReference =>
  collection(db, 'worlds', worldId, name);

export const membersCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'members');
export const profilesCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'profiles');
export const tasksCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'tasks');

export const memberDoc = (db: Firestore, worldId: WorldId, uid: Uid) => doc(membersCollection(db, worldId), uid);
export const profileDoc = (db: Firestore, worldId: WorldId, profileId: ProfileId) =>
  doc(profilesCollection(db, worldId), profileId);
export const taskDoc = (db: Firestore, worldId: WorldId, taskId: TaskId) => doc(tasksCollection(db, worldId), taskId);
