import { CheckCircleIcon, PauseIcon, PlayIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import dayjs from 'dayjs'
import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import Button from '../components/ui/Button.tsx'
import Card from '../components/ui/Card.tsx'
import demoInputs from '../data/demoInputs.json'
import realitySeed from '../data/reality-seed.json'
import { extractAssumptionsFromNormalized, normalizeForAnalysis, type Assumption } from '../lib/assumptionExtractor'
import { classifyDecays, matchDecays, scoreDecay, type DecayDetail, type RealityAnchor } from '../lib/decayEngine'

type DemoInput = {
  id: string
  title: string
  kind: 'text' | 'url'
  sourceLabel?: string
  sourceUrl?: string
  text: string
  expectedSignal?: string
}

type DemoResult = {
  demoId: string
  title: string
  startedAt: number
  finishedAt: number
  assumptions: Assumption[]
  decayDetails: DecayDetail[]
  decayScore: number
  explanationSummary: string
  storage: null
}

type RunStatus = 'idle' | 'running' | 'done' | 'error'

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

function deltaTone(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up'
  if (delta < 0) return 'down'
  return 'flat'
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

function DemoRunnerPage() {
  const anchors = useMemo(() => {
    const list = Array.isArray(realitySeed) ? (realitySeed as RealityAnchor[]) : []
    return list.filter((a) => typeof a?.id === 'string' && a.id.trim().length > 0)
  }, [])

  const examples = useMemo(() => {
    const list = Array.isArray(demoInputs) ? (demoInputs as DemoInput[]) : []
    return list.filter((x) => typeof x?.id === 'string' && typeof x?.title === 'string' && typeof x?.text === 'string')
  }, [])

  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [results, setResults] = useState<Record<string, DemoResult>>({})
  const [presentationMode, setPresentationMode] = useState(false)
  const tokenRef = useRef(0)

  const active = examples[activeIndex] ?? null
  const activeResult = active ? results[active.id] ?? null : null
  const previous = activeIndex > 0 ? examples[activeIndex - 1] ?? null : null
  const previousResult = previous ? results[previous.id] ?? null : null

  const scoreColor = (score: number) => {
    if (score >= 85) return 'text-emerald-700 dark:text-emerald-200'
    if (score >= 60) return 'text-amber-800 dark:text-amber-200'
    return 'text-red-700 dark:text-red-300'
  }

  const scoreLabel = (score: number) => {
    if (score >= 85) return 'Healthy'
    if (score >= 60) return 'Watch'
    return 'High risk'
  }

  const runOne = async (ex: DemoInput, seq: number): Promise<void> => {
    const startedAt = Date.now()
    const inputText = ex.text
    const normalized = normalizeForAnalysis({ text: inputText })
    const assumptions = extractAssumptionsFromNormalized(normalized)
    if (tokenRef.current !== seq) return

    const matches = matchDecays({
      assumptions,
      anchors,
      normalizedLower: normalized.normalizedLower,
      tokens: normalized.tokens,
    })
    const decayDetails = classifyDecays({ matches, anchors, assumptions })
    const decayScore = scoreDecay(decayDetails)
    const storage = null

    const finishedAt = Date.now()
    setResults((prev) => ({
      ...prev,
      [ex.id]: {
        demoId: ex.id,
        title: ex.title,
        startedAt,
        finishedAt,
        assumptions,
        decayDetails,
        decayScore,
        explanationSummary: decayDetails.length ? `Detected ${decayDetails.length} decay(s). Score ${decayScore}.` : 'No decay detected.',
        storage,
      },
    }))
  }

  const runAll = async (opts: { presentation: boolean }): Promise<void> => {
    const seq = tokenRef.current + 1
    tokenRef.current = seq
    setStatus('running')
    setError(null)
    for (let i = 0; i < examples.length; i += 1) {
      if (tokenRef.current !== seq) return
      setActiveIndex(i)
      await sleep(450)
      await runOne(examples[i], seq)
      if (tokenRef.current !== seq) return

      if (opts.presentation) {
        const started = Date.now()
        while (Date.now() - started < 10_000) {
          if (tokenRef.current !== seq) return
          await sleep(250)
        }
      } else {
        await sleep(550)
      }
    }
    if (tokenRef.current !== seq) return
    setStatus('done')
  }

  const summary = useMemo(() => {
    const list = examples
      .map((ex) => results[ex.id])
      .filter((x): x is DemoResult => Boolean(x))
      .sort((a, b) => a.finishedAt - b.finishedAt)
    if (!list.length) return null
    const avg = list.reduce((s, r) => s + r.decayScore, 0) / list.length
    const min = Math.min(...list.map((r) => r.decayScore))
    const max = Math.max(...list.map((r) => r.decayScore))
    return { count: list.length, avg: Math.round(avg), min, max }
  }, [examples, results])

  const applauseActive = Boolean(activeResult && activeResult.decayScore >= 85)
  const deltas = useMemo(() => {
    if (!activeResult || !previousResult) return null
    const scoreDelta = activeResult.decayScore - previousResult.decayScore
    const mismatchDelta = activeResult.decayDetails.length - previousResult.decayDetails.length
    const assumptionDelta = activeResult.assumptions.length - previousResult.assumptions.length
    return { scoreDelta, mismatchDelta, assumptionDelta }
  }, [activeResult, previousResult])

  const togglePresentation = () => {
    if (presentationMode) {
      tokenRef.current += 1
      setPresentationMode(false)
      setStatus('idle')
      setError(null)
      return
    }
    setPresentationMode(true)
    void runAll({ presentation: true }).catch((err) => {
      setStatus('error')
      setError(formatError(err))
    })
  }

  return (
    <div className="space-y-6">
      <Card
        heading="Demo runner"
        description="Seeds curated examples and runs the analyzer automatically for demo mode."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={status === 'running' || examples.length === 0}
              onClick={() => {
                void runAll({ presentation: false }).catch((err) => {
                  setStatus('error')
                  setError(formatError(err))
                })
              }}
            >
              {status === 'running' ? 'Running…' : 'Run Demo'}
            </Button>
            <Button
              variant="secondary"
              disabled={status === 'running'}
              onClick={() => {
                tokenRef.current += 1
                setStatus('idle')
                setError(null)
                setResults({})
                setActiveIndex(0)
              }}
            >
              Reset
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={presentationMode ? 'primary' : 'secondary'}
              leftIcon={presentationMode ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
              disabled={examples.length === 0}
              onClick={togglePresentation}
            >
              {presentationMode ? 'Presentation mode: On' : 'Presentation mode: Off'}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            {examples.map((ex, idx) => {
              const res = results[ex.id] ?? null
              const prev = idx > 0 ? results[examples[idx - 1].id] ?? null : null
              const isActive = idx === activeIndex
              const score = res?.decayScore ?? null
              const scoreDelta = score !== null && prev?.decayScore != null ? score - prev.decayScore : null
              const deltaKind = typeof scoreDelta === 'number' ? deltaTone(scoreDelta) : null
              return (
                <motion.div
                  key={ex.id}
                  layout
                  initial={false}
                  animate={{ scale: isActive ? 1 : 0.99 }}
                  transition={{ duration: 0.2 }}
                  className={clsx(
                    'rounded-2xl p-4 ring-1 ring-inset surface-glass',
                    isActive ? 'ring-[rgb(var(--color-primary))]/30' : 'ring-[color:rgb(var(--color-border))]',
                  )}
                  onClick={() => setActiveIndex(idx)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{ex.title}</div>
                      <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                        {ex.sourceLabel ? `${ex.sourceLabel}${ex.sourceUrl ? ' • ' : ''}` : null}
                        {ex.sourceUrl ? (
                          <a
                            href={ex.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-[rgb(var(--color-primary))] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Source
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Score</div>
                      <div className={clsx('mt-1 text-lg font-semibold tabular-nums', score !== null ? scoreColor(score) : '')}>
                        {score ?? '—'}
                      </div>
                      <AnimatePresence initial={false}>
                        {typeof scoreDelta === 'number' ? (
                          <motion.div
                            key={`${ex.id}:${scoreDelta}`}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.18 }}
                            className={clsx(
                              'mt-1 text-xs font-semibold tabular-nums',
                              deltaKind === 'up'
                                ? 'text-emerald-700 dark:text-emerald-200'
                                : deltaKind === 'down'
                                  ? 'text-red-700 dark:text-red-300'
                                  : 'text-[color:rgb(var(--color-muted))]',
                            )}
                          >
                            {formatDelta(scoreDelta)}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-[color:rgb(var(--color-muted))] line-clamp-3">
                    {ex.text}
                  </div>

                  {res ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-[color:rgb(var(--color-muted))]">
                      <CheckCircleIcon className="h-4 w-4" />
                      <span className="tabular-nums">{dayjs(res.finishedAt).format('HH:mm:ss')}</span>
                    </div>
                  ) : null}
                </motion.div>
              )
            })}
          </div>

            <div className="space-y-4">
              <div className="rounded-2xl p-4 surface-panel">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Active example</div>
                  <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                    {active ? active.title : '—'}
                  </div>
                </div>
                {activeResult ? (
                  <div className="text-right">
                    <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Decay</div>
                    <div className={clsx('mt-1 text-xl font-semibold tabular-nums', scoreColor(activeResult.decayScore))}>
                      {activeResult.decayScore}
                    </div>
                    <div className="mt-0.5 text-xs text-[color:rgb(var(--color-muted))]">
                      {scoreLabel(activeResult.decayScore)}
                    </div>
                  </div>
                ) : null}
              </div>

              {activeResult ? (
                <div className="mt-4">
                  <div className="relative h-24 w-24">
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
                        animate={{ pathLength: activeResult.decayScore / 100 }}
                        transition={{ duration: 0.55, ease: 'easeOut' }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-2xl font-semibold tabular-nums">
                        {activeResult.decayScore}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="rounded-xl p-3 surface-glass">
                      <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Assumptions</div>
                      <div className="mt-1 text-sm">
                        {activeResult.assumptions.length}
                      </div>
                    </div>
                    <div className="rounded-xl p-3 surface-glass">
                      <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Mismatches</div>
                      <div className="mt-1 text-sm">
                        {activeResult.decayDetails.length}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-[color:rgb(var(--color-muted))]">
                  Run the demo to generate results. Presentation mode auto-runs and auto-advances every 10 seconds.
                </div>
              )}
            </div>

            {activeResult && previousResult && deltas ? (
              <motion.div
                key={`${activeResult.demoId}:${previousResult.demoId}:${deltas.scoreDelta}:${deltas.mismatchDelta}:${deltas.assumptionDelta}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                className="rounded-2xl p-4 surface-panel"
              >
                <div className="text-sm font-semibold">Compared to previous</div>
                <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                  {previous ? previous.title : '—'}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Score', delta: deltas.scoreDelta },
                    { label: 'Mismatches', delta: deltas.mismatchDelta },
                    { label: 'Assumptions', delta: deltas.assumptionDelta },
                  ].map((x) => {
                    const kind = deltaTone(x.delta)
                    return (
                      <div key={x.label} className="rounded-xl p-3 surface-glass">
                        <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">{x.label}</div>
                        <div
                          className={clsx(
                            'mt-1 text-lg font-semibold tabular-nums',
                            kind === 'up'
                              ? 'text-emerald-700 dark:text-emerald-200'
                              : kind === 'down'
                                ? 'text-red-700 dark:text-red-300'
                                : 'text-[color:rgb(var(--color-muted))]',
                          )}
                        >
                          {formatDelta(x.delta)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            ) : null}

            {summary ? (
              <div className="rounded-2xl p-4 surface-panel">
                <div className="text-sm font-semibold">Run summary</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Runs', value: String(summary.count) },
                    { label: 'Avg score', value: String(summary.avg) },
                    { label: 'Range', value: `${summary.min}–${summary.max}` },
                  ].map((x) => (
                    <div key={x.label} className="rounded-xl p-3 surface-glass">
                      <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">{x.label}</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">{x.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <AnimatePresence>
        {applauseActive ? (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: [0.95, 1.03, 1] }}
              transition={{ duration: 0.55 }}
              className="rounded-2xl bg-[rgb(var(--color-panel))] px-4 py-3 ring-1 ring-inset ring-[color:rgb(var(--color-border))] shadow-lg"
            >
              <div className="text-sm font-semibold">Applause</div>
              <motion.div
                className="mt-1 text-lg"
                animate={{ rotate: [0, -2, 2, 0] }}
                transition={{ duration: 0.7 }}
              >
                👏👏👏
              </motion.div>
              <div className="mt-1 text-xs text-[color:rgb(var(--color-muted))]">
                High score moment
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default DemoRunnerPage
