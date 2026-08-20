import { useState } from 'react'
import { api } from '../api'
import { useChatStore } from './store'

/** Short display name for a folder path. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

interface ProjectBarProps {
  /** Read-only mode for ChatView: shows the chat's bound project/cwd. */
  readOnly?: boolean
  projectId?: string | null
  cwd?: string | null
}

/** Rounded "选择项目" bar sitting above the input box (Codex style). */
export function ProjectBar({ readOnly, projectId: propProjectId, cwd: propCwd }: ProjectBarProps) {
  const projects = useChatStore((s) => s.projects)
  const homeProjectId = useChatStore((s) => s.homeProjectId)
  const homeCwd = useChatStore((s) => s.homeCwd)
  const setHomeTarget = useChatStore((s) => s.setHomeTarget)
  const [menuOpen, setMenuOpen] = useState(false)

  const projectId = readOnly ? propProjectId : homeProjectId
  const cwd = readOnly ? propCwd : homeCwd
  const project = projects.find((p) => p.id === projectId)
  const label = project ? project.name : cwd ? folderName(cwd) : null
  const subPath = project ? project.cwd : cwd

  // 选择文件夹…: reuse the project for this folder if one exists, otherwise
  // create it (name = folder basename) and bind the new project.
  const pickFolder = async () => {
    setMenuOpen(false)
    const path = await api.pickFolder()
    if (!path) return
    const existing = useChatStore.getState().projects.find((p) => p.cwd === path)
    if (existing) {
      setHomeTarget({ projectId: existing.id })
      return
    }
    const res = await api.createProject({ cwd: path, cli: 'kimi', name: folderName(path) })
    if (!res.ok) return
    let projectId = res.session?.projectId
    if (!projectId) {
      // Fall back to the projects mirror, which syncs via onStateChanged.
      await new Promise((r) => setTimeout(r, 300))
      projectId = useChatStore.getState().projects.find((p) => p.cwd === path)?.id
    }
    setHomeTarget(projectId ? { projectId } : { cwd: path })
  }

  if (readOnly) {
    return (
      <div className="chat-project-bar readonly">
        <span className="chat-project-bar-icon">📁</span>
        <span className="chat-project-bar-label">{label ?? '默认目录'}</span>
        {subPath && <span className="chat-project-bar-path">{subPath}</span>}
      </div>
    )
  }

  return (
    <div className="chat-project-bar-wrap">
      <button className="chat-project-bar" onClick={() => setMenuOpen((v) => !v)}>
        <span className="chat-project-bar-icon">📁</span>
        <span className="chat-project-bar-label">{label ?? '选择项目'}</span>
        {label ? (
          <span
            className="chat-project-bar-clear"
            title="清除项目"
            onClick={(e) => {
              e.stopPropagation()
              setHomeTarget(null)
            }}
          >
            ×
          </span>
        ) : (
          <span className="chat-project-bar-caret">⌄</span>
        )}
      </button>
      {menuOpen && (
        <>
          <div className="popover-overlay" onClick={() => setMenuOpen(false)} />
          <div className="chat-project-menu">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setHomeTarget({ projectId: p.id })
                  setMenuOpen(false)
                }}
              >
                <span className="chat-project-menu-name">📁 {p.name}</span>
                <span className="chat-project-menu-cwd">{p.cwd}</span>
              </button>
            ))}
            <button onClick={() => void pickFolder()}>
              <span className="chat-project-menu-name">选择文件夹…</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
