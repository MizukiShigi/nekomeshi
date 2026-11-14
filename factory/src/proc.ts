import { execFileSync, spawn } from 'node:child_process'

export function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): string {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export function tryRun(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): { ok: boolean; out: string } {
  try {
    return { ok: true, out: run(cmd, args, opts) }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string }
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message }
  }
}

export type ShellResult = { ok: boolean; output: string; durationMs: number }

// Verify output is fed back to agents, so keep the tail where the failures are.
export function shell(command: string, cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<ShellResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], { cwd, env })
    let out = ''
    const onData = (d: Buffer) => {
      out += d.toString()
      if (out.length > 400_000) out = out.slice(-200_000)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const timer = setTimeout(() => {
      out += `\n[factory] timed out after ${timeoutMs}ms`
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output: out.slice(-12_000), durationMs: Date.now() - started })
    })
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
