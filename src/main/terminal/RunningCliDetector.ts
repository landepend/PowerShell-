import { execFile } from 'child_process'
import type { Logger } from '../logger'

/**
 * Detects which known CLI (kimi / codex / claude) is running inside each
 * session's shell, by walking the descendant tree of each given PID.
 *
 * CLIs are matched against both the process name and its command line, so
 * npm shims (`kimi.cmd` -> cmd.exe -> node …\kimi-code\…) and native
 * executables (`claude.exe`) are both found. The shallowest match wins —
 * that is the command the user actually typed.
 *
 * Runs a single powershell.exe with the script passed as -EncodedCommand
 * (UTF-16LE base64), sidestepping all command-line quoting issues. Any
 * failure resolves to an empty map: quitting must never hang on this.
 */

// Boundary-safe CLI matcher, tested against:
//   node.exe …/@moonshot-ai/kimi-code/dist/main.mjs   (npm CLI running as node)
//   cmd.exe /c "…\npm\kimi.cmd"                        (cmd shim)
//   claude.exe                                         (native exe)
// while rejecting lookalikes such as `notepad.exe C:\docs\kimi-notes.txt`.
// Group 2 captures the keyword ("kimi", "kimi-code", "codex", "claude", …).
const CLI_PATTERN = String.raw`(?i)(^|[\\/\s"@])((kimi|claude)(-code)?|codex)(\.(cmd|exe|bat|ps1|mjs|js))?(?=[\s"./\\]|$)`

function buildScript(pids: number[]): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(${pids.join(',')})
$byParent = @{}
foreach ($p in (Get-CimInstance Win32_Process)) {
  $key = [int]$p.ParentProcessId
  if (-not $byParent.ContainsKey($key)) { $byParent[$key] = @() }
  $byParent[$key] += $p
}
$pat = '${CLI_PATTERN}'
function Find-Cli($parentId) {
  foreach ($c in $byParent[[int]$parentId]) {
    if ($null -eq $c) { continue }
    $text = $c.Name + ' ' + $c.CommandLine
    if ($text -match $pat) {
      $kw = $Matches[2].ToLower()
      if ($kw.StartsWith('kimi')) { return 'kimi' }
      if ($kw.StartsWith('claude')) { return 'claude' }
      return 'codex'
    }
    $r = Find-Cli $c.ProcessId
    if ($r) { return $r }
  }
  return $null
}
foreach ($root in $roots) {
  $r = Find-Cli $root
  if ($r) { Write-Output "$root|$r" }
}
`
}

/** Returns a map of shell PID -> CLI name for shells that have one running. */
export function detectRunningClis(
  pids: number[],
  logger: Logger
): Promise<Map<number, string>> {
  return new Promise((resolve) => {
    const found = new Map<number, string>()
    if (pids.length === 0) {
      resolve(found)
      return
    }
    const encoded = Buffer.from(buildScript(pids), 'utf16le').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 8000 },
      (err, stdout) => {
        if (err) {
          logger.error('CLI Snapshot Failed', err)
          resolve(found)
          return
        }
        for (const line of stdout.split(/\r?\n/)) {
          const m = /^(\d+)\|(\w+)$/.exec(line.trim())
          if (m) found.set(parseInt(m[1], 10), m[2])
        }
        resolve(found)
      }
    )
  })
}
