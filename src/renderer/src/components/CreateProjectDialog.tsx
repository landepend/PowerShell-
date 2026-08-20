import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { PROJECT_CLIS, type CliKind } from '../../../shared/types/session'
import type { CliModelOption } from '../../../shared/types/api'

const CLI_KEYS = Object.keys(PROJECT_CLIS) as CliKind[]

const PERMISSIONS: Record<CliKind, { value: string; label: string }[]> = {
  kimi: [
    { value: '', label: '默认（手动确认）' },
    { value: 'yolo', label: 'yolo（自动批准工具调用）' },
    { value: 'auto', label: 'auto（全自动，不提问）' },
    { value: 'plan', label: 'plan（先出计划再执行）' }
  ],
  claude: [
    { value: '', label: '默认' },
    { value: 'acceptEdits', label: '自动接受编辑' },
    { value: 'plan', label: 'plan（计划模式）' },
    { value: 'bypass', label: '跳过全部权限确认' }
  ],
  codex: [
    { value: '', label: '默认' },
    { value: 'full-auto', label: '全自动（--full-auto）' },
    { value: 'bypass', label: '绕过审批与沙箱' }
  ]
}

const THINKING: Partial<Record<CliKind, { value: string; label: string }[]>> = {
  kimi: [
    { value: '', label: '默认（跟随模型配置）' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
    { value: 'max', label: '最高（max）' }
  ],
  claude: [
    { value: '', label: '默认' },
    { value: '0', label: '关闭' },
    { value: '2048', label: '低' },
    { value: '8192', label: '中' },
    { value: '32768', label: '高' }
  ],
  codex: [
    { value: '', label: '默认' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' }
  ]
}

/** Compose the full startup command from the selected options. */
function composeCommand(
  cli: CliKind,
  model: string,
  permission: string,
  thinking: string,
  context1m: boolean
): string {
  const parts: string[] = [cli]
  let prefix = ''
  if (model) {
    const m = cli === 'claude' ? '--model' : '-m'
    parts.push(m, context1m ? `${model}[1m]` : model)
  }
  switch (cli) {
    case 'kimi':
      if (permission) parts.push(`--${permission}`)
      if (thinking) prefix = `$env:KIMI_MODEL_THINKING_EFFORT='${thinking}'; `
      break
    case 'claude':
      if (permission === 'bypass') parts.push('--dangerously-skip-permissions')
      else if (permission) parts.push('--permission-mode', permission)
      if (thinking) prefix = `$env:MAX_THINKING_TOKENS='${thinking}'; `
      break
    case 'codex':
      if (permission === 'full-auto') parts.push('--full-auto')
      else if (permission === 'bypass') parts.push('--dangerously-bypass-approvals-and-sandbox')
      if (thinking) parts.push('-c', `model_reasoning_effort='${thinking}'`)
      break
  }
  return prefix + parts.join(' ')
}

/** Modal for "创建任务": pick a folder, a CLI and its launch options — no typing. */
export function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [cli, setCli] = useState<CliKind>('kimi')
  const [models, setModels] = useState<CliModelOption[]>([])
  const [model, setModel] = useState('')
  const [permission, setPermission] = useState('')
  const [thinking, setThinking] = useState('')
  const [context1m, setContext1m] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const cache = useRef<Partial<Record<CliKind, CliModelOption[]>>>({})

  // Load model choices from the CLI's local config when the CLI selection changes.
  useEffect(() => {
    setModel('')
    setPermission('')
    setThinking('')
    setContext1m(false)
    const cached = cache.current[cli]
    if (cached) {
      setModels(cached)
      return
    }
    setModels([])
    let cancelled = false
    void api.getCliOptions(cli).then((list) => {
      if (cancelled) return
      cache.current[cli] = list
      setModels(list)
    })
    return () => {
      cancelled = true
    }
  }, [cli])

  const pick = async () => {
    const path = await api.pickFolder()
    if (path) setCwd(path)
  }

  const commandLine = composeCommand(cli, model, permission, thinking, context1m)

  const create = async () => {
    if (!cwd) {
      setError('请先选择项目文件夹')
      return
    }
    setBusy(true)
    setError('')
    const r = await api.createProject({
      cwd,
      cli,
      name: name.trim() || undefined,
      commandLine
    })
    setBusy(false)
    if (r.ok) {
      onClose()
    } else {
      setError(r.error ?? '创建失败')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">创建任务</div>

        <div className="modal-label">项目文件夹</div>
        <div className="folder-row">
          <button onClick={() => void pick()}>选择文件夹…</button>
          <span className="folder-path" title={cwd}>
            {cwd || '未选择'}
          </span>
        </div>

        <div className="modal-label">项目名称（可选，默认取文件夹名）</div>
        <input
          className="modal-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="项目名称"
        />

        <div className="modal-label">启动 CLI</div>
        <div className="cli-options">
          {CLI_KEYS.map((key) => (
            <button key={key} className={cli === key ? 'primary' : ''} onClick={() => setCli(key)}>
              {PROJECT_CLIS[key].label}
            </button>
          ))}
        </div>

        <div className="modal-label">模型</div>
        <select className="modal-input" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">默认</option>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        {cli === 'claude' && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={context1m}
              disabled={!model}
              onChange={(e) => setContext1m(e.target.checked)}
            />
            启用 1M 长上下文（模型名追加 [1m]，需先选模型）
          </label>
        )}

        <div className="modal-label">权限模式</div>
        <select
          className="modal-input"
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
        >
          {PERMISSIONS[cli].map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        {THINKING[cli] && (
          <>
            <div className="modal-label">思考强度</div>
            <select
              className="modal-input"
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
            >
              {THINKING[cli]!.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </>
        )}
        {cli === 'kimi' && (
          <div className="modal-hint">
            思考强度通过 KIMI_MODEL_THINKING_EFFORT 环境变量注入，仅对 kimi 官方模型生效，openai 型 provider 会被忽略
          </div>
        )}

        <div className="modal-label">将执行</div>
        <code className="command-preview">{commandLine}</code>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !cwd} onClick={() => void create()}>
            {busy ? '创建中…' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  )
}
