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

$PythonReady = $null
$PythonCandidates = @()
if ($env:SCIENTIFIC_ILLUSTRATOR_PYTHON) { $PythonCandidates += $env:SCIENTIFIC_ILLUSTRATOR_PYTHON }
$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($PythonCommand) { $PythonCandidates += $PythonCommand.Source }
foreach ($Candidate in $PythonCandidates | Select-Object -Unique) {
  & $Candidate -c "import pptx" 2>$null
  if ($LASTEXITCODE -eq 0) { $PythonReady = $Candidate; break }
}
if (-not $PythonReady -and $PythonCommand) {
  $VenvDir = Join-Path $InstallDir "plugins\scientific-illustrator\scripts\.venv"
  & $PythonCommand.Source -m venv $VenvDir
  $VenvPython = Join-Path $VenvDir "Scripts\python.exe"
  & $VenvPython -m pip install --disable-pip-version-check "python-pptx>=1.0,<2"
  $PythonReady = $VenvPython
}
if ($PythonReady) {
  Write-Host "Presentation OOXML backend: $PythonReady"
} else {
  Write-Warning "Python with python-pptx was not found. Windows Microsoft PowerPoint COM remains available, but Windows WPS support requires Python 3 and python-pptx."
}

codex plugin marketplace add $InstallDir
codex plugin add $Plugin

Write-Host "Installed $Plugin"
Write-Host "Restart Codex and start a new task before first use."
Write-Host "Windows PowerPoint uses COM; WPS and unconnected Mac PowerPoint use the editable PPTX OOXML backend."
Write-Host "A connected Office.js task pane can also be selected explicitly; see the README for certificate and manifest sideload steps."
