import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { IMPLEMENT_SCHEMA, READ_TOOLS, REVIEW_SCHEMA, WRITE_TOOLS, runClaude, type ImplementOutput } from './claude.ts'
import type { Review, Severity } from './decide.ts'
import * as G from './git.ts'
import { fill, log, type Ctx } from './pipeline.ts'
import { shell } from './proc.ts'

// Two kinds of eval keep prompt changes honest:
// - task evals: the implement prompt must pass hidden tests it never sees
// - review evals: a planted bug must be caught, and a harmless change must not be flagged
export type TaskEvalResult = {
  id: string
  kind: 'task'
  status: string
  verifyOk: boolean
  hiddenPass: boolean
  costUsd: number
  minutes: number
}

export type ReviewEvalResult = {
  id: string
  kind: 'review'
  expected: 'flag' | 'clean'
  caught: boolean
  costUsd: number
  topSeverity: Severity | 'none'
}

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 }

function readPrompt(ctx: Ctx, name: string): string {
  const dir = ctx.promptDir ?? join(ctx.repoDir, 'factory/prompts')
  return readFileSync(join(dir, `${name}.md`), 'utf8')
}

export async function runTaskEval(ctx: Ctx, evalDir: string, id: string, stamp: string): Promise<TaskEvalResult> {
  const dir = join(evalDir, 'tasks', id)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { title: string; hiddenTestPath: string }
  const wt = join(ctx.stateDir, 'wt', `eval-${id}`)
  const branch = `eval/${id}-${stamp}`
  const started = Date.now()
  G.addWorktree(ctx.repoDir, wt, branch, `origin/${ctx.cfg.baseBranch}`)
  try {
    const inst = await shell(ctx.cfg.install, wt, 10 * 60_000)
    if (!inst.ok) throw new Error(inst.output.slice(-800))
    const impl = await runClaude<ImplementOutput>({
      cwd: wt,
      prompt: fill(readPrompt(ctx, 'implement'), {
        ISSUE_NUMBER: 0,
        ISSUE_TITLE: meta.title,
        ISSUE_BODY: readFileSync(join(dir, 'task.md'), 'utf8'),
        ISSUE_COMMENTS: '(none)',
        BRANCH: branch,
        BASE: ctx.cfg.baseBranch,
      }),
      model: ctx.cfg.models.implement,
      allowedTools: WRITE_TOOLS,
      schema: IMPLEMENT_SCHEMA,
      budgetUsd: ctx.cfg.budgetsUsd.implement,
      timeoutMs: ctx.cfg.timeoutsMin.implement * 60_000,
      logFile: join(ctx.stateDir, 'evals', stamp, `${id}.jsonl`),
    })
    const verify = await shell(ctx.cfg.verify, wt, 15 * 60_000)
    const target = join(wt, meta.hiddenTestPath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(dir, 'hidden.test.ts'), target)
    // UTC on purpose: the runner usually sits in JST, which would hide time-zone bugs.
    const hidden = await shell(`TZ=UTC pnpm exec vitest run ${meta.hiddenTestPath}`, wt, 5 * 60_000)
    return {
      id,
      kind: 'task',
      status: impl.output?.status ?? `error: ${impl.error}`,
      verifyOk: verify.ok,
      hiddenPass: hidden.ok,
      costUsd: impl.costUsd,
      minutes: (Date.now() - started) / 60000,
    }
  } finally {
    G.removeWorktree(ctx.repoDir, wt)
    G.git(['branch', '-D', branch], ctx.repoDir)
  }
}

export async function runReviewEval(ctx: Ctx, evalDir: string, id: string, stamp: string): Promise<ReviewEvalResult> {
  const dir = join(evalDir, 'reviews', id)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
    perspective: string
    expected: 'flag' | 'clean'
    file: string
    minSeverity: Severity
    issueTitle: string
    issueBody: string
  }
  const wt = join(ctx.stateDir, 'wt', `review-eval-${id}`)
  const branch = `eval/review-${id}-${stamp}`
  G.addWorktree(ctx.repoDir, wt, branch, `origin/${ctx.cfg.baseBranch}`)
  try {
    G.git(['apply', join(dir, 'change.patch')], wt)
    G.git(['add', '-A'], wt)
    G.git(['-c', 'user.name=factory-eval', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', `eval: ${id}`], wt)
    const text = fill(readPrompt(ctx, 'review-common'), {
      PERSPECTIVE: meta.perspective,
      ISSUE_NUMBER: 0,
      ISSUE_TITLE: meta.issueTitle,
      ISSUE_BODY: meta.issueBody,
      BASE: ctx.cfg.baseBranch,
      DIFF: G.diffText(wt, ctx.cfg.baseBranch),
      PREVIOUS: '',
      PERSPECTIVE_INSTRUCTIONS: readPrompt(ctx, `review-${meta.perspective}`),
    })
    const r = await runClaude<Review>({
      cwd: wt,
      prompt: text,
      model: ctx.cfg.models.review,
      allowedTools: READ_TOOLS,
      schema: REVIEW_SCHEMA,
      budgetUsd: ctx.cfg.budgetsUsd.review,
      timeoutMs: ctx.cfg.timeoutsMin.review * 60_000,
      logFile: join(ctx.stateDir, 'evals', stamp, `review-${id}.jsonl`),
    })
    const findings = r.output?.findings ?? []
    const top = findings.reduce<Severity | 'none'>((t, f) => (t === 'none' || RANK[f.severity] > RANK[t] ? f.severity : t), 'none')
    const hit = findings.some((f) => f.file === meta.file && RANK[f.severity] >= RANK[meta.minSeverity] && f.evidence.trim())
    const caught = meta.expected === 'flag' ? hit : !findings.some((f) => RANK[f.severity] >= RANK.high)
    return { id, kind: 'review', expected: meta.expected, caught, costUsd: r.costUsd, topSeverity: top }
  } finally {
    G.removeWorktree(ctx.repoDir, wt)
    G.git(['branch', '-D', branch], ctx.repoDir)
  }
}

export async function runEvals(ctx: Ctx, evalDir: string, only: string[]): Promise<(TaskEvalResult | ReviewEvalResult)[]> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const tasks = existsSync(join(evalDir, 'tasks')) ? readdirSync(join(evalDir, 'tasks')) : []
  const reviews = existsSync(join(evalDir, 'reviews')) ? readdirSync(join(evalDir, 'reviews')) : []
  const pick = (id: string) => only.length === 0 || only.includes(id)
  const results: (TaskEvalResult | ReviewEvalResult)[] = []
  for (const id of reviews.filter(pick)) {
    log(`eval review ${id}`)
    results.push(await runReviewEval(ctx, evalDir, id, stamp))
  }
  for (const id of tasks.filter(pick)) {
    log(`eval task ${id}`)
    results.push(await runTaskEval(ctx, evalDir, id, stamp))
  }
  const out = join(ctx.stateDir, 'evals', `${stamp}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ stamp, factorySha: ctx.factorySha, promptDir: ctx.promptDir, results }, null, 2))
  log(`eval results: ${out}`)
  return results
}

export function renderEvals(results: (TaskEvalResult | ReviewEvalResult)[]): string {
  const lines = ['| eval | 種類 | 結果 | 詳細 | 費用 |', '|---|---|---|---|---|']
  for (const r of results) {
    if (r.kind === 'task') {
      lines.push(`| ${r.id} | 実装 | ${r.hiddenPass ? '合格' : '不合格'} | status=${r.status}, verify=${r.verifyOk ? 'ok' : 'ng'}, ${r.minutes.toFixed(1)}分 | $${r.costUsd.toFixed(2)} |`)
    } else {
      lines.push(`| ${r.id} | レビュー（${r.expected === 'flag' ? '見つけるべき' : '指摘すべきでない'}） | ${r.caught ? '合格' : '不合格'} | 最大の重大度=${r.topSeverity} | $${r.costUsd.toFixed(2)} |`)
    }
  }
  const pass = results.filter((r) => (r.kind === 'task' ? r.hiddenPass : r.caught)).length
  lines.push('', `合格 ${pass}/${results.length}、費用 $${results.reduce((s, r) => s + r.costUsd, 0).toFixed(2)}`)
  return lines.join('\n')
}
