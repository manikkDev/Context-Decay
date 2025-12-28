import { describe, expect, it } from 'vitest'
import { extractAssumptions, type Assumption, type AssumptionType } from './assumptionExtractor'

function hasType(list: Assumption[], type: AssumptionType): boolean {
  return list.some((a) => a.type === type)
}

function hasSubject(list: Assumption[], subject: string): boolean {
  return list.some((a) => a.subject === subject)
}

describe('extractAssumptions', () => {
  it('is deterministic for identical input', async () => {
    const input = 'You should use Vite instead of create-react-app.'
    const a = await extractAssumptions(input)
    const b = await extractAssumptions(input)
    expect(a).toEqual(b)
    expect(a.map((x) => x.id)).toEqual([...a.map((x) => x.id)].sort())
  })

  it('extracts tool recommendation assumptions', async () => {
    const input = 'You should use Vite instead of create-react-app.'
    const assumptions = await extractAssumptions(input)
    expect(hasType(assumptions, 'tool_recommendation')).toBe(true)
    expect(hasSubject(assumptions, 'vite')).toBe(true)
    expect(hasSubject(assumptions, 'create-react-app')).toBe(true)
  })

  it('extracts environment expectations from Node version requirements', async () => {
    const input = 'This project requires Node.js v18 or higher.'
    const assumptions = await extractAssumptions(input)
    expect(hasType(assumptions, 'environment_expectation')).toBe(true)
    const node = assumptions.find((a) => a.subject === 'node.js' && a.impliedValue.toLowerCase().includes('v18'))
    expect(node?.confidence).toBeGreaterThan(0.5)
  })

  it('extracts package manager install expectations', async () => {
    const input = 'Install react-router-dom with npm install react-router-dom.'
    const assumptions = await extractAssumptions(input)
    const pm = assumptions.find((a) => a.subject === 'npm' && a.impliedValue.toLowerCase().includes('react-router-dom'))
    expect(pm).toBeTruthy()
  })

  it('extracts api usage assumptions', async () => {
    const input = 'Use useEffect to fetch data after mount.'
    const assumptions = await extractAssumptions(input)
    expect(hasType(assumptions, 'api_usage')).toBe(true)
    expect(hasSubject(assumptions, 'useeffect')).toBe(true)
  })

  it('extracts behavior expectations about StrictMode', async () => {
    const input = 'React StrictMode may run effects twice in development.'
    const assumptions = await extractAssumptions(input)
    expect(hasType(assumptions, 'behavior_expectation')).toBe(true)
    const strict = assumptions.find((a) => a.type === 'behavior_expectation' && a.subject === 'react')
    expect(strict?.impliedValue.toLowerCase()).toContain('strictmode')
  })

  it('extracts deployment target expectations', async () => {
    const input = 'Deploy the app to Firebase Hosting.'
    const assumptions = await extractAssumptions(input)
    expect(hasType(assumptions, 'environment_expectation')).toBe(true)
    expect(hasSubject(assumptions, 'firebase')).toBe(true)
  })

  it('infers create-react-app tool recommendation from CLI commands', async () => {
    const input = 'Run:\n\nnpx create-react-app my-app\n\nThen cd my-app and npm start.'
    const assumptions = await extractAssumptions(input)
    expect(hasType(assumptions, 'tool_recommendation')).toBe(true)
    expect(hasSubject(assumptions, 'create-react-app')).toBe(true)
  })

  it('infers deployment platform environment and cost assumptions', async () => {
    const input = 'We deployed this on Vercel and configured environment variables.'
    const assumptions = await extractAssumptions(input)
    const vercel = assumptions.filter((a) => a.subject === 'vercel' && a.type === 'environment_expectation')
    expect(vercel.length).toBeGreaterThanOrEqual(2)
    expect(vercel.some((a) => a.impliedValue.toLowerCase().includes('pricing'))).toBe(true)
  })

  it('extracts create-react-app assumptions from StackOverflow-like CRA text', async () => {
    const url = 'https://stackoverflow.com/questions/12345678/how-to-create-react-app'
    const input = 'Run: npx create-react-app my-app. Then npm start.'
    const assumptions = await extractAssumptions(input, { url })
    expect(hasSubject(assumptions, 'create-react-app')).toBe(true)
  })

  it('extracts fallback assumptions for MDN Array.map-like input', async () => {
    const url = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map'
    const input = 'Array.prototype.map() creates a new array populated with the results of calling a provided function.'
    const assumptions = await extractAssumptions(input, { url })
    expect(assumptions.length).toBeGreaterThan(0)
    expect(assumptions.some((a) => a.evidenceSnippet.toLowerCase().includes('array.prototype.map'))).toBe(true)
  })

  it('extracts fallback assumptions for garbage input', async () => {
    const assumptions = await extractAssumptions('qweoiu zxcmn asd asd', { url: null })
    expect(assumptions.length).toBeGreaterThan(0)
    expect(assumptions[0]?.impliedValue.length ?? 0).toBeGreaterThan(0)
  })
})
