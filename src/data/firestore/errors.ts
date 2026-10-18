import { FirebaseError } from 'firebase/app';
import { DataStoreError } from '../DataStore';

/** Maps any failure to a `DataStoreError`; the one place that knows Firebase error codes. */
export function toDataStoreError(error: unknown): DataStoreError {
  if (error instanceof DataStoreError) return error;
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'permission-denied':
      case 'unauthenticated':
        return new DataStoreError('permission-denied', error.message, { cause: error });
      case 'not-found':
        return new DataStoreError('not-found', error.message, { cause: error });
      case 'already-exists':
        return new DataStoreError('already-exists', error.message, { cause: error });
      case 'invalid-argument':
        return new DataStoreError('invalid-argument', error.message, { cause: error });
      case 'failed-precondition':
      case 'unavailable':
        return new DataStoreError('unavailable', error.message, { cause: error });
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DataStoreError('unknown', message, { cause: error });
}
