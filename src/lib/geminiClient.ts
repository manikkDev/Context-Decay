import type { LLMResponse } from './llm'

export type GeminiRuntimeEnv = { apiKey: string; endpoint: string }

let geminiChain: Promise<void> = Promise.resolve()
let geminiLastAt = 0

async function rateLimitGemini(minIntervalMs: number): Promise<void> {
  const run = async () => {
    const now = Date.now()
    const wait = Math.max(0, geminiLastAt + minIntervalMs - now)
    if (wait) await new Promise((r) => setTimeout(r, wait))
    geminiLastAt = Date.now()
  }
  geminiChain = geminiChain.then(run, run)
  await geminiChain
}

async function retry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown = null
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const base = 260 * Math.pow(2, i)
      const jitter = Math.floor(Math.random() * 90)
      await new Promise((r) => setTimeout(r, base + jitter))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function extractGeminiText(json: unknown): { text: string | null; confidence: number | null } {
  if (!json || typeof json !== 'object') return { text: null, confidence: null }
  const anyJson = json as Record<string, unknown>
  const directText = typeof anyJson.text === 'string' ? anyJson.text : null
  const directConf = typeof anyJson.confidence === 'number' ? anyJson.confidence : null
  if (directText) return { text: directText, confidence: directConf }

  const candidates = Array.isArray(anyJson.candidates) ? anyJson.candidates : null
  if (candidates && candidates[0] && typeof candidates[0] === 'object') {
    const c0 = candidates[0] as Record<string, unknown>
    const content = c0.content && typeof c0.content === 'object' ? (c0.content as Record<string, unknown>) : null
    const parts = content && Array.isArray(content.parts) ? content.parts : null
    const p0 = parts && parts[0] && typeof parts[0] === 'object' ? (parts[0] as Record<string, unknown>) : null
    const t = p0 && typeof p0.text === 'string' ? p0.text : null
    const conf = typeof c0.confidence === 'number' ? c0.confidence : null
    if (t) return { text: t, confidence: conf }
  }

  const outputText = typeof anyJson.outputText === 'string' ? anyJson.outputText : null
  if (outputText) return { text: outputText, confidence: directConf }

  return { text: null, confidence: null }
}

export async function askGemini(prompt: string, env: GeminiRuntimeEnv): Promise<LLMResponse> {
  await rateLimitGemini(650)

  const call = async (): Promise<LLMResponse> => {
    const res = await fetch(env.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.apiKey}`,
        'x-api-key': env.apiKey,
      },
      body: JSON.stringify({ model: 'gemini-1.5-flash', prompt }),
    })

    if (!res.ok) {
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500
      if (retryable) throw new Error(`Gemini HTTP ${res.status}`)
      const text = await res.text().catch(() => '')
      throw new Error(`Gemini HTTP ${res.status}${text ? `: ${text}` : ''}`)
    }

    const json = (await res.json().catch(() => null)) as unknown
    const extracted = extractGeminiText(json)
    const answer = extracted.text ?? 'Gemini: (empty response)'
    const confidence = typeof extracted.confidence === 'number' ? clamp01(extracted.confidence) : 0.84
    return { model: 'gemini', answer, confidence, meta: { endpoint: env.endpoint, model: 'gemini-1.5-flash' } }
  }

  return retry(call, 3)
}

