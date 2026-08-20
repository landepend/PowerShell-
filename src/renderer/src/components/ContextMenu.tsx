import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'

export function ContextMenu() {
  const menu = useSessionStore((s) => s.menu)
  const sessions = useSessionStore((s) => s.sessions)
  const closeMenu = useSessionStore((s) => s.closeMenu)
  const setRenaming = useSessionStore((s) => s.setRenaming)

  if (!menu) return null
  const session = sessions.find((s) => s.id === menu.sessionId)
  if (!session) return null

  const run = (action: () => void) => () => {
    action()
    closeMenu()
  }

  return (
    <div className="popover-overlay" onClick={closeMenu} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="context-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={run(() => void api.restartSession(session.id))}>重启</button>
        <button onClick={run(() => setRenaming(session.id))}>重命名</button>
        <button onClick={run(() => void api.duplicateSession(session.id))}>创建副本</button>
        <button onClick={run(() => void api.togglePin(session.id))}>
          {session.pinned ? '取消置顶' : '置顶'}
        </button>
        <div className="menu-separator" />
        <button onClick={run(() => void api.openFolder(session.cwd))}>打开文件夹</button>
        <button onClick={run(() => void navigator.clipboard.writeText(session.cwd))}>复制路径</button>
        <div className="menu-separator" />
        <button className="danger" onClick={run(() => void api.closeSession(session.id))}>
          关闭
        </button>
      </div>
    </div>
  )
}
