import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Assumption } from './assumptionExtractor'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function a(partial: Partial<Assumption> & Pick<Assumption, 'id' | 'subject' | 'type' | 'impliedValue' | 'confidence'>): Assumption {
  return {
    id: partial.id,
    subject: partial.subject,
    ruleId: partial.ruleId ?? 'test.rule',
    evidenceSnippet: partial.evidenceSnippet ?? partial.impliedValue,
    type: partial.type,
    impliedValue: partial.impliedValue,
    confidence: partial.confidence,
  }
}

describe('two-tier LLM pipeline', () => {
  it('escalates when small model confidence is low', async () => {
    vi.resetModules()
    delete process.env.VITE_GEMINI_API_KEY
    delete process.env.VITE_GEMINI_ENDPOINT
    const mod = await import('./llm')

    const assumptions: Assumption[] = [
      a({
        id: 'a1',
        subject: 'node.js',
        type: 'environment_expectation',
        impliedValue: 'node.js version v18 or newer is required.',
        confidence: 0.85,
      }),
    ]

    const result = await mod.runTwoTierLLM('My project uses Node.js v12. Is that fine?', assumptions, { logToFirestore: false })
    expect(result.escalation.needsEscalation).toBe(true)
    expect(result.gemini?.model).toBe('gemini')
    expect(result.comparison?.similarityScore).toBeTypeOf('number')
    expect(result.comparison?.recommendedAction).toBe('trust_gemini')
    expect(result.gemini?.meta && typeof result.gemini.meta === 'object' && 'simulated' in result.gemini.meta).toBe(true)
  })

  it('does not escalate when small model is confident and aligned', async () => {
    vi.resetModules()
    delete process.env.VITE_GEMINI_API_KEY
    delete process.env.VITE_GEMINI_ENDPOINT
    const mod = await import('./llm')

    const assumptions: Assumption[] = [
      a({
        id: 'a0',
        subject: 'vite',
        type: 'tool_recommendation',
        impliedValue: 'Prefer vite over create-react-app.',
        confidence: 0.7,
      }),
    ]

    const result = await mod.runTwoTierLLM('You should use Vite instead of create-react-app.', assumptions, {
      logToFirestore: false,
    })
    expect(result.escalation.needsEscalation).toBe(false)
    expect(result.gemini).toBeUndefined()
    expect(result.comparison).toBeUndefined()
  })

  it('escalates on critical assumption contradiction even with higher confidence', async () => {
    vi.resetModules()
    delete process.env.VITE_GEMINI_API_KEY
    delete process.env.VITE_GEMINI_ENDPOINT
    const mod = await import('./llm')

    const assumptions: Assumption[] = [
      a({
        id: 'a2',
        subject: 'vite',
        type: 'tool_recommendation',
        impliedValue: 'Prefer vite over create-react-app.',
        confidence: 0.9,
      }),
    ]

    const result = await mod.runTwoTierLLM('I must use create-react-app for a new project. What do you recommend?', assumptions, {
      logToFirestore: false,
    })
    expect(result.small.confidence).toBeGreaterThanOrEqual(0.6)
    expect(result.escalation.needsEscalation).toBe(true)
    expect(result.escalation.reason.toLowerCase()).toContain('critical')
    expect(result.comparison?.contradictionFlags.length).toBeGreaterThan(0)
    expect(result.comparison?.recommendedAction).toBe('human_review')
  })

  it('retries on 429 and succeeds when Gemini endpoint recovers', async () => {
    vi.resetModules()
    process.env.VITE_GEMINI_API_KEY = 'test-key'
    process.env.VITE_GEMINI_ENDPOINT = 'http://localhost:31337/gemini'

    let calls = 0
    server.use(
      http.post('http://localhost:31337/gemini', async () => {
        calls += 1
        if (calls === 1) return new HttpResponse('rate limited', { status: 429 })
        return HttpResponse.json({ text: 'Gemini says hello', confidence: 0.9 })
      }),
    )

    const mod = await import('./llm')
    const resp = await mod.askGeminiFallback('Hello?')
    expect(resp.model).toBe('gemini')
    expect(resp.answer).toContain('Gemini says hello')
    expect(calls).toBe(2)
  })
})
