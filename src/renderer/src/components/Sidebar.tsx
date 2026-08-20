import { useState } from 'react'
import type { DragEvent } from 'react'
import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'
import { SessionItem } from './SessionItem'
import { CreateProjectDialog } from './CreateProjectDialog'
import type { ProjectMeta, SessionState } from '../../../shared/types/session'

/** Flat draggable session list (pinned section only). */
function DraggableSessions({ list, all }: { list: SessionState[]; all: SessionState[] }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const handleDrop = (index: number) => (e: DragEvent) => {
    e.preventDefault()
    setDropIndex(null)
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      return
    }
    // Reorder only this section's subsequence inside the global id list.
    const sub = list.map((s) => s.id)
    const [moved] = sub.splice(dragIndex, 1)
    sub.splice(index, 0, moved)
    const queue = [...sub]
    const ids = all.map((s) => (list.some((l) => l.id === s.id) ? queue.shift()! : s.id))
    void api.reorderSessions(ids)
    setDragIndex(null)
  }

  return (
    <>
      {list.map((session, index) => (
        <div
          key={session.id}
          draggable
          className={dropIndex === index && dragIndex !== null && dragIndex !== index ? 'drop-target' : ''}
          onDragStart={(e) => {
            setDragIndex(index)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDropIndex(index)
          }}
          onDragLeave={() => setDropIndex((i) => (i === index ? null : i))}
          onDrop={handleDrop(index)}
          onDragEnd={() => {
            setDragIndex(null)
            setDropIndex(null)
          }}
        >
          <SessionItem session={session} />
        </div>
      ))}
    </>
  )
}

function ProjectGroup({ project, sessions }: { project: ProjectMeta; sessions: SessionState[] }) {
  const visible = sessions.filter((s) => !s.pinned)
  return (
    <div className="project-group">
      <div
        className="project-header"
        title={project.cwd}
        onClick={() => void api.toggleProjectCollapsed(project.id)}
      >
        <span className="project-arrow">{project.collapsed ? '▸' : '▾'}</span>
        <span className="project-icon">📁</span>
        <span className="project-name">{project.name}</span>
        <span className="project-count">{sessions.length}</span>
        <button
          className="project-add"
          title="在此项目中新建会话"
          onClick={(e) => {
            e.stopPropagation()
            void api.addSessionToProject(project.id)
          }}
        >
          ＋
        </button>
        {sessions.length === 0 && (
          <button
            className="project-delete"
            title="删除项目"
            onClick={(e) => {
              e.stopPropagation()
              void api.deleteProject(project.id)
            }}
          >
            ×
          </button>
        )}
      </div>
      {!project.collapsed && visible.length > 0 && (
        <div className="project-items">
          {visible.map((s) => (
            <SessionItem key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const projects = useSessionStore((s) => s.projects)
  const [showDialog, setShowDialog] = useState(false)
  const setSettingsOpen = useSessionStore((s) => s.setSettingsOpen)

  const pinned = sessions.filter((s) => s.pinned)
  // Codex-style "最近": ungrouped sessions, most recently active first.
  const recent = sessions
    .filter((s) => !s.pinned && !s.projectId)
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  const sortedProjects = [...projects].sort((a, b) => a.order - b.order)

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>会话</span>
        <span className="sidebar-count">{sessions.length}</span>
      </div>

      <button
        className="nav-item"
        title="新建 PowerShell 会话（Ctrl+Shift+N）"
        onClick={() => void api.createSession('powershell')}
      >
        ＋ 新会话
      </button>

      <div className="session-list">
        {pinned.length > 0 && (
          <>
            <div className="section-title">置顶</div>
            <DraggableSessions list={pinned} all={sessions} />
          </>
        )}

        <div className="section-title section-row">
          <span>项目</span>
          <button className="section-add" title="创建任务" onClick={() => setShowDialog(true)}>
            ＋
          </button>
        </div>
        {sortedProjects.map((p) => (
          <ProjectGroup
            key={p.id}
            project={p}
            sessions={sessions.filter((s) => s.projectId === p.id)}
          />
        ))}

        {recent.length > 0 && (
          <>
            <div className="section-title">最近</div>
            {recent.map((s) => (
              <SessionItem key={s.id} session={s} />
            ))}
          </>
        )}
      </div>

      <div className="sidebar-bottom">
        <button className="settings-btn" onClick={() => setSettingsOpen(true)}>
          ⚙ 设置
        </button>
      </div>

      {showDialog && <CreateProjectDialog onClose={() => setShowDialog(false)} />}
    </div>
  )
}
