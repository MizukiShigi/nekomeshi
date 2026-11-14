import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.ts'
import { parseRecords, renderRecord, type RunRecord } from './record.ts'

// The factory and the PR Review Judge each hold the list of paths that need a human.
// They must not drift, or a PR could auto-merge through one gate the other would stop.
describe('judge and factory agree on human-review paths', () => {
  it('lists the same globs in the same order', () => {
    const cfg = parseConfig(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
    const wf = readFileSync(new URL('../../.github/workflows/pr-review-judge.yml', import.meta.url), 'utf8')
    const block = wf.slice(wf.indexOf('critical:'), wf.indexOf('static-allow:'))
    const globs = [...block.matchAll(/^\s+- '(.+)'$/gm)].map((m) => m[1])
    expect(globs).toEqual(cfg.humanReviewGlobs)
  })
})

describe('run records', () => {
  it('round-trip through a comment', () => {
    const r: RunRecord = {
      version: 1, runId: 'issue-1-x', kind: 'issue', issue: 1, pr: 2, factorySha: 'abc1234',
      startedAt: '2026-11-15T00:00:00Z', finishedAt: '2026-11-15T00:10:00Z', outcome: 'merge-ok-shadow',
      fixRounds: 1, verifyRuns: [{ ok: false, durationMs: 1 }, { ok: true, durationMs: 1 }],
      findings: { security: { high: 1 } }, acceptance: { total: 2, met: 2 },
      merge: { verdict: 'merge', live: false, reasons: [] }, judge: { label: 'skip', botApproved: true, checksGreen: true },
      reasons: [], steps: [{ step: 'implement', costUsd: 1.5, durationMs: 1, ok: true }], models: { implement: 'm' },
    }
    expect(parseRecords(['noise', renderRecord(r)])).toEqual([r])
  })
})
