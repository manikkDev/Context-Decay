import { ArrowRightIcon, DocumentTextIcon, LinkIcon } from '@heroicons/react/24/outline'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button.tsx'
import Card from '../components/ui/Card.tsx'
import {
  seedCloudFirestoreDemoData,
  verifyCloudFirestoreConnection,
  type FirestoreTestResult,
} from '../lib/firestoreTest'

type DemoExample = {
  title: string
  kind: 'url' | 'text'
  value: string
  summary: string
}

const examples: DemoExample[] = [
  {
    title: 'Web tutorial URL',
    kind: 'url',
    value: 'https://vite.dev/guide/',
    summary: 'Docs-style content with frequent updates and clear structure.',
  },
  {
    title: 'Concept snippet',
    kind: 'text',
    value:
      'A context window is a bounded memory used by an assistant to generate responses. Over time, the window can accumulate stale assumptions, repeated facts, and contradictory notes. A detector should surface drift and recommend refresh actions.',
    summary: 'A short text chunk with stable definitions and room for drift scoring.',
  },
  {
    title: 'API notes',
    kind: 'text',
    value:
      'When integrating external APIs, cache results with a TTL and persist citations. If the upstream schema changes, invalidate cached responses and re-run normalization to prevent silent corruption of downstream analytics.',
    summary: 'A practical snippet that can be used for extractable signals and checks.',
  },
]

function DemoPage() {
  const navigate = useNavigate()
  const [testResult, setTestResult] = useState<FirestoreTestResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  async function runFirestoreTest() {
    setIsRunning(true)
    setTestResult(null)
    const result = await verifyCloudFirestoreConnection()
    setTestResult(result)
    setIsRunning(false)
  }

  async function seedDemoData() {
    setIsRunning(true)
    setTestResult(null)
    const result = await seedCloudFirestoreDemoData()
    setTestResult(result)
    setIsRunning(false)
  }

  return (
    <div className="space-y-6">
      <Card
        heading="Cloud Firestore verification"
        description="Writes a document and reads it back from cloud Firestore."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={runFirestoreTest} disabled={isRunning}>
            {isRunning ? 'Running…' : 'Verify Cloud Firestore'}
          </Button>
          <Button variant="secondary" onClick={seedDemoData} disabled={isRunning}>
            {isRunning ? 'Running…' : 'Seed demo data'}
          </Button>
        </div>

        {testResult ? (
          <div className="mt-4 rounded-xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-3">
            {testResult.ok ? (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-[color:rgb(var(--color-text))]">
                  Success
                </div>
                <div className="text-xs text-[color:rgb(var(--color-muted))]">
                  Project: {testResult.projectId}
                </div>
                <div className="text-xs text-[color:rgb(var(--color-muted))]">Path: {testResult.path}</div>
                <pre className="max-h-56 overflow-auto text-xs leading-5 text-[color:rgb(var(--color-muted))]">
                  {JSON.stringify(testResult.data, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-red-600 dark:text-red-400">Failed</div>
                <pre className="whitespace-pre-wrap text-xs leading-5 text-[color:rgb(var(--color-muted))]">
                  {testResult.error}
                </pre>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      <Card
        heading="Demo"
        description="Pick a curated example and load it into the Analyzer shell."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {examples.map((ex, idx) => (
            <motion.div
              key={ex.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: idx * 0.05 }}
              whileHover={{ y: -2 }}
              className="h-full"
            >
              <div className="h-full rounded-2xl p-4 surface-glass">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{ex.title}</div>
                    <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                      {ex.summary}
                    </div>
                  </div>
                  <div
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950/5 ring-1 ring-[color:rgb(var(--color-border))] dark:bg-white/5"
                    aria-hidden="true"
                  >
                    {ex.kind === 'url' ? (
                      <LinkIcon className="h-5 w-5" />
                    ) : (
                      <DocumentTextIcon className="h-5 w-5" />
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <Button
                    variant="secondary"
                    rightIcon={<ArrowRightIcon className="h-4 w-4" />}
                    onClick={() => {
                      navigate('/analyze', { state: { preset: ex } })
                    }}
                    className="w-full"
                  >
                    Load in Analyzer
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export default DemoPage
