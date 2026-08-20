import { useState } from 'react'
import { api } from '../api'
import { folderName } from './ProjectBar'

interface NewProjectModalProps {
  cwd: string
  onClose(): void
}

/** Minimal name-the-project modal after picking a folder from the sidebar ＋. */
export function NewProjectModal({ cwd, onClose }: NewProjectModalProps) {
  const [name, setName] = useState(folderName(cwd))
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const res = await api.createProject({ cwd, cli: 'kimi', name: name.trim() || undefined })
    if (res.ok) onClose()
    else setError(res.error ?? '创建失败')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">新建项目</div>
        <label className="modal-label">文件夹</label>
        <div className="folder-path" title={cwd}>
          {cwd}
        </div>
        <label className="modal-label">项目名称</label>
        <input
          className="modal-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
          }}
        />
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void submit()}>
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
