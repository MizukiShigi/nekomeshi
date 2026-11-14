// A run record is posted as a PR or issue comment, so the run history lives in GitHub
// and survives the machine that ran it. Metrics and retros read these comments back.
export const RUN_MARKER = '<!-- factory-run -->'

export type StepCost = { step: string; costUsd: number; durationMs: number; ok: boolean }

export type RunRecord = {
  version: 1
  runId: string
  kind: 'issue' | 'fix'
  issue: number
  pr: number | null
  factorySha: string
  startedAt: string
  finishedAt: string
  outcome: 'merged' | 'merge-ok-shadow' | 'needs-human-review' | 'blocked' | 'error'
  fixRounds: number
  verifyRuns: { ok: boolean; durationMs: number }[]
  findings: Record<string, Record<string, number>>
  acceptance: { total: number; met: number }
  merge: { verdict: string; live: boolean; reasons: string[] } | null
  judge: { label: string | null; botApproved: boolean; checksGreen: boolean } | null
  reasons: string[]
  steps: StepCost[]
  models: Record<string, string>
}

export function totalCost(r: RunRecord): number {
  return r.steps.reduce((s, x) => s + x.costUsd, 0)
}

const OUTCOME_JA: Record<RunRecord['outcome'], string> = {
  merged: 'マージした',
  'merge-ok-shadow': '自動マージしてよいと判定した（並走中なのでマージはしていない）',
  'needs-human-review': '人間のレビューに回した',
  blocked: '止めた（agent:blocked）',
  error: 'ランナーの異常で止まった',
}

export function renderRecord(r: RunRecord): string {
  const mins = ((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 60000).toFixed(1)
  const lines = [
    RUN_MARKER,
    `### ファクトリの実行記録 \`${r.runId}\``,
    '',
    `- 結果: ${OUTCOME_JA[r.outcome]}`,
    `- 修正の回数: ${r.fixRounds}`,
    `- 受け入れ条件: ${r.acceptance.met}/${r.acceptance.total} を満たした`,
    `- 時間: ${mins} 分 / 費用: $${totalCost(r).toFixed(2)}`,
  ]
  if (r.reasons.length) lines.push(`- 理由: ${r.reasons.join(' / ')}`)
  if (r.merge?.reasons.length) lines.push(`- 人間に回した理由: ${r.merge.reasons.join(' / ')}`)
  lines.push('', '<details><summary>記録（JSON）</summary>', '', '```json', JSON.stringify(r, null, 2), '```', '', '</details>')
  return lines.join('\n')
}

export function parseRecords(commentBodies: string[]): RunRecord[] {
  const out: RunRecord[] = []
  for (const body of commentBodies) {
    if (!body.includes(RUN_MARKER)) continue
    const m = body.match(/```json\n([\s\S]*?)\n```/)
    if (!m) continue
    try {
      const r = JSON.parse(m[1]) as RunRecord
      if (r.version === 1) out.push(r)
    } catch {
      // a hand-edited comment is skipped rather than failing the whole report
    }
  }
  return out
}
