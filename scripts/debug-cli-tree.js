// Debug: spawn the app's shell-integration command via node-pty, then dump
// the descendant process tree of the returned PID to see where kimi lands.
const path = require('path')
const os = require('os')
const pty = require('node-pty')
const { execFile } = require('child_process')

const script = path.join(__dirname, '..', 'data', 'pss-shell-integration.ps1')
const proc = pty.spawn(
  'powershell.exe',
  ['-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', script, '-StartupCommand', 'kimi'],
  { name: 'xterm-256color', cols: 120, rows: 30, cwd: os.homedir(), env: process.env }
)
proc.onData(() => {})

setTimeout(() => {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$root = ${proc.pid}
$procs = Get-CimInstance Win32_Process
$me = $procs | Where-Object { $_.ProcessId -eq $root }
Write-Output ("ROOT " + $root + " " + $me.Name + " | " + $me.CommandLine)
function Walk($id, $depth) {
  foreach ($c in ($procs | Where-Object { $_.ParentProcessId -eq $id })) {
    Write-Output ((' ' * $depth) + $c.ProcessId + ' ' + $c.Name + ' | ' + $c.CommandLine)
    Walk $c.ProcessId ($depth + 2)
  }
}
Walk $root 2
`
  const encoded = Buffer.from(ps, 'utf16le').toString('base64')
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { timeout: 10000 },
    (err, stdout) => {
      console.log(stdout)
      if (err) console.error('ERR', err.message)
      proc.kill()
      process.exit(0)
    }
  )
}, 10000)
