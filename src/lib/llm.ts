import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import type { Assumption } from './assumptionExtractor'
import { getAuthClient, getFirestoreClient } from './firebase'

export type LLMModel = 'small' | 'gemini'

export type LLMResponse = {
  model: LLMModel
  answer: string
  confidence: number
  meta?: Record<string, unknown>
}

export type ContradictionFlag = {
  assumptionId: string
  severity: 'low' | 'high'
  reason: string
}

export type EscalationComparisonSummary = {
  similarityScore: number
  contradictionFlags: ContradictionFlag[]
  recommendedAction: 'trust_small_model' | 'trust_gemini' | 'human_review'
}

export type TwoTierLLMResult = {
  promptHash: string
  small: LLMResponse
  escalation: { needsEscalation: boolean; reason: string }
  gemini?: LLMResponse
  comparison?: EscalationComparisonSummary
  log?: { ok: true; path: string } | { ok: false; error: string }
}

type GeminiRuntimeEnv = { apiKey: string; endpoint: string }

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function summarizeDeterministic(prompt: string): { answer: string; confidence: number; meta: Record<string, unknown> } {
  const p = prompt.trim()
  const lower = p.toLowerCase()
  const tokens = tokenize(lower)
  const hasVite = tokens.includes('vite')
  const hasCra = tokens.includes('create') && tokens.includes('react') && tokens.includes('app')
  const hasCraAlias = tokens.includes('cra') || lower.includes('create-react-app')
  const hasNode = tokens.includes('node') || lower.includes('node.js') || lower.includes('nodejs')
  const versions = Array.from(lower.matchAll(/\bv?(\d{1,2})(?:\.\d+){0,2}\b/g)).map((m) => Number(m[1]))
  const hasPreferCue = /\b(instead of|over|prefer|recommended)\b/.test(lower)
  const hasMust = /\b(must|always|required)\b/.test(lower)

  if ((hasCra || hasCraAlias) && hasVite && hasPreferCue) {
    return {
      answer: 'Recommendation: use Vite over create-react-app for new projects.',
      confidence: 0.78,
      meta: { rule: 'vite_over_cra' },
    }
  }

  if ((hasCra || hasCraAlias) && !hasVite) {
    return {
      answer: 'Recommendation: use create-react-app for the setup you described.',
      confidence: hasMust ? 0.72 : 0.66,
      meta: { rule: 'cra_default' },
    }
  }

  if (hasVite && !hasNode) {
    return {
      answer: 'Recommendation: use Vite for a fast dev server and modern tooling.',
      confidence: hasMust ? 0.76 : 0.7,
      meta: { rule: 'vite_default' },
    }
  }

  if (hasNode) {
    const maxMajor = versions.length ? Math.max(...versions.filter((x) => Number.isFinite(x))) : null
    if (maxMajor !== null && maxMajor >= 18) {
      return {
        answer: `Environment: Node.js v${maxMajor} looks compatible. Prefer Node.js v18+ for modern tooling.`,
        confidence: 0.74,
        meta: { rule: 'node_modern', major: maxMajor },
      }
    }
    if (maxMajor !== null && maxMajor > 0) {
      return {
        answer: `Environment: Node.js v${maxMajor} may be too old for modern tooling; consider upgrading to v18+.`,
        confidence: 0.52,
        meta: { rule: 'node_too_old', major: maxMajor },
      }
    }
  }

  const firstSentence = p.split(/(?<=[.!?])\s+/)[0] ?? p
  const clipped = firstSentence.length > 220 ? `${firstSentence.slice(0, 220).trim()}…` : firstSentence.trim()
  const confidence = clipped.length >= 40 ? 0.62 : 0.55
  return { answer: `Summary: ${clipped}`, confidence, meta: { rule: 'summary' } }
}

export async function askSmallModel(prompt: string): Promise<LLMResponse> {
  const out = summarizeDeterministic(prompt)
  return { model: 'small', answer: out.answer, confidence: out.confidence, meta: out.meta }
}

function computeAssumptionSeverity(a: Assumption): 'low' | 'high' {
  const t = a.impliedValue.toLowerCase()
  const modalHigh = /\b(must|always|never|required)\b/.test(t)
  const confHigh = (a.confidence ?? 0) >= 0.8
  return modalHigh || confHigh ? 'high' : 'low'
}

function contradictionFlagsForAnswer(answer: string, assumptions: Assumption[]): ContradictionFlag[] {
  const ans = answer.toLowerCase()
  const out: ContradictionFlag[] = []

  for (const a of assumptions) {
    const implied = a.impliedValue.toLowerCase()
    const sev = computeAssumptionSeverity(a)

    const prefer = implied.match(/\bprefer\s+([a-z0-9._-]+)\s+over\s+([a-z0-9._-]+)\b/)
    if (prefer) {
      const primary = prefer[1]
      const secondary = prefer[2]
      const recommendsSecondary =
        new RegExp(`\\b(use|prefer|recommend)\\b[^.\\n]{0,80}\\b${escapeRegExp(secondary)}\\b`).test(ans) &&
        !new RegExp(`\\b${escapeRegExp(primary)}\\b`).test(ans)
      if (recommendsSecondary) {
        out.push({
          assumptionId: a.id,
          severity: sev,
          reason: `Recommends ${secondary} despite preference for ${primary}.`,
        })
      }
      continue
    }

    const deprecated = /(deprecated|avoid|no longer recommended)/.test(implied)
    if (deprecated) {
      const subject = a.subject.toLowerCase()
      const recommendsSubject =
        new RegExp(`\\b(use|prefer|recommend)\\b[^.\\n]{0,80}\\b${escapeRegExp(subject)}\\b`).test(ans)
      if (recommendsSubject) {
        out.push({
          assumptionId: a.id,
          severity: sev,
          reason: `Recommends ${a.subject} despite a deprecation/avoidance assumption.`,
        })
      }
      continue
    }

    const versionReq = implied.match(/\b(node(?:\.js)?|nodejs)\b[^.\\n]*\bv?(\d{1,2})\b[^.\\n]*(or newer|\+|higher|newer)\b/)
    if (versionReq) {
      const requiredMajor = Number(versionReq[2])
      const mentioned = ans.match(/\bnode(?:\.js)?\s*v?(\d{1,2})\b/)
      if (mentioned) {
        const major = Number(mentioned[1])
        if (Number.isFinite(major) && major < requiredMajor) {
          out.push({
            assumptionId: a.id,
            severity: sev,
            reason: `Mentions Node.js v${major}, below required v${requiredMajor}.`,
          })
        }
      }
      continue
    }

    const subject = a.subject.toLowerCase()
    if (subject && ans.includes(subject)) {
      const negates = /\b(not|never|no)\b/.test(ans) && /\b(should|must|use|recommend)\b/.test(ans)
      const assumptionAffirms = /\b(should|must|always)\b/.test(implied)
      if (assumptionAffirms && negates) {
        out.push({
          assumptionId: a.id,
          severity: sev,
          reason: `Negates prescriptive assumption mentioning ${a.subject}.`,
        })
      }
    }
  }

  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function adjudicateSmallModelResponse(
  smallResp: LLMResponse,
  assumptions: Assumption[],
): { needsEscalation: boolean; reason: string } {
  const reasons: string[] = []

  if (!Number.isFinite(smallResp.confidence) || smallResp.confidence < 0.6) {
    reasons.push(`Low confidence (${smallResp.confidence.toFixed(2)})`)
  }

  const flags = contradictionFlagsForAnswer(smallResp.answer, assumptions)
  if (flags.length) {
    const hasHigh = flags.some((f) => f.severity === 'high')
    reasons.push(hasHigh ? 'Critical assumption mismatch' : 'Assumption contradiction')
  }

  if (!reasons.length) return { needsEscalation: false, reason: 'Small model response accepted' }
  return { needsEscalation: true, reason: reasons.join('; ') }
}

function geminiEnv(): GeminiRuntimeEnv | null {
  const apiKeyRaw = import.meta.env.VITE_GEMINI_API_KEY
  const endpointRaw = import.meta.env.VITE_GEMINI_ENDPOINT
  const apiKey = isNonEmptyString(apiKeyRaw) ? apiKeyRaw : null
  const endpoint = isNonEmptyString(endpointRaw) ? endpointRaw : null
  if (!apiKey || !endpoint) return null
  return { apiKey, endpoint }
}

function simulatedGemini(prompt: string): LLMResponse {
  const p = prompt.trim()
  const lower = p.toLowerCase()
  const hasQuestion = /\?/.test(p)
  const hasVite = /\bvite\b/.test(lower)
  const hasCra = /\bcreate-react-app\b|\bcra\b/.test(lower)
  const answer =
    hasVite && hasCra
      ? 'Gemini (simulated): Prefer Vite for new projects; CRA is often less recommended today.'
      : hasQuestion
        ? `Gemini (simulated): ${p.length > 220 ? `${p.slice(0, 220).trim()}…` : p}`
        : `Gemini (simulated): ${p.length > 220 ? `${p.slice(0, 220).trim()}…` : p}`
  return { model: 'gemini', answer, confidence: 0.82, meta: { simulated: true, model: 'gemini-1.5-flash' } }
}

let geminiClientPromise: Promise<typeof import('./geminiClient')> | null = null

async function loadGeminiClient(): Promise<typeof import('./geminiClient')> {
  geminiClientPromise ??= import('./geminiClient')
  return geminiClientPromise
}

export async function askGeminiFallback(prompt: string): Promise<LLMResponse> {
  const env = geminiEnv()
  if (!env) return simulatedGemini(prompt)
  const mod = await loadGeminiClient()
  return mod.askGemini(prompt, env)
}

function jaccardSimilarity(a: string, b: string): number {
  const as = new Set(tokenize(a))
  const bs = new Set(tokenize(b))
  if (as.size === 0 && bs.size === 0) return 1
  if (as.size === 0 || bs.size === 0) return 0
  let inter = 0
  for (const t of as) if (bs.has(t)) inter += 1
  const union = as.size + bs.size - inter
  return union ? inter / union : 0
}

function decideRecommendedAction(
  small: LLMResponse,
  gemini: LLMResponse,
  similarityScore: number,
  flags: ContradictionFlag[],
): EscalationComparisonSummary['recommendedAction'] {
  const hasHigh = flags.some((f) => f.severity === 'high')
  const hasAny = flags.length > 0
  if (hasHigh) return 'human_review'
  if (hasAny && similarityScore < 0.45) return 'human_review'
  if (small.confidence < 0.6 && gemini.confidence >= 0.7) return 'trust_gemini'
  if (gemini.confidence >= small.confidence + 0.12) return 'trust_gemini'
  if (similarityScore >= 0.6) return 'trust_small_model'
  return 'human_review'
}

export async function runTwoTierLLM(
  prompt: string,
  assumptions: Assumption[],
  options?: { logToFirestore?: boolean; userContext?: { sessionId?: string | null } },
): Promise<TwoTierLLMResult> {
  const promptHash = await sha256HexOrStable(prompt)
  const small = await askSmallModel(prompt)
  const escalation = adjudicateSmallModelResponse(small, assumptions)

  if (!escalation.needsEscalation) {
    const log =
      options?.logToFirestore === true
        ? await logAnalysisSession({
            prompt,
            promptHash,
            small,
            assumptions,
            escalation,
            gemini: null,
            comparison: null,
            userContext: options?.userContext ?? null,
          })
        : undefined
    return { promptHash, small, escalation, log }
  }

  const gemini = await askGeminiFallback(prompt)
  const smallFlags = contradictionFlagsForAnswer(small.answer, assumptions)
  const geminiFlags = contradictionFlagsForAnswer(gemini.answer, assumptions)
  const contradictionFlags = mergeFlags([...smallFlags, ...geminiFlags])
  const similarityScore = jaccardSimilarity(small.answer, gemini.answer)
  const recommendedAction = decideRecommendedAction(small, gemini, similarityScore, contradictionFlags)
  const comparison: EscalationComparisonSummary = { similarityScore, contradictionFlags, recommendedAction }

  const log =
    options?.logToFirestore === true
      ? await logAnalysisSession({
          prompt,
          promptHash,
          small,
          assumptions,
          escalation,
          gemini,
          comparison,
          userContext: options?.userContext ?? null,
        })
      : undefined

  return { promptHash, small, escalation, gemini, comparison, log }
}

function mergeFlags(flags: ContradictionFlag[]): ContradictionFlag[] {
  const seen = new Map<string, ContradictionFlag>()
  for (const f of flags) {
    const key = `${f.assumptionId}|${f.reason}`
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, f)
      continue
    }
    if (prev.severity === 'low' && f.severity === 'high') seen.set(key, f)
  }
  return Array.from(seen.values()).sort((a, b) => a.assumptionId.localeCompare(b.assumptionId) || a.reason.localeCompare(b.reason))
}

function redactSensitive(input: string): string {
  let out = input
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted-api-key]')
  out = out.replace(/\bsk-[0-9A-Za-z]{16,}\b/g, '[redacted-api-key]')
  out = out.replace(/\b(eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g, '[redacted-jwt]')
  out = out.replace(/\b[a-f0-9]{32,}\b/gi, '[redacted-token]')
  out = out.replace(/\b[0-9A-Za-z_-]{48,}\b/g, '[redacted-token]')
  return out
}

async function sha256HexOrStable(input: string): Promise<string> {
  try {
    if (globalThis.crypto?.subtle) {
      const enc = new TextEncoder().encode(input)
      const buf = await globalThis.crypto.subtle.digest('SHA-256', enc)
      const bytes = new Uint8Array(buf)
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    return stableHash32Hex(input)
  }
  return stableHash32Hex(input)
}

function stableHash32Hex(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h) ^ input.charCodeAt(i)
  return (h >>> 0).toString(16).padStart(8, '0')
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

async function logAnalysisSession(params: {
  prompt: string
  promptHash: string
  assumptions: Assumption[]
  small: LLMResponse
  escalation: { needsEscalation: boolean; reason: string }
  gemini: LLMResponse | null
  comparison: EscalationComparisonSummary | null
  userContext: { sessionId?: string | null } | null
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const db = await getFirestoreClient()
    const auth = await getAuthClient()
    const uid = auth.currentUser?.uid ?? null
    const userIdHash = uid ? await sha256HexOrStable(uid) : null
    const sessionId = params.userContext?.sessionId ?? null
    const sessionHash = sessionId ? await sha256HexOrStable(sessionId) : null

    const promptRedacted = redactSensitive(params.prompt).slice(0, 2000)
    const smallRedacted = redactSensitive(params.small.answer).slice(0, 2000)
    const geminiRedacted = params.gemini ? redactSensitive(params.gemini.answer).slice(0, 2000) : null

    const docRef = await addDoc(collection(db, 'llmQueryLogs'), {
      kind: 'llm_query',
      createdAt: serverTimestamp(),
      userIdHash,
      sessionHash,
      promptHash: params.promptHash,
      promptPreview: promptRedacted.slice(0, 280),
      promptRedacted,
      assumptions: params.assumptions.map((a) => ({
        assumptionId: a.id,
        subject: a.subject,
        type: a.type,
        impliedValue: a.impliedValue,
        confidence: a.confidence,
      })),
      small: {
        answerHash: await sha256HexOrStable(params.small.answer),
        answerPreview: smallRedacted.slice(0, 280),
        answerRedacted: smallRedacted,
        confidence: params.small.confidence,
        meta: params.small.meta ?? null,
      },
      escalation: params.escalation,
      gemini: params.gemini
        ? {
            answerHash: await sha256HexOrStable(params.gemini.answer),
            answerPreview: geminiRedacted ? geminiRedacted.slice(0, 280) : null,
            answerRedacted: geminiRedacted,
            confidence: params.gemini.confidence,
            meta: params.gemini.meta ?? null,
          }
        : null,
      comparison: params.comparison,
    })

    return { ok: true, path: docRef.path }
  } catch (err) {
    return { ok: false, error: formatError(err) }
  }
}
