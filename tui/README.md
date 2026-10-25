# Kaisu TUI

See the [root README](../README.md#the-terminal-version). Quick start:

```bash
node ../scripts/fetch-binaries.mjs   # once, for ffmpeg
uv run python main.py
```

Search, inspection and downloads run as managed subprocess jobs. Escape cancels the active job, including an active ffmpeg conversion; Ctrl+Q stops its process tree before quitting. Search and inspection have two-minute deadlines, and downloads have a 24-hour safety deadline.
