import { matchesAny } from './glob.ts'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export type Finding = {
  severity: Severity
  file: string
  line: number | null
  title: string
  detail: string
  evidence: string
}

export type Criterion = { criterion: string; met: boolean; evidence: string }

export type Review = {
  perspective: string
  summary: string
  findings: Finding[]
  acceptance?: Criterion[]
}

export type VerifyResult = { ok: boolean; output: string }

export type LoopDecision =
  | { action: 'ready'; reasons: string[] }
  | { action: 'fix'; reasons: string[] }
  | { action: 'blocked'; reasons: string[] }

// A high finding without a concrete trigger is usually a guess; counting it would let
// speculative reviewers drive the fix loop.
export function blockingFindings(reviews: Review[], changedFiles: string[]): Finding[] {
  const changed = new Set(changedFiles)
  return reviews.flatMap((r) =>
    r.findings.filter(
      (f) =>
        (f.severity === 'critical' || f.severity === 'high') &&
        changed.has(f.file) &&
        f.evidence.trim().length > 0,
    ),
  )
}

export function unmetCriteria(reviews: Review[]): Criterion[] {
  return reviews.flatMap((r) => (r.acceptance ?? []).filter((c) => !c.met || c.evidence.trim() === ''))
}

export function decideLoop(o: {
  verify: VerifyResult
  reviews: Review[] | null
  changedFiles: string[]
  fixRounds: number
  maxFixRounds: number
}): LoopDecision {
  const reasons: string[] = []
  if (!o.verify.ok) reasons.push('verify failed')
  if (o.reviews) {
    for (const f of blockingFindings(o.reviews, o.changedFiles)) {
      reasons.push(`[${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} ${f.title}`)
    }
    for (const c of unmetCriteria(o.reviews)) reasons.push(`unmet: ${c.criterion}`)
    if (!o.reviews.some((r) => r.perspective === 'acceptance')) reasons.push('acceptance review missing')
  }
  if (o.changedFiles.length === 0) return { action: 'blocked', reasons: ['no changes'] }
  if (reasons.length === 0) return { action: 'ready', reasons: [] }
  if (o.fixRounds >= o.maxFixRounds) return { action: 'blocked', reasons }
  return { action: 'fix', reasons }
}

export type MergeMode = 'off' | 'shadow' | 'on'

export type MergeDecision = {
  verdict: 'merge' | 'human'
  live: boolean
  reasons: string[]
}

// The factory's own rules can only add reasons to send a PR to a human; the existing
// PR Review Judge must also have said skip-human-review and approved.
export function decideMerge(o: {
  changedFiles: string[]
  diffLines: number
  humanReviewGlobs: string[]
  maxDiffLines: number
  judgeLabel: 'skip' | 'needs' | null
  botApproved: boolean
  checksGreen: boolean
  mode: MergeMode
  liveGlobs: string[]
}): MergeDecision {
  const reasons: string[] = []
  const guarded = o.changedFiles.filter((f) => matchesAny(f, o.humanReviewGlobs))
  if (guarded.length > 0) reasons.push(`touches human-review paths: ${guarded.join(', ')}`)
  if (o.diffLines >= o.maxDiffLines) reasons.push(`diff ${o.diffLines} lines >= ${o.maxDiffLines}`)
  if (o.judgeLabel !== 'skip') reasons.push(`PR Review Judge: ${o.judgeLabel ?? 'no decision'}`)
  if (!o.botApproved) reasons.push('no approval from the review bot')
  if (!o.checksGreen) reasons.push('checks not green')
  if (reasons.length > 0) return { verdict: 'human', live: false, reasons }
  const allLive = o.changedFiles.length > 0 && o.changedFiles.every((f) => matchesAny(f, o.liveGlobs))
  const live = o.mode === 'on' || (o.mode === 'shadow' && allLive)
  return { verdict: 'merge', live: o.mode !== 'off' && live, reasons: [] }
}

export function parseBlockedBy(body: string): number[] {
  const m = body.match(/##\s*Blocked by\s*\n([\s\S]*?)(?:\n##\s|$)/i)
  if (!m) return []
  return [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1]))
}
