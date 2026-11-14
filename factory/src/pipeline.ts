import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FIX_SCHEMA, IMPLEMENT_SCHEMA, READ_TOOLS, REVIEW_SCHEMA, WRITE_TOOLS, runClaude,
  type FixOutput, type ImplementOutput,
} from './claude.ts'
import { parseConfig, type FactoryConfig } from './config.ts'
import {
  blockingFindings, decideLoop, decideMerge, parseBlockedBy, unmetCriteria,
  type Review, type VerifyResult,
} from './decide.ts'
import { Gh, type GhIssue, type GhPr } from './gh.ts'
import * as G from './git.ts'
import { run, shell, sleep, tryRun } from './proc.ts'
import { renderRecord, type RunRecord } from './record.ts'

export type Ctx = {
  repoDir: string
  stateDir: string
  cfg: FactoryConfig
  gh: Gh
  factorySha: string
  // Evals point this at a working tree to try prompt changes before they are merged.
  promptDir: string | null
}

export function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

export function loadCtx(repoDir: string, opts: { local?: boolean } = {}): Ctx {
  G.fetch(repoDir)
  const base = 'main'
  const cfgText = opts.local ? readFileSync(join(repoDir, 'factory/config.json'), 'utf8') : G.readFromBase(repoDir, base, 'factory/config.json')
  const cfg = parseConfig(cfgText)
  const stateDir = join(repoDir, '.factory')
  mkdirSync(stateDir, { recursive: true })
  return {
    repoDir,
    stateDir,
    cfg,
    gh: new Gh(cfg.repo),
    factorySha: G.baseSha(repoDir, cfg.baseBranch).slice(0, 7),
    promptDir: opts.local ? join(repoDir, 'factory/prompts') : null,
  }
}

function prompt(ctx: Ctx, name: string): string {
  if (ctx.promptDir) return readFileSync(join(ctx.promptDir, `${name}.md`), 'utf8')
  return G.readFromBase(ctx.repoDir, ctx.cfg.baseBranch, `factory/prompts/${name}.md`)
}

export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{{${k}}}`))
}

// Comments from people without write access are dropped: on a public repo they are
// untrusted text that would otherwise flow straight into the agent's prompt.
export function trustedComments(ctx: Ctx, comments: GhIssue['comments']): string {
  const cache = new Map<string, boolean>()
  const ok = (login: string) => {
    if (!cache.has(login)) cache.set(login, ctx.gh.canWrite(login))
    return cache.get(login)
  }
  const kept = comments.filter((c) => !c.body.includes('<!-- factory') && ok(c.author.login))
  return kept.length ? kept.map((c) => `- ${c.author.login}: ${c.body}`).join('\n') : '(none)'
}

export async function ensureBaseGreen(ctx: Ctx): Promise<VerifyResult> {
  const sha = G.baseSha(ctx.repoDir, ctx.cfg.baseBranch)
  const marker = join(ctx.stateDir, `base-ok-${sha}`)
  if (existsSync(marker)) return { ok: true, output: 'cached' }
  const wt = join(ctx.stateDir, 'wt', 'base')
  G.removeWorktree(ctx.repoDir, wt)
  G.git(['worktree', 'add', '--quiet', '--detach', wt, `origin/${ctx.cfg.baseBranch}`], ctx.repoDir)
  try {
    const r = await shell(`${ctx.cfg.install} && ${ctx.cfg.verify}`, wt, 15 * 60_000)
    if (r.ok) writeFileSync(marker, new Date().toISOString())
    return { ok: r.ok, output: r.output }
  } finally {
    G.removeWorktree(ctx.repoDir, wt)
  }
}

export type Eligibility = { ok: true } | { ok: false; reason: string }

export function eligibility(ctx: Ctx, issue: GhIssue, openFactoryPrs: GhPr[]): Eligibility {
  const L = ctx.cfg.labels
  const names = issue.labels.map((l) => l.name)
  if (issue.state !== 'OPEN') return { ok: false, reason: 'not open' }
  if (!names.includes(L.ready)) return { ok: false, reason: `no ${L.ready}` }
  if (names.includes(L.inProgress) || names.includes(L.blocked)) return { ok: false, reason: 'in progress or blocked' }
  const actor = ctx.gh.labelActor(issue.number, L.ready)
  if (!actor || !ctx.gh.canWrite(actor)) return { ok: false, reason: `${L.ready} added by ${actor ?? 'unknown'} without write access` }
  for (const dep of parseBlockedBy(issue.body)) {
    if (ctx.gh.issue(dep).state === 'OPEN') return { ok: false, reason: `blocked by #${dep}` }
  }
  if (openFactoryPrs.some((p) => p.headRefName === branchFor(ctx, issue.number))) return { ok: false, reason: 'a factory PR is already open' }
  if (openFactoryPrs.length >= ctx.cfg.maxOpenAgentPRs) return { ok: false, reason: `${openFactoryPrs.length} factory PRs open (cap ${ctx.cfg.maxOpenAgentPRs})` }
  return { ok: true }
}

export function branchFor(ctx: Ctx, issue: number): string {
  return `${ctx.cfg.branchPrefix}issue-${issue}`
}

export function openFactoryPrs(ctx: Ctx): GhPr[] {
  return ctx.gh.listPrs('open').filter((p) => p.headRefName.startsWith(ctx.cfg.branchPrefix))
}

async function runReviews(ctx: Ctx, wt: string, issue: GhIssue, runId: string, round: number, previous: Review[] | null): Promise<{ reviews: Review[]; costs: RunRecord['steps'] }> {
  const common = prompt(ctx, 'review-common')
  const diff = G.diffText(wt, ctx.cfg.baseBranch)
  const prev = previous
    ? `# Previous review round\n\nThe author answered these earlier findings. Do not repeat a finding the author declined with a sound reason.\n\n${JSON.stringify(previous.map((r) => ({ perspective: r.perspective, findings: r.findings })), null, 2)}`
    : ''
  const jobs = ctx.cfg.perspectives.map(async (p) => {
    const text = fill(common, {
      PERSPECTIVE: p,
      ISSUE_NUMBER: issue.number,
      ISSUE_TITLE: issue.title,
      ISSUE_BODY: issue.body,
      BASE: ctx.cfg.baseBranch,
      DIFF: diff.length > 150_000 ? `${diff.slice(0, 150_000)}\n... (truncated; run git diff yourself)` : diff,
      PREVIOUS: prev,
      PERSPECTIVE_INSTRUCTIONS: prompt(ctx, `review-${p}`),
    })
    const r = await runClaude<Review>({
      cwd: wt,
      prompt: text,
      model: ctx.cfg.models.review,
      allowedTools: READ_TOOLS,
      schema: REVIEW_SCHEMA,
      budgetUsd: ctx.cfg.budgetsUsd.review,
      timeoutMs: ctx.cfg.timeoutsMin.review * 60_000,
      logFile: join(ctx.stateDir, 'logs', runId, `review-${p}-${round}.jsonl`),
    })
    // A reviewer that crashed must not count as a clean review.
    const review: Review = r.output ?? {
      perspective: p,
      summary: `レビューが失敗した: ${r.error}`,
      findings: [{ severity: 'high', file: '(review)', line: null, title: `review ${p} failed`, detail: r.error ?? '', evidence: 'reviewer error' }],
    }
    review.perspective = p
    return { review, cost: { step: `review-${p}-${round}`, costUsd: r.costUsd, durationMs: r.durationMs, ok: r.ok } }
  })
  const done = await Promise.all(jobs)
  return { reviews: done.map((d) => d.review), costs: done.map((d) => d.cost) }
}

function renderReviews(reviews: Review[], round: number): string {
  const lines = [`<!-- factory-review -->`, `### 観点別レビュー（${round + 1} 回目）`, '']
  for (const r of reviews) {
    lines.push(`#### ${r.perspective}`, '', r.summary, '')
    if (r.acceptance?.length) {
      lines.push('| 受け入れ条件 | 判定 | 証拠 |', '|---|---|---|')
      for (const c of r.acceptance) lines.push(`| ${c.criterion.replace(/\|/g, '\\|')} | ${c.met ? '満たす' : '満たさない'} | ${c.evidence.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
      lines.push('')
    }
    if (r.findings.length) {
      lines.push('| 重大度 | 場所 | 指摘 |', '|---|---|---|')
      for (const f of r.findings) lines.push(`| ${f.severity} | \`${f.file}${f.line ? `:${f.line}` : ''}\` | ${f.title.replace(/\|/g, '\\|')} |`)
      lines.push('')
    } else {
      lines.push('指摘なし', '')
    }
  }
  return lines.join('\n')
}

function problemsText(d: { reasons: string[] }, reviews: Review[] | null, changed: string[]): string {
  const parts = [`Reasons: ${d.reasons.join('; ')}`]
  if (reviews) {
    for (const f of blockingFindings(reviews, changed)) {
      parts.push(`- [${f.severity}] ${f.file}:${f.line ?? ''} ${f.title}\n  detail: ${f.detail}\n  evidence: ${f.evidence}`)
    }
    for (const c of unmetCriteria(reviews)) parts.push(`- [unmet acceptance criterion] ${c.criterion} (evidence given: ${c.evidence || 'none'})`)
  }
  return parts.join('\n')
}

function commitLeftovers(wt: string): void {
  if (G.isDirty(wt)) {
    G.git(['add', '-A'], wt)
    G.git(['commit', '-q', '-m', 'chore: commit changes the agent left uncommitted'], wt)
  }
}

type JudgeState = { label: 'skip' | 'needs' | null; botApproved: boolean; checksGreen: boolean; pending: boolean }

export function judgeState(ctx: Ctx, pr: GhPr): JudgeState {
  const short = pr.headRefOid.slice(0, 7)
  const judged = pr.comments.filter((c) => c.body.includes('<!-- pr-review-judge -->') && c.body.includes(`\`${short}\``)).pop()
  let label: JudgeState['label'] = null
  if (judged) label = judged.body.includes('人間レビューが必要') ? 'needs' : 'skip'
  const botApproved = pr.reviews.some((r) => r.state === 'APPROVED' && r.author.login.includes('review-bot') && (!r.commit || r.commit.oid === pr.headRefOid))
  const checks = pr.statusCheckRollup
  const pending = checks.some((c) => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')
  const failed = checks.some((c) => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(c.conclusion ?? '') || ['FAILURE', 'ERROR'].includes(c.state ?? ''))
  return { label, botApproved, checksGreen: !pending && !failed && checks.length > 0, pending: pending || !judged }
}

async function waitForJudge(ctx: Ctx, prNumber: number): Promise<{ pr: GhPr; state: JudgeState }> {
  const deadline = Date.now() + ctx.cfg.timeoutsMin.github * 60_000
  await sleep(20_000)
  for (;;) {
    const pr = ctx.gh.pr(prNumber)
    const state = judgeState(ctx, pr)
    // The bot approves a few seconds after the judge comment; give it a moment.
    if (!state.pending && (state.label !== 'skip' || state.botApproved)) return { pr, state }
    if (Date.now() > deadline) return { pr, state }
    await sleep(20_000)
  }
}

export type LoopResult = {
  outcome: RunRecord['outcome']
  reasons: string[]
  reviews: Review[] | null
}

// Shared by new issues and by agent:fix requests: verify, review, fix until clean or capped,
// then hand the PR to the judge and decide whether to merge.
async function qualityLoop(ctx: Ctx, rec: RunRecord, wt: string, branch: string, issue: GhIssue, prNumber: number): Promise<LoopResult> {
  let previous: Review[] | null = null
  let lastReviews: Review[] | null = null
  for (let round = 0; ; round++) {
    log(`#${issue.number} verify (round ${round})`)
    const v = await shell(ctx.cfg.verify, wt, 15 * 60_000)
    rec.verifyRuns.push({ ok: v.ok, durationMs: v.durationMs })
    let reviews: Review[] | null = null
    if (v.ok) {
      log(`#${issue.number} reviews (round ${round})`)
      const r = await runReviews(ctx, wt, issue, rec.runId, round, previous)
      rec.steps.push(...r.costs)
      reviews = r.reviews
      lastReviews = reviews
      ctx.gh.comment(prNumber, renderReviews(reviews, round))
    }
    const changed = G.changedFiles(wt, ctx.cfg.baseBranch)
    const d = decideLoop({ verify: v, reviews, changedFiles: changed, fixRounds: rec.fixRounds, maxFixRounds: ctx.cfg.maxFixRounds })
    log(`#${issue.number} decide: ${d.action} ${d.reasons.join('; ')}`)
    if (d.action === 'ready') return { outcome: 'needs-human-review', reasons: [], reviews: lastReviews }
    if (d.action === 'blocked') return { outcome: 'blocked', reasons: d.reasons, reviews: lastReviews }
    rec.fixRounds++
    const fixPrompt = fill(prompt(ctx, 'fix'), {
      BRANCH: branch,
      ISSUE_NUMBER: issue.number,
      ISSUE_TITLE: issue.title,
      ISSUE_BODY: issue.body,
      ROUND: rec.fixRounds,
      PROBLEMS: problemsText(d, reviews, changed),
      VERIFY_OUTPUT: v.ok ? '(passed)' : v.output.slice(-6000),
      BASE: ctx.cfg.baseBranch,
    })
    log(`#${issue.number} fix round ${rec.fixRounds}`)
    const f = await runClaude<FixOutput>({
      cwd: wt,
      prompt: fixPrompt,
      model: ctx.cfg.models.fix,
      allowedTools: WRITE_TOOLS,
      schema: FIX_SCHEMA,
      budgetUsd: ctx.cfg.budgetsUsd.fix,
      timeoutMs: ctx.cfg.timeoutsMin.fix * 60_000,
      logFile: join(ctx.stateDir, 'logs', rec.runId, `fix-${rec.fixRounds}.jsonl`),
    })
    rec.steps.push({ step: `fix-${rec.fixRounds}`, costUsd: f.costUsd, durationMs: f.durationMs, ok: f.ok })
    commitLeftovers(wt)
    G.push(wt, branch)
    if (f.output) {
      const rows = f.output.responses.map((x) => `| ${x.item.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160)} | ${x.action === 'fixed' ? '直した' : '直していない'} | ${x.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
      ctx.gh.comment(prNumber, [`<!-- factory-fix -->`, `### 修正 ${rec.fixRounds} 回目`, '', f.output.summary, '', '| 指摘 | 対応 | 理由 |', '|---|---|---|', ...rows].join('\n'))
    }
    if (f.output) previous = reviews
  }
}

async function finishWithJudge(ctx: Ctx, rec: RunRecord, prNumber: number, wt: string): Promise<void> {
  tryRun('gh', ['pr', 'ready', String(prNumber), '-R', ctx.cfg.repo])
  log(`#${rec.issue} PR #${prNumber} ready; waiting for checks and the PR Review Judge`)
  const { state } = await waitForJudge(ctx, prNumber)
  const changed = G.changedFiles(wt, ctx.cfg.baseBranch)
  const m = decideMerge({
    changedFiles: changed,
    diffLines: G.diffLines(wt, ctx.cfg.baseBranch),
    humanReviewGlobs: ctx.cfg.humanReviewGlobs,
    maxDiffLines: ctx.cfg.maxDiffLines,
    judgeLabel: state.label,
    botApproved: state.botApproved,
    checksGreen: state.checksGreen,
    mode: ctx.cfg.merge.mode,
    liveGlobs: ctx.cfg.merge.liveGlobs,
  })
  rec.judge = { label: state.label, botApproved: state.botApproved, checksGreen: state.checksGreen }
  rec.merge = m
  if (m.verdict === 'merge' && m.live) {
    const r = tryRun('gh', ['pr', 'merge', String(prNumber), '--squash', '--delete-branch', '-R', ctx.cfg.repo])
    rec.outcome = r.ok ? 'merged' : 'needs-human-review'
    if (!r.ok) rec.reasons.push(`merge failed: ${r.out.slice(0, 300)}`)
  } else if (m.verdict === 'merge') {
    ctx.gh.addLabels(prNumber, [ctx.cfg.labels.mergeOk])
    rec.outcome = 'merge-ok-shadow'
  } else {
    rec.outcome = 'needs-human-review'
  }
}

function newRecord(ctx: Ctx, kind: RunRecord['kind'], issue: number): RunRecord {
  return {
    version: 1,
    runId: `${kind}-${issue}-${Date.now().toString(36)}`,
    kind,
    issue,
    pr: null,
    factorySha: ctx.factorySha,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    outcome: 'error',
    fixRounds: 0,
    verifyRuns: [],
    findings: {},
    acceptance: { total: 0, met: 0 },
    merge: null,
    judge: null,
    reasons: [],
    steps: [],
    models: { ...ctx.cfg.models },
  }
}

function summarizeReviews(rec: RunRecord, reviews: Review[] | null): void {
  if (!reviews) return
  for (const r of reviews) {
    const counts: Record<string, number> = {}
    for (const f of r.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1
    rec.findings[r.perspective] = counts
    if (r.acceptance) rec.acceptance = { total: r.acceptance.length, met: r.acceptance.filter((c) => c.met && c.evidence.trim()).length }
  }
}

export async function processIssue(ctx: Ctx, n: number): Promise<RunRecord | null> {
  const L = ctx.cfg.labels
  const issue = ctx.gh.issue(n)
  const el = eligibility(ctx, issue, openFactoryPrs(ctx))
  if (!el.ok) {
    log(`#${n} skipped: ${el.reason}`)
    return null
  }
  const base = await ensureBaseGreen(ctx)
  if (!base.ok) {
    log(`base branch is red; the factory does not start work on a red main\n${base.output.slice(-3000)}`)
    return null
  }
  const rec = newRecord(ctx, 'issue', n)
  const branch = branchFor(ctx, n)
  const wt = join(ctx.stateDir, 'wt', `issue-${n}`)
  ctx.gh.removeLabels(n, [L.ready])
  ctx.gh.addLabels(n, [L.inProgress])
  ctx.gh.comment(n, `<!-- factory-start -->\nファクトリが着手した（run \`${rec.runId}\`、ファクトリ ${ctx.factorySha}）`)
  let reviews: Review[] | null = null
  try {
    G.addWorktree(ctx.repoDir, wt, branch, `origin/${ctx.cfg.baseBranch}`)
    const inst = await shell(ctx.cfg.install, wt, 10 * 60_000)
    if (!inst.ok) throw new Error(`install failed: ${inst.output.slice(-1500)}`)
    log(`#${n} implement`)
    const impl = await runClaude<ImplementOutput>({
      cwd: wt,
      prompt: fill(prompt(ctx, 'implement'), {
        ISSUE_NUMBER: n,
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
        ISSUE_COMMENTS: trustedComments(ctx, issue.comments),
        BRANCH: branch,
        BASE: ctx.cfg.baseBranch,
      }),
      model: ctx.cfg.models.implement,
      allowedTools: WRITE_TOOLS,
      schema: IMPLEMENT_SCHEMA,
      budgetUsd: ctx.cfg.budgetsUsd.implement,
      timeoutMs: ctx.cfg.timeoutsMin.implement * 60_000,
      logFile: join(ctx.stateDir, 'logs', rec.runId, 'implement.jsonl'),
    })
    rec.steps.push({ step: 'implement', costUsd: impl.costUsd, durationMs: impl.durationMs, ok: impl.ok })
    if (!impl.output) throw new Error(`implement failed: ${impl.error}`)
    commitLeftovers(wt)
    if (impl.output.status === 'blocked' || G.commitsSince(wt, ctx.cfg.baseBranch) === 0) {
      rec.outcome = 'blocked'
      rec.reasons.push(impl.output.blockedReason || 'the agent made no commits')
      ctx.gh.comment(n, `<!-- factory-blocked -->\nファクトリは実装しなかった。Issue を直して \`${L.ready}\` を付け直すと、もう一度拾う\n\n${impl.output.blockedReason || impl.output.summary}`)
      ctx.gh.addLabels(n, [L.blocked])
      return rec
    }
    G.push(wt, branch)
    const verification = impl.output.verification.map((v) => `- ${v.criterion}: ${v.evidence}`).join('\n')
    const body = [`Closes #${n}`, '', '## 変更', '', impl.output.summary, '', '## 実装した AI が確かめたこと', '', verification || '(なし)', '', `<sub>ファクトリ ${ctx.factorySha} / run \`${rec.runId}\`</sub>`].join('\n')
    rec.pr = ctx.gh.createDraftPr(branch, ctx.cfg.baseBranch, issue.title, body)
    log(`#${n} draft PR #${rec.pr}`)
    const loop = await qualityLoop(ctx, rec, wt, branch, issue, rec.pr)
    reviews = loop.reviews
    if (loop.outcome === 'blocked') {
      rec.outcome = 'blocked'
      rec.reasons.push(...loop.reasons)
      ctx.gh.addLabels(n, [L.blocked])
      ctx.gh.comment(rec.pr, `<!-- factory-blocked -->\n修正を ${rec.fixRounds} 回しても残ったので止めた。人間が直すか、Issue を直して \`${L.ready}\` を付け直す\n\n${loop.reasons.map((r) => `- ${r}`).join('\n')}`)
      return rec
    }
    await finishWithJudge(ctx, rec, rec.pr, wt)
    return rec
  } catch (e) {
    rec.outcome = 'error'
    rec.reasons.push((e as Error).message.slice(0, 1500))
    ctx.gh.addLabels(n, [L.blocked])
    return rec
  } finally {
    summarizeReviews(rec, reviews)
    rec.finishedAt = new Date().toISOString()
    ctx.gh.removeLabels(n, [L.inProgress])
    const body = renderRecord(rec)
    ctx.gh.comment(rec.pr ?? n, body)
    if (rec.pr) ctx.gh.comment(n, `ファクトリの実行が終わった: ${rec.outcome}（記録は #${rec.pr}）`)
    mkdirSync(join(ctx.stateDir, 'logs', rec.runId), { recursive: true })
    writeFileSync(join(ctx.stateDir, 'logs', rec.runId, 'record.json'), JSON.stringify(rec, null, 2))
    G.removeWorktree(ctx.repoDir, wt)
    log(`#${n} finished: ${rec.outcome}`)
  }
}

// A human asked for changes on a factory PR by adding agent:fix after commenting.
export async function processFixRequest(ctx: Ctx, prNumber: number): Promise<RunRecord | null> {
  const L = ctx.cfg.labels
  const pr = ctx.gh.pr(prNumber)
  if (!pr.headRefName.startsWith(ctx.cfg.branchPrefix) || pr.state !== 'OPEN') return null
  const actor = ctx.gh.labelActor(prNumber, L.fix)
  if (!actor || !ctx.gh.canWrite(actor)) {
    log(`PR #${prNumber}: ${L.fix} added by ${actor} without write access; ignored`)
    return null
  }
  const issueNumber = Number(pr.body.match(/Closes #(\d+)/)?.[1] ?? 0)
  if (!issueNumber) return null
  const issue = ctx.gh.issue(issueNumber)
  const rec = newRecord(ctx, 'fix', issueNumber)
  rec.pr = prNumber
  ctx.gh.removeLabels(prNumber, [L.fix, L.mergeOk])
  const wt = join(ctx.stateDir, 'wt', `fix-${prNumber}`)
  let reviews: Review[] | null = null
  try {
    G.addWorktreeForRemoteBranch(ctx.repoDir, wt, pr.headRefName)
    const inst = await shell(ctx.cfg.install, wt, 10 * 60_000)
    if (!inst.ok) throw new Error(`install failed: ${inst.output.slice(-1500)}`)
    const lastRun = [...pr.comments].reverse().find((c) => c.body.includes('<!-- factory-run -->'))?.createdAt ?? ''
    const human = pr.comments.filter((c) => c.createdAt > lastRun && !c.body.includes('<!-- ') && ctx.gh.canWrite(c.author.login))
    const inline = JSON.parse(run('gh', ['api', `repos/${ctx.cfg.repo}/pulls/${prNumber}/comments`])) as { user: { login: string }; body: string; path: string; line: number | null; created_at: string }[]
    const inlineNew = inline.filter((c) => c.created_at > lastRun && ctx.gh.canWrite(c.user.login))
    const problems = [
      ...human.map((c) => `- (comment by ${c.author.login}) ${c.body}`),
      ...inlineNew.map((c) => `- (review comment by ${c.user.login} on ${c.path}:${c.line ?? ''}) ${c.body}`),
    ].join('\n')
    if (!problems) {
      ctx.gh.comment(prNumber, `\`${L.fix}\` が付いたが、前回の実行より後の人間のコメントが見つからなかった。直してほしい点をコメントしてから付け直す`)
      rec.outcome = 'blocked'
      return rec
    }
    rec.fixRounds = 0
    const f = await runClaude<FixOutput>({
      cwd: wt,
      prompt: fill(prompt(ctx, 'fix'), {
        BRANCH: pr.headRefName, ISSUE_NUMBER: issueNumber, ISSUE_TITLE: issue.title, ISSUE_BODY: issue.body,
        ROUND: 'human', PROBLEMS: problems, VERIFY_OUTPUT: '(not run yet)', BASE: ctx.cfg.baseBranch,
      }),
      model: ctx.cfg.models.fix,
      allowedTools: WRITE_TOOLS,
      schema: FIX_SCHEMA,
      budgetUsd: ctx.cfg.budgetsUsd.fix,
      timeoutMs: ctx.cfg.timeoutsMin.fix * 60_000,
      logFile: join(ctx.stateDir, 'logs', rec.runId, 'fix-human.jsonl'),
    })
    rec.steps.push({ step: 'fix-human', costUsd: f.costUsd, durationMs: f.durationMs, ok: f.ok })
    commitLeftovers(wt)
    G.push(wt, pr.headRefName)
    const loop = await qualityLoop(ctx, rec, wt, pr.headRefName, issue, prNumber)
    reviews = loop.reviews
    if (loop.outcome === 'blocked') {
      rec.outcome = 'blocked'
      rec.reasons.push(...loop.reasons)
      ctx.gh.addLabels(issueNumber, [L.blocked])
      return rec
    }
    await finishWithJudge(ctx, rec, prNumber, wt)
    return rec
  } catch (e) {
    rec.outcome = 'error'
    rec.reasons.push((e as Error).message.slice(0, 1500))
    return rec
  } finally {
    summarizeReviews(rec, reviews)
    rec.finishedAt = new Date().toISOString()
    ctx.gh.comment(prNumber, renderRecord(rec))
    mkdirSync(join(ctx.stateDir, 'logs', rec.runId), { recursive: true })
    writeFileSync(join(ctx.stateDir, 'logs', rec.runId, 'record.json'), JSON.stringify(rec, null, 2))
    G.removeWorktree(ctx.repoDir, wt)
  }
}
