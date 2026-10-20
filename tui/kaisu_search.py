"""YouTube search through yt-dlp's `ytsearchN:` pseudo-URL (flat mode: one request, no per-video lookups).

Mirrors desktop/src-tauri/src/search.rs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

import yt_dlp

PAGE_SIZE = 12
MAX_RESULTS = 48
MAX_QUERY_CHARS = 200
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


@dataclass(frozen=True)
class Result:
    id: str
    title: str
    url: str
    channel: str | None
    duration: float | None
    views: int | None
    live: bool


def clean_query(query: str) -> str:
    q = " ".join(query.split())
    if not q:
        raise ValueError("Type something to search for.")
    if len(q) > MAX_QUERY_CHARS:
        raise ValueError(f"Search is limited to {MAX_QUERY_CHARS} characters.")
    return q


def parse_results(info: dict) -> list[Result]:
    results = []
    for e in info.get("entries") or []:
        vid, title = e.get("id"), e.get("title")
        # Channels and playlists can show up in results; only videos have an 11-character id.
        if not (isinstance(vid, str) and _VIDEO_ID.match(vid) and title):
            continue
        results.append(
            Result(
                id=vid,
                title=title,
                url=f"https://www.youtube.com/watch?v={vid}",
                channel=e.get("channel") or e.get("uploader"),
                duration=e.get("duration"),
                views=e.get("view_count"),
                live=e.get("live_status") in ("is_live", "is_upcoming"),
            )
        )
    return results


def search(query: str, limit: int = PAGE_SIZE) -> list[Result]:
    query = clean_query(query)
    limit = max(1, min(limit, MAX_RESULTS))
    opts = {"extract_flat": "in_playlist", "quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    return parse_results(info or {})


# ---- display helpers ---------------------------------------------------------------------------


def fmt_duration(seconds: float | None) -> str:
    if seconds is None:
        return "--:--"
    total = round(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def fmt_count(n: int | None) -> str:
    if n is None:
        return ""
    for size, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if n >= size:
            value = n / size
            text = f"{round(value)}" if value >= 100 else f"{value:.1f}".removesuffix(".0")
            return text + suffix
    return str(n)


def fmt_date(yyyymmdd: str | None) -> str:
    try:
        return datetime.strptime(yyyymmdd or "", "%Y%m%d").strftime("%b %d, %Y").replace(" 0", " ")
    except ValueError:
        return ""
