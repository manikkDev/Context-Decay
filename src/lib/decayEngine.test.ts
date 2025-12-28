import { describe, expect, it } from 'vitest'
import { extractAssumptionsFromNormalized, normalizeForAnalysis, type Assumption } from './assumptionExtractor'
import { classifyDecays, matchDecays, scoreDecay, type RealityAnchor } from './decayEngine'

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

function anchor(partial: Partial<RealityAnchor> & Pick<RealityAnchor, 'id' | 'domain' | 'key' | 'effectiveFrom'>): RealityAnchor {
  return {
    ...partial,
    effectiveTo: partial.effectiveTo ?? null,
    severity: partial.severity ?? 'low',
    description: partial.description ?? '',
  }
}

function run(params: { text: string; assumptions: Assumption[]; anchors: RealityAnchor[] }) {
  const normalized = normalizeForAnalysis({ text: params.text })
  const matches = matchDecays({
    assumptions: params.assumptions,
    anchors: params.anchors,
    normalizedLower: normalized.normalizedLower,
    tokens: normalized.tokens,
  })
  const details = classifyDecays({ matches, anchors: params.anchors, assumptions: params.assumptions })
  const score = scoreDecay(details)
  return { normalized, matches, details, score }
}

describe('decayEngine deterministic pipeline', () => {
  it('classifies deprecation as soft decay and applies a 20-point penalty', () => {
    const assumptions: Assumption[] = [
      a({
        id: 'a1',
        subject: 'create-react-app',
        type: 'environment_expectation',
        impliedValue: 'must use create-react-app.',
        confidence: 0.9,
      }),
    ]
    const anchors: RealityAnchor[] = [
      anchor({
        id: 'create-react-app.deprecated',
        domain: 'create-react-app',
        key: 'create-react-app.deprecated',
        type: 'deprecation',
        description: 'Create React App is deprecated.',
        effectiveFrom: '2023-02-01',
        severity: 'high',
        citationUrl: 'https://example.test/cra',
      }),
    ]

    const { matches, details, score } = run({
      text: 'Reference: create-react-app.deprecated',
      assumptions,
      anchors,
    })

    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe('exact')
    expect(matches[0].matchedAnchorId).toBe('create-react-app.deprecated')

    expect(details).toHaveLength(1)
    expect(details[0].decayClass).toBe('soft')
    expect(details[0].ruleUsed).toBe('deprecated')
    expect(details[0].evidenceUrl).toBe('https://example.test/cra')
    expect(score).toBe(80)
  })

  it('clamps score at 0 when penalties exceed 100', () => {
    const assumptions: Assumption[] = [
      a({ id: 'a1', subject: 'alpha', type: 'environment_expectation', impliedValue: 'must use alpha.', confidence: 0.9 }),
      a({ id: 'a2', subject: 'alpha', type: 'environment_expectation', impliedValue: 'must use alpha.', confidence: 0.9 }),
      a({ id: 'a3', subject: 'alpha', type: 'environment_expectation', impliedValue: 'must use alpha.', confidence: 0.9 }),
    ]
    const anchors: RealityAnchor[] = [
      anchor({
        id: 'alpha.breaking',
        domain: 'alpha',
        key: 'alpha.breaking',
        type: 'breaking-change',
        description: 'Breaking change.',
        effectiveFrom: '2022-01-01',
        severity: 'high',
      }),
    ]

    const { details, score } = run({
      text: 'Reference: alpha.breaking',
      assumptions,
      anchors,
    })
    expect(details).toHaveLength(3)
    expect(details.every((d) => d.decayClass === 'hard')).toBe(true)
    expect(score).toBe(0)
  })

  it('does not apply decay when assumption subject does not match anchor domain', () => {
    const assumptions: Assumption[] = [
      a({
        id: 'a1',
        subject: 'vite',
        type: 'tool_recommendation',
        impliedValue: 'Prefer vite over create-react-app.',
        confidence: 0.8,
      }),
    ]
    const anchors: RealityAnchor[] = [
      anchor({
        id: 'create-react-app.deprecated',
        domain: 'create-react-app',
        key: 'create-react-app.deprecated',
        type: 'deprecation',
        description: 'Create React App is deprecated.',
        effectiveFrom: '2023-02-01',
      }),
    ]

    const { matches, details, score } = run({
      text: 'Reference: create-react-app.deprecated',
      assumptions,
      anchors,
    })

    expect(matches).toHaveLength(1)
    expect(details).toHaveLength(0)
    expect(score).toBe(100)
  })

  it('falls back to token overlap matching when exact key is absent', () => {
    const assumptions: Assumption[] = [
      a({
        id: 'a1',
        subject: 'vite',
        type: 'environment_expectation',
        impliedValue: 'Use environment variables from vite without restrictions.',
        confidence: 0.6,
      }),
    ]
    const anchors: RealityAnchor[] = [
      anchor({
        id: 'vite.env-prefix',
        domain: 'vite',
        key: 'vite.env-prefix',
        type: 'policy',
        description: 'Only environment variables prefixed with VITE_ are exposed to clients.',
        effectiveFrom: '2021-04-20',
        severity: 'medium',
        citationUrl: 'https://example.test/vite-env',
      }),
    ]

    const { matches, details, score } = run({
      text: 'Vite env prefix rules: only variables with VITE_ are exposed.',
      assumptions,
      anchors,
    })

    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe('token')

    expect(details).toHaveLength(1)
    expect(details[0].decayClass).toBe('risk')
    expect(details[0].ruleUsed).toBe('environment_cost_change')
    expect(details[0].evidenceUrl).toBe('https://example.test/vite-env')
    expect(score).toBe(75)
  })

  it('ignores behavioral-change anchors for behavior_expectation assumptions', () => {
    const assumptions: Assumption[] = [
      a({
        id: 'a1',
        subject: 'react',
        type: 'behavior_expectation',
        impliedValue: 'React StrictMode may run effects twice in development.',
        confidence: 0.7,
      }),
    ]
    const anchors: RealityAnchor[] = [
      anchor({
        id: 'react.strictmode.double-invoke',
        domain: 'react',
        key: 'react.strictmode.double-invoke',
        type: 'behavioral-change',
        description: 'StrictMode may double-invoke renders/effects in development.',
        effectiveFrom: '2021-10-01',
      }),
    ]

    const { matches, details, score } = run({
      text: 'Reference: react.strictmode.double-invoke',
      assumptions,
      anchors,
    })

    expect(matches).toHaveLength(1)
    expect(details).toHaveLength(0)
    expect(score).toBe(100)
  })
})

describe('stabilization validation scenarios', () => {
  it('produces identical extraction results for identical input', () => {
    const text =
      "If you need a quick React setup, you can use create-react-app. For newer projects, you should prefer Vite over create-react-app."
    const n1 = normalizeForAnalysis({ text })
    const n2 = normalizeForAnalysis({ text })
    const a1 = extractAssumptionsFromNormalized(n1)
    const a2 = extractAssumptionsFromNormalized(n2)
    expect(n1).toEqual(n2)
    expect(a1).toEqual(a2)
  })

  it('flags create-react-app deprecation as soft decay when assumptions exist', () => {
    const text =
      "If you need a quick React setup, you can use create-react-app. It's stable and still works for many apps."
    const normalized = normalizeForAnalysis({ text })
    const assumptions = extractAssumptionsFromNormalized(normalized)
    expect(assumptions.length).toBeGreaterThanOrEqual(1)

    const anchors: RealityAnchor[] = [
      anchor({
        id: 'create-react-app.deprecated',
        domain: 'create-react-app',
        key: 'create-react-app.deprecated',
        type: 'deprecation',
        description: 'Create React App is deprecated.',
        effectiveFrom: '2023-02-01',
      }),
    ]
    const matches = matchDecays({
      assumptions,
      anchors,
      normalizedLower: `${normalized.normalizedLower} create-react-app.deprecated`,
      tokens: normalized.tokens,
    })
    const details = classifyDecays({ matches, anchors, assumptions })
    expect(details.some((d) => d.decayClass === 'soft')).toBe(true)
  })

  it('does not produce decay for MDN-style Array.map content', () => {
    const text =
      'The map() method creates a new array populated with the results of calling a provided function on every element in the calling array.'
    const normalized = normalizeForAnalysis({ text })
    const assumptions = extractAssumptionsFromNormalized(normalized)

    const anchors: RealityAnchor[] = [
      anchor({
        id: 'create-react-app.deprecated',
        domain: 'create-react-app',
        key: 'create-react-app.deprecated',
        type: 'deprecation',
        description: 'Create React App is deprecated.',
        effectiveFrom: '2023-02-01',
      }),
    ]

    const { details, score } = run({ text, assumptions, anchors })
    expect(details).toHaveLength(0)
    expect(score).toBeGreaterThanOrEqual(95)
  })

  it('extracts no assumptions from garbage input', () => {
    const text = 'qzv 11 !! ~~ ____'
    const normalized = normalizeForAnalysis({ text })
    const assumptions = extractAssumptionsFromNormalized(normalized)
    expect(assumptions).toHaveLength(0)
  })
})
