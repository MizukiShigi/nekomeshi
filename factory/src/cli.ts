import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderEvals, runEvals } from './evals.ts'
import { collect, summarize } from './metrics.ts'
import { loadCtx, log, openFactoryPrs, processFixRequest, processIssue, type Ctx } from './pipeline.ts'
import { sleep } from './proc.ts'
import { retro } from './retro.ts'

const USAGE = `usage: pnpm factory <command>
  run [--watch MIN]   process every eligible ready-for-agent issue and agent:fix PR, once or every MIN minutes
  issue <n>           process one issue
  fix <pr>            process an agent:fix request on a factory PR
  metrics             print run metrics from GitHub
  eval [ids...]       run evals with the prompts in this working tree
  retro [--since ISO] open a retro PR that proposes changes to the factory
  labels              create the labels the factory uses`

function lock(ctx: Ctx): () => void {
  const f = join(ctx.stateDir, 'runner.lock')
  if (existsSync(f)) throw new Error(`${f} exists: another runner is active (delete it if it is stale)`)
  writeFileSync(f, String(process.pid))
  return () => rmSync(f, { force: true })
}

async function runOnce(ctx: Ctx): Promise<void> {
  const L = ctx.cfg.labels
  for (const pr of openFactoryPrs(ctx).filter((p) => p.labels.some((l) => l.name === L.fix))) {
    await processFixRequest(ctx, pr.number)
  }
  const issues = ctx.gh.listIssues(L.ready).sort((a, b) => a.number - b.number)
  if (issues.length === 0) log('no ready issues')
  for (const i of issues) await processIssue(ctx, i.number)
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const repoDir = resolve(process.env.FACTORY_REPO_DIR ?? process.cwd())
  if (!cmd || cmd === 'help') {
    console.log(USAGE)
    return
  }
  if (cmd === 'eval') {
    const ctx = loadCtx(repoDir, { local: true })
    const results = await runEvals(ctx, join(repoDir, 'factory/evals'), rest)
    console.log(renderEvals(results))
    return
  }
  const ctx = loadCtx(repoDir)
  if (cmd === 'labels') {
    const L = ctx.cfg.labels
    ctx.gh.ensureLabel(L.ready, '1D76DB', 'ファクトリに任せてよい（人間が付ける）')
    ctx.gh.ensureLabel(L.inProgress, 'FBCA04', 'ファクトリが作業中')
    ctx.gh.ensureLabel(L.blocked, 'D93F0B', 'ファクトリが止まった。理由はコメント')
    ctx.gh.ensureLabel(L.fix, 'C5DEF5', 'ファクトリに直させる（人間が PR に付ける）')
    ctx.gh.ensureLabel(L.mergeOk, '0E8A16', '並走中: ファクトリは自動マージしてよいと判定した')
    return
  }
  if (cmd === 'metrics') {
    const { records, prs } = collect(ctx)
    console.log(summarize(records, prs))
    return
  }
  const unlock = lock(ctx)
  try {
    if (cmd === 'issue') await processIssue(ctx, Number(rest[0]))
    else if (cmd === 'fix') await processFixRequest(ctx, Number(rest[0]))
    else if (cmd === 'retro') {
      const i = rest.indexOf('--since')
      await retro(ctx, i >= 0 ? rest[i + 1] : new Date(Date.now() - 7 * 86400_000).toISOString())
    } else if (cmd === 'run') {
      const i = rest.indexOf('--watch')
      const every = i >= 0 ? Number(rest[i + 1]) : 0
      for (;;) {
        await runOnce(loadCtx(repoDir))
        if (!every) break
        await sleep(every * 60_000)
      }
    } else {
      console.log(USAGE)
      process.exitCode = 1
    }
  } finally {
    unlock()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
