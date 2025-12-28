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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Button from '../components/ui/Button.tsx'
import Card from '../components/ui/Card.tsx'
import IconButton from '../components/ui/IconButton.tsx'
import realitySeed from '../data/reality-seed.json'
import {
  KNOWN_TECH_SUBJECTS,
  extractAssumptionsFromNormalized,
  normalizeForAnalysis,
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

type AnalysisResult = {
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
  if (!details.length) return 'No decay detected.'
  const counts = new Map<string, number>()
  for (const d of details) counts.set(d.decayClass, (counts.get(d.decayClass) ?? 0) + 1)
  const order: Array<DecayDetail['decayClass']> = ['hard', 'soft', 'risk', 'context']
  const parts = order
    .filter((k) => counts.has(k))
    .map((k) => `${k}(${counts.get(k) ?? 0})`)
    .join(', ')
  const score = decayScore === null ? '—' : String(decayScore)
  return `Detected ${details.length} decay(s): ${parts}. Score ${score}.`
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
  const res = await fetch('/__api/fetch-url', {
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
      throw new Error('URL fetch blocked (likely CORS). Use the Text tab, or run via the dev server proxy.')
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
  const [inspectorDocked, setInspectorDocked] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(min-width: 1024px)').matches
  })
  const [copied, setCopied] = useState(false)
  const runSeq = useRef(0)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(min-width: 1024px)')
    const handler = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches)
      if (e.matches) setInspectorOpen(false)
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

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

    let persistInputValue = value.trim()
    let persistResult: AnalysisResult = {
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

      const normalized = normalizeForAnalysis({
        text: resolvedText,
        url: resolvedUrl ?? (kind === 'url' ? value.trim() : null),
      })
      setSession((prev) => (prev ? { ...prev, resolvedText, normalized } : prev))

      pushEvent({ kind: 'assumptions_extracted', label: 'Extracting assumptions…', status: 'pending' })
      const extracted = extractAssumptionsFromNormalized(normalized)
      const validated = validateAssumptions(extracted, anchors)
      if (!guard()) return

      setSession((prev) => (prev ? { ...prev, extractedAssumptions: extracted, validatedAssumptions: validated } : prev))
      pushEvent({
        kind: 'assumptions_extracted',
        label: `Assumptions extracted (${extracted.length}), validated (${validated.length})`,
        status: 'done',
      })

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
            ? 'No decay detected.'
            : 'No decay detected (no anchor matches).'
      const result: AnalysisResult = {
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
        label: `Decays classified (${decayDetails.length})${countsText ? `: ${countsText}` : ''}`,
        status: 'done',
      })
      pushEvent({
        kind: 'final_decay_score',
        label: `Final decay score: ${decayScore}`,
        status: 'done',
      })

      const write = await persistAnalysisSession({ inputType: kind, inputValue: persistInputValue, result })
      if (!guard()) return
      if (!write.ok || write.analysisSessionsCount === 0) {
        const message = write.ok ? 'Firestore persistence failed' : `Firestore persistence failed: ${write.error}`
        setSession((prev) => (prev ? { ...prev, status: 'error', analysisStatus: 'failed', error: message } : prev))
        pushEvent({ kind: 'error', label: message, status: 'error' })
        return
      }

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
        analysisStatus: 'failed',
        assumptions: [],
        decayDetails: [],
        decayScore: null,
        explanationSummary: message,
      }
      setSession((prev) => (prev ? { ...prev, status: 'error', analysisStatus: 'failed', error: message } : prev))
      pushEvent({ kind: 'error', label: message, status: 'error' })
      await persistAnalysisSession({
        inputType: kind,
        inputValue: persistInputValue,
        result: persistResult,
      })
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
      const status = decay ? 'decay' : 'unmatched'
      const evidenceUrl = decay?.evidenceUrl ?? null
      return { assumption: a, decay, anchor, status, evidenceUrl }
    })

    const nowMs = session.completedAtMs ?? Date.now()
    return { result, assumptionCards, nowMs, finalScore: result.decayScore }
  }, [session])

  const canRun = tabIndex === 0 ? Boolean(url.trim()) : Boolean(text.trim())
  const reportJson = useMemo(() => safeJsonStringify(derived?.result ?? null), [derived])

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
      detail: 'Assumptions + validation',
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

  const resultOverview = useMemo(() => {
    if (!derived) return null
    const counts = new Map<DecayDetail['decayClass'], number>()
    for (const d of derived.result.decayDetails) {
      counts.set(d.decayClass, (counts.get(d.decayClass) ?? 0) + 1)
    }
    const matchedAnchors = new Set(derived.result.decayDetails.map((d) => d.matchedAnchorId)).size
    const sortedFindings = [...derived.assumptionCards]
      .filter((x) => x.decay)
      .sort((a, b) => {
        const p = (c: DecayDetail['decayClass']) => (c === 'hard' ? 4 : c === 'risk' ? 3 : c === 'soft' ? 2 : 1)
        const aC = a.decay ? p(a.decay.decayClass) : 0
        const bC = b.decay ? p(b.decay.decayClass) : 0
        return bC - aC || a.assumption.subject.localeCompare(b.assumption.subject)
      })
      .slice(0, 3)

    return {
      counts,
      matchedAnchors,
      assumptions: derived.result.assumptions.length,
      decays: derived.result.decayDetails.length,
      findings: sortedFindings,
    }
  }, [derived])

  const openInspector = () => {
    if (isDesktop) {
      setInspectorDocked(true)
      return
    }
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
      filename: `decay-report_${suffix}.json`,
      text: reportJson || safeJsonStringify(null),
      mime: 'application/json',
    })
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-10 surface-glass">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/2 h-[520px] w-[680px] -translate-x-1/2 rounded-full bg-[rgb(var(--color-primary))]/18 blur-3xl" />
          <div className="absolute -bottom-28 right-[-160px] h-[520px] w-[620px] rounded-full bg-[rgb(var(--color-secondary))]/18 blur-3xl" />
          <div className="absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_55%,transparent_78%)]">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:44px_44px]" />
          </div>
        </div>

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Analyzer</div>
            <div className="mt-2 max-w-2xl text-pretty text-sm text-[color:rgb(var(--color-muted))] sm:text-base">
              Paste a URL or snippet, run detection, then review a clean score + evidence-backed results.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {[
                { label: 'Deterministic pipeline' },
                { label: `Reality anchors: ${anchors.length}` },
                { label: 'Canonical Firestore write' },
              ].map((x) => (
                <span
                  key={x.label}
                  className="rounded-full border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 px-3 py-1 text-xs text-[color:rgb(var(--color-muted))] backdrop-blur"
                >
                  {x.label}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              leftIcon={<CodeBracketSquareIcon className="h-4 w-4" aria-hidden="true" />}
              onClick={openInspector}
              disabled={!derived}
            >
              View JSON
            </Button>
          </div>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
      <Card
        heading="Input"
        description="Choose URL or text, then run detection."
      >
        <Tab.Group selectedIndex={tabIndex} onChange={setTabIndex}>
          <Tab.List className="inline-flex rounded-xl bg-slate-950/5 p-1 ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5">
            {['URL', 'Text'].map((label) => (
              <Tab
                key={label}
                className={({ selected }) =>
                  clsx(
                    'rounded-lg px-3 py-1.5 text-sm font-semibold transition',
                    selected
                      ? 'bg-[rgb(var(--color-panel))] text-[color:rgb(var(--color-text))] shadow-sm ring-1 ring-[color:rgb(var(--color-border))]'
                      : 'text-[color:rgb(var(--color-muted))] hover:text-[color:rgb(var(--color-text))]',
                  )
                }
              >
                {label}
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
                  className="absolute inset-0 z-20 overflow-hidden rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/75 backdrop-blur"
                >
                  <div className="pointer-events-none absolute inset-0 opacity-70">
                    <motion.div
                      className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(99,102,241,0.18),transparent)]"
                      style={{ backgroundSize: '220% 100%' }}
                      animate={reduceMotion ? undefined : { backgroundPositionX: ['0%', '100%'] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                    />
                    <div className="absolute inset-0 bg-[radial-gradient(600px_320px_at_15%_15%,rgba(99,102,241,0.22),transparent_60%),radial-gradient(540px_360px_at_85%_30%,rgba(20,184,166,0.18),transparent_62%)]" />
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
              key={session.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.25 }}
              className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"
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
                        Inspector
                      </Button>
                    </div>
                  </div>

                  {session.error ? (
                    <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
                      {session.error}
                    </div>
                  ) : null}

                  {derived ? (
                    <div className="mt-5 space-y-3">
                      {resultOverview ? (
                        <div className="rounded-2xl p-4 surface-glass">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Overview</div>
                              <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                                {resultOverview.assumptions} assumptions • {resultOverview.matchedAnchors} matched anchors •{' '}
                                {resultOverview.decays} decays
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {(
                                [
                                  { k: 'hard' as const, label: 'Hard', className: 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300' },
                                  { k: 'risk' as const, label: 'Risk', className: 'bg-sky-500/10 text-sky-800 ring-sky-500/20 dark:text-sky-200' },
                                  { k: 'soft' as const, label: 'Soft', className: 'bg-amber-500/10 text-amber-800 ring-amber-500/20 dark:text-amber-200' },
                                  { k: 'context' as const, label: 'Context', className: 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200' },
                                ] as const
                              )
                                .filter((x) => (resultOverview.counts.get(x.k) ?? 0) > 0)
                                .map((x) => (
                                  <span
                                    key={x.k}
                                    className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', x.className)}
                                  >
                                    {x.label} {resultOverview.counts.get(x.k) ?? 0}
                                  </span>
                                ))}
                            </div>
                          </div>

                          {resultOverview.findings.length ? (
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              {resultOverview.findings.map((f) => (
                                <div key={f.assumption.id} className="rounded-xl p-3 surface-panel">
                                  <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Top finding</div>
                                  <div className="mt-1 truncate text-sm font-semibold">{f.assumption.subject}</div>
                                  <div className="mt-1 line-clamp-2 text-xs text-[color:rgb(var(--color-muted))]">
                                    {f.assumption.impliedValue}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="rounded-2xl p-4 surface-glass">
                        <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Decay score</div>
                        <div className="mt-3 flex items-center gap-4">
                          <div className="relative h-24 w-24">
                            <div
                              className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-[rgb(var(--color-primary))]/20 to-[rgb(var(--color-secondary))]/15 blur-xl"
                              aria-hidden="true"
                            />
                            <svg viewBox="0 0 100 100" className="h-full w-full">
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
                                stroke="rgb(var(--color-primary))"
                                strokeWidth="10"
                                strokeLinecap="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: derived.finalScore / 100 }}
                                transition={{ type: 'spring', stiffness: 140, damping: 18, mass: 0.6 }}
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="text-2xl font-semibold tabular-nums">{derived.finalScore}</div>
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">
                              {derived.finalScore >= 85 ? 'Healthy' : derived.finalScore >= 60 ? 'Watch' : 'High risk'}
                            </div>
                            <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                              As-of {dayjs(derived.nowMs).format('YYYY-MM-DD')}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl p-4 surface-glass">
                        <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Summary</div>
                      <div className="mt-2 text-sm text-[color:rgb(var(--color-muted))]">
                          {derived.result.explanationSummary}
                      </div>
                    </div>
                  </div>
                  ) : null}
                </div>

                {derived ? (
                  <div className="rounded-2xl p-4 surface-panel">
                    <div className="text-sm font-semibold">Assumptions</div>
                    <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                      Collapsible cards show match status, severity, and evidence links.
                    </div>

                    <motion.div
                      initial="hidden"
                      animate="show"
                      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                      className="mt-4 space-y-2"
                    >
                      {derived.assumptionCards.length ? (
                        derived.assumptionCards.map(({ assumption, decay, anchor, status, evidenceUrl }) => {
                          const badge =
                            status === 'decay'
                              ? decay?.decayClass === 'hard'
                                ? 'Hard'
                                : decay?.decayClass === 'soft'
                                  ? 'Soft'
                                  : decay?.decayClass === 'risk'
                                    ? 'Risk'
                                    : 'Context'
                              : 'Unmatched'

                          const badgeClass =
                            status === 'decay'
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
                              whileHover={{ y: -2 }}
                            >
                              <Disclosure defaultOpen={false}>
                                {({ open }) => (
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
                                          open ? 'rotate-180' : 'rotate-0',
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
                                              No anchor matched.
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
                          No assumptions extracted from the input.
                        </div>
                      )}
                    </motion.div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl p-4 surface-panel">
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

                <div className="rounded-2xl p-4 surface-panel">
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
                        <div className="text-sm font-semibold text-[color:rgb(var(--color-text))]">Write complete</div>
                        <div className="text-xs text-[color:rgb(var(--color-muted))]">Path: {session.firestore.path}</div>
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
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>

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
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-[88px] space-y-4">
            <AnimatePresence initial={false}>
              {inspectorDocked ? (
                <motion.div
                  key="inspector-docked"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.7 }}
                  className="rounded-3xl p-4 surface-glass"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">Inspector</div>
                      <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                        Raw analysis JSON for the current result.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <IconButton
                        ariaLabel={copied ? 'Copied' : 'Copy JSON to clipboard'}
                        icon={copied ? <CheckIcon className="h-5 w-5" /> : <ClipboardIcon className="h-5 w-5" />}
                        onClick={() => void copyReportJson()}
                        disabled={!derived}
                      />
                      <IconButton
                        ariaLabel="Download JSON file"
                        icon={<ArrowDownTrayIcon className="h-5 w-5" />}
                        onClick={downloadReportJson}
                        disabled={!derived}
                      />
                      <IconButton
                        ariaLabel="Close inspector"
                        icon={<XMarkIcon className="h-5 w-5" />}
                        onClick={() => setInspectorDocked(false)}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
                      className="max-h-[calc(100vh-360px)] overflow-auto p-3 text-xs leading-5 text-[color:rgb(var(--color-muted))]"
                      tabIndex={0}
                      aria-label="Analysis JSON"
                    >
                      {reportJson}
                    </pre>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="inspector-collapsed"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.7 }}
                >
                  <Card
                    heading="Inspector"
                    description={derived ? 'View raw JSON and export/copy.' : 'Run an analysis to enable JSON inspection.'}
                  >
                    <Button
                      variant="secondary"
                      leftIcon={<CodeBracketSquareIcon className="h-4 w-4" />}
                      onClick={() => setInspectorDocked(true)}
                      disabled={!derived}
                      aria-label="Open inspector panel"
                      className="w-full"
                    >
                      Open inspector
                    </Button>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
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
