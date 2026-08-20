import * as pty from 'node-pty'
import type { Logger } from '../logger'

const BUFFER_CAP = 128 * 1024

/**
 * Owns node-pty processes, one per session id.
 *
 * Output is buffered until the renderer attaches its terminal view
 * (attach() returns the buffer), so output produced before the UI is
 * ready — e.g. during session restore at app start — is not lost.
 */
export class PtyManager {
  private readonly procs = new Map<string, pty.IPty>()
  private readonly buffers = new Map<string, string>()
  private readonly attached = new Set<string>()

  constructor(
    private readonly logger: Logger,
    private readonly forward: (id: string, data: string) => void
  ) {}

  /** Spawn a PTY. Throws with a descriptive error when spawn fails. */
  create(
    id: string,
    file: string,
    args: string[],
    cwd: string,
    onExit: (exitCode: number) => void
  ): void {
    this.kill(id)
    this.buffers.set(id, '')
    let proc: pty.IPty
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env: process.env as Record<string, string>,
        useConpty: true
      })
    } catch (err) {
      this.logger.error(`PTY Spawn ${id}`, err)
      throw new Error(`Failed to start ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.procs.set(id, proc)
    proc.onData((data) => this.dispatch(id, data))
    proc.onExit(({ exitCode }) => {
      this.procs.delete(id)
      this.logger.log('PTY Exit', `${id} code=${exitCode}`)
      onExit(exitCode)
    })
    this.logger.log('PTY Spawn', `${id} pid=${proc.pid} ${file} ${args.join(' ')} @ ${cwd}`)
  }

  private dispatch(id: string, data: string): void {
    if (this.attached.has(id)) {
      this.forward(id, data)
      return
    }
    const prev = this.buffers.get(id) ?? ''
    let next = prev + data
    if (next.length > BUFFER_CAP) {
      next = next.slice(next.length - BUFFER_CAP)
      const nl = next.indexOf('\n')
      if (nl > 0) next = next.slice(nl + 1)
    }
    this.buffers.set(id, next)
  }

  /** Mark the terminal view attached and return everything buffered so far. */
  attach(id: string): string {
    this.attached.add(id)
    const buffered = this.buffers.get(id) ?? ''
    this.buffers.delete(id)
    return buffered
  }

  write(id: string, data: string): void {
    try {
      this.procs.get(id)?.write(data)
    } catch (err) {
      this.logger.error(`PTY Write ${id}`, err)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.procs.get(id)?.resize(cols, rows)
    } catch {
      // resize races with exit; ignore
    }
  }

  kill(id: string): void {
    const proc = this.procs.get(id)
    this.procs.delete(id)
    this.buffers.delete(id)
    this.attached.delete(id)
    if (proc) {
      try {
        proc.kill()
      } catch {
        // already dead
      }
    }
  }

  /** Keep the renderer attachment across a respawn so live output keeps flowing. */
  respawn(
    id: string,
    file: string,
    args: string[],
    cwd: string,
    onExit: (exitCode: number) => void
  ): void {
    const wasAttached = this.attached.has(id)
    this.kill(id)
    this.create(id, file, args, cwd, onExit)
    if (wasAttached) this.attached.add(id)
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id)
  }

  /** OS PID of the session's shell process (undefined once exited). */
  pid(id: string): number | undefined {
    return this.procs.get(id)?.pid
  }
}
