#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-$HOME/.codex/marketplaces/scientific-illustrator}"
REPOSITORY="https://github.com/icebird1998/scientific-illustrator.git"
PLUGIN="scientific-illustrator@scientific-illustrator-tools"

command -v git >/dev/null || { echo "Git is required." >&2; exit 1; }
command -v codex >/dev/null || { echo "Codex CLI is required." >&2; exit 1; }

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
elif [[ -e "$INSTALL_DIR" ]]; then
  echo "Install directory exists but is not this Git repository: $INSTALL_DIR" >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPOSITORY" "$INSTALL_DIR"
fi

codex plugin marketplace add "$INSTALL_DIR"
codex plugin add "$PLUGIN"

echo "Installed $PLUGIN"
echo "Restart Codex and start a new task before first use."
echo "PowerPoint live control requires Windows; draw.io remains available on supported desktop systems."
