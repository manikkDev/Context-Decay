import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { doc, getFirestore, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
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
  for (const name of candidates) loadDotEnvFile(path.join(cwd, name))
}

function requiredEnv(key) {
  const v = process.env[key]
  if (typeof v !== 'string' || !v.trim().length) throw new Error(`Missing env: ${key}`)
  return v.trim()
}

function readRealitySeed() {
  const seedPath = path.join(process.cwd(), 'src', 'data', 'reality-seed.json')
  const raw = fs.readFileSync(seedPath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('Invalid reality-seed.json format')
  return parsed.filter((a) => a && typeof a === 'object' && typeof a.id === 'string' && a.id.trim().length)
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
  if (!auth.currentUser) {
    await signInAnonymously(auth)
  }
  const db = getFirestore(app)

  const anchors = readRealitySeed()
  const batches = []
  let batch = writeBatch(db)
  let count = 0

  for (const anchor of anchors) {
    const id = String(anchor.id)
    const ref = doc(db, 'realityAnchors', id)
    batch.set(
      ref,
      {
        ...anchor,
        updatedAt: serverTimestamp(),
        source: 'seed',
      },
      { merge: true },
    )
    count += 1
    if (count % 450 === 0) {
      batches.push(batch.commit())
      batch = writeBatch(db)
    }
  }

  batches.push(batch.commit())
  await Promise.all(batches)

  process.stdout.write(`Seeded ${count} realityAnchors\n`)
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})

