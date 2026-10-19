# Starts the Kaisu TUI, installing `uv` first if it's missing. uv fetches Python and all
# dependencies itself, so nothing else needs to be set up beforehand.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# uv's installer puts it here, which may not be on PATH yet in this session.
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Kaisu's terminal app needs 'uv', a small tool that sets up Python and"
    Write-Host "the required packages for you (https://docs.astral.sh/uv/)."
    $answer = Read-Host "Install uv now? It goes in your user profile and nothing else is changed. [Y/n]"
    if ($answer -and $answer -notmatch '^[Yy]') {
        Write-Host "Okay. Install uv yourself, then run this again:  winget install --id=astral-sh.uv -e"
        exit 1
    }
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Write-Host "uv was installed but isn't on PATH yet. Open a new terminal and run this again."
        exit 1
    }
}

uv run python main.py @args
exit $LASTEXITCODE
