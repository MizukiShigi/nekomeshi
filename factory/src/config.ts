import type { MergeMode } from './decide.ts'

export type FactoryConfig = {
  repo: string
  baseBranch: string
  branchPrefix: string
  labels: {
    ready: string
    inProgress: string
    blocked: string
    fix: string
    mergeOk: string
    judgeNeedsReview: string
    judgeSkipReview: string
  }
  auth: { apiKeyEnv: string }
  models: { implement: string; review: string; fix: string; retro: string }
  budgetsUsd: { implement: number; review: number; fix: number; retro: number }
  timeoutsMin: { implement: number; review: number; fix: number; retro: number; github: number }
  maxFixRounds: number
  maxOpenAgentPRs: number
  maxDiffLines: number
  perspectives: string[]
  install: string
  verify: string
  humanReviewGlobs: string[]
  merge: { mode: MergeMode; liveGlobs: string[] }
}

export function parseConfig(text: string): FactoryConfig {
  const c = JSON.parse(text) as FactoryConfig
  for (const k of ['repo', 'baseBranch', 'branchPrefix', 'install', 'verify'] as const) {
    if (typeof c[k] !== 'string' || !c[k]) throw new Error(`config.${k} missing`)
  }
  if (!['off', 'shadow', 'on'].includes(c.merge?.mode)) throw new Error('config.merge.mode must be off|shadow|on')
  if (!(c.maxFixRounds >= 0)) throw new Error('config.maxFixRounds missing')
  if (typeof c.auth?.apiKeyEnv !== 'string' || !c.auth.apiKeyEnv) throw new Error('config.auth.apiKeyEnv missing')
  return c
}
