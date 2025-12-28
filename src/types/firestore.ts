import type { Timestamp } from 'firebase/firestore'

export type AnalysisSessionStatus = 'pending' | 'done' | 'failed'

export type AnalysisDecayDetail = {
  assumption: string
  mismatch: string
  severity: number
  timestamp: Timestamp
}

export type AnalysisTimelineEvent = {
  type: string
  label: string
  timestamp: Timestamp
  metadata?: Record<string, unknown>
}

export type AnalysisSessionDoc = {
  userId?: string | null
  inputText: string
  inputUrl: string | null
  createdAt: Timestamp
  decayScore: number
  decayDetails: AnalysisDecayDetail[]
  timeline: AnalysisTimelineEvent[]
  status: AnalysisSessionStatus
}

export type RealityAnchorDoc = {
  domain: string
  key: string
  value: unknown
  effectiveFrom: string
  effectiveTo: string | null
  metadata: string
}
