import { run, tryRun } from './proc.ts'

export type GhIssue = {
  number: number
  title: string
  body: string
  state: string
  labels: { name: string }[]
  comments: { author: { login: string }; body: string; createdAt: string }[]
}

export type GhPr = {
  number: number
  title: string
  body: string
  state: string
  isDraft: boolean
  headRefName: string
  headRefOid: string
  url: string
  labels: { name: string }[]
  reviews: { author: { login: string }; state: string; commit?: { oid: string } }[]
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[]
  comments: { author: { login: string }; body: string; createdAt: string }[]
  mergedAt: string | null
  createdAt: string
}

export class Gh {
  readonly repo: string
  constructor(repo: string) {
    this.repo = repo
  }

  raw(args: string[], input?: string): string {
    return run('gh', [...args, '-R', this.repo], { input })
  }

  api<T>(path: string, method = 'GET', fields: Record<string, string> = {}): T {
    const args = ['api', '-X', method, path]
    for (const [k, v] of Object.entries(fields)) args.push('-f', `${k}=${v}`)
    const out = run('gh', args)
    return (out.trim() ? JSON.parse(out) : null) as T
  }

  issue(n: number): GhIssue {
    return JSON.parse(this.raw(['issue', 'view', String(n), '--json', 'number,title,body,state,labels,comments']))
  }

  listIssues(label: string): GhIssue[] {
    return JSON.parse(
      this.raw(['issue', 'list', '--state', 'open', '--label', label, '--limit', '50', '--json', 'number,title,body,state,labels,comments']),
    )
  }

  pr(n: number): GhPr {
    return JSON.parse(
      this.raw([
        'pr', 'view', String(n), '--json',
        'number,title,body,state,isDraft,headRefName,headRefOid,url,labels,reviews,statusCheckRollup,comments,mergedAt,createdAt',
      ]),
    )
  }

  listPrs(state: 'open' | 'all', search?: string): GhPr[] {
    const args = ['pr', 'list', '--state', state, '--limit', '100', '--json', 'number,title,body,state,isDraft,headRefName,headRefOid,url,labels,mergedAt,createdAt,comments']
    if (search) args.push('--search', search)
    return JSON.parse(this.raw(args))
  }

  addLabels(n: number, labels: string[]): void {
    if (labels.length) this.raw(['issue', 'edit', String(n), '--add-label', labels.join(',')])
  }

  removeLabels(n: number, labels: string[]): void {
    for (const l of labels) tryRun('gh', ['issue', 'edit', String(n), '--remove-label', l, '-R', this.repo])
  }

  comment(n: number, body: string): void {
    this.raw(['issue', 'comment', String(n), '--body-file', '-'], body)
  }

  createDraftPr(head: string, base: string, title: string, body: string): number {
    const url = this.raw(['pr', 'create', '--draft', '--head', head, '--base', base, '--title', title, '--body-file', '-'], body).trim()
    return Number(url.split('/').pop())
  }

  // The timeline is the only place that says who added a label; a label on a public
  // repo must come from someone with write access before an agent spends money on it.
  labelActor(n: number, label: string): string | null {
    const jq = `.[] | select(.event == "labeled" and .label.name == ${JSON.stringify(label)}) | .actor.login`
    const lines = run('gh', ['api', '--paginate', `repos/${this.repo}/issues/${n}/events`, '--jq', jq]).split('\n').filter(Boolean)
    return lines.pop() ?? null
  }

  canWrite(login: string): boolean {
    const r = tryRun('gh', ['api', `repos/${this.repo}/collaborators/${login}/permission`, '--jq', '.permission'])
    return r.ok && ['admin', 'maintain', 'write'].includes(r.out.trim())
  }

  ensureLabel(name: string, color: string, description: string): void {
    tryRun('gh', ['label', 'create', name, '--color', color, '--description', description, '-R', this.repo])
  }
}
