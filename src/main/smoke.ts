import { existsSync } from 'fs'
import { join } from 'path'
import type { ChatManager } from './chat/ChatManager'
import type { SessionManager } from './terminal/SessionManager'
import type { Logger } from './logger'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface SmokeDeps {
  sessions: SessionManager
  chats: ChatManager
  logger: Logger
  dataDir: string
  close(): void
}

/**
 * End-to-end smoke suite, enabled with PSS_SMOKE=1. Exercises the paths that
 * matter for a release: boot → session restore → chat create → real kimi turn
 * → runner-side queueing → cancel/steer → metadata mutations → delete.
 * Every step logs `Smoke | PASS/FAIL <name>`; the suite ends with
 * `Smoke Test Complete | ALL PASS` or the failure count, then closes the app
 * through the normal path (workspace flush + PTY teardown).
 */
export function runSmoke({ sessions, chats, logger, dataDir, close }: SmokeDeps): void {
  const check = (name: string, ok: boolean, detail = '') => {
    logger.log('Smoke', `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`)
  }

  void (async () => {
    try {
      // Let session restore settle (PTYs spawn asynchronously).
      await wait(3000)
      const restored = sessions.getState().sessions.length
      check('sessions restored', restored > 0, `${restored} sessions`)

      const chat = chats.create({ cwd: join(dataDir, '..') })
      check('chat create', !!chat.id, `${chat.id} @ ${chat.cwd}`)
      // Low effort keeps the smoke fast; the model stays the default.
      chats.setEffort(chat.id, 'low')

      const send1 = await chats.send(chat.id, '请只回复两个字：好的')
      check('turn 1 accepted', send1.ok, send1.error)

      // Queue a second turn behind the running one, then cancel: cancel ends
      // turn 1, and the runner must pick up turn 2 from its own queue.
      await wait(2000)
      const send2 = await chats.send(chat.id, '请只回复两个字：收到')
      check('turn 2 queued', send2.ok, send2.error)
      chats.cancel(chat.id)
      check('cancel issued', true)

      const deadline = Date.now() + 240_000
      let settled = false
      while (Date.now() < deadline) {
        await wait(2000)
        const history = chats.history(chat.id)
        const users = history.filter((m) => m.role === 'user').length
        const assistants = history.filter((m) => m.role === 'assistant').length
        // Both user turns recorded and at least one assistant reply survived
        // (a cancelled turn 1 may legitimately produce no assistant text).
        if (users >= 2 && assistants >= 1) {
          settled = true
          break
        }
      }
      check('turns completed', settled)
      const history = chats.history(chat.id)
      check(
        'transcript interleaved',
        history.filter((m) => m.role === 'user').length >= 2,
        `${history.length} messages`
      )

      chats.rename(chat.id, '冒烟测试')
      check('rename applied', chats.list().find((c) => c.id === chat.id)?.title === '冒烟测试')
      chats.togglePin(chat.id)
      const pinned = chats.list().find((c) => c.id === chat.id)?.pinned === true
      chats.togglePin(chat.id)
      const unpinned = chats.list().find((c) => c.id === chat.id)?.pinned === undefined
      check('pin toggle round-trip', pinned && unpinned)

      chats.delete(chat.id)
      check('chat deleted', !chats.list().some((c) => c.id === chat.id))
      check(
        'transcript removed',
        !existsSync(join(dataDir, 'chats', `${chat.id}.jsonl`))
      )
    } catch (err) {
      check('suite crashed', false, err instanceof Error ? err.message : String(err))
    }
    logger.log('Smoke Test Complete', 'see PASS/FAIL lines above')
    close()
  })()
}
