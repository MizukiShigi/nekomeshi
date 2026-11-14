import { existsSync } from 'node:fs'
import { run, tryRun } from './proc.ts'

export function git(args: string[], cwd: string): string {
  return run('git', args, { cwd })
}

export function fetch(repoDir: string): void {
  git(['fetch', '--quiet', '--prune', 'origin'], repoDir)
}

// Prompts and rules are read from the base branch, not the working tree, so a PR
// branch cannot loosen the rules that judge it.
export function readFromBase(repoDir: string, base: string, path: string): string {
  return git(['show', `origin/${base}:${path}`], repoDir)
}

export function baseSha(repoDir: string, base: string): string {
  return git(['rev-parse', `origin/${base}`], repoDir).trim()
}

export function addWorktree(repoDir: string, dir: string, branch: string, startPoint: string): void {
  if (existsSync(dir)) removeWorktree(repoDir, dir)
  tryRun('git', ['branch', '-D', branch], { cwd: repoDir })
  git(['worktree', 'add', '--quiet', '-b', branch, dir, startPoint], repoDir)
}

export function addWorktreeForRemoteBranch(repoDir: string, dir: string, branch: string): void {
  if (existsSync(dir)) removeWorktree(repoDir, dir)
  tryRun('git', ['branch', '-D', branch], { cwd: repoDir })
  git(['worktree', 'add', '--quiet', '-b', branch, dir, `origin/${branch}`], repoDir)
}

export function removeWorktree(repoDir: string, dir: string): void {
  tryRun('git', ['worktree', 'remove', '--force', dir], { cwd: repoDir })
  tryRun('git', ['worktree', 'prune'], { cwd: repoDir })
}

export function headSha(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd).trim()
}

export function commitsSince(cwd: string, base: string): number {
  return Number(git(['rev-list', '--count', `origin/${base}..HEAD`], cwd).trim())
}

export function changedFiles(cwd: string, base: string): string[] {
  return git(['diff', '--name-only', `origin/${base}...HEAD`], cwd).split('\n').filter(Boolean)
}

export function diffText(cwd: string, base: string): string {
  return git(['diff', `origin/${base}...HEAD`], cwd)
}

export function diffLines(cwd: string, base: string): number {
  return git(['diff', '--numstat', `origin/${base}...HEAD`], cwd)
    .split('\n')
    .filter(Boolean)
    .reduce((sum, l) => {
      const [a, d] = l.split('\t')
      return sum + (Number(a) || 0) + (Number(d) || 0)
    }, 0)
}

export function isDirty(cwd: string): boolean {
  return git(['status', '--porcelain'], cwd).trim().length > 0
}

export function push(cwd: string, branch: string): void {
  git(['push', '--quiet', '--force-with-lease', '-u', 'origin', branch], cwd)
}
