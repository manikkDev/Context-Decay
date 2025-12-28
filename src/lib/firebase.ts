import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

type FirebaseWebConfig = Pick<
  FirebaseOptions,
  'apiKey' | 'authDomain' | 'projectId' | 'storageBucket' | 'messagingSenderId' | 'appId'
>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function assertValidConfig(config: Partial<FirebaseWebConfig>): asserts config is FirebaseWebConfig {
  const missing: string[] = []
  if (!isNonEmptyString(config.apiKey)) missing.push('apiKey')
  if (!isNonEmptyString(config.authDomain)) missing.push('authDomain')
  if (!isNonEmptyString(config.projectId)) missing.push('projectId')
  if (!isNonEmptyString(config.storageBucket)) missing.push('storageBucket')
  if (!isNonEmptyString(config.messagingSenderId)) missing.push('messagingSenderId')
  if (!isNonEmptyString(config.appId)) missing.push('appId')
  if (missing.length) {
    throw new Error(`Firebase config missing: ${missing.join(', ')}`)
  }
}

const firebaseConfig: Partial<FirebaseWebConfig> = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

type FirebaseClients = {
  app: FirebaseApp
  firestore: Firestore
  auth: Auth
}

let cached: FirebaseClients | null = null

function getFirebaseClients(): FirebaseClients {
  if (cached) return cached
  assertValidConfig(firebaseConfig)
  const app = initializeApp(firebaseConfig)
  cached = {
    app,
    firestore: getFirestore(app),
    auth: getAuth(app),
  }
  return cached
}

export async function initFirebaseApp(): Promise<FirebaseApp> {
  return getFirebaseClients().app
}

export async function getFirestoreClient(): Promise<Firestore> {
  return getFirebaseClients().firestore
}

export async function getAuthClient(): Promise<Auth> {
  return getFirebaseClients().auth
}
