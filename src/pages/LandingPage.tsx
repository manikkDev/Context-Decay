import {
    ArrowTrendingUpIcon,
    BoltIcon,
    ChartBarIcon,
    CursorArrowRaysIcon,
    LinkIcon,
    ShieldCheckIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { Link } from 'react-router-dom'
import Button from '../components/ui/Button.tsx'
import Card from '../components/ui/Card.tsx'

const features = [
  {
    title: 'Decay signals',
    description: 'Surface freshness, drift, and repetition with structured indicators.',
    icon: <SparklesIcon className="h-5 w-5" aria-hidden="true" />,
  },
  {
    title: 'Timeline',
    description: 'Track context health across edits, summaries, and reference changes.',
    icon: <ChartBarIcon className="h-5 w-5" aria-hidden="true" />,
  },
  {
    title: 'Actionable output',
    description: 'Turn decay into concrete remediation steps and checkpoints.',
    icon: <CursorArrowRaysIcon className="h-5 w-5" aria-hidden="true" />,
  },
]

const steps = [
  {
    title: 'Normalize',
    description: 'Strip noise and standardize tokens so runs stay deterministic.',
    icon: <BoltIcon className="h-5 w-5" aria-hidden="true" />,
  },
  {
    title: 'Extract assumptions',
    description: 'Pull explicit expectations with rule IDs and evidence snippets.',
    icon: <LinkIcon className="h-5 w-5" aria-hidden="true" />,
  },
  {
    title: 'Match anchors',
    description: 'Compare assumptions against known reality anchors and classify decays.',
    icon: <ArrowTrendingUpIcon className="h-5 w-5" aria-hidden="true" />,
  },
  {
    title: 'Score + store',
    description: 'Compute a canonical score and persist a single source of truth.',
    icon: <ShieldCheckIcon className="h-5 w-5" aria-hidden="true" />,
  },
]

function LandingPage() {
  const reduceMotion = useReducedMotion()
  const reveal = {
    hidden: { opacity: 0, y: 14 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { type: 'spring' as const, stiffness: 280, damping: 26, mass: 0.7, delay: 0.05 + i * 0.06 },
    }),
  } satisfies Variants

  const shimmer = reduceMotion
    ? {}
    : {
        backgroundPosition: ['0% 0%', '100% 100%'],
        transition: { duration: 10, repeat: Infinity },
      }

  const floaty = reduceMotion
    ? {}
    : {
        y: [0, -8, 0],
        rotate: [0, 0.6, 0],
        transition: { duration: 6, repeat: Infinity },
      }

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl surface-glass">
        <div className="pointer-events-none absolute inset-0">
          <motion.div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                'radial-gradient(900px 500px at 12% 14%, rgba(var(--color-primary),0.20), transparent 55%), radial-gradient(820px 520px at 86% 20%, rgba(var(--color-secondary),0.18), transparent 55%), radial-gradient(760px 520px at 60% 92%, rgba(168,85,247,0.14), transparent 60%)',
              backgroundSize: '240% 240%',
            }}
            animate={shimmer}
          />
          <div className="absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_52%,transparent_78%)]">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:44px_44px]" />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0),rgba(0,0,0,0.04))] dark:bg-[linear-gradient(to_bottom,rgba(0,0,0,0),rgba(255,255,255,0.06))]" />
        </div>

        <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center">
          <div className="min-w-0">
            <motion.div variants={reveal} initial="hidden" animate="show" custom={0}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 px-3 py-1 text-xs font-semibold text-[color:rgb(var(--color-muted))] backdrop-blur">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full bg-[rgb(var(--color-primary))]/50 ${reduceMotion ? 'opacity-0' : 'animate-ping'}`}
                  />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[rgb(var(--color-primary))]" />
                </span>
                Deterministic analysis • modern motion UI
              </div>
            </motion.div>

            <motion.h1
              variants={reveal}
              initial="hidden"
              animate="show"
              custom={1}
              className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-5xl"
            >
              Detect context drift before it turns into{' '}
              <span className="bg-gradient-to-r from-[rgb(var(--color-primary))] via-fuchsia-500 to-[rgb(var(--color-secondary))] bg-clip-text text-transparent">
                knowledge decay
              </span>
            </motion.h1>

            <motion.p
              variants={reveal}
              initial="hidden"
              animate="show"
              custom={2}
              className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-[color:rgb(var(--color-muted))] sm:text-base"
            >
              A design-forward analyzer that inspects text and URLs for freshness, cohesion, and stability—then writes
              one canonical result you can trust.
            </motion.p>

            <motion.div
              variants={reveal}
              initial="hidden"
              animate="show"
              custom={3}
              className="mt-7 flex flex-wrap items-center gap-3"
            >
              <Link to="/analyze">
                <Button variant="primary">Open Analyzer</Button>
              </Link>
              <Link to="/demo">
                <Button variant="secondary">View Demo</Button>
              </Link>
              <div className="ml-1 flex items-center gap-2 text-xs text-[color:rgb(var(--color-muted))]">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
                Fast, local-first UI
              </div>
            </motion.div>

            <motion.div
              variants={reveal}
              initial="hidden"
              animate="show"
              custom={4}
              className="mt-8 flex flex-wrap items-center gap-2"
            >
              {['Normalization', 'Assumptions', 'Anchors', 'Scoring', 'Firestore'].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 px-3 py-1 text-xs text-[color:rgb(var(--color-muted))] backdrop-blur"
                >
                  {label}
                </span>
              ))}
            </motion.div>
          </div>

          <motion.div
            className="relative"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.1 }}
          >
            <motion.div
              className="relative overflow-hidden rounded-3xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/65 p-4 shadow-sm backdrop-blur"
              whileHover={reduceMotion ? undefined : { y: -4 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.7 }}
              animate={floaty}
            >
              <div className="pointer-events-none absolute inset-0 opacity-80">
                <div className="absolute -top-20 left-10 h-56 w-56 rounded-full bg-[rgb(var(--color-primary))]/20 blur-3xl" />
                <div className="absolute -bottom-24 right-0 h-56 w-56 rounded-full bg-[rgb(var(--color-secondary))]/20 blur-3xl" />
              </div>

              <div className="relative flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Live preview</div>
                  <div className="mt-1 text-xs text-[color:rgb(var(--color-muted))]">
                    Animated report summary + stable scoring
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {['bg-emerald-500/70', 'bg-amber-500/70', 'bg-rose-500/70'].map((c) => (
                    <span key={c} className={`h-2 w-2 rounded-full ${c}`} />
                  ))}
                </div>
              </div>

              <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Decay score</div>
                    <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">92</div>
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-950/5 ring-1 ring-inset ring-[color:rgb(var(--color-border))] dark:bg-white/5">
                    <motion.div
                      className="h-full w-[92%] rounded-full bg-gradient-to-r from-emerald-400 to-[rgb(var(--color-primary))]"
                      initial={{ width: '0%' }}
                      animate={{ width: '92%' }}
                      transition={{ duration: 1.2, delay: 0.25 }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    {[
                      { label: 'Hard', value: '0' },
                      { label: 'Soft', value: '1' },
                      { label: 'Risk', value: '0' },
                    ].map((x) => (
                      <div key={x.label} className="rounded-xl bg-slate-950/5 p-2 dark:bg-white/5">
                        <div className="text-[11px] text-[color:rgb(var(--color-muted))]">{x.label}</div>
                        <div className="mt-1 font-semibold tabular-nums">{x.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 p-3">
                  <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Signals</div>
                  <div className="mt-3 space-y-2">
                    {[
                      { label: 'Anchor match', pct: 0.84 },
                      { label: 'Assumption clarity', pct: 0.72 },
                      { label: 'Determinism', pct: 0.96 },
                    ].map((x, idx) => (
                      <div key={x.label} className="rounded-xl bg-slate-950/5 p-2 dark:bg-white/5">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[color:rgb(var(--color-muted))]">
                          <span>{x.label}</span>
                          <span className="font-semibold tabular-nums">{Math.round(x.pct * 100)}%</span>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-950/5 ring-1 ring-inset ring-[color:rgb(var(--color-border))] dark:bg-white/5">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-[rgb(var(--color-secondary))] to-fuchsia-500"
                            initial={{ width: '0%' }}
                            animate={{ width: `${Math.round(x.pct * 100)}%` }}
                          transition={{
                            duration: 0.95,
                            delay: 0.35 + idx * 0.08,
                          }}
                        />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative mt-4 overflow-hidden rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Recent events</div>
                  <div className="text-[11px] text-[color:rgb(var(--color-muted))]">As-of today</div>
                </div>
                <div className="mt-3 space-y-2">
                  {[
                    { label: 'Input normalized', tone: 'bg-emerald-500/10 text-emerald-800 ring-emerald-500/20 dark:text-emerald-200' },
                    { label: 'Assumptions extracted', tone: 'bg-sky-500/10 text-sky-800 ring-sky-500/20 dark:text-sky-200' },
                    { label: 'Anchors matched', tone: 'bg-fuchsia-500/10 text-fuchsia-800 ring-fuchsia-500/20 dark:text-fuchsia-200' },
                  ].map((x) => (
                    <div key={x.label} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/5 px-2.5 py-2 dark:bg-white/5">
                      <div className="min-w-0 truncate text-xs font-medium">{x.label}</div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${x.tone}`}>
                        done
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">What you get</div>
            <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
              A small design-forward prototype with motion and glass surfaces.
            </div>
          </div>
        </div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.08 } },
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div
              key={f.title}
              variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
              transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.7 }}
              whileHover={reduceMotion ? undefined : { y: -3 }}
            >
              <Card
                className="h-full"
                heading={
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950/5 text-[color:rgb(var(--color-text))] ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5">
                      {f.icon}
                    </span>
                    <span>{f.title}</span>
                  </div>
                }
                description={f.description}
              >
                <div className="mt-4 text-xs text-[color:rgb(var(--color-muted))]">
                  Designed to stay readable in both themes with token-driven colors.
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section className="rounded-3xl p-6 sm:p-10 surface-glass">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)] lg:items-start">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.55 }}
            >
              <div className="text-sm font-semibold">How it works</div>
              <div className="mt-2 text-sm text-[color:rgb(var(--color-muted))]">
                A fixed pipeline designed for repeatable results and a premium reading experience.
              </div>
            </motion.div>

            <motion.div
              className="mt-6 space-y-3"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: '-80px' }}
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
            >
              {steps.map((s) => (
                <motion.div
                  key={s.title}
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.4 }}
                  whileHover={reduceMotion ? undefined : { x: 2 }}
                >
                  <div className="flex items-start gap-3 rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 p-4 backdrop-blur">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950/5 ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5">
                      {s.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{s.title}</div>
                      <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">{s.description}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
            className="rounded-3xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))]/55 p-5 backdrop-blur"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Bento layout</div>
                <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                  Motion-first UI patterns for modern product pages.
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-[rgb(var(--color-primary))]/10 px-2.5 py-1 text-xs font-semibold text-[rgb(var(--color-primary))] ring-1 ring-inset ring-[rgb(var(--color-primary))]/20">
                New
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { k: 'Responsive', v: 'Mobile → desktop' },
                { k: 'Motion', v: 'Viewport + hover' },
                { k: 'Contrast', v: 'Theme-safe tokens' },
                { k: 'Clarity', v: 'Readable density' },
              ].map((x) => (
                <div key={x.k} className="rounded-2xl bg-slate-950/5 p-4 ring-1 ring-inset ring-[color:rgb(var(--color-border))] dark:bg-white/5">
                  <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">{x.k}</div>
                  <div className="mt-2 text-sm font-semibold">{x.v}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl bg-slate-950/5 ring-1 ring-inset ring-[color:rgb(var(--color-border))] dark:bg-white/5">
              <motion.div
                className="h-10 w-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]"
                style={{ backgroundSize: '220% 100%' }}
                animate={reduceMotion ? undefined : { backgroundPositionX: ['0%', '100%'] }}
                transition={{ duration: 2.2, repeat: Infinity }}
              />
            </div>
          </motion.div>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-3xl p-6 sm:p-10 surface-panel">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-20 left-[-120px] h-72 w-72 rounded-full bg-[rgb(var(--color-primary))]/18 blur-3xl" />
          <div className="absolute -bottom-24 right-[-120px] h-72 w-72 rounded-full bg-[rgb(var(--color-secondary))]/18 blur-3xl" />
        </div>
        <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Ready to explore?</div>
            <div className="mt-2 max-w-2xl text-sm text-[color:rgb(var(--color-muted))]">
              Paste a URL or snippet and see a polished, deterministic analysis result with export-ready JSON.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/analyze">
              <Button variant="primary">Start analyzing</Button>
            </Link>
            <Link to="/demo">
              <Button variant="secondary">Run curated demos</Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="rounded-3xl p-6 surface-glass">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold">Context Decay</div>
          <div className="text-sm text-[color:rgb(var(--color-muted))]">
            Prototype UI for exploring context stability.
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
