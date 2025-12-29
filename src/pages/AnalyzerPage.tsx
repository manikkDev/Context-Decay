import { Dialog, Disclosure, Tab } from '@headlessui/react'
import {
    ArrowDownTrayIcon,
    ArrowPathIcon,
    BoltIcon,
    CheckIcon,
    ChevronDownIcon,
    ClipboardIcon,
    CodeBracketSquareIcon,
    ShieldCheckIcon,
    SparklesIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'
import dayjs from 'dayjs'
import { signInAnonymously } from 'firebase/auth'
import { addDoc, collection, getCountFromServer, serverTimestamp } from 'firebase/firestore'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Button from '../components/ui/Button.tsx'
import Card from '../components/ui/Card.tsx'
import IconButton from '../components/ui/IconButton.tsx'
import realitySeed from '../data/reality-seed.json'
import {
    KNOWN_TECH_SUBJECTS,
    extractAssumptionsFromNormalized,
    normalizeForAnalysis,
    validateAnalyzability,
    type Assumption,
    type NormalizedInput,
} from '../lib/assumptionExtractor'
import { classifyDecays, matchDecays, scoreDecay, type DecayDetail, type RealityAnchor } from '../lib/decayEngine'
import { getAuthClient, getFirestoreClient } from '../lib/firebase'
import {
    verifyCloudFirestoreConnection as runFirestoreHealthCheck,
    seedCloudFirestoreDemoData,
    type FirestoreTestResult,
} from '../lib/firestoreTest'
import '../styles/pages/analyzer.css'

type AnalyzerPreset = {
  kind: 'url' | 'text'
  value: string
  title?: string
}

type LocationState = {
  preset?: AnalyzerPreset
}

type SessionKind = 'url' | 'text'

type AnalysisStatus = 'success' | 'insufficient_signal' | 'failed'

type ContentCategory = 'A' | 'B' | 'C' | 'D'

type AnalysisResult = {
  contentCategory: ContentCategory
  analysisStatus: AnalysisStatus
  assumptions: Assumption[]
  decayDetails: DecayDetail[]
  decayScore: number | null
  explanationSummary: string
}

type FirestoreWriteState =
  | { status: 'idle' }
  | { status: 'writing' }
  | { status: 'done'; path: string; analysisSessionsCount: number }
  | { status: 'error'; error: string }

type AnalyzerProgressEvent = {
  id: string
  kind:
    | 'input_ready'
    | 'url_fetched'
    | 'assumptions_extracted'
    | 'anchors_matched'
    | 'mismatches_found'
    | 'final_decay_score'
    | 'error'
  label: string
  status: 'pending' | 'done' | 'error'
  createdAt: number
  payload?: Record<string, unknown>
}

type AnalyzerSession = {
  id: string
  status: 'idle' | 'running' | 'done' | 'error'
  analysisStatus: AnalysisStatus | null
  kind: SessionKind
  input: string
  resolvedText: string
  normalized: NormalizedInput | null
  extractedAssumptions: Assumption[]
  validatedAssumptions: Assumption[]
  anchors: RealityAnchor[]
  result: AnalysisResult | null
  completedAtMs: number | null
  events: AnalyzerProgressEvent[]
  firestore: FirestoreWriteState
  error: string | null
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

function stableId(prefix: string): string {
  const rand = Math.floor(Math.random() * 1_000_000_000)
  return `${prefix}_${Date.now()}_${rand}`
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function hostnameFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function includesAny(haystackLower: string, needlesLower: string[]): boolean {
  for (const n of needlesLower) {
    if (haystackLower.includes(n)) return true
  }
  return false
}

function classifyContentType(params: { text: string; url: string | null }): ContentCategory {
  const text = params.text.trim()
  const lower = text.toLowerCase()

  const host = hostnameFromUrl(params.url)
  const maintainedHosts = new Set([
    'developer.mozilla.org',
    'www.npmjs.com',
    'docs.npmjs.com',
    'nodejs.org',
    'react.dev',
    'nextjs.org',
    'vite.dev',
    'tailwindcss.com',
    'kubernetes.io',
    'docs.docker.com',
    'docs.microsoft.com',
    'learn.microsoft.com',
    'cloud.google.com',
    'firebase.google.com',
    'aws.amazon.com',
    'docs.aws.amazon.com',
    'registry.terraform.io',
    'docs.github.com',
    'docs.gitlab.com',
    'pkg.go.dev',
    'docs.python.org',
    'docs.oracle.com',
  ])

  if (host) {
    const exact = maintainedHosts.has(host)
    const sub = Array.from(maintainedHosts).some((h) => host === h || host.endsWith(`.${h}`))
    if (exact || sub) return 'C'
  }

  const hasCodeLike = /[`{}()[\];<>]|=>|::|#include|\b(class|interface|struct|enum|function|def)\b/i.test(text)
  const foundationalMarkers = [
    'loop',
    'loops',
    'array',
    'arrays',
    'string',
    'strings',
    'integer',
    'integers',
    'boolean',
    'variable',
    'variables',
    'function',
    'functions',
    'syntax',
    'data type',
    'datatype',
    'algorithm',
    'algorithms',
    'big o',
    'time complexity',
    'space complexity',
    'stack',
    'queue',
    'hash map',
    'hashmap',
    'dictionary',
    'recursion',
    'pointer',
    'reference',
  ]
  const timeSensitiveMarkers = [
    'install',
    'deployment',
    'deploy',
    'docker',
    'kubernetes',
    'terraform',
    'aws',
    'azure',
    'gcp',
    'firebase',
    'heroku',
    'npm',
    'yarn',
    'pnpm',
    'pip',
    'brew',
    'apt',
    'gradle',
    'maven',
    'create-react-app',
    'vite',
    'webpack',
    'react',
    'next.js',
    'react router',
    'deprecated',
    'migration',
    'breaking change',
    'upgrade',
    'v1',
    'v2',
    'v3',
    'v4',
    'v5',
    'v6',
    'v7',
  ]

  const hasVersionShape = /\b(v?\d+\.\d+(\.\d+)?)\b/.test(lower)
  const hasTimeSensitive = includesAny(lower, timeSensitiveMarkers) || hasVersionShape
  const hasFoundational = includesAny(lower, foundationalMarkers)
  const hasKnownTechSubject = KNOWN_TECH_SUBJECTS.some((s) => typeof s === 'string' && lower.includes(s.toLowerCase()))

  if (!hasCodeLike && !hasFoundational && !hasKnownTechSubject && !hasTimeSensitive) return 'A'
  if ((hasFoundational || hasCodeLike) && !hasTimeSensitive) return 'B'
  return 'D'
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return JSON.stringify({ error: 'Unable to serialize JSON payload.' }, null, 2)
  }
}

async function writeClipboardText(text: string): Promise<void> {
  const clip = navigator.clipboard
  if (clip && typeof clip.writeText === 'function') {
    await clip.writeText(text)
    return
  }
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', 'true')
  el.style.position = 'fixed'
  el.style.top = '0'
  el.style.left = '0'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

function downloadTextFile(opts: { filename: string; text: string; mime: string }): void {
  const blob = new Blob([opts.text], { type: opts.mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function summarizeDecay(details: DecayDetail[], decayScore: number | null, status: AnalysisStatus): string {
  if (status === 'failed') return 'Analysis failed.'
  if (status === 'insufficient_signal') return 'Insufficient signal: no valid assumptions found.'
  if (!details.length) return 'No relevant changes detected.'
  const counts = new Map<string, number>()
  for (const d of details) counts.set(d.decayClass, (counts.get(d.decayClass) ?? 0) + 1)
  const order: Array<DecayDetail['decayClass']> = ['hard', 'soft', 'risk', 'context']
  const parts = order
    .filter((k) => counts.has(k))
    .map((k) => `${k}(${counts.get(k) ?? 0})`)
    .join(', ')
  const score = decayScore === null ? '—' : String(decayScore)
  return `Detected ${details.length} relevance issue(s): ${parts}. Relevance score ${score}.`
}

function canonicalizeEntity(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function validateAssumptions(extracted: Assumption[], anchors: RealityAnchor[]): Assumption[] {
  const known = new Set<string>()
  for (const s of KNOWN_TECH_SUBJECTS) known.add(canonicalizeEntity(s))
  for (const a of anchors) known.add(canonicalizeEntity(a.domain))

  const out: Assumption[] = []
  for (const a of extracted) {
    if (!a.evidenceSnippet || !a.evidenceSnippet.trim()) continue
    const subj = canonicalizeEntity(a.subject)
    if (!subj) continue
    if (!known.has(subj)) continue
    out.push(a)
  }

  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

async function fetchUrlText(url: string): Promise<{ resolvedUrl: string; text: string }> {
  const res = await fetch('/api/fetch-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  }).catch(() => null)

  if (res && res.ok) {
    const data = (await res.json().catch(() => null)) as { ok?: unknown; url?: unknown; text?: unknown } | null
    const text = data && typeof data.text === 'string' ? data.text : null
    const resolvedUrl = data && typeof data.url === 'string' ? data.url : url
    if (text && text.trim()) return { resolvedUrl, text }
  }

  try {
    const direct = await fetch(url, { method: 'GET' })
    if (!direct.ok) throw new Error(`URL fetch failed (HTTP ${direct.status})`)
    const raw = await direct.text()
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) throw new Error('URL fetch succeeded but returned empty text')
    return { resolvedUrl: url, text: cleaned }
  } catch (err) {
    const msg = formatError(err)
    if (/failed to fetch/i.test(msg) || /networkerror/i.test(msg)) {
      throw new Error('URL fetch blocked (likely CORS). Use the Text tab, or try a different URL.')
    }
    throw err
  }
}

function AnalyzerPage() {
  const location = useLocation()
  const state = location.state as LocationState | null
  const preset = state?.preset
  const reduceMotion = useReducedMotion()

  const [url, setUrl] = useState(() => (preset?.kind === 'url' ? preset.value : ''))
  const [text, setText] = useState(() => (preset?.kind === 'text' ? preset.value : ''))
  const [tabIndex, setTabIndex] = useState(() => (preset?.kind === 'text' ? 1 : 0))
  const [firestoreResult, setFirestoreResult] = useState<FirestoreTestResult | null>(null)
  const [isVerifyingFirestore, setIsVerifyingFirestore] = useState(false)
  const [session, setSession] = useState<AnalyzerSession | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resultsRevealStep, setResultsRevealStep] = useState(0)
  const runSeq = useRef(0)
  const copyTimerRef = useRef<number | null>(null)
  const revealTimersRef = useRef<number[]>([])
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const sessionId = session?.id ?? null
  const sessionStatus = session?.status ?? null

  useEffect(() => {
    if (!sessionStatus) return
    if (sessionStatus !== 'done' && sessionStatus !== 'error') return
    const el = resultsRef.current
    if (!el) return
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [sessionId, sessionStatus, reduceMotion])

  useEffect(() => {
    for (const t of revealTimersRef.current) window.clearTimeout(t)
    revealTimersRef.current = []

    if (!sessionId) {
      setResultsRevealStep(0)
      return
    }

    if (sessionStatus !== 'done' && sessionStatus !== 'error') {
      setResultsRevealStep(0)
      return
    }

    if (reduceMotion) {
      setResultsRevealStep(99)
      return
    }

    setResultsRevealStep(0)

    const schedule = [120, 360, 620, 920, 1240]
    schedule.forEach((ms, idx) => {
      const t = window.setTimeout(() => setResultsRevealStep(idx + 1), ms)
      revealTimersRef.current.push(t)
    })

    return () => {
      for (const t of revealTimersRef.current) window.clearTimeout(t)
      revealTimersRef.current = []
    }
  }, [sessionId, sessionStatus, reduceMotion])

  const anchors = useMemo(() => {
    const list = Array.isArray(realitySeed) ? (realitySeed as RealityAnchor[]) : []
    return list.filter((a) => typeof a?.id === 'string' && a.id.trim().length > 0)
  }, [])

  const isRunning = session?.status === 'running'

  function pushEvent(next: Omit<AnalyzerProgressEvent, 'id' | 'createdAt'>): void {
    setSession((prev) => {
      if (!prev) return prev
      const id = stableId('evt')
      const createdAt = Date.now()
      const event: AnalyzerProgressEvent = { ...next, id, createdAt }
      return { ...prev, events: [...prev.events, event] }
    })
  }

  async function runAnalysis(kind: SessionKind, value: string): Promise<void> {
    const seq = runSeq.current + 1
    runSeq.current = seq
    const id = stableId('session')
    const startedAtMs = Date.now()
    const initial: AnalyzerSession = {
      id,
      status: 'running',
      analysisStatus: null,
      kind,
      input: value,
      resolvedText: '',
      normalized: null,
      extractedAssumptions: [],
      validatedAssumptions: [],
      anchors,
      result: null,
      completedAtMs: null,
      events: [],
      firestore: { status: 'idle' },
      error: null,
    }
    setSession(initial)

    const guard = () => runSeq.current === seq
    const waitForMinimumDuration = async (): Promise<void> => {
      const remainingMs = 3000 - (Date.now() - startedAtMs)
      if (remainingMs <= 0) return
      await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs))
    }

    let persistInputValue = value.trim()
    let persistResult: AnalysisResult = {
      contentCategory: 'D',
      analysisStatus: 'failed',
      assumptions: [],
      decayDetails: [],
      decayScore: null,
      explanationSummary: 'Analysis failed.',
    }

    const persistAnalysisSession = async (params: {
      inputType: SessionKind
      inputValue: string
      result: AnalysisResult
    }): Promise<{ ok: true; path: string; analysisSessionsCount: number } | { ok: false; error: string }> => {
      setSession((prev) => (prev ? { ...prev, firestore: { status: 'writing' } } : prev))
      let authUnavailable = false
      try {
        const auth = await getAuthClient()
        if (!auth.currentUser) {
          try {
            await signInAnonymously(auth)
          } catch (err) {
            const code =
              err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : null
            if (code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed') {
              authUnavailable = true
            }
            if (code !== 'auth/configuration-not-found' && code !== 'auth/operation-not-allowed') {
              throw err
            }
          }
        }

        const db = await getFirestoreClient()
        const writePayload = {
          inputType: params.inputType,
          inputValue: params.inputValue.trim().slice(0, 20_000),
          result: params.result,
          createdAt: serverTimestamp(),
        }

        let docRef: { path: string }
        let countCollection = 'analysisSessions'
        try {
          docRef = await addDoc(collection(db, 'analysisSessions'), writePayload)
        } catch (err) {
          const message = formatError(err)
          const denied = /permission[_\s-]?denied|missing or insufficient permissions/i.test(message)
          if (!denied) throw err
          docRef = await addDoc(collection(db, 'firestore_connection_check'), {
            ...writePayload,
            kind: 'analysis_session',
            intendedCollection: 'analysisSessions',
          })
          countCollection = 'firestore_connection_check'
        }

        const countSnap = await getCountFromServer(collection(db, countCollection))
        const analysisSessionsCount = Number(countSnap.data().count)
        if (!guard()) return { ok: false, error: 'Stale analysis run' }
        setSession((prev) =>
          prev ? { ...prev, firestore: { status: 'done', path: docRef.path, analysisSessionsCount } } : prev,
        )
        return { ok: true, path: docRef.path, analysisSessionsCount }
      } catch (err) {
        if (!guard()) return { ok: false, error: 'Stale analysis run' }
        const base = formatError(err)
        const denied = /permission[_\s-]?denied|missing or insufficient permissions/i.test(base)
        const error =
          denied && authUnavailable
            ? `${base}\n\nFix: enable Anonymous Auth in Firebase (Authentication → Sign-in method → Anonymous), OR relax Firestore rules for analysisSessions writes.`
            : denied
              ? `${base}\n\nFix: relax Firestore rules for analysisSessions writes (or ensure users are authenticated).`
              : base
        setSession((prev) => (prev ? { ...prev, firestore: { status: 'error', error } } : prev))
        return { ok: false, error }
      }
    }

    try {
      let resolvedText = value.trim()
      let resolvedUrl: string | null = null
      pushEvent({ kind: 'input_ready', label: 'Input received', status: 'done', payload: { kind } })

      if (kind === 'url') {
        pushEvent({ kind: 'url_fetched', label: 'Fetching URL content…', status: 'pending' })
        const fetched = await fetchUrlText(resolvedText)
        if (!guard()) return
        resolvedUrl = fetched.resolvedUrl
        resolvedText = fetched.text
        persistInputValue = resolvedUrl ?? persistInputValue
        setSession((prev) => (prev ? { ...prev, input: resolvedUrl ?? prev.input, resolvedText } : prev))
        pushEvent({
          kind: 'url_fetched',
          label: 'URL content fetched',
          status: 'done',
          payload: { chars: resolvedText.length, url: resolvedUrl ?? value },
        })
      } else {
        persistInputValue = resolvedText
        setSession((prev) => (prev ? { ...prev, resolvedText } : prev))
      }

      const contentCategory = classifyContentType({
        text: resolvedText,
        url: resolvedUrl ?? (kind === 'url' ? value.trim() : null),
      })

      if (contentCategory !== 'D') {
        const result: AnalysisResult = {
          contentCategory,
          analysisStatus: 'insufficient_signal',
          assumptions: [],
          decayDetails: [],
          decayScore: null,
          explanationSummary:
            contentCategory === 'A'
              ? 'This content does not contain technical instructions or dependencies that could become outdated due to changes in tools or systems.'
              : contentCategory === 'B'
                ? 'This content explains stable concepts that do not depend on changing tools, platforms, or environments. There is nothing here that can decay over time.'
                : 'This content is maintained by the tool’s authors and is kept up to date. Relevance analysis is not necessary, but version awareness is still important.',
        }
        persistResult = result
        await persistAnalysisSession({ inputType: kind, inputValue: persistInputValue, result })
        if (!guard()) return
        await waitForMinimumDuration()
        if (!guard()) return
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'done',
                analysisStatus: 'insufficient_signal',
                result,
                completedAtMs: Date.now(),
                error: null,
              }
            : prev,
        )
        return
      }

      const analyzable = validateAnalyzability(resolvedText)
      if (!analyzable) {
        const result: AnalysisResult = {
          contentCategory: 'D',
          analysisStatus: 'insufficient_signal',
          assumptions: [],
          decayDetails: [],
          decayScore: null,
          explanationSummary:
            'This looks like time-sensitive technical content, but it does not include enough identifiable tools, code, or platform details for a meaningful relevance analysis.',
        }
        persistResult = result
        await persistAnalysisSession({ inputType: kind, inputValue: persistInputValue, result })
        if (!guard()) return
        await waitForMinimumDuration()
        if (!guard()) return
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'done',
                analysisStatus: 'insufficient_signal',
                result,
                completedAtMs: Date.now(),
                error: null,
              }
            : prev,
        )
        return
      }

      const normalized = normalizeForAnalysis({
        text: resolvedText,
        url: resolvedUrl ?? (kind === 'url' ? value.trim() : null),
      })
      setSession((prev) => (prev ? { ...prev, resolvedText, normalized } : prev))

      pushEvent({ kind: 'assumptions_extracted', label: 'Extracting expectations…', status: 'pending' })
      const extracted = extractAssumptionsFromNormalized(normalized)
      const validated = validateAssumptions(extracted, anchors)
      if (!guard()) return

      setSession((prev) => (prev ? { ...prev, extractedAssumptions: extracted, validatedAssumptions: validated } : prev))
      pushEvent({
        kind: 'assumptions_extracted',
        label: `Expectations extracted (${extracted.length}), validated (${validated.length})`,
        status: 'done',
      })

      if (validated.length === 0) {
        const result: AnalysisResult = {
          contentCategory: 'D',
          analysisStatus: 'insufficient_signal',
          assumptions: [],
          decayDetails: [],
          decayScore: null,
          explanationSummary:
            'This input includes technical context, but it does not make specific, checkable expectations about tools, versions, or platform behavior. A relevance score would be guesswork, so none is shown.',
        }
        persistResult = result
        await persistAnalysisSession({ inputType: kind, inputValue: persistInputValue, result })
        if (!guard()) return
        await waitForMinimumDuration()
        if (!guard()) return
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'done',
                analysisStatus: 'insufficient_signal',
                result,
                completedAtMs: Date.now(),
                error: null,
              }
            : prev,
        )
        return
      }

      pushEvent({ kind: 'anchors_matched', label: 'Matching anchors…', status: 'pending' })
      const matches = matchDecays({
        assumptions: extracted,
        anchors,
        normalizedLower: normalized.normalizedLower,
        tokens: normalized.tokens,
      })
      const decayDetails = classifyDecays({ matches, anchors, assumptions: extracted })
      const decayScore = scoreDecay(decayDetails)
      const explanationSummary =
        decayDetails.length > 0
          ? summarizeDecay(decayDetails, decayScore, 'success')
          : matches.length > 0
            ? 'No relevant changes detected.'
            : 'No relevant changes detected (no anchor matches).'
      const result: AnalysisResult = {
        contentCategory: 'D',
        analysisStatus: 'success',
        assumptions: extracted,
        decayDetails,
        decayScore,
        explanationSummary,
      }
      persistResult = result

      const matchedAnchorIds = new Set(matches.map((m) => m.matchedAnchorId))
      const counts = new Map<string, number>()
      for (const d of decayDetails) counts.set(d.decayClass, (counts.get(d.decayClass) ?? 0) + 1)
      const countsText = ['hard', 'soft', 'risk', 'context']
        .filter((k) => counts.has(k))
        .map((k) => `${k} ${counts.get(k) ?? 0}`)
        .join(', ')

      pushEvent({
        kind: 'anchors_matched',
        label: `Anchors matched (${matchedAnchorIds.size})`,
        status: 'done',
      })
      pushEvent({
        kind: 'mismatches_found',
        label: `Relevance issues classified (${decayDetails.length})${countsText ? `: ${countsText}` : ''}`,
        status: 'done',
      })
      pushEvent({
        kind: 'final_decay_score',
        label: `Final relevance score: ${decayScore}`,
        status: 'done',
      })

      const write = await persistAnalysisSession({ inputType: kind, inputValue: persistInputValue, result })
      if (!guard()) return
      if (!write.ok) {
        const message = `Firestore persistence failed: ${write.error}`
        pushEvent({ kind: 'error', label: message, status: 'error' })
      }

      await waitForMinimumDuration()
      if (!guard()) return
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: 'done',
              analysisStatus: 'success',
              result,
              completedAtMs: Date.now(),
              error: null,
            }
          : prev,
      )
    } catch (err) {
      if (!guard()) return
      const message = formatError(err)
      persistResult = {
        contentCategory: classifyContentType({ text: value.trim(), url: kind === 'url' ? value.trim() : null }),
        analysisStatus: 'failed',
        assumptions: [],
        decayDetails: [],
        decayScore: null,
        explanationSummary: message,
      }
      await persistAnalysisSession({
        inputType: kind,
        inputValue: persistInputValue,
        result: persistResult,
      })
      await waitForMinimumDuration()
      if (!guard()) return
      setSession((prev) => (prev ? { ...prev, status: 'error', analysisStatus: 'failed', error: message } : prev))
      pushEvent({ kind: 'error', label: message, status: 'error' })
    }
  }

  async function verifyCloudFirestoreConnection(): Promise<void> {
    setIsVerifyingFirestore(true)
    setFirestoreResult(null)
    const result = await runFirestoreHealthCheck()
    setFirestoreResult(result)
    setIsVerifyingFirestore(false)
  }

  async function seedDemoData(): Promise<void> {
    setIsVerifyingFirestore(true)
    setFirestoreResult(null)
    const result = await seedCloudFirestoreDemoData()
    setFirestoreResult(result)
    setIsVerifyingFirestore(false)
  }

  const derived = useMemo(() => {
    if (!session || !session.result) return null
    const result = session.result
    if (result.analysisStatus !== 'success') return null
    if (result.decayScore === null) return null
    const anchorsById = new Map(session.anchors.map((a) => [a.id, a]))
    const detailByAssumptionId = new Map(result.decayDetails.map((d) => [d.assumptionId, d] as const))

    const assumptionCards = result.assumptions.map((a) => {
      const decay = detailByAssumptionId.get(a.id) ?? null
      const anchor = decay ? anchorsById.get(decay.matchedAnchorId) ?? null : null
      const status = decay ? 'flagged' : 'no_flag'
      const evidenceUrl = decay?.evidenceUrl ?? null
      return { assumption: a, decay, anchor, status, evidenceUrl }
    })

    const nowMs = session.completedAtMs ?? Date.now()
    return { result, assumptionCards, nowMs, finalScore: result.decayScore }
  }, [session])

  const canRun = tabIndex === 0 ? Boolean(url.trim()) : Boolean(text.trim())
  const reportResult = session?.result ?? null
  const reportJson = useMemo(() => safeJsonStringify(reportResult), [reportResult])

  const runPipeline = useMemo(() => {
    if (!session) return null
    const done = new Set(session.events.filter((e) => e.status === 'done').map((e) => e.kind))
    const pending = new Set(session.events.filter((e) => e.status === 'pending').map((e) => e.kind))
    const errored = session.events.some((e) => e.status === 'error')

    const steps: Array<{
      id: string
      label: string
      status: 'todo' | 'active' | 'done' | 'error'
      detail?: string
      icon: ReactNode
    }> = []

    const normalizeStatus = done.has('input_ready') ? 'done' : session.status === 'running' ? 'active' : 'todo'
    steps.push({
      id: 'normalize',
      label: 'Normalize',
      status: errored ? 'error' : normalizeStatus,
      detail: 'Standardize tokens + strip noise',
      icon: <BoltIcon className="h-4 w-4" aria-hidden="true" />,
    })

    if (session.kind === 'url') {
      const s = done.has('url_fetched') ? 'done' : pending.has('url_fetched') ? 'active' : session.status === 'running' ? 'todo' : 'todo'
      steps.push({
        id: 'fetch',
        label: 'Fetch URL',
        status: errored ? 'error' : s,
        detail: 'Resolve + extract readable text',
        icon: <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />,
      })
    }

    const extractStatus = done.has('assumptions_extracted')
      ? 'done'
      : pending.has('assumptions_extracted')
        ? 'active'
        : session.status === 'running'
          ? 'todo'
          : 'todo'
    steps.push({
      id: 'extract',
      label: 'Extract',
      status: errored ? 'error' : extractStatus,
      detail: 'Expectations + validation',
      icon: <SparklesIcon className="h-4 w-4" aria-hidden="true" />,
    })

    const matchStatus = done.has('anchors_matched')
      ? 'done'
      : pending.has('anchors_matched')
        ? 'active'
        : session.status === 'running'
          ? 'todo'
          : 'todo'
    steps.push({
      id: 'match',
      label: 'Match',
      status: errored ? 'error' : matchStatus,
      detail: 'Reality anchors + classification',
      icon: <ChevronDownIcon className="h-4 w-4 rotate-[-90deg]" aria-hidden="true" />,
    })

    const scored = done.has('final_decay_score') && session.status !== 'running'
    const scoreStatus =
      scored || (session.status === 'done' && session.analysisStatus === 'success')
        ? 'done'
        : session.status === 'running'
          ? done.has('final_decay_score')
            ? 'active'
            : 'todo'
          : 'todo'
    const storeStatus =
      session.firestore.status === 'done'
        ? 'done'
        : session.firestore.status === 'writing'
          ? 'active'
          : session.firestore.status === 'error'
            ? 'error'
            : 'todo'
    const scoreLabel = session.status === 'running' ? 'Score + store' : 'Score'
    const scoreDetail = session.status === 'running' ? 'Canonical score + persistence' : 'Canonical score'
    steps.push({
      id: 'score',
      label: scoreLabel,
      status: errored ? 'error' : storeStatus === 'error' ? 'error' : storeStatus === 'active' ? 'active' : scoreStatus,
      detail: scoreDetail,
      icon: <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />,
    })

    return steps
  }, [session])

  const runProgress = useMemo(() => {
    if (!runPipeline) return null
    const total = runPipeline.length
    const doneCount = runPipeline.filter((s) => s.status === 'done').length
    const hasError = runPipeline.some((s) => s.status === 'error')
    const active = runPipeline.find((s) => s.status === 'active') ?? null
    const fraction = total ? clamp01(doneCount / total) : 0
    const stepLabel = active ? active.label : doneCount === total ? 'Complete' : 'Queued'
    return { total, doneCount, fraction, hasError, stepLabel }
  }, [runPipeline])

  const displayResult = session?.result ?? null
  const displayStatus: AnalysisStatus | null = session?.analysisStatus ?? (displayResult ? displayResult.analysisStatus : null)
  const storyReady = session?.status === 'done' || session?.status === 'error'
  const isFailed = displayStatus === 'failed' || session?.status === 'error'
  const relevanceScore = derived?.finalScore ?? null
  const contentCategory: ContentCategory | null = displayResult ? displayResult.contentCategory : null
  const showDetailedStages = contentCategory === 'D' && !isFailed && derived && relevanceScore !== null
  const isTimeSensitiveButNotScored = contentCategory === 'D' && displayStatus === 'insufficient_signal' && !isFailed
  const noScoreTitle =
    contentCategory === 'A'
      ? 'Not technical content'
      : contentCategory === 'B'
        ? 'Foundational knowledge — no decay applies'
        : contentCategory === 'C'
          ? 'Actively maintained documentation'
          : null
  const stage1Title =
    isFailed
      ? 'Analysis could not be completed'
      : isTimeSensitiveButNotScored
        ? 'This does not have a meaningful relevance analysis'
      : noScoreTitle
        ? noScoreTitle
        : relevanceScore !== null
          ? scoreTone(relevanceScore).headline
          : 'Analysis could not be completed'
  const stage1Summary =
    !isFailed && noScoreTitle && displayResult?.explanationSummary
      ? ensureSentence(displayResult.explanationSummary)
      : isTimeSensitiveButNotScored && displayResult?.explanationSummary
        ? ensureSentence(displayResult.explanationSummary)
      : isFailed
        ? ensureSentence(displayResult?.explanationSummary ?? session?.error ?? 'Something prevented a complete check.')
        : (() => {
            const top =
              derived?.assumptionCards.find((x) => x.decay && (x.anchor?.description || x.decay?.justification)) ?? null
            if (top?.anchor?.description) return ensureSentence(top.anchor.description)
            if (top?.decay?.justification) return ensureSentence(top.decay.justification)
            if (relevanceScore === null) return 'Something prevented a complete check.'
            if (relevanceScore >= 80) return 'No major changes detected in today’s ecosystem.'
            if (relevanceScore >= 40) return 'Some parts of this guidance may no longer apply today.'
            return 'Key parts of this guidance may be unsafe or outdated today.'
          })()

  function scoreTone(
    score: number,
  ): { headline: string; tone: 'safe' | 'caution' | 'risk'; ringClass: string; chipClass: string } {
    if (score >= 80) {
      return {
        headline: 'This information is still valid',
        tone: 'safe',
        ringClass: 'text-emerald-500 dark:text-emerald-400',
        chipClass: 'bg-emerald-500/10 text-emerald-800 ring-emerald-500/20 dark:text-emerald-200',
      }
    }
    if (score >= 40) {
      return {
        headline: 'This information is partially outdated',
        tone: 'caution',
        ringClass: 'text-amber-500 dark:text-amber-400',
        chipClass: 'bg-amber-500/10 text-amber-800 ring-amber-500/20 dark:text-amber-200',
      }
    }
    return {
      headline: 'This information is risky to use today',
      tone: 'risk',
      ringClass: 'text-rose-500 dark:text-rose-400',
      chipClass: 'bg-rose-500/10 text-rose-800 ring-rose-500/20 dark:text-rose-200',
    }
  }

  function ensureSentence(value: string): string {
    const s = value.trim()
    if (!s) return s
    if (/[.!?]$/.test(s)) return s
    return `${s}.`
  }

  const openInspector = () => {
    setInspectorOpen(true)
  }

  async function copyReportJson(): Promise<void> {
    if (!reportJson) return
    try {
      await writeClipboardText(reportJson)
      setCopied(true)
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  function downloadReportJson(): void {
    const suffix = dayjs().format('YYYYMMDD_HHmmss')
    downloadTextFile({
      filename: `relevance-report_${suffix}.json`,
      text: reportJson || safeJsonStringify(null),
      mime: 'application/json',
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="analyzer-page"
      data-reduce-motion={reduceMotion ? 'true' : 'false'}
    >
      <div className="analyzer-ambient" aria-hidden="true">
        <div className="analyzer-ambientBlob" />
        <div className="analyzer-ambientGrid" />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ type: 'spring', stiffness: 180, damping: 26, mass: 0.7 }}
        className="analyzer-hero surface-glass"
      >
        <div className="analyzer-heroVfx" aria-hidden="true">
          <div className="analyzer-heroVfxGlow" />
          <div className="analyzer-heroVfxSweep" />
          <div className="analyzer-heroVfxLines" />
        </div>

        <div className="analyzer-heroInner">
          <div className="analyzer-heroCopy">
            <div className="analyzer-heroTitle">Analyzer</div>
            <div className="analyzer-heroSubtitle">
              Paste a URL or snippet, run detection, then review a clean score + evidence-backed results.
            </div>
            <div className="analyzer-heroBadges">
              {[
                { label: 'Deterministic pipeline' },
                { label: `Reality anchors: ${anchors.length}` },
                { label: 'Canonical Firestore write' },
              ].map((x) => (
                <span
                  key={x.label}
                  className="analyzer-badge"
                >
                  {x.label}
                </span>
              ))}
            </div>
          </div>

          <div className="analyzer-heroActions">
            <Button
              variant="secondary"
              leftIcon={<CodeBracketSquareIcon className="h-4 w-4" aria-hidden="true" />}
              onClick={openInspector}
              disabled={!displayResult}
            >
              View JSON
            </Button>
          </div>
        </div>
      </motion.section>
      <div className="analyzer-layout">
        <div className="analyzer-main">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 180, damping: 26, mass: 0.75 }}
      >
      <Card
        heading="Input"
        description="Choose URL or text, then run detection."
      >
        <Tab.Group selectedIndex={tabIndex} onChange={setTabIndex}>
          <Tab.List className="relative inline-flex rounded-xl bg-slate-950/5 p-1 ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5">
            {['URL', 'Text'].map((label) => (
              <Tab
                key={label}
                className={({ selected }) =>
                  clsx(
                    'relative rounded-lg px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none',
                    selected
                      ? 'text-[color:rgb(var(--color-text))]'
                      : 'text-[color:rgb(var(--color-muted))] hover:text-[color:rgb(var(--color-text))]',
                  )
                }
              >
                {({ selected }) => (
                  <>
                    {selected ? (
                      <motion.span
                        layoutId="analyzer-input-tab"
                        className="absolute inset-0 rounded-lg bg-[rgb(var(--color-panel))] shadow-sm ring-1 ring-[color:rgb(var(--color-border))]"
                        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
                      />
                    ) : null}
                    <span className="relative z-10">{label}</span>
                  </>
                )}
              </Tab>
            ))}
          </Tab.List>

          <div className="relative mt-4">
            <Tab.Panels>
            <Tab.Panel>
              <div className="rounded-2xl p-4 surface-panel">
                <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">
                  URL input
                </div>
                <div className="mt-2 rounded-xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-3">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-transparent text-sm outline-none"
                    aria-label="URL to analyze"
                    inputMode="url"
                    disabled={isRunning}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    variant="primary"
                    className="shadow-[0_18px_60px_rgba(99,102,241,0.28)]"
                    disabled={!url.trim() || isRunning}
                    onClick={() => runAnalysis('url', url)}
                    rightIcon={<SparklesIcon className="h-4 w-4" aria-hidden="true" />}
                  >
                    {isRunning ? 'Analyzing…' : 'Run detection'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setUrl('')}
                    disabled={!url.trim() || isRunning}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </Tab.Panel>
            <Tab.Panel>
              <div className="rounded-2xl p-4 surface-panel">
                <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">
                  Text input
                </div>
                <div className="mt-2 rounded-xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-3">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste text here..."
                    className="h-52 w-full resize-none bg-transparent text-sm leading-6 outline-none"
                    aria-label="Text to analyze"
                    disabled={isRunning}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    variant="primary"
                    className="shadow-[0_18px_60px_rgba(99,102,241,0.28)]"
                    disabled={!text.trim() || isRunning}
                    onClick={() => runAnalysis('text', text)}
                    rightIcon={<SparklesIcon className="h-4 w-4" aria-hidden="true" />}
                  >
                    {isRunning ? 'Analyzing…' : 'Run detection'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setText('')}
                    disabled={!text.trim() || isRunning}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </Tab.Panel>
            </Tab.Panels>

            <AnimatePresence initial={false}>
              {session && session.status === 'running' ? (
                <motion.div
                  key={`run-overlay:${session.id}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="analyzer-runOverlay"
                >
                  <div className="analyzer-runOverlayVfx" aria-hidden="true">
                    <div className="analyzer-runOverlayGlow" />
                    <div className="analyzer-runOverlayRadar" />
                    <div className="analyzer-runOverlayRings" />
                    <div className="analyzer-runOverlayPulse" />
                    <div className="analyzer-runOverlayNoise" />
                    <div className="analyzer-runOverlayData" />
                    <div className="analyzer-runOverlayGrid analyzer-runOverlayGridPrimary" />
                    <div className="analyzer-runOverlayGrid analyzer-runOverlayGridSecondary" />
                    <div className="analyzer-runOverlayScan analyzer-runOverlayScanPrimary" />
                    <div className="analyzer-runOverlayScan analyzer-runOverlayScanSecondary" />
                    <div className="analyzer-runOverlayScanLine" />
                    <div className="analyzer-runOverlayBrackets" />
                    <div className="analyzer-runOverlayFlicker" />
                    <div className="analyzer-runOverlayParticles">
                      {Array.from({ length: 18 }).map((_, idx) => (
                        <span key={idx} className="analyzer-runOverlayParticle" />
                      ))}
                    </div>
                  </div>

                  <div className="relative flex h-full flex-col justify-between p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">Running detection</div>
                        <div className="mt-1 text-xs text-[color:rgb(var(--color-muted))]">
                          {session.kind === 'url' ? 'URL mode' : 'Text mode'} • Events stream live below
                        </div>
                      </div>
                      <motion.div
                        className="grid h-9 w-9 place-items-center rounded-2xl bg-[rgb(var(--color-primary))]/10 text-[rgb(var(--color-primary))] ring-1 ring-inset ring-[rgb(var(--color-primary))]/20"
                        animate={reduceMotion ? undefined : { rotate: 360 }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' as never }}
                        aria-hidden="true"
                      >
                        <ArrowPathIcon className="h-5 w-5" />
                      </motion.div>
                    </div>

                    <div className="mt-4 rounded-2xl bg-[rgb(var(--color-bg))]/55 p-3 ring-1 ring-inset ring-[color:rgb(var(--color-border))]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Pipeline</div>
                          <div className="mt-1 text-sm font-semibold">
                            {runProgress ? runProgress.stepLabel : 'Queued'}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs font-semibold tabular-nums text-[color:rgb(var(--color-muted))]">
                          {runProgress ? `${runProgress.doneCount}/${runProgress.total}` : '—'}
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-950/5 ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5">
                        <motion.div
                          className={clsx(
                            'h-full rounded-full',
                            runProgress?.hasError
                              ? 'bg-red-500/70'
                              : 'bg-gradient-to-r from-[rgb(var(--color-primary))]/75 to-[rgb(var(--color-secondary))]/70',
                          )}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.round((runProgress?.fraction ?? 0) * 100)}%` }}
                          transition={{ type: 'spring', stiffness: 180, damping: 22, mass: 0.6 }}
                        />
                      </div>
                    </div>

                    <motion.div
                      className="mt-3 grid gap-2"
                      initial="hidden"
                      animate="show"
                      variants={{
                        hidden: {},
                        show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
                      }}
                    >
                      {(runPipeline ?? []).map((step) => {
                        const tone =
                          step.status === 'done'
                            ? 'bg-emerald-500/10 text-emerald-800 ring-emerald-500/20 dark:text-emerald-200'
                            : step.status === 'active'
                              ? 'bg-[rgb(var(--color-primary))]/10 text-[rgb(var(--color-text))] ring-[rgb(var(--color-primary))]/20'
                              : step.status === 'error'
                                ? 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300'
                                : 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200'

                        return (
                          <motion.div
                            key={step.id}
                            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                            transition={{ type: 'spring', stiffness: 240, damping: 26, mass: 0.6 }}
                            className="flex items-center justify-between gap-3 rounded-2xl bg-[rgb(var(--color-bg))]/55 px-3 py-2 ring-1 ring-inset ring-[color:rgb(var(--color-border))]"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <motion.div
                                className="grid h-9 w-9 place-items-center rounded-2xl bg-slate-950/5 ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5"
                                animate={
                                  reduceMotion || step.status !== 'active'
                                    ? undefined
                                    : { scale: [1, 1.04, 1], boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 0 0 6px rgba(99,102,241,0.12)', '0 0 0 rgba(0,0,0,0)'] }
                                }
                                transition={{ duration: 1.1, repeat: Infinity }}
                              >
                                {step.icon}
                              </motion.div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold">{step.label}</div>
                                <div className="mt-0.5 truncate text-xs text-[color:rgb(var(--color-muted))]">{step.detail}</div>
                              </div>
                            </div>
                            <span
                              className={clsx(
                                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                                tone,
                              )}
                            >
                              {step.status === 'done'
                                ? 'done'
                                : step.status === 'active'
                                  ? 'running'
                                  : step.status === 'error'
                                    ? 'error'
                                    : 'queued'}
                            </span>
                          </motion.div>
                        )
                      })}
                    </motion.div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </Tab.Group>

        <AnimatePresence>
          {session ? (
            <motion.div
              ref={resultsRef}
              key={session.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.25 }}
              className="mt-8 space-y-4 border-t border-[color:rgb(var(--color-border))] pt-6"
            >
              <div className="space-y-4">
                <div className="rounded-2xl p-4 surface-panel">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        {session.status === 'running'
                          ? 'Analyzing…'
                          : session.status === 'error'
                            ? 'Failed'
                            : 'Results'}
                      </div>
                      <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                        {session.kind === 'url' ? 'URL' : 'Text'} • Anchors seeded ({session.anchors.length})
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        disabled={session.status === 'running' || !canRun}
                        onClick={() => {
                          if (tabIndex === 0) runAnalysis('url', url)
                          else runAnalysis('text', text)
                        }}
                      >
                        Re-run
                      </Button>
                      <Button
                        variant="secondary"
                        leftIcon={<CodeBracketSquareIcon className="h-4 w-4" />}
                        onClick={openInspector}
                        aria-label="Open inspector"
                      >
                        Technical JSON
                      </Button>
                    </div>
                  </div>

                  {session.error ? (
                    <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
                      {session.error}
                    </div>
                  ) : null}

                  {storyReady ? (
                    <div className="mt-5 space-y-4">
                      {resultsRevealStep >= 1 ? (
                        <motion.div
                          initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 26, mass: 0.65 }}
                          className="analyzer-storyCard surface-glass analyzer-revealCard"
                          style={{ '--analyzer-reveal-delay': '0s' } as CSSProperties}
                        >
                          <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Stage 1</div>
                          <div className="mt-2 text-balance text-2xl font-semibold tracking-tight">
                            {stage1Title}
                          </div>
                          <div className="mt-3 text-sm text-[color:rgb(var(--color-muted))]">
                            {stage1Summary}
                          </div>
                        </motion.div>
                      ) : null}

                      {showDetailedStages ? (
                        <>
                          {resultsRevealStep >= 2 ? (
                            <motion.div
                              initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }}
                              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 26, mass: 0.65 }}
                              className="analyzer-storyCard surface-glass analyzer-revealCard"
                              style={{ '--analyzer-reveal-delay': '0.06s' } as CSSProperties}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Stage 2</div>
                                  <div className="mt-2 text-lg font-semibold">Relevance Score</div>
                                  <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                                    Measures how well this information matches today’s tools and practices.
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {[
                                      {
                                        label: 'Safe (80–100)',
                                        className: 'bg-emerald-500/10 text-emerald-800 ring-emerald-500/20 dark:text-emerald-200',
                                      },
                                      {
                                        label: 'Caution (40–79)',
                                        className: 'bg-amber-500/10 text-amber-800 ring-amber-500/20 dark:text-amber-200',
                                      },
                                      {
                                        label: 'High risk (0–39)',
                                        className: 'bg-rose-500/10 text-rose-800 ring-rose-500/20 dark:text-rose-200',
                                      },
                                    ].map((x) => (
                                      <span
                                        key={x.label}
                                        className={clsx(
                                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                                          x.className,
                                        )}
                                      >
                                        {x.label}
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div className="shrink-0">
                                  <div className="relative h-28 w-28">
                                    <div
                                      className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-[rgb(var(--color-primary))]/20 to-[rgb(var(--color-secondary))]/15 blur-xl"
                                      aria-hidden="true"
                                    />
                                    <svg
                                      viewBox="0 0 100 100"
                                      className={clsx('h-full w-full', scoreTone(relevanceScore).ringClass)}
                                    >
                                      <circle
                                        cx="50"
                                        cy="50"
                                        r="44"
                                        fill="none"
                                        stroke="rgba(0,0,0,0.08)"
                                        strokeWidth="10"
                                        className="dark:stroke-white/10"
                                      />
                                      <motion.circle
                                        cx="50"
                                        cy="50"
                                        r="44"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="10"
                                        strokeLinecap="round"
                                        initial={{ pathLength: 0 }}
                                        animate={{ pathLength: relevanceScore / 100 }}
                                        transition={{ type: 'spring', stiffness: 140, damping: 18, mass: 0.6 }}
                                      />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="text-3xl font-semibold tabular-nums">{relevanceScore}</div>
                                    </div>
                                  </div>
                                  <div className="mt-2 text-center text-xs text-[color:rgb(var(--color-muted))]">
                                    <span
                                      className="cursor-help underline decoration-dotted underline-offset-4"
                                      title="Low score does NOT mean wrong — it means conditions have changed."
                                    >
                                      What this means
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          ) : null}

                          {resultsRevealStep >= 3 ? (
                            <motion.div
                              initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }}
                              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 26, mass: 0.65 }}
                              className="analyzer-storyCard surface-glass analyzer-revealCard"
                              style={{ '--analyzer-reveal-delay': '0.08s' } as CSSProperties}
                            >
                              <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Stage 3</div>
                              <div className="mt-2 text-lg font-semibold">What this content expects to be true</div>
                              <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                                These are the conditions this content relies on. When conditions change, the score drops.
                              </div>

                              <motion.div
                                initial="hidden"
                                animate="show"
                                variants={{
                                  hidden: {},
                                  show: { transition: { staggerChildren: 0.06, delayChildren: reduceMotion ? 0 : 0.12 } },
                                }}
                                className="mt-4 space-y-3"
                              >
                                {[...derived.assumptionCards]
                                  .sort((a, b) => {
                                    const p = (x: typeof a) => {
                                      const c = x.decay?.decayClass ?? null
                                      if (c === 'hard') return 40
                                      if (c === 'risk') return 30
                                      if (c === 'soft') return 20
                                      if (c === 'context') return 10
                                      return 0
                                    }
                                    return p(b) - p(a) || a.assumption.subject.localeCompare(b.assumption.subject)
                                  })
                                  .map(({ assumption, decay, anchor, evidenceUrl }) => {
                                    const changed =
                                      decay?.justification?.trim() ||
                                      anchor?.description?.trim() ||
                                      (decay
                                        ? 'Some relevant conditions have changed since this was written.'
                                        : 'No relevant change was flagged for this expectation.')

                                    const chip =
                                      decay?.decayClass === 'hard'
                                        ? {
                                            label: 'High risk',
                                            className: 'bg-rose-500/10 text-rose-800 ring-rose-500/20 dark:text-rose-200',
                                          }
                                        : decay?.decayClass === 'risk'
                                          ? {
                                              label: 'Risk',
                                              className: 'bg-sky-500/10 text-sky-800 ring-sky-500/20 dark:text-sky-200',
                                            }
                                          : decay?.decayClass === 'soft'
                                            ? {
                                                label: 'Outdated',
                                                className: 'bg-amber-500/10 text-amber-800 ring-amber-500/20 dark:text-amber-200',
                                              }
                                            : decay?.decayClass === 'context'
                                              ? {
                                                  label: 'Context changed',
                                                  className:
                                                    'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200',
                                                }
                                              : { label: 'No flags', className: 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200' }

                                    return (
                                      <motion.div
                                        key={assumption.id}
                                        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                                        transition={{ type: 'spring', stiffness: 240, damping: 26, mass: 0.6 }}
                                        className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4 analyzer-revealItem"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="text-sm font-semibold">{assumption.subject}</div>
                                          <span
                                            className={clsx(
                                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                                              chip.className,
                                            )}
                                          >
                                            {chip.label}
                                          </span>
                                        </div>

                                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] md:items-stretch">
                                          <div className="rounded-xl p-3 surface-panel">
                                            <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">It expects</div>
                                            <div className="mt-1 text-sm text-[color:rgb(var(--color-text))]">
                                              This content expects: {ensureSentence(assumption.impliedValue)}
                                            </div>
                                          </div>

                                          <div className="hidden md:flex items-center justify-center text-[color:rgb(var(--color-muted))]">
                                            <ChevronDownIcon className="h-5 w-5 rotate-[-90deg]" aria-hidden="true" />
                                          </div>

                                          <div className="rounded-xl p-3 surface-panel">
                                            <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">What changed?</div>
                                            <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">{ensureSentence(changed)}</div>
                                            {evidenceUrl ? (
                                              <a
                                                href={evidenceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-2 inline-flex text-sm font-semibold text-[rgb(var(--color-primary))] hover:underline"
                                              >
                                                Open citation
                                              </a>
                                            ) : null}
                                          </div>
                                        </div>
                                      </motion.div>
                                    )
                                  })}
                              </motion.div>
                            </motion.div>
                          ) : null}

                          {resultsRevealStep >= 4 ? (
                            <motion.div
                              initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }}
                              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 26, mass: 0.65 }}
                              className="analyzer-storyCard surface-glass analyzer-revealCard"
                              style={{ '--analyzer-reveal-delay': '0.1s' } as CSSProperties}
                            >
                              <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Stage 4</div>
                              <div className="mt-2 text-lg font-semibold">What should you do?</div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span
                                  className={clsx(
                                    'inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset',
                                    scoreTone(relevanceScore).chipClass,
                                  )}
                                >
                                  {relevanceScore >= 80
                                    ? 'Safe to follow as-is'
                                    : relevanceScore >= 40
                                      ? 'Follow with caution — update parts'
                                      : 'Avoid — use newer alternatives'}
                                </span>
                                <span className="text-sm text-[color:rgb(var(--color-muted))]">
                                  Suggested next step:{' '}
                                  {relevanceScore >= 80
                                    ? 'Spot-check any commands against current docs.'
                                    : relevanceScore >= 40
                                      ? 'Cross-check key steps with current official documentation.'
                                      : 'Look for a newer guide that uses modern tooling.'}
                                </span>
                              </div>
                            </motion.div>
                          ) : null}
                        </>
                      ) : isTimeSensitiveButNotScored ? (
                        resultsRevealStep >= 2 ? (
                          <motion.div
                            initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }}
                            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 26, mass: 0.65 }}
                            className="analyzer-storyCard surface-glass analyzer-revealCard"
                            style={{ '--analyzer-reveal-delay': '0.06s' } as CSSProperties}
                          >
                            <div className="text-lg font-semibold">Why you’re seeing this</div>
                            <div className="mt-2 text-sm text-[color:rgb(var(--color-muted))]">
                              This is expected behavior. A relevance score is only shown when the input contains enough specific, checkable detail.
                            </div>
                            <div className="mt-3 text-sm text-[color:rgb(var(--color-muted))]">
                              Try including concrete tool names, versions, commands, APIs, or deployment steps.
                            </div>
                          </motion.div>
                        ) : null
                      ) : !isFailed && (contentCategory === 'A' || contentCategory === 'B' || contentCategory === 'C') ? (
                        resultsRevealStep >= 2 ? (
                          <motion.div
                            initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }}
                            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 26, mass: 0.65 }}
                            className="analyzer-storyCard surface-glass analyzer-revealCard"
                            style={{ '--analyzer-reveal-delay': '0.06s' } as CSSProperties}
                          >
                            <div className="text-lg font-semibold">
                              {contentCategory === 'A'
                                ? 'Guidance'
                                : contentCategory === 'B'
                                  ? 'Why you’re seeing this'
                                  : 'Note'}
                            </div>
                            <div className="mt-2 text-sm text-[color:rgb(var(--color-muted))]">
                              {contentCategory === 'A'
                                ? 'Try pasting a tutorial, setup guide, or technical answer that references tools, versions, or deployment steps.'
                                : contentCategory === 'B'
                                  ? 'This is expected behavior and does not indicate an error. This content does not depend on changing tools, platforms, or environments.'
                                  : 'This is official documentation that is maintained by its authors. A relevance score is not necessary, but you should still confirm the version and defaults you are using.'}
                            </div>
                          </motion.div>
                        ) : null
                      ) : (
                        resultsRevealStep >= 2 ? (
                          <motion.div
                            initial={{ opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }}
                            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 26, mass: 0.65 }}
                            className="analyzer-storyCard surface-glass analyzer-revealCard"
                            style={{ '--analyzer-reveal-delay': '0.06s' } as CSSProperties}
                          >
                            <div className="text-lg font-semibold">What should you do?</div>
                            <div className="mt-2 text-sm text-[color:rgb(var(--color-muted))]">
                              Re-run, try a different source, or use the technical JSON to inspect what was captured.
                            </div>
                          </motion.div>
                        ) : null
                      )}

                      {showDetailedStages && resultsRevealStep >= 5 ? (
                        <Disclosure defaultOpen={false}>
                        {({ open }) => (
                          <div className="analyzer-storyCard surface-panel">
                            <Disclosure.Button className="flex w-full items-center justify-between gap-3">
                              <div className="text-sm font-semibold">Show technical details</div>
                              <ChevronDownIcon
                                className={clsx(
                                  'h-5 w-5 text-[color:rgb(var(--color-muted))] transition',
                                  open ? 'rotate-180' : 'rotate-0',
                                )}
                                aria-hidden="true"
                              />
                            </Disclosure.Button>
                            <Disclosure.Panel className="mt-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="rounded-2xl p-4 surface-glass">
                                  <div className="text-sm font-semibold">Detailed findings</div>
                                  <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                                    Expand any item to see evidence, rule details, and citations.
                                  </div>

                                  {derived ? (
                                    <motion.div
                                      initial="hidden"
                                      animate="show"
                                      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                                      className="mt-4 space-y-2"
                                    >
                                      {derived.assumptionCards.length ? (
                                        derived.assumptionCards.map(({ assumption, decay, anchor, status, evidenceUrl }) => {
                                          const badge =
                                            status === 'flagged'
                                              ? decay?.decayClass === 'hard'
                                                ? 'Hard'
                                                : decay?.decayClass === 'soft'
                                                  ? 'Soft'
                                                  : decay?.decayClass === 'risk'
                                                    ? 'Risk'
                                                    : 'Context'
                                              : 'No flags'

                                          const badgeClass =
                                            status === 'flagged'
                                              ? decay?.decayClass === 'hard'
                                                ? 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300'
                                                : decay?.decayClass === 'soft'
                                                  ? 'bg-amber-500/10 text-amber-800 ring-amber-500/20 dark:text-amber-200'
                                                  : decay?.decayClass === 'risk'
                                                    ? 'bg-sky-500/10 text-sky-800 ring-sky-500/20 dark:text-sky-200'
                                                    : 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200'
                                              : 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200'

                                          return (
                                            <motion.div
                                              key={assumption.id}
                                              variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                                              transition={{ type: 'spring', stiffness: 240, damping: 26, mass: 0.6 }}
                                            >
                                              <Disclosure defaultOpen={false}>
                                                {({ open: openItem }) => (
                                                  <div className="rounded-xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] transition-shadow duration-200 hover:shadow-sm">
                                                    <Disclosure.Button className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left">
                                                      <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                          <div className="text-sm font-semibold">{assumption.subject}</div>
                                                          <span
                                                            className={clsx(
                                                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                                                              badgeClass,
                                                            )}
                                                          >
                                                            {badge}
                                                          </span>
                                                          <span className="text-xs text-[color:rgb(var(--color-muted))]">
                                                            {(clamp01(assumption.confidence) * 100).toFixed(0)}%
                                                          </span>
                                                        </div>
                                                        <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                                                          {assumption.impliedValue}
                                                        </div>
                                                      </div>
                                                      <ChevronDownIcon
                                                        className={clsx(
                                                          'mt-0.5 h-5 w-5 shrink-0 text-[color:rgb(var(--color-muted))] transition',
                                                          openItem ? 'rotate-180' : 'rotate-0',
                                                        )}
                                                        aria-hidden="true"
                                                      />
                                                    </Disclosure.Button>
                                                    <Disclosure.Panel className="px-3 pb-3">
                                                      <div className="grid gap-3 md:grid-cols-2">
                                                        <div className="rounded-xl p-3 surface-panel">
                                                          <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">
                                                            Match
                                                          </div>
                                                          <div className="mt-1 text-sm">
                                                            {anchor ? (
                                                              <div className="space-y-1">
                                                                <div className="text-sm font-semibold">{anchor.id}</div>
                                                                <div className="text-sm text-[color:rgb(var(--color-muted))]">
                                                                  {anchor.description ?? ''}
                                                                </div>
                                                              </div>
                                                            ) : (
                                                              <div className="text-sm text-[color:rgb(var(--color-muted))]">
                                                                No matched change detail for this item.
                                                              </div>
                                                            )}
                                                          </div>
                                                        </div>

                                                        <div className="rounded-xl p-3 surface-panel">
                                                          <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">
                                                            Evidence
                                                          </div>
                                                          <div className="mt-1 text-sm">
                                                            {decay ? (
                                                              <div className="space-y-1">
                                                                <div className="text-sm text-[color:rgb(var(--color-muted))]">
                                                                  {decay.justification}
                                                                </div>
                                                                <div className="text-xs text-[color:rgb(var(--color-muted))]">
                                                                  Rule: {decay.ruleUsed} • Match: {decay.matchType}
                                                                </div>
                                                                {evidenceUrl ? (
                                                                  <a
                                                                    href={evidenceUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="text-sm font-semibold text-[rgb(var(--color-primary))] hover:underline"
                                                                  >
                                                                    Open citation
                                                                  </a>
                                                                ) : null}
                                                              </div>
                                                            ) : evidenceUrl ? (
                                                              <a
                                                                href={evidenceUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-sm font-semibold text-[rgb(var(--color-primary))] hover:underline"
                                                              >
                                                                Open citation
                                                              </a>
                                                            ) : (
                                                              <div className="text-sm text-[color:rgb(var(--color-muted))]">
                                                                No evidence link available.
                                                              </div>
                                                            )}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    </Disclosure.Panel>
                                                  </div>
                                                )}
                                              </Disclosure>
                                            </motion.div>
                                          )
                                        })
                                      ) : (
                                        <div className="text-sm text-[color:rgb(var(--color-muted))]">
                                          No extracted items are available for this input.
                                        </div>
                                      )}
                                    </motion.div>
                                  ) : (
                                    <div className="mt-4 text-sm text-[color:rgb(var(--color-muted))]">
                                      Run an analysis to see detailed findings.
                                    </div>
                                  )}
                                </div>

                                <div className="space-y-4">
                                  <div className="rounded-2xl p-4 surface-glass">
                                    <div className="text-sm font-semibold">Live timeline</div>
                                    <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                                      Incremental events as each stage completes.
                                    </div>
                                    <div className="mt-4 space-y-3">
                                      <AnimatePresence initial={false}>
                                        {session.events.map((e) => (
                                          <motion.div
                                            key={e.id}
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 6 }}
                                            transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.7 }}
                                            className="flex items-start gap-3"
                                          >
                                            <div
                                              className={clsx(
                                                'mt-1 h-2.5 w-2.5 rounded-full',
                                                e.status === 'done'
                                                  ? 'bg-emerald-500'
                                                  : e.status === 'error'
                                                    ? 'bg-red-500'
                                                    : 'bg-[color:rgb(var(--color-border))]',
                                              )}
                                            />
                                            <div className="min-w-0">
                                              <div className="text-sm font-medium">{e.label}</div>
                                              <div className="mt-0.5 text-xs text-[color:rgb(var(--color-muted))] tabular-nums">
                                                {dayjs(e.createdAt).format('HH:mm:ss')}
                                              </div>
                                            </div>
                                          </motion.div>
                                        ))}
                                      </AnimatePresence>
                                      {session.events.length === 0 ? (
                                        <div className="text-sm text-[color:rgb(var(--color-muted))]">
                                          Start an analysis run to populate this timeline.
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="rounded-2xl p-4 surface-glass">
                                    <div className="text-sm font-semibold">Firestore diagnostic</div>
                                    <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                                      Confirms cloud persistence by reading back analysisSessions count.
                                    </div>
                                    <div className="mt-4">
                                      {session.firestore.status === 'idle' ? (
                                        <div className="text-sm text-[color:rgb(var(--color-muted))]">No write yet.</div>
                                      ) : session.firestore.status === 'writing' ? (
                                        <div className="text-sm text-[color:rgb(var(--color-muted))]">Writing…</div>
                                      ) : session.firestore.status === 'done' ? (
                                        <div className="space-y-2">
                                          <div className="text-sm font-semibold text-[color:rgb(var(--color-text))]">
                                            Write complete
                                          </div>
                                          <div className="text-xs text-[color:rgb(var(--color-muted))]">
                                            Path: {session.firestore.path}
                                          </div>
                                          <div className="text-xs text-[color:rgb(var(--color-muted))] tabular-nums">
                                            Firestore Stored Analyses: {session.firestore.analysisSessionsCount}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="space-y-2">
                                          <div className="text-sm font-semibold text-red-600 dark:text-red-400">Write failed</div>
                                          <pre className="whitespace-pre-wrap text-xs leading-5 text-[color:rgb(var(--color-muted))]">
                                            {session.firestore.error}
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </Disclosure.Panel>
                          </div>
                        )}
                        </Disclosure>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 180, damping: 26, mass: 0.75 }}
      >
      <Card>
        <Disclosure defaultOpen={false}>
          {({ open }) => (
            <>
              <Disclosure.Button className="flex w-full items-center justify-between gap-3">
                <div className="text-sm font-semibold">Cloud Firestore verification</div>
                <ChevronDownIcon
                  className={clsx(
                    'h-5 w-5 text-[color:rgb(var(--color-muted))] transition',
                    open ? 'rotate-180' : 'rotate-0',
                  )}
                  aria-hidden="true"
                />
              </Disclosure.Button>
              <Disclosure.Panel className="mt-4">
                <div className="text-sm text-[color:rgb(var(--color-muted))]">
                  Writes a document and reads it back from cloud Firestore.
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={verifyCloudFirestoreConnection}
                    disabled={isVerifyingFirestore}
                  >
                    {isVerifyingFirestore ? 'Running…' : 'Verify Cloud Firestore'}
                  </Button>
                  <Button variant="secondary" onClick={seedDemoData} disabled={isVerifyingFirestore}>
                    {isVerifyingFirestore ? 'Running…' : 'Seed demo data'}
                  </Button>
                </div>

                {firestoreResult ? (
                  <div className="mt-4 rounded-xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-3">
                    {firestoreResult.ok ? (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-[color:rgb(var(--color-text))]">Success</div>
                        <div className="text-xs text-[color:rgb(var(--color-muted))]">
                          Project: {firestoreResult.projectId}
                        </div>
                        <div className="text-xs text-[color:rgb(var(--color-muted))]">Path: {firestoreResult.path}</div>
                        <pre className="max-h-56 overflow-auto text-xs leading-5 text-[color:rgb(var(--color-muted))]">
                          {JSON.stringify(firestoreResult.data, null, 2)}
                        </pre>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-red-600 dark:text-red-400">Failed</div>
                        <pre className="whitespace-pre-wrap text-xs leading-5 text-[color:rgb(var(--color-muted))]">
                          {firestoreResult.error}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : null}
              </Disclosure.Panel>
            </>
          )}
        </Disclosure>
      </Card>
      </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {inspectorOpen ? (
          <Dialog open={inspectorOpen} onClose={setInspectorOpen} className="relative z-50">
            <motion.div
              className="fixed inset-0 bg-slate-950/30 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              aria-hidden="true"
            />
            <div className="fixed inset-0 overflow-hidden">
              <div className="absolute inset-0 overflow-hidden">
                <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-6 sm:pl-10">
                  <Dialog.Panel className="pointer-events-auto w-screen max-w-[520px]">
                    <motion.div
                      initial={{ x: 28, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: 28, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.7 }}
                    >
                    <div className="flex h-full flex-col rounded-l-3xl surface-glass ring-1 ring-white/10">
                      <div className="flex items-start justify-between gap-3 border-b border-[color:rgb(var(--color-border))] p-4">
                        <div className="min-w-0">
                          <Dialog.Title className="text-sm font-semibold">Inspector</Dialog.Title>
                          <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                            Raw analysis JSON for the current result.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <IconButton
                            ariaLabel={copied ? 'Copied' : 'Copy JSON to clipboard'}
                            icon={copied ? <CheckIcon className="h-5 w-5" /> : <ClipboardIcon className="h-5 w-5" />}
                            onClick={() => void copyReportJson()}
                          />
                          <IconButton
                            ariaLabel="Download JSON file"
                            icon={<ArrowDownTrayIcon className="h-5 w-5" />}
                            onClick={downloadReportJson}
                          />
                          <IconButton
                            ariaLabel="Close inspector"
                            icon={<XMarkIcon className="h-5 w-5" />}
                            onClick={() => setInspectorOpen(false)}
                          />
                        </div>
                      </div>

                      <div className="flex-1 overflow-auto p-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl p-3 surface-panel">
                            <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Score</div>
                            <div className="mt-1 text-lg font-semibold tabular-nums">
                              {derived ? derived.finalScore : '—'}
                            </div>
                          </div>
                          <div className="rounded-xl p-3 surface-panel">
                            <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">As-of</div>
                            <div className="mt-1 text-sm font-semibold tabular-nums">
                              {derived ? dayjs(derived.nowMs).format('YYYY-MM-DD') : '—'}
                            </div>
                          </div>
                          <div className="rounded-xl p-3 surface-panel">
                            <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Mismatches</div>
                            <div className="mt-1 text-lg font-semibold tabular-nums">
                              {derived ? derived.result.decayDetails.length : '—'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]">
                          <pre
                            className="max-h-[calc(100vh-260px)] overflow-auto p-3 text-xs leading-5 text-[color:rgb(var(--color-muted))]"
                            tabIndex={0}
                            aria-label="Analysis JSON"
                          >
                            {reportJson}
                          </pre>
                        </div>
                      </div>
                    </div>
                    </motion.div>
                  </Dialog.Panel>
                </div>
              </div>
            </div>
          </Dialog>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

export default AnalyzerPage
