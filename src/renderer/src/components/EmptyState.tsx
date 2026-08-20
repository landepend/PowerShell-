import { api } from '../api'

export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-title">暂无会话</div>
      <div className="empty-subtitle">创建你的第一个终端</div>
      <div className="empty-actions">
        <button onClick={() => void api.createSession('powershell')}>PowerShell</button>
      </div>
    </div>
  )
}
