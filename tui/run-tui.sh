#!/usr/bin/env sh
# Starts the Kaisu TUI, installing `uv` first if it's missing. uv fetches Python and all
# dependencies itself, so nothing else needs to be set up beforehand.
set -eu
cd "$(dirname "$0")"

# uv's installer puts it here, which may not be on PATH yet in this shell.
PATH="$HOME/.local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  echo "Kaisu's terminal app needs 'uv', a small tool that sets up Python and"
  echo "the required packages for you (https://docs.astral.sh/uv/)."
  printf "Install uv now? It goes in ~/.local/bin and nothing else is changed. [Y/n] "
  read -r answer || answer=n
  case "$answer" in
    ""|[Yy]*) ;;
    *) echo "Okay. Install uv yourself, then run this again:  curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1 ;;
  esac
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://astral.sh/uv/install.sh | sh
  else
    echo "Neither curl nor wget is available to download uv. Install one of them (or uv itself) and try again."
    exit 1
  fi
  command -v uv >/dev/null 2>&1 || { echo "uv was installed but isn't on PATH yet. Open a new terminal and run this again."; exit 1; }
fi

exec uv run python main.py "$@"
