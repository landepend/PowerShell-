import { spawn } from 'child_process'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { net } from 'electron'
import type { Logger } from '../logger'

export interface UsageLimit {
  label: string
  used: number
  limit: number
  resetHint?: string
}

export type KimiUsageResult =
  | { kind: 'ok'; summary: UsageLimit | null; limits: UsageLimit[]; extraUsage: unknown }
  | { kind: 'error'; message: string }

/**
 * Reads Kimi quota via the local `kimi web` API (/api/v1/oauth/usage).
 * Reuses an already-running kimi server when one is registered and alive;
 * otherwise spawns a temporary one and kills it right after the query.
 * net.fetch goes through Chromium's stack, so the system proxy applies.
 */

const HOME = join(homedir(), '.kimi-code')
const USAGE_PATH = '/api/v1/oauth/usage'
const REQUEST_TIMEOUT = 8000
const SPAWN_TIMEOUT = 15000

function kimiHome(): string {
  return process.env.KIMI_CODE_HOME || HOME
}

function readServerToken(): string | null {
  try {
    const file = join(kimiHome(), 'server.token')
    if (!existsSync(file)) return null
    const token = readFileSync(file, 'utf8').trim()
    return token || null
  } catch {
    return null
  }
}

/** Registered servers; liveness is verified by an actual request. */
function registeredInstances(): { host: string; port: number }[] {
  try {
    const dir = join(kimiHome(), 'server', 'instances')
    const out: { host: string; port: number }[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        host?: string
        port?: number
      }
      if (j.host && typeof j.port === 'number') out.push({ host: j.host, port: j.port })
    }
    return out
  } catch {
    return []
  }
}

interface UsagePayload {
  code?: number
  data?: {
    kind?: string
    summary?: { label?: string; used?: number; limit?: number; reset_hint?: string }
    limits?: { label?: string; used?: number; limit?: number; reset_hint?: string }[]
    extra_usage?: unknown
  }
}

function toLimit(raw?: { label?: string; used?: number; limit?: number; reset_hint?: string }): UsageLimit | null {
  if (!raw || typeof raw.used !== 'number' || typeof raw.limit !== 'number') return null
  return { label: raw.label ?? '', used: raw.used, limit: raw.limit, resetHint: raw.reset_hint }
}

async function queryUsage(base: string, token: string): Promise<KimiUsageResult | null> {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    const res = await net.fetch(`${base}${USAGE_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    })
    clearTimeout(t)
    if (!res.ok) return null
    const body = (await res.json()) as UsagePayload
    if (body.code !== 0 || !body.data || body.data.kind !== 'ok') return null
    const limits = (body.data.limits ?? []).map(toLimit).filter((l): l is UsageLimit => l !== null)
    return {
      kind: 'ok',
      summary: toLimit(body.data.summary),
      limits,
      extraUsage: body.data.extra_usage ?? null
    }
  } catch {
    return null
  }
}

/** Spawn a throwaway `kimi web`, grab host+token from its banner, query, kill. */
function queryViaTempServer(logger: Logger): Promise<KimiUsageResult> {
  return new Promise((resolve) => {
    const exe = join(kimiHome(), 'bin', 'kimi.exe')
    if (!existsSync(exe)) {
      resolve({ kind: 'error', message: '未找到 kimi 可执行文件' })
      return
    }
    const proc = spawn(exe, ['web', '--no-open'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    let done = false
    const finish = (r: KimiUsageResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        proc.kill()
      } catch {
        // already gone
      }
      resolve(r)
    }
    const timer = setTimeout(
      () => finish({ kind: 'error', message: 'kimi web 启动超时' }),
      SPAWN_TIMEOUT
    )
    proc.on('error', (err) => finish({ kind: 'error', message: err.message }))
    proc.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      const host = /Local:\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(output)
      const token = /Token:\s+(\S+)/.exec(output)
      if (!host || !token) return
      void queryUsage(`http://127.0.0.1:${host[1]}`, token[1]).then((r) => {
        finish(r ?? { kind: 'error', message: '额度查询失败' })
      })
    })
    proc.on('exit', () => finish({ kind: 'error', message: 'kimi web 提前退出' }))
    logger.log('Kimi Usage', 'spawned temp kimi web')
  })
}

export async function getKimiUsage(logger: Logger): Promise<KimiUsageResult> {
  const token = readServerToken()
  if (token) {
    for (const inst of registeredInstances()) {
      const r = await queryUsage(`http://${inst.host}:${inst.port}`, token)
      if (r) return r
    }
  }
  return queryViaTempServer(logger)
}
