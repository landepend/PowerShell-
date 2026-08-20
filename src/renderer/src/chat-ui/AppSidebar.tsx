import { useEffect, useState } from 'react'
import { api } from '../api'
import { useChatStore } from './store'
import { ChatMenu, RenameInput } from './Menu'
import { NewProjectModal } from './NewProjectModal'
import type { AppInfo } from '../../../shared/types/api'
import type { ChatMeta } from '../../../shared/types/chat'
import type { ProjectMeta } from '../../../shared/types/session'

function ChatRow({ chat, active }: { chat: ChatMeta; active: boolean }) {
  const openChat = useChatStore((s) => s.openChat)
  const openHome = useChatStore((s) => s.openHome)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const commitRename = (title: string) => {
    setRenaming(false)
    const t = title.trim()
    if (t && t !== chat.title) void api.renameChat(chat.id, t)
  }

  return (
    <div
      className={`chat-item${active ? ' active' : ''}`}
      title={chat.cwd}
      onClick={() => openChat(chat.id)}
    >
      {renaming ? (
        <RenameInput
          initial={chat.title}
          onCommit={commitRename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className="chat-item-title">{chat.title || '新对话'}</span>
      )}
      {chat.pinned && (
        <button
          className="chat-item-btn pin"
          title="取消置顶"
          onClick={(e) => {
            e.stopPropagation()
            void api.togglePinChat(chat.id)
          }}
        >
          📌
        </button>
      )}
      <button
        className="chat-item-btn"
        title="更多"
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen(true)
        }}
      >
        ···
      </button>
      {menuOpen && (
        <ChatMenu
          onClose={() => setMenuOpen(false)}
          items={[
            {
              label: chat.pinned ? '取消置顶' : '置顶',
              onClick: () => void api.togglePinChat(chat.id)
            },
            { label: '重命名', onClick: () => setRenaming(true) },
            {
              label: '删除',
              danger: true,
              onClick: () => {
                if (active) openHome()
                void api.deleteChat(chat.id)
              }
            }
          ]}
        />
      )}
    </div>
  )
}

/** Project row: folder + name only; click toggles inline chat expansion. */
function ProjectRow({
  project,
  chats,
  activeChatId,
  collapsed,
  onToggle
}: {
  project: ProjectMeta
  chats: ChatMeta[]
  activeChatId: string | null
  collapsed: boolean
  onToggle(): void
}) {
  const openHome = useChatStore((s) => s.openHome)
  const [menuOpen, setMenuOpen] = useState(false)
  const newChat = () => openHome(project.id)

  return (
    <div className="project-group">
      <div className="project-header" title={project.cwd} onClick={onToggle}>
        <span className="project-icon">📁</span>
        <span className="project-name">{project.name}</span>
        <button
          className="chat-item-btn pin"
          title="新建对话"
          onClick={(e) => {
            e.stopPropagation()
            newChat()
          }}
        >
          ✎
        </button>
        <button
          className="chat-item-btn"
          title="更多"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(true)
          }}
        >
          ···
        </button>
        {menuOpen && (
          <ChatMenu
            onClose={() => setMenuOpen(false)}
            items={[
              { label: '新建对话', onClick: newChat },
              { label: '打开文件夹', onClick: () => void api.openFolder(project.cwd) },
              {
                label: '删除项目',
                danger: true,
                disabled: chats.length > 0,
                onClick: () => void api.deleteProject(project.id)
              }
            ]}
          />
        )}
      </div>
      {!collapsed && (
        <div className="project-items">
          <div className="chat-item chat-item-new" onClick={newChat}>
            ＋ 新对话
          </div>
          {chats.map((c) => (
            <ChatRow key={c.id} chat={c} active={c.id === activeChatId} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AppSidebar() {
  const view = useChatStore((s) => s.view)
  const chats = useChatStore((s) => s.chats)
  const projects = useChatStore((s) => s.projects)
  const openHome = useChatStore((s) => s.openHome)
  const openTerminal = useChatStore((s) => s.openTerminal)
  const openSettings = useChatStore((s) => s.openSettings)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [newProjectCwd, setNewProjectCwd] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  useEffect(() => {
    void api.getAppInfo().then(setInfo)
  }, [])

  const byRecency = (a: ChatMeta, b: ChatMeta) => b.lastActiveAt.localeCompare(a.lastActiveAt)
  const q = filter.trim().toLowerCase()
  const matchChat = (c: ChatMeta) => !q || (c.title || '').toLowerCase().includes(q)
  const pinned = chats.filter((c) => c.pinned && matchChat(c)).sort(byRecency)
  const ungrouped = chats.filter((c) => !c.projectId && !c.pinned && matchChat(c)).sort(byRecency)
  const sortedProjects = [...projects].sort((a, b) => a.order - b.order)
  // Filtering also keeps projects that contain a matching chat.
  const visibleProjects = sortedProjects.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      chats.some((c) => c.projectId === p.id && matchChat(c))
  )
  const activeChatId = view.kind === 'chat' ? view.chatId : null

  // ＋ on the 项目 header: pick a folder, then name it in a small modal.
  const startNewProject = async () => {
    const path = await api.pickFolder()
    if (path) setNewProjectCwd(path)
  }

  return (
    <div className="sidebar">
      <div className="chat-brand">
        <span className="chat-brand-name">PowerShell++</span>
        <span className="chat-brand-actions">
          <button
            className="chat-icon-btn"
            title="筛选对话或项目"
            onClick={() => setSearchOpen((v) => !v)}
          >
            🔍
          </button>
          <span className="chat-brand-caret">⌄</span>
        </span>
      </div>

      {searchOpen && (
        <div className="chat-search">
          <input
            autoFocus
            placeholder="筛选对话或项目"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('')
                setSearchOpen(false)
              }
            }}
          />
        </div>
      )}

      <div className="chat-nav">
        <button className="chat-navrow" onClick={() => openHome()}>
          <span>✎ 新对话</span>
          <span className="chat-navrow-end">⊕</span>
        </button>
        <button
          className={`chat-navrow${view.kind === 'terminal' ? ' active' : ''}`}
          onClick={openTerminal}
        >
          <span>▸ 终端会话</span>
        </button>
      </div>

      <div className="session-list">
        {pinned.length > 0 && (
          <>
            <div className="section-title">置顶</div>
            {pinned.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === activeChatId} />
            ))}
          </>
        )}

        <div className="section-title section-row">
          <span>项目</span>
          <button className="section-add" title="新建项目" onClick={() => void startNewProject()}>
            ＋
          </button>
        </div>
        {visibleProjects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            chats={chats
              .filter((c) => c.projectId === p.id && !c.pinned && matchChat(c))
              .sort(byRecency)}
            activeChatId={activeChatId}
            // Force expansion while a filter is active.
            collapsed={!!collapsed[p.id] && !q}
            onToggle={() => setCollapsed((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
          />
        ))}

        {ungrouped.length > 0 && (
          <>
            <div className="section-title">对话</div>
            {ungrouped.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === activeChatId} />
            ))}
          </>
        )}
      </div>

      <div className="chat-usercard-wrap">
        {userMenuOpen && (
          <ChatMenu
            className="up"
            onClose={() => setUserMenuOpen(false)}
            items={[
              { label: '使用情况', onClick: () => openSettings('usage') },
              { label: '设置 Ctrl+,', onClick: () => openSettings() },
              { label: '打开数据目录', onClick: () => void api.openDataFolder() }
            ]}
            footer={
              <div className="chat-menu-footer">PowerShell++ v{info?.version ?? '…'}</div>
            }
          />
        )}
        <button className="chat-usercard" onClick={() => setUserMenuOpen((v) => !v)}>
          <span className="chat-avatar">
            {(info?.userName ?? '?').charAt(0).toUpperCase()}
          </span>
          <span className="chat-username">{info?.userName ?? '…'}</span>
        </button>
      </div>

      {newProjectCwd && (
        <NewProjectModal cwd={newProjectCwd} onClose={() => setNewProjectCwd(null)} />
      )}
    </div>
  )
}
