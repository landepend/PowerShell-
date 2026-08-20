param([string]$StartupCommand = "")

function global:prompt {
    $loc = $executionContext.SessionState.Path.CurrentLocation
    $esc = [char]27
    $out = ''
    if ($loc.Provider.Name -eq 'FileSystem') {
        $out += "$esc]9;9;$($loc.ProviderPath)$esc\"
    }
    $out += "PS $loc$('>' * ($nestedPromptLevel + 1)) "
    return $out
}

if ($StartupCommand) {
    Invoke-Expression $StartupCommand
}
