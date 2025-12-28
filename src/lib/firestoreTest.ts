import { signInAnonymously } from 'firebase/auth';
import {
    collection,
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    type Firestore,
} from 'firebase/firestore';
import { getAuthClient, getFirestoreClient, initFirebaseApp } from './firebase';

export type FirestoreTestResult =
  | { ok: true; projectId: string; path: string; id: string; data: Record<string, unknown> }
  | { ok: false; error: string }

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : null
    if (code) return `${code}: ${err.message}`
    return err.message
  }
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    const msg = (err as { message: string }).message
    const code =
      'code' in err && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : null
    if (code) return `${code}: ${msg}`
    return msg
  }
  return String(err)
}

async function getProjectId(): Promise<string> {
  const app = await initFirebaseApp()
  const projectId = typeof app.options.projectId === 'string' ? app.options.projectId : null
  if (!projectId) throw new Error('Firebase projectId missing at runtime')
  return projectId
}

async function writeAndReadHealthCheck(db: Firestore): Promise<{ path: string; id: string; data: Record<string, unknown> }> {
  const checks = collection(db, 'firestore_connection_check')
  const ref = doc(checks, 'health_check')
  await setDoc(ref, { source: 'cloud_firestore', verifiedAt: serverTimestamp() })
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Document read-back failed: not found')
  return { path: ref.path, id: ref.id, data: snap.data() as Record<string, unknown> }
}

export async function seedCloudFirestoreDemoData(): Promise<FirestoreTestResult> {
  try {
    const auth = await getAuthClient()
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth)
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : null
        if (code !== 'auth/configuration-not-found' && code !== 'auth/operation-not-allowed') {
          throw err
        }
      }
    }

    const projectId = await getProjectId()
    const db = await getFirestoreClient()
    const checks = collection(db, 'firestore_connection_check')
    const ref = doc(checks, 'demo_seed')
    await setDoc(ref, {
      source: 'cloud_firestore',
      verifiedAt: serverTimestamp(),
      kind: 'demo_seed',
      value: `demo-${Math.floor(Math.random() * 1_000_000)}`,
    })
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('Document read-back failed: not found')
    return { ok: true, projectId, path: ref.path, id: ref.id, data: snap.data() as Record<string, unknown> }
  } catch (err) {
    return { ok: false, error: formatError(err) }
  }
}

export async function verifyCloudFirestoreConnection(): Promise<FirestoreTestResult> {
  try {
    const auth = await getAuthClient()
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth)
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : null
        if (code !== 'auth/configuration-not-found' && code !== 'auth/operation-not-allowed') {
          throw err
        }
      }
    }

    const projectId = await getProjectId()
    const db = await getFirestoreClient()
    const { path, id, data } = await writeAndReadHealthCheck(db)
    return { ok: true, projectId, path, id, data }
  } catch (err) {
    return { ok: false, error: formatError(err) }
  }
}
