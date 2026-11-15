import type { FactoryConfig } from './config.ts'
import { run } from './proc.ts'

// With an API key in the environment, Claude Code quietly prefers it over the claude.ai
// login, so billing used to depend on which shell the runner was started from. The key is
// now named in config and checked before any agent runs.
export function requireApiKey(cfg: FactoryConfig): string {
  const name = cfg.auth.apiKeyEnv
  const key = process.env[name]
  if (!key) {
    throw new Error(`${name} is not set. The factory bills Claude to the API key named by auth.apiKeyEnv in factory/config.json.`)
  }
  process.env.ANTHROPIC_API_KEY = key
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  const status = JSON.parse(run('claude', ['auth', 'status'])) as { apiKeySource?: string }
  if (status.apiKeySource !== 'ANTHROPIC_API_KEY') {
    throw new Error(`claude would not bill to ${name} (apiKeySource: ${status.apiKeySource ?? 'none'})`)
  }
  return `api-key:${name}`
}
