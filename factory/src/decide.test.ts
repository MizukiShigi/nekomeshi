import { describe, expect, it } from 'vitest'
import { decideLoop, decideMerge, parseBlockedBy, type Review } from './decide.ts'
import { matchesAny } from './glob.ts'

const clean: Review[] = [
  { perspective: 'acceptance', summary: '', findings: [], acceptance: [{ criterion: 'a', met: true, evidence: 'test x' }] },
  { perspective: 'security', summary: '', findings: [] },
]

describe('glob', () => {
  it('matches nested and root paths', () => {
    expect(matchesAny('factory/src/a.ts', ['factory/**'])).toBe(true)
    expect(matchesAny('README.md', ['**/*.md'])).toBe(true)
    expect(matchesAny('docs/a/b.md', ['**/*.md'])).toBe(true)
    expect(matchesAny('src/lib/utils.ts', ['**/*.md'])).toBe(false)
    expect(matchesAny('.env.local', ['**/.env*'])).toBe(true)
    expect(matchesAny('package.json', ['package.json'])).toBe(true)
    expect(matchesAny('src/package.json', ['package.json'])).toBe(false)
  })
})

describe('decideLoop', () => {
  const base = { changedFiles: ['src/lib/utils.ts'], fixRounds: 0, maxFixRounds: 2 }

  it('is ready when verify passes and reviews are clean', () => {
    expect(decideLoop({ ...base, verify: { ok: true, output: '' }, reviews: clean }).action).toBe('ready')
  })

  it('fixes on verify failure until the cap, then blocks', () => {
    const v = { ok: false, output: 'x' }
    expect(decideLoop({ ...base, verify: v, reviews: null }).action).toBe('fix')
    expect(decideLoop({ ...base, fixRounds: 2, verify: v, reviews: null }).action).toBe('blocked')
  })

  it('counts only evidenced critical/high findings in changed files', () => {
    const reviews: Review[] = [
      ...clean,
      {
        perspective: 'standards',
        summary: '',
        findings: [
          { severity: 'high', file: 'src/other.ts', line: 1, title: 'outside diff', detail: '', evidence: 'e' },
          { severity: 'high', file: 'src/lib/utils.ts', line: 2, title: 'no evidence', detail: '', evidence: ' ' },
          { severity: 'medium', file: 'src/lib/utils.ts', line: 3, title: 'medium', detail: '', evidence: 'e' },
        ],
      },
    ]
    expect(decideLoop({ ...base, verify: { ok: true, output: '' }, reviews }).action).toBe('ready')
    reviews[2].findings.push({ severity: 'critical', file: 'src/lib/utils.ts', line: 4, title: 'real', detail: '', evidence: 'input "," breaks filter' })
    const d = decideLoop({ ...base, verify: { ok: true, output: '' }, reviews })
    expect(d.action).toBe('fix')
    expect(d.reasons).toEqual(['[critical] src/lib/utils.ts:4 real'])
  })

  it('treats an unmet or unevidenced acceptance criterion as blocking', () => {
    const reviews: Review[] = [{ perspective: 'acceptance', summary: '', findings: [], acceptance: [{ criterion: 'shows age', met: true, evidence: '' }] }]
    expect(decideLoop({ ...base, verify: { ok: true, output: '' }, reviews }).action).toBe('fix')
  })

  it('does not accept an acceptance review without per-criterion entries', () => {
    const reviews: Review[] = [{ perspective: 'acceptance', summary: 'all six criteria are met', findings: [] }]
    const d = decideLoop({ ...base, verify: { ok: true, output: '' }, reviews })
    expect(d.action).toBe('fix')
    expect(d.reasons).toEqual(['acceptance review listed no criteria'])
  })

  it('blocks when nothing changed', () => {
    expect(decideLoop({ ...base, changedFiles: [], verify: { ok: true, output: '' }, reviews: clean }).action).toBe('blocked')
  })
})

describe('decideMerge', () => {
  const base = {
    changedFiles: ['src/lib/utils.ts'],
    diffLines: 40,
    humanReviewGlobs: ['factory/**', 'package.json'],
    maxDiffLines: 1000,
    judgeLabel: 'skip' as const,
    botApproved: true,
    checksGreen: true,
    mode: 'shadow' as const,
    liveGlobs: ['**/*.md'],
  }

  it('records a merge verdict without merging code in shadow mode', () => {
    expect(decideMerge(base)).toEqual({ verdict: 'merge', live: false, reasons: [] })
  })

  it('merges docs-only changes live in shadow mode', () => {
    expect(decideMerge({ ...base, changedFiles: ['README.md'] }).live).toBe(true)
  })

  it('sends to a human when any guard trips', () => {
    expect(decideMerge({ ...base, changedFiles: ['package.json'] }).verdict).toBe('human')
    expect(decideMerge({ ...base, judgeLabel: 'needs' }).verdict).toBe('human')
    expect(decideMerge({ ...base, botApproved: false }).verdict).toBe('human')
    expect(decideMerge({ ...base, checksGreen: false }).verdict).toBe('human')
    expect(decideMerge({ ...base, diffLines: 1000 }).verdict).toBe('human')
  })

  it('never merges when mode is off', () => {
    expect(decideMerge({ ...base, mode: 'off', changedFiles: ['README.md'] }).live).toBe(false)
  })
})

describe('parseBlockedBy', () => {
  it('reads issue numbers from the Blocked by section only', () => {
    const body = '## What to build\nsee #9\n\n## Blocked by\n- #12\n- #15\n\n## Notes\n#99'
    expect(parseBlockedBy(body)).toEqual([12, 15])
    expect(parseBlockedBy('## Blocked by\nNone - can start immediately')).toEqual([])
    expect(parseBlockedBy('no section')).toEqual([])
  })
})
