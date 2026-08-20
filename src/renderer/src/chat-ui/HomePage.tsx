import { useState } from 'react'
import { ChatInput } from './ChatInput'
import { ProjectBar } from './ProjectBar'

/** Quick actions on the home page fill the input with a preset prompt. */
const QUICK_ACTIONS = [
  {
    icon: '⌕',
    color: 'blue',
    label: '探索并理解代码',
    prompt: '探索这个代码库，帮我理解它的整体结构和关键模块。'
  },
  { icon: '✚', color: 'purple', label: '构建新功能、应用或工具', prompt: '帮我构建一个新功能：' },
  { icon: '✔', color: 'green', label: '审查代码并提出修改建议', prompt: '审查当前项目的代码并提出修改建议。' },
  { icon: '⚠', color: 'orange', label: '修复问题和失败', prompt: '帮我修复以下问题：' }
]

export function HomePage() {
  const [draft, setDraft] = useState('')
  return (
    <div className="chat-home">
      <div className="chat-home-glow" />
      <div className="chat-home-inner">
        <div className="chat-home-logo">⬡</div>
        <div className="chat-home-title">我们要构建什么？</div>
        <div className="chat-home-input">
          <ProjectBar />
          <ChatInput chatId={null} value={draft} onChange={setDraft} />
        </div>
        <div className="chat-quick-cards">
          {QUICK_ACTIONS.map((a) => (
            <button key={a.label} className="chat-quick-card" onClick={() => setDraft(a.prompt)}>
              <span className={`chat-quick-icon ${a.color}`}>{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
