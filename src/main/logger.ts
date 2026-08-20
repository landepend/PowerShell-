import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

/** Minimal append-only file logger. Never logs terminal input/output content. */
export class Logger {
  private readonly file: string

  constructor(file: string) {
    this.file = file
    mkdirSync(dirname(file), { recursive: true })
  }

  log(event: string, detail = ''): void {
    const line = `[${new Date().toISOString()}] ${event}${detail ? ' | ' + detail : ''}\n`
    try {
      appendFileSync(this.file, line)
    } catch {
      // logging must never break the app
    }
    if (process.env.PSS_SMOKE) process.stdout.write(line)
  }

  error(event: string, err: unknown): void {
    const msg = err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err)
    this.log(`ERROR ${event}`, msg.replace(/\s*\n\s*/g, ' | '))
  }
}
