import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'
import type { AppInfo, KimiUsageResult, UsageLimit } from '../../../shared/types/api'

type Section = 'appearance' | 'usage' | 'data'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'usage', label: '使用情况' },
  { key: 'data', label: '数据' }
]

/** Localized label for the quota lines returned by the kimi usage API. */
function limitLabel(label: string): string {
  if (/weekly/i.test(label)) return '每周额度'
  if (/5h/i.test(label)) return '5 小时窗口'
  return label || '额度'
}

function UsageBar({ limit }: { limit: UsageLimit }) {
  const pct = limit.limit > 0 ? Math.min(100, Math.round((limit.used / limit.limit) * 100)) : 0
  return (
    <div className="usage-row">
      <div className="usage-head">
        <span>{limitLabel(limit.label)}</span>
        <span className="usage-pct">已用 {pct}%</span>
      </div>
      <div className="usage-bar">
        <div
          className={`usage-fill${pct >= 80 ? ' warn' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {limit.resetHint && <div className="usage-hint">{limit.resetHint}</div>}
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
    <>
      <h2>使用情况</h2>
      <div className="setting-card">
        <div className="usage-title">
          <span>Kimi 额度</span>
          <button onClick={() => void refresh()} disabled={loading}>
            {loading ? '查询中…' : '刷新'}
          </button>
        </div>
        {result?.kind === 'ok' && (
          <>
            {result.summary && <UsageBar limit={result.summary} />}
            {result.limits.map((l, i) => (
              <UsageBar key={i} limit={l} />
            ))}
            {!result.summary && result.limits.length === 0 && (
              <div className="usage-hint">暂无可显示的额度信息</div>
            )}
          </>
        )}
        {result?.kind === 'error' && (
          <div className="usage-hint">获取失败：{result.message}（确认已登录 kimi）</div>
        )}
        {!result && <div className="usage-hint">查询中…</div>}
      </div>
    </>
  )
}

function AppearanceSection() {
  const theme = useSessionStore((s) => s.theme)
  return (
    <>
      <h2>外观</h2>
      <div className="setting-card">
        <div className="setting-row">
          <div>
            <div className="setting-name">主题</div>
            <div className="setting-desc">深色或浅色界面</div>
          </div>
          <div className="cli-options">
            <button
              className={theme === 'dark' ? 'primary' : ''}
              onClick={() => void api.setTheme('dark')}
            >
              深色
            </button>
            <button
              className={theme === 'light' ? 'primary' : ''}
              onClick={() => void api.setTheme('light')}
            >
              浅色
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function DataSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void api.getAppInfo().then(setInfo)
  }, [])
  return (
    <>
      <h2>数据</h2>
      <div className="setting-card">
        <div className="setting-row">
          <div>
            <div className="setting-name">数据目录</div>
            <div className="setting-desc">{info?.dataDir ?? '…'}</div>
          </div>
          <button onClick={() => void api.openDataFolder()}>打开</button>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-name">版本</div>
            <div className="setting-desc">PowerShell++ {info?.version ?? ''}</div>
          </div>
        </div>
      </div>
    </>
  )
}

export function SettingsPage() {
  const close = useSessionStore((s) => s.setSettingsOpen)
  const [section, setSection] = useState<Section>('appearance')
  return (
    <div className="settings-page">
      <div className="settings-nav">
        <button className="settings-back" onClick={() => close(false)}>
          ← 返回应用
        </button>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`settings-nav-item${section === s.key ? ' active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        {section === 'appearance' && <AppearanceSection />}
        {section === 'usage' && <UsageSection />}
        {section === 'data' && <DataSection />}
      </div>
    </div>
  )
}
