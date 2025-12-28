import type { Assumption } from './assumptionExtractor'

export type AnchorSeverity = 'low' | 'medium' | 'high'
export type DecayClass = 'hard' | 'soft' | 'context' | 'risk'
export type MatchType = 'exact' | 'token'
export type ClassificationRuleId = 'deprecated' | 'removed' | 'behavior_change' | 'environment_cost_change'

export type RealityAnchor = {
  id: string
  domain: string
  key: string
  type?: string
  description?: string
  value?: unknown
  effectiveFrom: string
  effectiveTo?: string | null
  severity?: AnchorSeverity
  citationUrl?: string
}

export type DecayMatch = {
  assumptionId: string
  matchedAnchorId: string
  matchedKey: string
  matchType: MatchType
  justification: string
}

export type DecayDetail = DecayMatch & {
  ruleUsed: ClassificationRuleId
  decayClass: DecayClass
  evidenceUrl?: string
}

function canonicalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function subjectMatchesDomain(subject: string, domain: string): boolean {
  const s = canonicalize(subject)
  const d = canonicalize(domain)
  if (!s || !d) return false
  if (s === d) return true
  if (s.replace(/\bjs\b/g, '').trim() === d) return true
  if (d.replace(/\bjs\b/g, '').trim() === s) return true
  if (s.startsWith(`${d} `) || d.startsWith(`${s} `)) return true
  return false
}

function hasAssumptionNegation(assumption: Assumption): boolean {
  const text = `${assumption.subject} ${assumption.impliedValue}`.toLowerCase()
  return /\b(deprecated|avoid|no longer recommended|do not use|don't use)\b/.test(text)
}

function shouldApplyDecay(assumption: Assumption, anchor: RealityAnchor): boolean {
  const t = (anchor.type ?? '').toLowerCase()
  const match = subjectMatchesDomain(assumption.subject, anchor.domain)
  if (!match) return false
  if (t.includes('deprecation')) {
    if (hasAssumptionNegation(assumption)) return false
    return assumption.type === 'tool_recommendation' || assumption.type === 'environment_expectation'
  }
  if (t.includes('breaking-change')) {
    if (hasAssumptionNegation(assumption)) return false
    return assumption.type === 'environment_expectation'
  }
  if (t.includes('behavioral-change')) {
    return assumption.type !== 'behavior_expectation'
  }
  if (t.includes('policy')) {
    if (hasAssumptionNegation(assumption)) return false
    return assumption.type === 'environment_expectation'
  }
  throw new Error(`Unknown anchor type for classification: ${anchor.id}`)
}

function tokenize(input: string): string[] {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  return normalized.split(/\s+/).filter((t) => t.length >= 2)
}

function anchorTokens(anchor: RealityAnchor): string[] {
  return Array.from(new Set(tokenize(`${anchor.domain} ${anchor.key.replace(/\./g, ' ')}`)))
}

function pickClassificationRule(anchor: RealityAnchor): { ruleUsed: ClassificationRuleId; decayClass: DecayClass } {
  const t = (anchor.type ?? '').toLowerCase()
  if (t.includes('deprecation')) return { ruleUsed: 'deprecated', decayClass: 'soft' }
  if (t.includes('breaking-change')) return { ruleUsed: 'removed', decayClass: 'hard' }
  if (t.includes('behavioral-change')) return { ruleUsed: 'behavior_change', decayClass: 'context' }
  if (t.includes('policy')) return { ruleUsed: 'environment_cost_change', decayClass: 'risk' }
  throw new Error(`Unknown anchor type for classification: ${anchor.id}`)
}

function decayPenalty(decayClass: DecayClass): number {
  if (decayClass === 'hard') return 40
  if (decayClass === 'soft') return 20
  if (decayClass === 'context') return 10
  return 25
}

export function matchDecays(params: {
  assumptions: Assumption[]
  anchors: RealityAnchor[]
  normalizedLower: string
  tokens: string[]
}): DecayMatch[] {
  const tokenSet = new Set<string>()
  for (const raw of params.tokens) {
    for (const t of tokenize(raw)) tokenSet.add(t)
  }
  const anchors = params.anchors
    .map((a) => ({
      ...a,
      domain: a.domain ?? '',
      key: a.key ?? '',
      effectiveTo: a.effectiveTo ?? null,
      severity: a.severity ?? 'low',
    }))
    .filter((a) => typeof a.id === 'string' && a.id.trim())

  const matches: DecayMatch[] = []
  const lower = params.normalizedLower

  for (const assumption of params.assumptions) {
    const exactCandidates: Array<{ anchor: RealityAnchor; score: number }> = []
    for (const anchor of anchors) {
      const keyLower = anchor.key.toLowerCase()
      if (!keyLower) continue
      if (lower.includes(keyLower)) exactCandidates.push({ anchor, score: keyLower.length })
    }
    if (exactCandidates.length) {
      exactCandidates.sort((a, b) => b.score - a.score || a.anchor.id.localeCompare(b.anchor.id))
      const best = exactCandidates[0]
      matches.push({
        assumptionId: assumption.id,
        matchedAnchorId: best.anchor.id,
        matchedKey: best.anchor.key,
        matchType: 'exact',
        justification: `Exact key match on ${best.anchor.key}.`,
      })
      continue
    }

    const tokenCandidates: Array<{ anchor: RealityAnchor; ratio: number; overlap: number; hits: string[] }> = []
    for (const anchor of anchors) {
      const at = anchorTokens(anchor)
      if (at.length === 0) continue
      const hits: string[] = []
      for (const t of at) if (tokenSet.has(t)) hits.push(t)
      const overlap = hits.length
      const ratio = overlap / at.length
      if (overlap < 2) continue
      if (ratio < 0.6) continue
      tokenCandidates.push({ anchor, ratio, overlap, hits: hits.sort((a, b) => a.localeCompare(b)) })
    }
    if (!tokenCandidates.length) continue
    tokenCandidates.sort(
      (a, b) =>
        b.ratio - a.ratio ||
        b.overlap - a.overlap ||
        a.anchor.id.localeCompare(b.anchor.id),
    )
    const best = tokenCandidates[0]
    matches.push({
      assumptionId: assumption.id,
      matchedAnchorId: best.anchor.id,
      matchedKey: best.anchor.key,
      matchType: 'token',
      justification: `Token overlap ${best.overlap}/${anchorTokens(best.anchor).length}: ${best.hits.join(', ')}`,
    })
  }

  matches.sort(
    (a, b) =>
      a.assumptionId.localeCompare(b.assumptionId) ||
      a.matchedAnchorId.localeCompare(b.matchedAnchorId),
  )
  return matches
}

export function classifyDecays(params: { matches: DecayMatch[]; anchors: RealityAnchor[]; assumptions: Assumption[] }): DecayDetail[] {
  const anchorsById = new Map(params.anchors.map((a) => [a.id, a]))
  const assumptionsById = new Map(params.assumptions.map((a) => [a.id, a]))
  const out: DecayDetail[] = []

  for (const m of params.matches) {
    const anchor = anchorsById.get(m.matchedAnchorId)
    if (!anchor) throw new Error(`Matched anchor not found: ${m.matchedAnchorId}`)
    const assumption = assumptionsById.get(m.assumptionId)
    if (!assumption) throw new Error(`Matched assumption not found: ${m.assumptionId}`)
    if (!shouldApplyDecay(assumption, anchor)) continue
    const { ruleUsed, decayClass } = pickClassificationRule(anchor)
    out.push({
      ...m,
      ruleUsed,
      decayClass,
      evidenceUrl: anchor.citationUrl,
    })
  }

  out.sort(
    (a, b) =>
      a.assumptionId.localeCompare(b.assumptionId) ||
      a.matchedAnchorId.localeCompare(b.matchedAnchorId),
  )
  return out
}

export function scoreDecay(details: DecayDetail[]): number {
  let score = 100
  for (const d of details) score -= decayPenalty(d.decayClass)
  if (score < 0) score = 0
  if (score > 100) score = 100
  return score
}
