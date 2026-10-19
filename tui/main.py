import argparse
from pathlib import Path

from app import run


def main() -> None:
    parser = argparse.ArgumentParser(prog="kaisu-tui", description="Kaisu terminal UI for yt-dlp")
    parser.add_argument("--out", type=Path, help="download folder (default: $KAISU_OUT or ~/Downloads)")
    run(parser.parse_args().out)


if __name__ == "__main__":
    main()
