param(
  [string]$InstallDir = "$HOME\.codex\marketplaces\scientific-illustrator"
)

$ErrorActionPreference = "Stop"
$Repository = "https://github.com/icebird1998/scientific-illustrator.git"
$Plugin = "scientific-illustrator@scientific-illustrator-tools"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is required. Install Git for Windows, then run this installer again."
}

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  throw "Codex CLI was not found. Install or update the Codex app/CLI, then run this installer again."
}

if (Test-Path (Join-Path $InstallDir ".git")) {
  git -C $InstallDir pull --ff-only
} elseif (Test-Path $InstallDir) {
  throw "Install directory exists but is not this Git repository: $InstallDir"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
  git clone $Repository $InstallDir
}

codex plugin marketplace add $InstallDir
codex plugin add $Plugin

Write-Host "Installed $Plugin"
Write-Host "Restart Codex and start a new task before first use."
Write-Host "For PowerPoint, use Windows with desktop Microsoft PowerPoint installed."
