/** The only place that knows where documents live (docs/architecture.md §5). */
import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { ProfileId, TaskDefId, TaskId, Uid, WorldId } from '../../core/model';

export const worldDoc = (db: Firestore, worldId: WorldId): DocumentReference => doc(db, 'worlds', worldId);

const worldCollection = (db: Firestore, worldId: WorldId, name: string): CollectionReference =>
  collection(db, 'worlds', worldId, name);

export const membersCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'members');
export const profilesCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'profiles');
export const tasksCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'tasks');
export const collectiblesCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'collectibles');
export const rewardsCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'rewards');
export const taskDefsCollection = (db: Firestore, worldId: WorldId) => worldCollection(db, worldId, 'taskDefs');

export const memberDoc = (db: Firestore, worldId: WorldId, uid: Uid) => doc(membersCollection(db, worldId), uid);
export const profileDoc = (db: Firestore, worldId: WorldId, profileId: ProfileId) =>
  doc(profilesCollection(db, worldId), profileId);
export const taskDoc = (db: Firestore, worldId: WorldId, taskId: TaskId) => doc(tasksCollection(db, worldId), taskId);
export const collectibleDoc = (db: Firestore, worldId: WorldId, taskId: TaskId) =>
  doc(collectiblesCollection(db, worldId), taskId);
export const rewardDoc = (db: Firestore, worldId: WorldId, taskId: TaskId) => doc(rewardsCollection(db, worldId), taskId);
export const taskDefDoc = (db: Firestore, worldId: WorldId, defId: TaskDefId) =>
  doc(taskDefsCollection(db, worldId), defId);
