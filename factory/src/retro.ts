import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WRITE_TOOLS, runClaude } from './claude.ts'
import * as G from './git.ts'
import { collect, summarize } from './metrics.ts'
import { log, type Ctx } from './pipeline.ts'
import { shell } from './proc.ts'
import { totalCost } from './record.ts'

const RETRO_SCHEMA = {
  type: 'object',
  properties: {
    changed: { type: 'boolean' },
    summary: { type: 'string', description: 'Japanese: what you changed and which evidence each change answers' },
    notChanged: { type: 'string', description: 'Japanese: patterns you saw but left alone, and why' },
  },
  required: ['changed', 'summary', 'notChanged'],
}

// The retro turns what went wrong into small edits of the factory's own instructions.
// It always lands as a PR under factory/**, which the judge routes to a human: the
// factory may propose how to improve itself but never adopts the change alone.
export async function retro(ctx: Ctx, sinceIso: string): Promise<void> {
  const { records, prs } = collect(ctx)
  const recent = records.filter((r) => r.startedAt >= sinceIso)
  if (recent.length === 0) {
    log(`no runs since ${sinceIso}`)
    return
  }
  const humanNotes: string[] = []
  for (const p of prs) {
    const pr = ctx.gh.pr(p.number)
    for (const c of pr.comments) {
      if (c.createdAt >= sinceIso && !c.body.includes('<!-- ') && ctx.gh.canWrite(c.author.login)) humanNotes.push(`PR #${p.number} ${c.author.login}: ${c.body}`)
    }
  }
  const evidence = [
    `# Factory runs since ${sinceIso}`,
    '',
    summarize(recent, prs),
    '',
    '# Each run',
    ...recent.map((r) => `- ${r.runId} issue #${r.issue} PR #${r.pr ?? '-'}: ${r.outcome}, fix rounds ${r.fixRounds}, $${totalCost(r).toFixed(2)}; reasons: ${[...r.reasons, ...(r.merge?.reasons ?? [])].join(' / ') || '-'}`),
    '',
    '# Human comments on factory PRs',
    ...(humanNotes.length ? humanNotes : ['(none)']),
  ].join('\n')
  const date = new Date().toISOString().slice(0, 10)
  const branch = `${ctx.cfg.branchPrefix}retro-${date}`
  const wt = join(ctx.stateDir, 'wt', `retro-${date}`)
  G.addWorktree(ctx.repoDir, wt, branch, `origin/${ctx.cfg.baseBranch}`)
  try {
    mkdirSync(join(wt, 'docs/factory/retro'), { recursive: true })
    writeFileSync(join(wt, `docs/factory/retro/${date}.md`), `# ふりかえりの材料 ${date}\n\n${evidence}\n`)
    const prompt = [
      'You run the weekly retrospective of a software factory. The evidence below comes from GitHub: run records, outcomes and human comments.',
      '',
      evidence,
      '',
      '# What to do',
      '- Find patterns that cost a fix round, a block, or a human correction. One-off noise is not a pattern.',
      '- For each pattern, make the smallest change that would have prevented it, in one of: `factory/prompts/*.md`, `CLAUDE.md` (project rules), or a new eval case under `factory/evals/`.',
      '- Do not loosen any rule in `factory/config.json` (human-review paths, caps, merge mode). You may propose that in `notChanged` for a human to decide.',
      '- Keep `docs/factory/retro/' + date + '.md` and append a section 「変えたこと」 listing each change and the evidence it answers.',
      '- If nothing deserves a change, change nothing and say so.',
      '- Commit your changes. Do not push.',
    ].join('\n')
    const r = await runClaude<{ changed: boolean; summary: string; notChanged: string }>({
      cwd: wt,
      prompt,
      model: ctx.cfg.models.retro,
      allowedTools: WRITE_TOOLS,
      schema: RETRO_SCHEMA,
      budgetUsd: ctx.cfg.budgetsUsd.retro,
      timeoutMs: ctx.cfg.timeoutsMin.retro * 60_000,
      logFile: join(ctx.stateDir, 'logs', `retro-${date}.jsonl`),
    })
    const v = await shell(ctx.cfg.verify, wt, 15 * 60_000)
    if (G.isDirty(wt)) {
      G.git(['add', '-A'], wt)
      G.git(['commit', '-q', '-m', `docs(factory): retro ${date}`], wt)
    }
    G.push(wt, branch)
    const body = [
      `ファクトリのふりかえり（${sinceIso} 以降の ${recent.length} 件）`,
      '',
      '## 変えたこと',
      r.output?.summary ?? `(retro agent failed: ${r.error})`,
      '',
      '## 変えなかったこと',
      r.output?.notChanged ?? '-',
      '',
      `検証: ${v.ok ? 'pnpm verify が通った' : 'pnpm verify が落ちた'}`,
      '',
      'マージの前に、変えたプロンプトで `pnpm factory eval` を回して、前回の結果と比べること',
    ].join('\n')
    const url = ctx.gh.raw(['pr', 'create', '--draft', '--head', branch, '--base', ctx.cfg.baseBranch, '--title', `factory: ふりかえり ${date}`, '--body-file', '-'], body).trim()
    log(`retro PR: ${url}`)
  } finally {
    G.removeWorktree(ctx.repoDir, wt)
  }
}
