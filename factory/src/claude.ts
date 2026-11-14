import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type ClaudeResult<T> = {
  ok: boolean
  output: T | null
  costUsd: number
  turns: number
  durationMs: number
  error: string | null
  logFile: string
}

export type ClaudeRun = {
  cwd: string
  prompt: string
  model: string
  allowedTools: string[]
  schema: object
  budgetUsd: number
  timeoutMs: number
  logFile: string
}

// Tools an agent may use while changing code. No network and no git push: the runner
// pushes, so a confused or injected agent cannot publish anything by itself.
export const WRITE_TOOLS = [
  'Read', 'Glob', 'Grep', 'Edit', 'Write', 'MultiEdit', 'TodoWrite',
  'Bash(pnpm lint:*)', 'Bash(pnpm typecheck:*)', 'Bash(pnpm test:*)', 'Bash(pnpm verify:*)', 'Bash(pnpm exec vitest:*)',
  'Bash(pnpm exec tsc:*)', 'Bash(pnpm exec eslint:*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
  'Bash(ls:*)',
]

export const READ_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(ls:*)']

export function runClaude<T>(o: ClaudeRun): Promise<ClaudeResult<T>> {
  mkdirSync(dirname(o.logFile), { recursive: true })
  const log = createWriteStream(o.logFile)
  const started = Date.now()
  const args = [
    '-p',
    '--model', o.model,
    // Only the repo's own settings: the runner's personal skills, hooks and MCP servers
    // must not leak into factory runs or change their behaviour between machines.
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-budget-usd', String(o.budgetUsd),
    '--json-schema', JSON.stringify(o.schema),
    '--allowedTools', o.allowedTools.join(','),
  ]
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: o.cwd, env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })
    let buf = ''
    let last: Record<string, unknown> | null = null
    child.stdout.on('data', (d: Buffer) => {
      log.write(d)
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line) as Record<string, unknown>
          if (ev.type === 'result') last = ev
        } catch {
          // stream lines that are not JSON are kept in the log only
        }
      }
    })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      log.write(d)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      log.end()
      const r = last as Record<string, unknown> | null
      const output = (r?.structured_output ?? null) as T | null
      const err = r?.is_error ? String(r.result ?? r.subtype) : code !== 0 ? `exit ${code}: ${stderr.slice(-2000)}` : output ? null : 'no structured output'
      resolve({
        ok: !err,
        output,
        costUsd: Number(r?.total_cost_usd ?? 0),
        turns: Number(r?.num_turns ?? 0),
        durationMs: Date.now() - started,
        error: err,
        logFile: o.logFile,
      })
    })
    child.stdin.end(o.prompt)
  })
}

const findingSchema = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    file: { type: 'string', description: 'repo-relative path' },
    line: { type: ['integer', 'null'] },
    title: { type: 'string' },
    detail: { type: 'string' },
    evidence: { type: 'string', description: 'concrete input or steps that trigger the problem; empty if you cannot give one' },
  },
  required: ['severity', 'file', 'line', 'title', 'detail', 'evidence'],
}

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    summary: { type: 'string', description: 'one paragraph in Japanese' },
    findings: { type: 'array', items: findingSchema },
    acceptance: {
      type: 'array',
      description: 'acceptance perspective only: one entry per acceptance criterion of the issue',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string', description: 'test name, file:line or other proof; empty if none' },
        },
        required: ['criterion', 'met', 'evidence'],
      },
    },
  },
  required: ['perspective', 'summary', 'findings'],
}

// The acceptance reviewer must list every criterion; an empty list would read as "nothing to check".
export const ACCEPTANCE_REVIEW_SCHEMA = {
  ...REVIEW_SCHEMA,
  properties: {
    ...REVIEW_SCHEMA.properties,
    acceptance: { ...REVIEW_SCHEMA.properties.acceptance, minItems: 1 },
  },
  required: [...REVIEW_SCHEMA.required, 'acceptance'],
}

export const IMPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string', description: 'what changed, in Japanese, for the PR body' },
    verification: {
      type: 'array',
      items: {
        type: 'object',
        properties: { criterion: { type: 'string' }, evidence: { type: 'string' } },
        required: ['criterion', 'evidence'],
      },
    },
    blockedReason: { type: 'string', description: 'when blocked: what is missing, as questions in Japanese' },
  },
  required: ['status', 'summary', 'verification', 'blockedReason'],
}

export const FIX_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    responses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          action: { type: 'string', enum: ['fixed', 'not_fixed'] },
          reason: { type: 'string' },
        },
        required: ['item', 'action', 'reason'],
      },
    },
  },
  required: ['summary', 'responses'],
}

export type ImplementOutput = {
  status: 'done' | 'blocked'
  summary: string
  verification: { criterion: string; evidence: string }[]
  blockedReason: string
}

export type FixOutput = {
  summary: string
  responses: { item: string; action: 'fixed' | 'not_fixed'; reason: string }[]
}
