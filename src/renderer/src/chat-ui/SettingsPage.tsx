import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'
import { DEFAULT_HOME_EFFORT, DEFAULT_HOME_MODEL, useChatStore } from './store'
import { effortLabel } from './ModelEffortChip'
import type { ChatSettingsSection } from './store'
import type { AppInfo, KimiUsageResult, UsageLimit } from '../../../shared/types/api'

const SECTIONS: { key: ChatSettingsSection; icon: string; label: string }[] = [
  { key: 'general', icon: '⚙', label: '常规' },
  { key: 'appearance', icon: '🎨', label: '外观' },
  { key: 'usage', icon: '📊', label: '使用情况' },
  { key: 'about', icon: '⬡', label: '关于' }
]

/** Localized label for the quota lines returned by the kimi usage API. */
function limitLabel(label: string): string {
  if (/weekly/i.test(label)) return '每周额度'
  if (/5h/i.test(label)) return '5 小时窗口'
  return label || '额度'
}

function UsageRow({ limit }: { limit: UsageLimit }) {
  const pct = limit.limit > 0 ? Math.min(100, Math.round((limit.used / limit.limit) * 100)) : 0
  return (
    <div className="chat-usage-row">
      <div className="chat-usage-head">
        <span>{limitLabel(limit.label)}</span>
        <span className="chat-usage-pct">已用 {pct}%</span>
      </div>
      <div className="chat-usage-bar">
        <div
          className={`chat-usage-fill${pct >= 80 ? ' warn' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {limit.resetHint && <div className="chat-usage-hint">{limit.resetHint}</div>}
    </div>
  )
}

function GeneralSection({ info }: { info: AppInfo | null }) {
  return (
    <div className="chat-card">
      <div className="chat-card-row">
        <div>
          <div className="chat-card-name">数据目录</div>
          <div className="chat-card-desc">{info?.dataDir ?? '…'}</div>
        </div>
        <button className="chat-ghost-btn" onClick={() => void api.openDataFolder()}>
          打开
        </button>
      </div>
      <div className="chat-card-row">
        <div>
          <div className="chat-card-name">默认模型</div>
          <div className="chat-card-desc">新对话使用的模型</div>
        </div>
        <span className="chat-card-value">{DEFAULT_HOME_MODEL}</span>
      </div>
      <div className="chat-card-row">
        <div>
          <div className="chat-card-name">默认思考强度</div>
          <div className="chat-card-desc">新对话使用的思考强度</div>
        </div>
        <span className="chat-card-value">{effortLabel(DEFAULT_HOME_EFFORT)}</span>
      </div>
    </div>
  )
}

function AppearanceSection() {
  const theme = useSessionStore((s) => s.theme)
  return (
    <div className="chat-card">
      <div className="chat-card-row">
        <div>
          <div className="chat-card-name">主题</div>
          <div className="chat-card-desc">深色或浅色界面</div>
        </div>
        <div className="chat-theme-toggle">
          <button
            className={theme === 'dark' ? 'active' : ''}
            onClick={() => void api.setTheme('dark')}
          >
            深色
          </button>
          <button
            className={theme === 'light' ? 'active' : ''}
            onClick={() => void api.setTheme('light')}
          >
            浅色
          </button>
        </div>
      </div>
    </div>
  )
}

function UsageSection() {
  const [result, setResult] = useState<KimiUsageResult | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setResult(await api.getKimiUsage())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="chat-card">
      {result?.kind === 'ok' && (
        <>
          {result.summary && <UsageRow limit={result.summary} />}
          {result.limits.map((l, i) => (
            <UsageRow key={i} limit={l} />
          ))}
          {!result.summary && result.limits.length === 0 && (
            <div className="chat-usage-hint">暂无可显示的额度信息</div>
          )}
        </>
      )}
      {result?.kind === 'error' && (
        <div className="chat-card-row">
          <div className="chat-usage-hint">获取失败：{result.message}（确认已登录 kimi）</div>
          <button className="chat-ghost-btn" onClick={() => void refresh()} disabled={loading}>
            重试
          </button>
        </div>
      )}
      {!result && <div className="chat-usage-hint">查询中…</div>}
    </div>
  )
}

function AboutSection({ info }: { info: AppInfo | null }) {
  return (
    <div className="chat-card chat-about">
      <div className="chat-about-logo">⬡</div>
      <div className="chat-about-name">PowerShell++</div>
      <div className="chat-card-desc">版本 {info?.version ?? '…'}</div>
      <div className="chat-card-desc">{info?.dataDir ?? ''}</div>
    </div>
  )
}

/** Codex-style two-pane settings, shown instead of the old SettingsPage when
    settings is opened from the chat UI. */
export function ChatSettings() {
  const close = useSessionStore((s) => s.setSettingsOpen)
  const initial = useChatStore((s) => s.settingsSection)
  const [section, setSection] = useState<ChatSettingsSection>(initial)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void api.getAppInfo().then(setInfo)
  }, [])

  const title = SECTIONS.find((s) => s.key === section)?.label ?? ''

  return (
    <div className="chat-settings">
      <div className="chat-settings-nav">
        <button className="chat-settings-back" onClick={() => close(false)}>
          ← 返回应用
        </button>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`chat-settings-nav-item${section === s.key ? ' active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            <span className="chat-settings-nav-icon">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="chat-settings-content">
        <h2 className="chat-settings-title">{title}</h2>
        {section === 'general' && <GeneralSection info={info} />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'usage' && <UsageSection />}
        {section === 'about' && <AboutSection info={info} />}
      </div>
    </div>
  )
}
