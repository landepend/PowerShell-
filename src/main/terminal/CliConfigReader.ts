import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { CliKind } from '../../shared/types/session'
import type { Logger } from '../logger'

export interface CliModelOption {
  /** Value passed to the CLI (e.g. kimi's -m alias, claude's --model name). */
  value: string
  /** Display text, e.g. "K3 (1M)" or "sonnet". */
  label: string
  /** Thinking effort levels the model accepts (kimi k3 family: low/high/max). */
  efforts?: string[]
  defaultEffort?: string
}

export interface CliOptions {
  models: CliModelOption[]
}

/**
 * Reads model choices for the create-project dialog from each CLI's own local
 * configuration, so the user picks instead of typing. Every failure resolves
 * to an empty list — the dialog then offers only "默认".
 */

function formatContext(tokens: unknown): string {
  if (typeof tokens !== 'number' || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

/** `kimi provider list --json` returns the raw providers and models tables.
 *  Runs through cmd.exe because the npm-installed kimi is a .cmd shim. */
function kimiModels(logger: Logger): Promise<CliModelOption[]> {
  return new Promise((resolve) => {
    execFile(
      'cmd.exe',
      ['/c', 'kimi', 'provider', 'list', '--json'],
      { timeout: 8000 },
      (err, stdout) => {
        if (err) {
          logger.error('kimi provider list', err)
          resolve(kimiModelsFromConfig())
          return
        }
      try {
        const parsed = JSON.parse(stdout) as {
          models?: Record<
            string,
            {
              displayName?: string
              maxContextSize?: number
              supportEfforts?: string[]
              defaultEffort?: string
            }
          >
        }
        const models = Object.entries(parsed.models ?? {}).map(([alias, m]) => {
          const ctx = formatContext(m.maxContextSize)
          const name = m.displayName || alias
          const option: CliModelOption = {
            value: alias,
            label: ctx ? `${name} (${ctx})` : name
          }
          if (Array.isArray(m.supportEfforts)) {
            const efforts = m.supportEfforts.filter((e): e is string => typeof e === 'string')
            if (efforts.length > 0) option.efforts = efforts
          }
          if (typeof m.defaultEffort === 'string' && m.defaultEffort) {
            option.defaultEffort = m.defaultEffort
          }
          return option
        })
        resolve(models.length > 0 ? models : kimiModelsFromConfig())
      } catch {
        resolve(kimiModelsFromConfig())
      }
    })
  })
}

/** Fallback: scan [models."<alias>"] headers in ~/.kimi-code/config.toml. */
function kimiModelsFromConfig(): CliModelOption[] {
  try {
    const file = join(homedir(), '.kimi-code', 'config.toml')
    if (!existsSync(file)) return []
    const text = readFileSync(file, 'utf8')
    const out: CliModelOption[] = []
    for (const m of text.matchAll(/^\[models\."?([^"\]]+?)"?(?:\.overrides)?\]/gm)) {
      const alias = m[1]
      if (!out.some((o) => o.value === alias)) out.push({ value: alias, label: alias })
    }
    return out
  } catch {
    return []
  }
}

/** Claude Code has no local model registry; offer its built-in aliases. */
function claudeModels(): CliModelOption[] {
  return [
    { value: 'opus', label: 'opus' },
    { value: 'sonnet', label: 'sonnet' },
    { value: 'haiku', label: 'haiku' }
  ]
}

/** Codex: show the model currently configured in ~/.codex/config.toml. */
function codexModels(): CliModelOption[] {
  try {
    const file = join(homedir(), '.codex', 'config.toml')
    if (!existsSync(file)) return []
    const text = readFileSync(file, 'utf8')
    const m = /^model\s*=\s*"([^"]+)"/m.exec(text)
    return m ? [{ value: m[1], label: `${m[1]}（当前配置）` }] : []
  } catch {
    return []
  }
}

export async function getCliOptions(cli: CliKind, logger: Logger): Promise<CliOptions> {
  switch (cli) {
    case 'kimi':
      return { models: await kimiModels(logger) }
    case 'claude':
      return { models: claudeModels() }
    case 'codex':
      return { models: codexModels() }
  }
}
