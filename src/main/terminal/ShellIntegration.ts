import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Logger } from '../logger'

/**
 * PowerShell shell-integration script.
 *
 * A custom prompt emits OSC 9;9 (ConEmu-style cwd report) on every prompt
 * render, so the host can track cwd changes (`cd D:\A` -> `cd D:\B`)
 * without parsing user input. An optional startup command (e.g. `kimi`)
 * runs inside the shell, so when the CLI exits the user lands back in
 * PowerShell with cwd tracking still active.
 */
const SCRIPT = `param([string]$StartupCommand = "")

function global:prompt {
    $loc = $executionContext.SessionState.Path.CurrentLocation
    $esc = [char]27
    $out = ''
    if ($loc.Provider.Name -eq 'FileSystem') {
        $out += "$esc]9;9;$($loc.ProviderPath)$esc\\"
    }
    $out += "PS $loc$('>' * ($nestedPromptLevel + 1)) "
    return $out
}

if ($StartupCommand) {
    Invoke-Expression $StartupCommand
}
`

const SCRIPT_NAME = 'pss-shell-integration.ps1'

export class ShellIntegration {
  private readonly scriptPath: string

  constructor(dataDir: string, logger: Logger) {
    mkdirSync(dataDir, { recursive: true })
    this.scriptPath = join(dataDir, SCRIPT_NAME)
    // Rewritten on every start so app updates naturally ship script changes.
    writeFileSync(this.scriptPath, SCRIPT, 'utf8')
    logger.log('ShellIntegration', this.scriptPath)
  }

  /** Args for powershell.exe; startupCommand runs after the prompt hook is installed. */
  spawnArgs(startupCommand?: string): string[] {
    const args = ['-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath]
    if (startupCommand) args.push('-StartupCommand', startupCommand)
    return args
  }
}
