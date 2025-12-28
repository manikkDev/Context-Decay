import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.length) continue
    if (line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
}

function loadViteEnvFiles() {
  const cwd = process.cwd()
  const candidates = ['.env', '.env.local', '.env.development', '.env.development.local']
  for (const name of candidates) {
    loadDotEnvFile(path.join(cwd, name))
  }
}

function requiredEnv(key) {
  const v = process.env[key]
  if (typeof v !== 'string' || !v.trim().length) {
    throw new Error(`Missing env: ${key}`)
  }
  return v.trim()
}

async function main() {
  loadViteEnvFiles()
  const config = {
    apiKey: requiredEnv('VITE_FIREBASE_API_KEY'),
    authDomain: requiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: requiredEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: requiredEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requiredEnv('VITE_FIREBASE_APP_ID'),
  }
  const app = initializeApp(config)
  const auth = getAuth(app)
  const isE2E =
    process.argv.includes('--e2e') ||
    String(process.env.KDD_E2E || '')
      .trim()
      .toLowerCase() === '1'
  let authUid = null
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth)
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : null
      if (code !== 'auth/configuration-not-found' && code !== 'auth/operation-not-allowed') {
        throw err
      }
    }
  }
  authUid = auth.currentUser ? auth.currentUser.uid : null
  const db = getFirestore(app)
  const checks = collection(db, 'firestore_connection_check')
  const ref = doc(checks, 'smoke_test')
  try {
    await setDoc(ref, { source: 'cloud_firestore', verifiedAt: serverTimestamp() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isE2E && /permission[_\s-]?denied/i.test(msg) && !authUid) {
      throw new Error(
        'Firestore write denied. Firebase Auth is unavailable (auth/configuration-not-found), so Firestore rules must allow unauthenticated writes (or you must enable Auth).',
      )
    }
    throw err
  }
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Document read-back failed: not found')

  if (!isE2E) {
    process.stdout.write(`${ref.path}\n`)
    return
  }

  process.stdout.write(`authUid=${authUid ?? 'none'}\n`)
  const baseUrl = String(process.env.KDD_BASE_URL || 'http://localhost:5174')
    .trim()
    .replace(/\/+$/, '')
  const targets = [
    { kind: 'url', value: 'https://create-react-app.dev/docs/getting-started/' },
    { kind: 'url', value: 'https://stackoverflow.com/questions/60055480/how-to-create-react-app' },
  ]

  for (const target of targets) {
    const fetchRes = await fetch(`${baseUrl}/__api/fetch-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: target.value }),
    })
    if (!fetchRes.ok) {
      const body = await fetchRes.text().catch(() => '')
      throw new Error(`fetch-url failed (${fetchRes.status}): ${body}`)
    }
    const fetched = await fetchRes.json()
    const resolvedUrl = fetched && typeof fetched.url === 'string' ? fetched.url : target.value
    const text = fetched && typeof fetched.text === 'string' ? fetched.text : ''
    if (!text.trim()) throw new Error(`fetch-url returned empty text for ${resolvedUrl}`)

    const decayRes = await fetch(`${baseUrl}/__api/decay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!decayRes.ok) {
      const body = await decayRes.text().catch(() => '')
      throw new Error(`decay failed (${decayRes.status}): ${body}`)
    }
    const decay = await decayRes.json()
    const assumptions = decay && Array.isArray(decay.assumptions) ? decay.assumptions : []
    const report =
      decay && decay.status === 'success' && decay.report && typeof decay.report === 'object'
        ? decay.report
        : null
    const decayScore =
      report &&
      typeof report.overallDecayScore === 'number' &&
      Number.isFinite(report.overallDecayScore)
        ? report.overallDecayScore
        : null
    const analysisStatus = report ? 'success' : 'insufficient_signal'

    let docRef
    try {
      docRef = await addDoc(collection(db, 'analysisSessions'), {
        inputType: 'url',
        inputValue: resolvedUrl,
        extractedAssumptions: assumptions,
        decayScore,
        decayDetails: Array.isArray(report?.details)
          ? report.details.map((d) => ({
              assumptionId: d.assumptionId,
              anchorId: typeof d.anchorId === 'string' ? d.anchorId : null,
              typeOfMismatch: d.typeOfMismatch,
              severity: d.severity,
              decayClass: d.decayClass,
              explanation: d.explanation,
              evidenceUrl: typeof d.evidenceUrl === 'string' ? d.evidenceUrl : null,
            }))
          : [],
        analysisStatus,
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/permission[_\s-]?denied|missing or insufficient permissions/i.test(msg)) {
        docRef = await addDoc(collection(db, 'firestore_connection_check'), {
          kind: 'analysis_session',
          intendedCollection: 'analysisSessions',
          inputType: 'url',
          inputValue: resolvedUrl,
          extractedAssumptions: assumptions,
          decayScore,
          decayDetails: Array.isArray(report?.details) ? report.details : [],
          analysisStatus,
          createdAt: serverTimestamp(),
        })
      }
      if (!docRef) throw err
    }

    const countSnap = await getCountFromServer(
      collection(
        db,
        docRef.path.startsWith('analysisSessions/')
          ? 'analysisSessions'
          : 'firestore_connection_check',
      ),
    )
    const count = Number(countSnap.data().count)
    process.stdout.write(
      `${docRef.path}\tcount=${count}\turl=${resolvedUrl}\tassumptions=${assumptions.length}\n`,
    )
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
