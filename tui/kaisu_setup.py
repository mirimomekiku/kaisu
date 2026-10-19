"""Finds and installs the helper tools the TUI needs: ffmpeg/ffprobe and a JavaScript runtime.

(yt-dlp itself is a Python dependency, so uv/pip takes care of it.)

This mirrors desktop/src-tauri/src/setup.rs: same release sources, same checksum checks, and the
same managed folder, so tools installed by either app are found by the other. Keep the asset
tables below in sync with that file when changing them.
"""

from __future__ import annotations

import hashlib
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

EXE = ".exe" if sys.platform == "win32" else ""
REPO_BIN = Path(__file__).resolve().parent.parent / "bin"  # filled by `node scripts/fetch-binaries.mjs`

FFMPEG_BASE = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
DENO_BASE = "https://github.com/denoland/deno/releases/latest/download"

# progress(component, percent, label)
Progress = Callable[[str, float, str], None]


class SetupError(Exception):
    """A failure with a message that is safe to show to the user as-is."""


@dataclass(frozen=True)
class Assets:
    ffmpeg: str
    deno: str


ASSETS: dict[tuple[str, str], Assets] = {
    ("windows", "x86_64"): Assets("ffmpeg-master-latest-win64-lgpl.zip", "deno-x86_64-pc-windows-msvc.zip"),
    ("linux", "x86_64"): Assets("ffmpeg-master-latest-linux64-lgpl.tar.xz", "deno-x86_64-unknown-linux-gnu.zip"),
    ("linux", "aarch64"): Assets("ffmpeg-master-latest-linuxarm64-lgpl.tar.xz", "deno-aarch64-unknown-linux-gnu.zip"),
}


# ---- platform ---------------------------------------------------------------------------


def os_name() -> str:
    if sys.platform == "win32":
        return "windows"
    return "linux" if sys.platform.startswith("linux") else sys.platform


def arch_name() -> str:
    machine = platform.machine().lower()
    return {"amd64": "x86_64", "x86_64": "x86_64", "arm64": "aarch64", "aarch64": "aarch64"}.get(machine, machine)


def assets() -> Assets | None:
    return ASSETS.get((os_name(), arch_name()))


def platform_label() -> str:
    names = {"windows": "Windows", "linux": "Linux"}
    arch = {"x86_64": "64-bit", "aarch64": "ARM 64-bit"}.get(arch_name(), arch_name())
    return f"{names.get(os_name(), os_name())}, {arch}"


def managed_dir() -> Path:
    """Where tools we install go. Matches Tauri's app data dir for com.kaisu.app."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "com.kaisu.app" / "engine"


def _distro_ids() -> list[str]:
    try:
        text = Path("/etc/os-release").read_text()
    except OSError:
        return []
    ids: list[str] = []
    for line in text.splitlines():
        key, _, value = line.partition("=")
        value = value.strip().strip('"').lower()
        if key == "ID":
            ids.insert(0, value)
        elif key == "ID_LIKE":
            ids.extend(value.split())
    return ids


def manual_steps() -> list[str]:
    """Commands for installing the tools by hand, matched to this OS / distro."""
    if os_name() == "windows":
        return ["winget install Gyan.FFmpeg", "winget install DenoLand.Deno"]
    if os_name() == "linux":
        ids = _distro_ids()
        if {"fedora", "rhel", "centos"} & set(ids):
            step = "sudo dnf install ffmpeg-free"
        elif {"debian", "ubuntu"} & set(ids):
            step = "sudo apt install ffmpeg"
        elif "arch" in ids:
            step = "sudo pacman -S ffmpeg"
        elif {"suse", "opensuse"} & set(ids):
            step = "sudo zypper install ffmpeg"
        else:
            step = "Install ffmpeg with your distribution's package manager"
        return [step, "curl -fsSL https://deno.land/install.sh | sh"]
    return ["Install ffmpeg (with ffprobe) and deno, and make sure both are on your PATH"]


# ---- locating -----------------------------------------------------------------------------


def _has_ffmpeg(directory: Path) -> bool:
    return (directory / f"ffmpeg{EXE}").is_file() and (directory / f"ffprobe{EXE}").is_file()


def locate_ffmpeg_dir() -> Path | None:
    """A folder holding both ffmpeg and ffprobe: shared bin/, then managed, then PATH."""
    for directory in (REPO_BIN, managed_dir()):
        if _has_ffmpeg(directory):
            return directory
    found = shutil.which("ffmpeg")
    if found and _has_ffmpeg(Path(found).parent):
        return Path(found).parent
    return None


def locate_js_runtime() -> tuple[str, Path] | None:
    """(name, path) of deno from the managed folder or PATH, else node/bun from PATH."""
    managed = managed_dir() / f"deno{EXE}"
    if managed.is_file():
        return "deno", managed
    for name in ("deno", "node", "bun"):
        found = shutil.which(name)
        if found:
            return name, Path(found)
    return None


def missing_components() -> list[str]:
    missing = []
    if locate_ffmpeg_dir() is None:
        missing.append("ffmpeg")
    if locate_js_runtime() is None:
        missing.append("js")
    return missing


# ---- downloading ----------------------------------------------------------------------------


def checksum_for(sums: str, filename: str) -> str | None:
    """From a `<hash>  <name>` list (sha256sum format)."""
    for line in sums.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].lstrip("*") == filename:
            return parts[0].lower()
    return None


def single_checksum(text: str) -> str | None:
    """From a one-file checksum: `<hash>  <name>` or PowerShell's `Hash : <HASH>` block."""

    def is_hash(h: str) -> bool:
        return len(h) == 64 and all(c in "0123456789abcdefABCDEF" for c in h)

    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Hash"):
            candidate = line[4:].lstrip(" :").strip()
            if is_hash(candidate):
                return candidate.lower()
        elif line.split() and is_hash(line.split()[0]):
            return line.split()[0].lower()
    return None


def _open(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "kaisu"})
    try:
        return urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as e:
        raise SetupError(f"The download server answered {e.code} for {url}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise SetupError("Couldn't reach the download server. Check your internet connection and try again.") from e


def _get_text(url: str) -> str:
    with _open(url) as response:
        return response.read().decode("utf-8", "replace")


def _download(url: str, dest: Path, component: str, label: str, progress: Progress) -> str:
    """Streams `url` to `dest`, reporting progress, and returns the SHA-256 of what was written."""
    digest = hashlib.sha256()
    with _open(url) as response, dest.open("wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while chunk := response.read(256 * 1024):
            digest.update(chunk)
            out.write(chunk)
            done += len(chunk)
            if total:
                progress(component, min(done / total * 100, 100.0), label)
    return digest.hexdigest()


def _make_executable(path: Path) -> None:
    if sys.platform != "win32":
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _verify_runs(path: Path, flag: str) -> None:
    try:
        subprocess.run([str(path), flag], check=True, capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        raise SetupError(f"The downloaded {path.stem} doesn't run on this computer: {e}") from e


def _extract_member(opener, names: list[str], wanted: str, dest: Path) -> bool:
    """Copies the first archive member whose path ends with `wanted` (as a path segment)."""
    for name in names:
        if name == wanted or name.endswith("/" + wanted):
            with opener(name) as src, dest.open("wb") as out:
                shutil.copyfileobj(src, out)
            return True
    return False


def install_ffmpeg(progress: Progress) -> None:
    a = assets()
    if a is None:
        raise SetupError("Automatic setup isn't available for this computer. Follow the manual steps instead.")
    target = managed_dir()
    target.mkdir(parents=True, exist_ok=True)

    label = "Downloading the media converter…"
    expected = checksum_for(_get_text(f"{FFMPEG_BASE}/checksums.sha256"), a.ffmpeg)
    if not expected:
        raise SetupError(f"No checksum is published for {a.ffmpeg}")

    with tempfile.TemporaryDirectory(dir=target, prefix="ffmpeg-") as tmp:
        archive = Path(tmp) / a.ffmpeg
        if _download(f"{FFMPEG_BASE}/{a.ffmpeg}", archive, "ffmpeg", label, progress) != expected:
            raise SetupError("The downloaded file failed its safety check and was discarded.")

        progress("ffmpeg", 100.0, "Unpacking…")
        partials = {n: Path(tmp) / f"{n}{EXE}" for n in ("ffmpeg", "ffprobe")}
        try:
            if a.ffmpeg.endswith(".zip"):
                with zipfile.ZipFile(archive) as z:
                    names = z.namelist()
                    found = [_extract_member(z.open, names, f"bin/{n}{EXE}", p) for n, p in partials.items()]
            else:
                with tarfile.open(archive, "r:xz") as t:
                    members = {m.name: m for m in t.getmembers() if m.isfile()}
                    opener = lambda name: t.extractfile(members[name])  # noqa: E731
                    found = [_extract_member(opener, list(members), f"bin/{n}", p) for n, p in partials.items()]
        except (zipfile.BadZipFile, tarfile.TarError, OSError) as e:
            raise SetupError(f"The download couldn't be unpacked: {e}") from e
        if not all(found):
            raise SetupError("The download didn't contain ffmpeg and ffprobe")

        for name, partial in partials.items():
            _make_executable(partial)
        _verify_runs(partials["ffmpeg"], "-version")
        for name, partial in partials.items():
            os.replace(partial, target / f"{name}{EXE}")


def install_deno(progress: Progress) -> None:
    a = assets()
    if a is None:
        raise SetupError("Automatic setup isn't available for this computer. Follow the manual steps instead.")
    target = managed_dir()
    target.mkdir(parents=True, exist_ok=True)

    label = "Downloading the YouTube helper…"
    expected = single_checksum(_get_text(f"{DENO_BASE}/{a.deno}.sha256sum"))
    if not expected:
        raise SetupError("Could not read the published checksum for deno")

    with tempfile.TemporaryDirectory(dir=target, prefix="deno-") as tmp:
        archive = Path(tmp) / a.deno
        if _download(f"{DENO_BASE}/{a.deno}", archive, "js", label, progress) != expected:
            raise SetupError("The downloaded file failed its safety check and was discarded.")
        partial = Path(tmp) / f"deno{EXE}"
        try:
            with zipfile.ZipFile(archive) as z:
                ok = _extract_member(z.open, z.namelist(), f"deno{EXE}", partial)
        except (zipfile.BadZipFile, OSError) as e:
            raise SetupError(f"The download couldn't be unpacked: {e}") from e
        if not ok:
            raise SetupError("The download didn't contain deno")
        _make_executable(partial)
        _verify_runs(partial, "--version")
        os.replace(partial, target / f"deno{EXE}")


def install(components: list[str], progress: Progress) -> None:
    """Installs the named components ("ffmpeg", "js"). Raises SetupError with a friendly message."""
    if "ffmpeg" in components:
        install_ffmpeg(progress)
    if "js" in components:
        install_deno(progress)
