import { useEffect, useState } from 'react'
import { api } from '../api'
import type { CliModelOption } from '../../../shared/types/api'

/** Module-level cache: model list rarely changes during a session. */
let modelCache: CliModelOption[] | null = null

const EFFORT_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极高'
}

/** Short display label: last path segment, first letter uppercased. */
export function shortModelLabel(model: string | undefined, options: CliModelOption[] | null): string {
  if (!model) return '默认'
  const raw = options?.find((o) => o.value === model)?.label ?? model
  const seg = raw.split('/').pop() ?? raw
  return seg.charAt(0).toUpperCase() + seg.slice(1)
}

export function effortLabel(effort: string | undefined): string {
  if (!effort) return '默认'
  return EFFORT_LABELS[effort] ?? effort
}

interface ModelEffortChipProps {
  model?: string
  effort?: string
  onModelChange(model: string | undefined): void
  onEffortChange(effort: string | undefined): void
}

/** Combined "model · effort ⌄" chip; popup lists models, then effort levels
    for the selected model when it exposes them. */
export function ModelEffortChip({ model, effort, onModelChange, onEffortChange }: ModelEffortChipProps) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<CliModelOption[] | null>(modelCache)

  useEffect(() => {
    if (modelCache) return
    let cancelled = false
    void api.getCliOptions('kimi').then((list) => {
      modelCache = list
      if (!cancelled) setOptions(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const current = options?.find((o) => o.value === model)
  const efforts = current?.efforts

  return (
    <span className="chat-model-chip-wrap">
      <button className="chat-chip chat-model-chip" onClick={() => setOpen((v) => !v)}>
        {shortModelLabel(model, options)}
        {effort ? ` · ${effortLabel(effort)}` : ''} ⌄
      </button>
      {open && (
        <>
          <div className="popover-overlay" onClick={() => setOpen(false)} />
          <div className="chat-model-menu">
            <div className="chat-model-menu-title">模型</div>
            {(options ?? []).map((o) => (
              <button
                key={o.value}
                className={`chat-model-option${o.value === model ? ' active' : ''}`}
                onClick={() => {
                  onModelChange(o.value)
                  // Switching models reseats the effort to the new model's default.
                  if (o.efforts?.length) onEffortChange(o.defaultEffort ?? o.efforts[o.efforts.length - 1])
                  else onEffortChange(undefined)
                }}
              >
                <span>{shortModelLabel(o.value, options)}</span>
                <span className="chat-model-value">{o.value}</span>
              </button>
            ))}
            {efforts && efforts.length > 0 && (
              <>
                <div className="chat-model-menu-title">思考强度</div>
                <div className="chat-effort-row">
                  {efforts.map((e) => (
                    <button
                      key={e}
                      className={`chat-effort-btn${e === effort ? ' active' : ''}`}
                      onClick={() => {
                        onEffortChange(e)
                        setOpen(false)
                      }}
                    >
                      {effortLabel(e)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </span>
  )
}
