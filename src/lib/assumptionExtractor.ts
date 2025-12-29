export type AssumptionType =
  | 'tool_recommendation'
  | 'api_usage'
  | 'behavior_expectation'
  | 'environment_expectation'

export type Assumption = {
  id: string
  subject: string
  ruleId: string
  evidenceSnippet: string
  type: AssumptionType
  impliedValue: string
  confidence: number
}

type ExtractContext = {
  originalText: string
  normalizedText: string
  normalizedLower: string
  url: string | null
  urlLower: string | null
  codeBlocks: string[]
  tokens: string[]
  hasPrescriptive: boolean
  hasRecommendation: boolean
  hasMust: boolean
  hasShould: boolean
  hasAlways: boolean
  versions: string[]
}

type RuleMatch = {
  start: number
  end: number
  groups: Record<string, string | undefined>
  text: string
}

type Rule = {
  id: string
  type: AssumptionType
  regex: RegExp
  toAssumption: (m: RuleMatch, ctx: ExtractContext) => Omit<Assumption, 'id'> | null
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function decodeBasicHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function stripHtmlSafely(input: string): string {
  const stripped = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeBasicHtmlEntities(stripped)
}

function tokenize(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .replace(/[`"'()[\]{}<>]/g, ' ')
    .replace(/[^\p{L}\p{N}._+-]+/gu, ' ')
  const parts = normalized
    .split(/\s+/)
    .map((p) => p.replace(/^[,;:!?]+|[,;:!?]+$/g, '').replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
  return parts
}

function extractVersions(input: string): string[] {
  const versions: string[] = []
  const re = /\b(v?\d+(?:\.\d+){0,2}|\d{4})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    versions.push(m[1])
  }
  return versions
}

function extractCodeSegments(input: string): string[] {
  const out: string[] = []

  const fenced = input.match(/```[\s\S]*?```/g) ?? []
  for (const block of fenced) {
    const trimmed = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim()
    if (trimmed) out.push(trimmed)
  }

  const inline = input.match(/`[^`\n]{2,240}`/g) ?? []
  for (const seg of inline) {
    const trimmed = seg.replace(/^`/, '').replace(/`$/, '').trim()
    if (trimmed) out.push(trimmed)
  }

  const lines = input.split(/\r?\n/)
  let buf: string[] = []
  const flush = () => {
    const joined = buf.join('\n').trim()
    buf = []
    if (joined) out.push(joined)
  }
  for (const line of lines) {
    const isIndented = /^\s{4,}|\t/.test(line)
    if (isIndented) {
      buf.push(line.replace(/^\s{4}/, '').replace(/^\t/, ''))
      continue
    }
    flush()
  }
  flush()

  return Array.from(new Set(out))
}

function extractIdentifierTokens(input: string): string[] {
  const hits = input.match(/[A-Za-z_$][A-Za-z0-9_$-]{1,64}/g) ?? []
  const norm = hits.map((t) => t.toLowerCase())
  return Array.from(new Set(norm))
}

function stableHash32(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h) ^ input.charCodeAt(i)
  }
  return h >>> 0
}

function toAssumptionId(ruleId: string, subject: string, impliedValue: string): string {
  const base = `${ruleId}|${subject}|${impliedValue}`.toLowerCase()
  const hash = stableHash32(base).toString(16).padStart(8, '0')
  const safeSubject = subject.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  const safeRule = ruleId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return `${safeRule}:${safeSubject}:${hash}`
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function computeConfidence(ctx: ExtractContext, cues: { hasSubject: boolean; hasVerb: boolean; hasVersion: boolean }): number {
  let c = 0.35
  if (ctx.hasPrescriptive) c += 0.25
  if (ctx.hasRecommendation) c += 0.1
  if (ctx.hasMust) c += 0.1
  if (ctx.hasShould) c += 0.08
  if (ctx.hasAlways) c += 0.07
  if (cues.hasVerb) c += 0.15
  if (cues.hasSubject) c += 0.15
  if (cues.hasVersion) c += 0.15
  return clamp01(c)
}

function makeAssumption(params: Omit<Assumption, 'id'>): Assumption {
  const id = toAssumptionId(params.ruleId, params.subject, params.impliedValue)
  return { ...params, id }
}

function execAll(regex: RegExp, input: string): RuleMatch[] {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  const re = new RegExp(regex.source, flags)
  const out: RuleMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    const groups: Record<string, string | undefined> = {}
    if (m.groups) {
      for (const [k, v] of Object.entries(m.groups)) groups[k] = v
    }
    out.push({ start: m.index, end: m.index + m[0].length, groups, text: m[0] })
    if (m.index === re.lastIndex) re.lastIndex += 1
  }
  return out
}

const techAliases: Array<{ canonical: string; variants: string[] }> = [
  { canonical: 'react', variants: ['react'] },
  { canonical: 'create-react-app', variants: ['create-react-app', 'cra', 'create react app'] },
  { canonical: 'vite', variants: ['vite'] },
  { canonical: 'useeffect', variants: ['useeffect', 'use-effect'] },
  { canonical: 'node.js', variants: ['node.js', 'node', 'nodejs'] },
  { canonical: 'npm', variants: ['npm'] },
  { canonical: 'yarn', variants: ['yarn'] },
  { canonical: 'pnpm', variants: ['pnpm'] },
  { canonical: 'firebase', variants: ['firebase'] },
  { canonical: 'vercel', variants: ['vercel'] },
  { canonical: 'netlify', variants: ['netlify'] },
  { canonical: 'heroku', variants: ['heroku'] },
]

export const KNOWN_TECH_SUBJECTS = techAliases.map((t) => t.canonical)

function buildContext(inputText: string): ExtractContext {
  const stripped = normalizeText(stripHtmlSafely(inputText))
  const tokens = tokenize(stripped)
  const lower = stripped.toLowerCase()
  const hasMust = /\bmust\b/.test(lower)
  const hasShould = /\bshould\b/.test(lower)
  const hasAlways = /\balways\b/.test(lower)
  const hasRecommendation = /\b(recommend|recommended|recommendation)\b/.test(lower)
  const hasPrescriptive = hasMust || hasShould || hasAlways || /\b(need to|required to|requires)\b/.test(lower)
  const versions = extractVersions(stripped)
  return {
    originalText: inputText,
    normalizedText: stripped,
    normalizedLower: lower,
    url: null,
    urlLower: null,
    codeBlocks: [],
    tokens,
    hasPrescriptive,
    hasRecommendation,
    hasMust,
    hasShould,
    hasAlways,
    versions,
  }
}

function subjectFromGroup(value: string | undefined): string | null {
  if (!value) return null
  const v = value.toLowerCase()
  for (const t of techAliases) {
    if (t.variants.some((x) => x.toLowerCase() === v)) return t.canonical
    if (t.canonical === v) return t.canonical
  }
  return v
}

function splitSentences(input: string): string[] {
  const cleaned = normalizeText(input)
  if (!cleaned) return []
  const parts = cleaned.split(/(?<=[.!?])\s+/g).map((p) => p.trim())
  return parts.filter(Boolean)
}

const FALLBACK_STOPWORDS = new Set<string>([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'as',
  'at',
  'by',
  'from',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'we',
  'our',
  'you',
  'your',
  'they',
  'their',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
])

function fallbackSubjectFromSentence(sentence: string): string {
  const candidates = sentence.match(/\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,2}\b/g) ?? []
  for (const c of candidates) {
    const lower = c.toLowerCase()
    if (FALLBACK_STOPWORDS.has(lower)) continue
    if (lower.length < 3) continue
    return lower
  }

  const toks = tokenize(sentence)
  for (const t of toks) {
    if (FALLBACK_STOPWORDS.has(t)) continue
    if (t.length < 3) continue
    return t
  }
  return 'content'
}

function fallbackSentenceScore(sentence: string): number {
  const s = sentence.trim()
  if (s.length < 28) return -1
  const lower = s.toLowerCase()
  if (!/[a-z0-9]/i.test(s)) return -1

  let score = 0
  if (/\b(19|20)\d{2}\b/.test(lower)) score += 3
  if (/\bv?\d+(?:\.\d+){1,3}\b/.test(lower)) score += 3
  if (/\b\d+(?:\.\d+)?%/.test(lower)) score += 2
  if (/\b(\$|usd|eur|gbp|pricing|price|cost|free|paid|subscription)\b/.test(lower)) score += 2
  if (/\b(must|should|always|never|required|requires|need to|recommended|recommendation)\b/.test(lower)) score += 3
  if (/\b(deprecated|no longer|removed|breaking change|sunset)\b/.test(lower)) score += 3
  if (/\b(will|can|may|supports?|available|includes?|provides?)\b/.test(lower)) score += 1
  if (s.length >= 60 && s.length <= 240) score += 1

  if (/\b(cookie|cookies|privacy policy|terms of service|all rights reserved)\b/.test(lower)) score -= 6
  if (/\b(subscribe|newsletter|sign up|log in|contact us)\b/.test(lower)) score -= 3

  return score
}

function fallbackConfidenceForSentence(ctx: ExtractContext, sentence: string, score: number): number {
  const lower = sentence.toLowerCase()
  const hasVersion = /\b(19|20)\d{2}\b/.test(lower) || /\bv?\d+(?:\.\d+){1,3}\b/.test(lower)
  const hasVerb = /\b(must|should|always|never|required|requires|need to|recommended|will|can|may)\b/.test(lower)
  const hasSubject = Boolean(fallbackSubjectFromSentence(sentence))
  const base = computeConfidence(ctx, { hasSubject, hasVerb, hasVersion })
  const bump = score >= 6 ? 0.15 : score >= 3 ? 0.08 : 0
  return clamp01(base + bump)
}

function fallbackTypeForSentence(sentence: string): AssumptionType {
  const lower = sentence.toLowerCase()
  if (/\b(should|must|always|never|required|requires|need to|recommended)\b/.test(lower)) return 'environment_expectation'
  if (/\b(will|can|may)\b/.test(lower)) return 'behavior_expectation'
  return 'environment_expectation'
}

function extractFallbackAssumptionsFromProse(proseText: string, ctx: ExtractContext): Assumption[] {
  const sentences = splitSentences(proseText)
  const scored = sentences
    .map((s, i) => ({ s, i, score: fallbackSentenceScore(s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.length - b.s.length || a.i - b.i)

  const chosen: string[] = []
  const seen = new Set<string>()
  for (const item of scored) {
    const key = item.s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    chosen.push(item.s)
    if (chosen.length >= 6) break
  }

  if (chosen.length === 0) {
    const first = sentences.find((s) => s.trim().length >= 28) ?? proseText.trim().slice(0, 240)
    if (first) chosen.push(first)
  }
  if (chosen.length === 0) {
    chosen.push('No readable content was extracted from the input.')
  }

  const out: Assumption[] = []
  for (const sentence of chosen) {
    const trimmed = sentence.trim().slice(0, 360)
    if (!trimmed) continue
    const score = fallbackSentenceScore(trimmed)
    const subject = fallbackSubjectFromSentence(trimmed)
    const impliedValue = trimmed
    out.push(
      makeAssumption({
        type: fallbackTypeForSentence(trimmed),
        subject,
        ruleId: 'fallback-sentence-claim',
        evidenceSnippet: trimmed.slice(0, 280),
        impliedValue,
        confidence: fallbackConfidenceForSentence(ctx, trimmed, score),
      }),
    )
  }

  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

const rules: Rule[] = [
  {
    id: 'tool-recommendation-cra-cli',
    type: 'tool_recommendation',
    regex:
      /\b(?<runner>npx|npm|yarn|pnpm)\b[^\n]{0,80}\b(?<cmd>create-react-app|react-app)\b[^\n]{0,120}\b(?<appname>[\w.-]{1,64})?\b/gi,
    toAssumption: (m, ctx) => {
      const runner = m.groups.runner?.toLowerCase()
      const cmdRaw = m.groups.cmd?.toLowerCase()
      if (!runner || !cmdRaw) return null
      const tool = 'create-react-app'
      const impliedValue = `Use ${runner} ${cmdRaw} to scaffold a React app.`
      return {
        type: 'tool_recommendation',
        subject: tool,
        ruleId: 'tool-recommendation-cra-cli',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
  {
    id: 'tool-recommendation-cra-npm-init',
    type: 'tool_recommendation',
    regex: /\bnpm\b[^\n]{0,60}\binit\b[^\n]{0,60}\breact-app\b/gi,
    toAssumption: (_m, ctx) => {
      const impliedValue = 'Use npm init react-app to scaffold a React app.'
      return {
        type: 'tool_recommendation',
        subject: 'create-react-app',
        ruleId: 'tool-recommendation-cra-npm-init',
        evidenceSnippet: 'npm init react-app',
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
  {
    id: 'tool-recommendation-cra-implicit-mention',
    type: 'tool_recommendation',
    regex:
      /\b(?<tool>create-react-app|cra)\b(?:[^.\n]{0,120}\b(app|project|scaffold|bootstrap|starter|template|setup|init|create)\b|)/gi,
    toAssumption: (m, ctx) => {
      const tool = subjectFromGroup(m.groups.tool)
      if (!tool) return null
      const lower = ctx.normalizedLower
      const hasNegative = /\b(deprecated|avoid|no longer recommended)\b/.test(lower)
      if (hasNegative) return null
      const impliedValue = `Scaffold a React app using ${tool}.`
      return {
        type: 'tool_recommendation',
        subject: tool,
        ruleId: 'tool-recommendation-cra-implicit-mention',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
  {
    id: 'tool-recommendation-vite-over-cra',
    type: 'tool_recommendation',
    regex: /\b(should|must|recommend(?:ed)?)\b[^.]*\buse\b[^.]*\b(?<primary>vite)\b[^.]*\b(instead of|over)\b[^.]*\b(?<secondary>create-react-app|cra)\b/gi,
    toAssumption: (m, ctx) => {
      const primary = subjectFromGroup(m.groups.primary)
      const secondary = subjectFromGroup(m.groups.secondary)
      if (!primary || !secondary) return null
      const impliedValue = `Prefer ${primary} over ${secondary}.`
      return {
        type: 'tool_recommendation',
        subject: primary,
        ruleId: 'tool-recommendation-vite-over-cra',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: true, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
  {
    id: 'tool-recommendation-deprecation',
    type: 'tool_recommendation',
    regex: /\b(?<tool>create-react-app|cra)\b[^.]*\b(is|has been)\b[^.]*\b(deprecated|no longer recommended)\b/gi,
    toAssumption: (m, ctx) => {
      const tool = subjectFromGroup(m.groups.tool)
      if (!tool) return null
      const impliedValue = `${tool} is deprecated and should be avoided for new projects.`
      return {
        type: 'tool_recommendation',
        subject: tool,
        ruleId: 'tool-recommendation-deprecation',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
  {
    id: 'environment-node-version-requirement',
    type: 'environment_expectation',
    regex: /\b(requires|required|need(?:s)? to|must have)\b[^.]*\b(?<subject>node(?:\.js)?|nodejs)\b[^.]*\b(?<version>v?\d+(?:\.\d+){0,2})\b(?:\s*\+|\s*(?:or|and)\s*(?:higher|newer))?/gi,
    toAssumption: (m, ctx) => {
      const subject = subjectFromGroup(m.groups.subject)
      const version = m.groups.version
      if (!subject || !version) return null
      const impliedValue = `${subject} version ${version} or newer is required.`
      return {
        type: 'environment_expectation',
        subject,
        ruleId: 'environment-node-version-requirement',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: true }),
      }
    },
  },
  {
    id: 'pm-install',
    type: 'environment_expectation',
    regex: /\b(?<pm>npm|yarn)\b\s+(?<verb>install|add)\b(?:\s+--save(?:-dev)?)?\s+(?<pkg>@?[\w.-]+(?:\/[\w.-]+)*)/gi,
    toAssumption: (m, ctx) => {
      const pm = subjectFromGroup(m.groups.pm)
      const verb = m.groups.verb?.toLowerCase()
      const pkg = m.groups.pkg
      if (!pm || !verb || !pkg) return null
      const impliedValue = `Use ${pm} to ${verb} ${pkg}.`
      return {
        type: 'environment_expectation',
        subject: pm,
        ruleId: 'pm-install',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: true, hasVersion: false }),
      }
    },
  },
  {
    id: 'pm-run-script',
    type: 'environment_expectation',
    regex: /\b(?<pm>npm|yarn)\b\s+run\s+(?<script>[\w:-]+)\b/gi,
    toAssumption: (m, ctx) => {
      const pm = subjectFromGroup(m.groups.pm)
      const script = m.groups.script
      if (!pm || !script) return null
      const impliedValue = `Run ${pm} script ${script}.`
      return {
        type: 'environment_expectation',
        subject: pm,
        ruleId: 'pm-run-script',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: true, hasVersion: false }),
      }
    },
  },
  {
    id: 'api-usage-hook',
    type: 'api_usage',
    regex: /\b(use|call)\b[^.]*\b(?<api>useEffect|useState|createRoot)\b/gi,
    toAssumption: (m, ctx) => {
      const api = subjectFromGroup(m.groups.api)
      if (!api) return null
      const impliedValue = `Use the ${api} API as described.`
      return {
        type: 'api_usage',
        subject: api,
        ruleId: 'api-usage-hook',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: true, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
  {
    id: 'behavior-strictmode-double-invoke',
    type: 'behavior_expectation',
    regex: /\breact\b[^.]*\bstrict\s*mode\b[^.]*\b(?:run|invoke|call)\b[^.]*\b(twice|double)\b/gi,
    toAssumption: (_m, ctx) => {
      const impliedValue = 'React StrictMode may invoke effects or renders twice in development.'
      return {
        type: 'behavior_expectation',
        subject: 'react',
        ruleId: 'behavior-strictmode-double-invoke',
        evidenceSnippet: 'react strictmode',
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
  {
    id: 'deploy-target',
    type: 'environment_expectation',
    regex: /\bdeploy\b[^.]*\b(to|on)\b[^.]*\b(?<target>vercel|netlify|firebase)\b/gi,
    toAssumption: (m, ctx) => {
      const target = subjectFromGroup(m.groups.target)
      if (!target) return null
      const impliedValue = `Deployment target is ${target}.`
      return {
        type: 'environment_expectation',
        subject: target,
        ruleId: 'deploy-target',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: true, hasVersion: false }),
      }
    },
  },
  {
    id: 'deploy-platform-mention',
    type: 'environment_expectation',
    regex: /\b(?<platform>vercel|netlify|heroku)\b/gi,
    toAssumption: (m, ctx) => {
      const platform = subjectFromGroup(m.groups.platform)
      if (!platform) return null
      const impliedValue = `Deployment platform is ${platform}.`
      return {
        type: 'environment_expectation',
        subject: platform,
        ruleId: 'deploy-platform-mention',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: false }),
      }
    },
  },
  {
    id: 'deploy-platform-cost',
    type: 'environment_expectation',
    regex: /\b(?<platform>vercel|netlify|heroku)\b/gi,
    toAssumption: (m, ctx) => {
      const platform = subjectFromGroup(m.groups.platform)
      if (!platform) return null
      const impliedValue = `Assumes ${platform} pricing, quotas, and operational limits are acceptable.`
      return {
        type: 'environment_expectation',
        subject: platform,
        ruleId: 'deploy-platform-cost',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: false }),
      }
    },
  },
  {
    id: 'generic-prescriptive-verb-tech',
    type: 'environment_expectation',
    regex: /\b(?<modal>should|must|always)\b[^.]*\b(?<verb>use|install|run|deploy|recommend)\b[^.]*\b(?<tech>react|vite|create-react-app|cra|node(?:\.js)?|nodejs|npm|yarn|firebase)\b/gi,
    toAssumption: (m, ctx) => {
      const verb = m.groups.verb?.toLowerCase()
      const tech = subjectFromGroup(m.groups.tech)
      const modal = m.groups.modal?.toLowerCase()
      if (!verb || !tech || !modal) return null
      const impliedValue = `${modal} ${verb} ${tech}.`
      return {
        type: 'environment_expectation',
        subject: tech,
        ruleId: 'generic-prescriptive-verb-tech',
        evidenceSnippet: m.text,
        impliedValue,
        confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: true, hasVersion: ctx.versions.length > 0 }),
      }
    },
  },
]

export type NormalizedInput = {
  originalText: string
  url: string | null
  urlTokens: string[]
  proseText: string
  normalizedText: string
  normalizedLower: string
  codeBlocks: string[]
  identifierTokens: string[]
  tokens: string[]
  tokenStream: string
}

function tokensToStream(tokens: string[]): string {
  return tokens.join(' ')
}

export function normalizeForAnalysis(params: { text: string; url?: string | null }): NormalizedInput {
  const originalText = params.text ?? ''
  const url = typeof params.url === 'string' && params.url.trim() ? params.url.trim() : null
  const codeBlocks = extractCodeSegments(originalText)
  const proseText = normalizeText(stripHtmlSafely(originalText))
  const proseTokens = tokenize(proseText)

  const urlTokens: string[] = []
  if (url) {
    try {
      const u = new URL(url)
      urlTokens.push(...tokenize(`${u.hostname} ${u.pathname.replace(/[-_/]+/g, ' ')}`))
    } catch {
      urlTokens.push(...tokenize(url))
    }
  }

  const identifierTokens = extractIdentifierTokens(codeBlocks.join('\n'))
  const merged: string[] = []
  const seen = new Set<string>()
  for (const t of [...proseTokens, ...urlTokens, ...identifierTokens]) {
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    merged.push(t)
  }
  const normalizedText = normalizeText(merged.join(' '))
  const normalizedLower = normalizedText.toLowerCase()

  return {
    originalText,
    url,
    urlTokens,
    proseText,
    normalizedText,
    normalizedLower,
    codeBlocks,
    identifierTokens,
    tokens: merged,
    tokenStream: tokensToStream(merged),
  }
}

export function extractAssumptionsFromNormalized(input: NormalizedInput): Assumption[] {
  const baseCtx = buildContext(input.proseText)
  const ctx: ExtractContext = {
    ...baseCtx,
    url: input.url,
    urlLower: input.url ? input.url.toLowerCase() : null,
    codeBlocks: input.codeBlocks,
    tokens: input.tokens,
  }

  const out: Assumption[] = []
  const seen = new Set<string>()

  if (input.url && /\bcreate-react-app\b/.test(input.url.toLowerCase())) {
    const impliedValue = 'Scaffold a React app using create-react-app.'
    const a = makeAssumption({
      type: 'tool_recommendation',
      subject: 'create-react-app',
      ruleId: 'url-contains-create-react-app',
      evidenceSnippet: input.url.slice(0, 280),
      impliedValue,
      confidence: computeConfidence(ctx, { hasSubject: true, hasVerb: false, hasVersion: ctx.versions.length > 0 }),
    })
    const key = `${a.subject}|${a.ruleId}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(a)
    }
  }

  for (const rule of rules) {
    const matches = execAll(rule.regex, ctx.normalizedText)
    for (const m of matches) {
      const a0 = rule.toAssumption(m, ctx)
      if (!a0) continue
      const a = makeAssumption(a0)
      const key = `${a.subject}|${a.ruleId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(a)
    }
  }

  if (out.length === 0) {
    const allowFallback = Boolean(input.url) || validateAnalyzability(input.originalText)
    if (allowFallback) {
      const prose = input.proseText.trim() ? input.proseText : normalizeText(stripHtmlSafely(input.originalText))
      const fallback = extractFallbackAssumptionsFromProse(prose, ctx)
      for (const a of fallback) {
        const key = `${a.subject}|${a.ruleId}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(a)
      }
    }
  }

  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

export function extractAssumptions(inputText: string, opts?: { url?: string | null }): Promise<Assumption[]> {
  const normalized = normalizeForAnalysis({ text: inputText, url: opts?.url ?? null })
  const primary = extractAssumptionsFromNormalized(normalized)
  if (primary.length > 0) return Promise.resolve(primary)

  const baseCtx = buildContext(normalized.proseText)
  const ctx: ExtractContext = {
    ...baseCtx,
    url: normalized.url,
    urlLower: normalized.url ? normalized.url.toLowerCase() : null,
    codeBlocks: normalized.codeBlocks,
    tokens: normalized.tokens,
  }

  const prose = normalized.proseText.trim() ? normalized.proseText : normalizeText(stripHtmlSafely(normalized.originalText))
  return Promise.resolve(extractFallbackAssumptionsFromProse(prose, ctx))
}

export function validateAnalyzability(inputText: string): boolean {
  const normalized = normalizeForAnalysis({ text: inputText })
  const lower = normalized.normalizedLower
  const tokens = new Set(normalized.tokens.map((t) => t.toLowerCase()))
  const hasCodeBlock = normalized.codeBlocks.length > 0
  const hasCli =
    /\b(npm|npx|yarn|pnpm)\b\s+(install|add|create|init|run|exec|dlx)\b/.test(lower) ||
    /\bnpm\s+[-\w:/]+/.test(lower) ||
    /\bnpx\s+[-\w:/]+/.test(lower) ||
    /\byarn\s+[-\w:/]+/.test(lower) ||
    /\bpnpm\s+[-\w:/]+/.test(lower)
  const hasFunctionLike = /\b[A-Za-z_$][A-Za-z0-9_$]{1,64}\s*\(/.test(normalized.originalText)
  const knownSubjects = new Set(KNOWN_TECH_SUBJECTS.map((s) => s.toLowerCase()))
  const hasKnownTech = Array.from(knownSubjects).some((s) => tokens.has(s))
  const hasVersionHint = /\b(v\d+(?:\.\d+){0,2}|\d+\.\d+(?:\.\d+)?)\b/.test(lower)
  const hasStructured = /\b(install|setup|configure|configuration|requires?|must have|version)\b/.test(lower) || hasVersionHint
  return hasKnownTech || hasCodeBlock || hasCli || hasFunctionLike || hasStructured
}
