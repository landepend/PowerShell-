// Probe: does KIMI_MODEL_THINKING_EFFORT=max actually force max thinking?
// Spawns PowerShell with the env prefix + kimi (same shape as a PowerShell++
// project commandLine), then greps the TUI status line for "thinking: max".
const pty = require('node-pty')

const startup = "$env:KIMI_MODEL_THINKING_EFFORT='max'; kimi"
const p = pty.spawn(
  'powershell.exe',
  ['-NoExit', '-NoLogo', '-Command', startup],
  {
    name: 'xterm-256color',
    cols: 140,
    rows: 30,
    cwd: process.cwd(),
    useConpty: true
  }
)

let out = Buffer.alloc(0)
p.onData((d) => {
  out = Buffer.concat([out, Buffer.from(d, 'utf8')])
})

setTimeout(() => {
  // Strip CSI/OSC sequences so status-line text is greppable.
  const text = out
    .toString('utf8')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  const m = text.match(/thinking\s*:\s*(\w+)/i)
  console.log('status line effort:', m ? m[1] : '(not found)')
  const idx = text.toLowerCase().lastIndexOf('thinking')
  if (idx >= 0) console.log('context:', JSON.stringify(text.slice(idx - 40, idx + 40)))
  console.log(m && m[1].toLowerCase() === 'max' ? 'PASS' : 'FAIL')
  p.kill()
  process.exit(m && m[1].toLowerCase() === 'max' ? 0 : 1)
}, 20000)
