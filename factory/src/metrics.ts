import type { Ctx } from './pipeline.ts'
import { parseRecords, totalCost, type RunRecord } from './record.ts'

export type PrFate = { number: number; mergeOk: boolean; mergedAt: string | null; state: string; humanFix: boolean }

export function collect(ctx: Ctx): { records: RunRecord[]; prs: PrFate[] } {
  const prs = ctx.gh.listPrs('all').filter((p) => p.headRefName.startsWith(ctx.cfg.branchPrefix))
  const issues = JSON.parse(ctx.gh.raw(['issue', 'list', '--state', 'all', '--limit', '200', '--json', 'number,comments'])) as { number: number; comments: { body: string }[] }[]
  const bodies = [...prs.flatMap((p) => p.comments.map((c) => c.body)), ...issues.flatMap((i) => i.comments.map((c) => c.body))]
  const seen = new Set<string>()
  const records = parseRecords(bodies).filter((r) => (seen.has(r.runId) ? false : (seen.add(r.runId), true)))
  const fates = prs.map((p) => ({
    number: p.number,
    mergeOk: p.labels.some((l) => l.name === ctx.cfg.labels.mergeOk),
    mergedAt: p.mergedAt,
    state: p.state,
    humanFix: records.some((r) => r.kind === 'fix' && r.pr === p.number),
  }))
  return { records, prs: fates }
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function pct(a: number, b: number): string {
  return b ? `${Math.round((a / b) * 100)}%（${a}/${b}）` : '-'
}

export function summarize(records: RunRecord[], prs: PrFate[]): string {
  const issueRuns = records.filter((r) => r.kind === 'issue')
  const by = (o: RunRecord['outcome']) => issueRuns.filter((r) => r.outcome === o).length
  const reachedGate = issueRuns.filter((r) => ['merged', 'merge-ok-shadow', 'needs-human-review'].includes(r.outcome)).length
  const firstPass = issueRuns.filter((r) => r.outcome !== 'blocked' && r.outcome !== 'error' && r.fixRounds === 0).length
  const cost = records.reduce((s, r) => s + totalCost(r), 0)
  const minutes = issueRuns.map((r) => (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 60000)
  const shadow = prs.filter((p) => p.mergeOk)
  const shadowAgreed = shadow.filter((p) => p.mergedAt && !p.humanFix).length
  const shadowDisagreed = shadow.filter((p) => (p.state === 'CLOSED' && !p.mergedAt) || p.humanFix).length
  const findings: Record<string, Record<string, number>> = {}
  for (const r of records) {
    for (const [persp, counts] of Object.entries(r.findings)) {
      findings[persp] ??= {}
      for (const [sev, n] of Object.entries(counts)) findings[persp][sev] = (findings[persp][sev] ?? 0) + n
    }
  }
  const lines = [
    '| 指標 | 値 |',
    '|---|---|',
    `| Issue の実行数 | ${issueRuns.length} |`,
    `| 人間の関門かマージまで進んだ割合 | ${pct(reachedGate, issueRuns.length)} |`,
    `| 修正なしで通った割合 | ${pct(firstPass, issueRuns.length)} |`,
    `| マージ / 並走で自動マージ可 / 人間に回した / 止めた / 異常 | ${by('merged')} / ${by('merge-ok-shadow')} / ${by('needs-human-review')} / ${by('blocked')} / ${by('error')} |`,
    `| 修正の回数（平均） | ${issueRuns.length ? (issueRuns.reduce((s, r) => s + r.fixRounds, 0) / issueRuns.length).toFixed(2) : '-'} |`,
    `| 人間が agent:fix で戻した回数 | ${records.filter((r) => r.kind === 'fix').length} |`,
    `| 時間の中央値（分） | ${median(minutes).toFixed(1)} |`,
    `| 費用の合計 / 1件あたり | $${cost.toFixed(2)} / $${issueRuns.length ? (cost / issueRuns.length).toFixed(2) : '-'} |`,
    `| 並走: 自動マージ可と判定した PR | ${shadow.length}（人間がそのままマージ ${shadowAgreed}、戻したか閉じた ${shadowDisagreed}、未決 ${shadow.length - shadowAgreed - shadowDisagreed}） |`,
    '',
    '| 観点 | critical | high | medium | low |',
    '|---|---|---|---|---|',
    ...Object.entries(findings).map(([p, c]) => `| ${p} | ${c.critical ?? 0} | ${c.high ?? 0} | ${c.medium ?? 0} | ${c.low ?? 0} |`),
  ]
  return lines.join('\n')
}
