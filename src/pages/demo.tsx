import {
  ArrowRightIcon,
  BoltIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  LinkIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button.tsx'
import Card from '../components/ui/Card.tsx'

type AnalyzerPreset = {
  kind: 'url' | 'text'
  value: string
  title?: string
}

function HowToUsePage() {
  const navigate = useNavigate()

  const examples = useMemo((): AnalyzerPreset[] => {
    return [
      {
        kind: 'text',
        title: 'React setup tutorial from 2019 (example)',
        value:
          "React setup (2019-style): Use create-react-app to create a new project. Install react-router-dom@5 and use useHistory() with <Switch> for routing. Deploy the build output to Heroku using a free dyno, and set config vars in the Heroku dashboard. For Node, use version 12.",
      },
      {
        kind: 'text',
        title: 'Deploying to Heroku (example)',
        value:
          'Deployment notes: Push your repo to Heroku, let it build automatically, and rely on free-tier dynos for preview environments. Use the legacy buildpack settings and configure environment variables directly in the dashboard.',
      },
      {
        kind: 'text',
        title: 'Framework/tool recommendation (example)',
        value:
          'Recommendation: For a new frontend project, use create-react-app because it is the standard. For state management, use Redux everywhere. For APIs, use REST only and avoid GraphQL. This approach is stable for most teams.',
      },
    ]
  }, [])

  return (
    <div className="space-y-6">
      <div className="rounded-3xl p-6 surface-glass">
        <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">How to Use This Tool</div>
        <div className="mt-2 text-balance text-2xl font-semibold tracking-tight">
          Know what to paste, and what results mean
        </div>
        <div className="mt-2 max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          This page helps you choose the right kind of content so the analyzer can produce a meaningful result.
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="primary"
            rightIcon={<ArrowRightIcon className="h-4 w-4" aria-hidden="true" />}
            onClick={() => navigate('/analyze')}
          >
            Open Analyzer
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const first = examples[0]
              if (!first) return
              navigate('/analyze', { state: { preset: { kind: first.kind, value: first.value, title: first.title } } })
            }}
          >
            Try a sample input
          </Button>
        </div>
      </div>

      <Card heading="What this analyzer is designed to check">
        <div className="max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          This tool checks whether technical information still matches today’s tools, APIs, and environments. It does NOT
          judge writing quality or correctness — it checks whether conditions have changed since the content was written.
        </div>
      </Card>

      <Card heading="Good things to analyze" description="These inputs usually produce meaningful results.">
        <div className="grid gap-3 lg:grid-cols-2">
          {[
            {
              title: 'Technical tutorials',
              description: 'Setup steps, commands, or workflows for React, backend, DevOps, cloud, and tooling.',
              icon: <DocumentTextIcon className="h-5 w-5" aria-hidden="true" />,
            },
            {
              title: 'StackOverflow-style answers',
              description: 'Recommendations for specific tools, versions, libraries, or approaches.',
              icon: <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />,
            },
            {
              title: 'Blog posts about deployment or setup',
              description: 'Hosting, CI, environment variables, SDKs, and platform-specific instructions.',
              icon: <BoltIcon className="h-5 w-5" aria-hidden="true" />,
            },
            {
              title: 'Version-dependent documentation',
              description: 'Docs where behavior changes over time, especially across major releases.',
              icon: <ShieldCheckIcon className="h-5 w-5" aria-hidden="true" />,
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950/5 ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5">
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">{item.description}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-2xl bg-[rgb(var(--color-bg))]/55 p-4 ring-1 ring-inset ring-[color:rgb(var(--color-border))]">
          <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">Example links (not auto-run)</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              'A React setup tutorial from 2019',
              'A blog explaining how to deploy to Heroku',
              'An answer recommending a specific framework or tool',
            ].map((label) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-xl bg-[rgb(var(--color-bg))] px-3 py-2 ring-1 ring-inset ring-[color:rgb(var(--color-border))]"
              >
                <LinkIcon className="h-4 w-4 text-[rgb(var(--color-primary))]" aria-hidden="true" />
                <div className="min-w-0 truncate text-sm font-semibold text-[rgb(var(--color-primary))]">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card heading="When decay analysis does not apply" description="If you see no score, this can be expected behavior.">
        <div className="max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          Some content does not rely on changing ecosystems, so there is nothing to decay.
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {[
            'Basic programming concepts (loops, arrays, syntax)',
            'Math or algorithm fundamentals',
            'General explanations without tools or environments',
            'Non-technical articles or random text',
          ].map((label) => (
            <div
              key={label}
              className="flex items-start gap-3 rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4"
            >
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-200">
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{label}</div>
                <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                  These are stable ideas. The analyzer is intentionally conservative and avoids inventing a score when the input
                  does not depend on changing tools or platforms.
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card heading="What happens behind the scenes">
        <div className="grid gap-3">
          {[
            'The content is scanned for technical signals.',
            'The system identifies what the content expects to be true.',
            'Those expectations are compared with today’s reality.',
            'If conditions changed, a relevance score is shown.',
            'If not, the system explains why no score is needed.',
          ].map((label, idx) => (
            <div
              key={label}
              className="flex items-start gap-3 rounded-2xl bg-[rgb(var(--color-bg))]/55 p-4 ring-1 ring-inset ring-[color:rgb(var(--color-border))]"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[rgb(var(--color-primary))]/10 text-[rgb(var(--color-primary))] ring-1 ring-inset ring-[rgb(var(--color-primary))]/20 tabular-nums">
                {idx + 1}
              </div>
              <div className="text-sm text-[color:rgb(var(--color-muted))]">{label}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card heading="How to read the result">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-200">
            Green / high score → safe to use
          </span>
          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200">
            Yellow → use with caution
          </span>
          <span className="inline-flex items-center rounded-full bg-rose-500/10 px-3 py-1 text-sm font-semibold text-rose-800 ring-1 ring-inset ring-rose-500/20 dark:text-rose-200">
            Red → likely outdated or risky
          </span>
          <span className="inline-flex items-center rounded-full bg-slate-500/10 px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-500/20 dark:text-slate-200">
            No score → non-technical or timeless content
          </span>
        </div>
        <div className="mt-4 text-sm text-[color:rgb(var(--color-muted))]">
          A low score does not mean the content is wrong — it means the world changed.
        </div>
      </Card>

      <Card heading="Current limitations">
        <div className="grid gap-2 text-sm text-[color:rgb(var(--color-muted))]">
          <div>Works best on technical, ecosystem-dependent content.</div>
          <div>Not designed for opinion pieces.</div>
          <div>Some sites may block content fetching.</div>
          <div>Prototype uses a limited knowledge base.</div>
        </div>
      </Card>

      <Card heading="Start analyzing">
        <div className="max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          Paste a technical tutorial or answer to see how it holds up today.
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="primary"
            rightIcon={<ArrowRightIcon className="h-4 w-4" aria-hidden="true" />}
            onClick={() => navigate('/analyze')}
          >
            Paste your own content
          </Button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {examples.map((ex) => (
            <div
              key={ex.title ?? ex.value.slice(0, 20)}
              className="rounded-2xl bg-[rgb(var(--color-bg))]/55 p-4 ring-1 ring-inset ring-[color:rgb(var(--color-border))]"
            >
              <div className="text-sm font-semibold">{ex.title}</div>
              <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))] line-clamp-3">{ex.value}</div>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => navigate('/analyze', { state: { preset: { kind: ex.kind, value: ex.value, title: ex.title } } })}
                >
                  Load in Analyzer
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card heading="How Decay Detection Works (Scope & Limitations)">
        <div className="max-w-3xl space-y-4 text-sm text-[color:rgb(var(--color-muted))]">
          <div>
            This system checks whether technical guidance still matches today’s tools and practices by comparing what the
            content expects to be true against a curated knowledge base of approximately 25–30 high-impact ecosystem
            changes. These are real, verifiable shifts that affected a large amount of technical content.
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-[color:rgb(var(--color-text))]">What the knowledge base covers</div>
            <div className="space-y-1">
              <div>Frontend frameworks (for example: Create React App deprecation, major framework version shifts)</div>
              <div>Package management &amp; runtimes (for example: Node.js end-of-life, npm and Yarn behavior changes)</div>
              <div>Backend frameworks (for example: major breaking framework updates)</div>
              <div>Cloud platforms &amp; hosting (for example: removal of free tiers, policy changes)</div>
              <div>DevOps &amp; tooling (for example: deprecated tools, changed defaults)</div>
            </div>
          </div>

          <div>
            Coverage is intentionally limited. The system does not attempt to know everything, because broad coverage
            would require guesswork. If a change is not in the knowledge base, the analyzer will not invent decay for it
            — it will either find no relevant change, or explain that decay analysis does not apply here.
          </div>

          <div>
            Decay analysis works best for tutorials, setup guides, blog posts, and Q&amp;A answers that recommend specific
            tools or workflows. Foundational concepts (like loops, arrays, or algorithms) and actively maintained official
            documentation may not receive a relevance score, because there is often nothing time-sensitive to evaluate.
          </div>
        </div>
      </Card>
    </div>
  )
}

export default HowToUsePage
