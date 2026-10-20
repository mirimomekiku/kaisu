import os
import threading
from pathlib import Path

import yt_dlp
from rich.text import Text

import kaisu_search
import kaisu_setup
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.screen import ModalScreen
from textual.widgets.option_list import Option
from textual.widgets import (
    Button,
    Footer,
    Header,
    Input,
    Label,
    OptionList,
    ProgressBar,
    RadioButton,
    RadioSet,
    RichLog,
)

# Same presets (and the same selectors) as the desktop app.
SORT = ["res", "ext:mp4:m4a"]
PRESETS = {
    "fmt-best": {"format": "bv*+ba/b", "label": "Best quality (MP4)"},
    "fmt-1080p": {"format": "bv*[height<=1080]+ba/b[height<=1080]", "label": "1080p (MP4)"},
    "fmt-720p": {"format": "bv*[height<=720]+ba/b[height<=720]", "label": "720p (MP4)"},
    "fmt-mp3": {"format": "ba/b", "label": "Audio only (MP3)"},
}


def default_out_dir() -> Path:
    return Path(os.environ.get("KAISU_OUT") or Path.home() / "Downloads")


def valid_url(url: str) -> bool:
    return url.startswith(("http://", "https://")) and not any(c.isspace() for c in url)


class Cancelled(yt_dlp.utils.DownloadCancelled):
    """Raised from yt-dlp hooks to abort; DownloadCancelled is not retried or swallowed."""


class SetupScreen(ModalScreen[bool]):
    """First-run helper: installs ffmpeg / a JavaScript runtime if they are missing."""

    DEFAULT_CSS = """
    SetupScreen { align: center middle; }
    #setup-box { width: 74; height: auto; max-height: 90%; background: #18181b; border: round #f43f5e; padding: 1 2; }
    #setup-title { text-style: bold; color: #f43f5e; margin-bottom: 1; }
    #setup-parts { margin: 1 0; }
    #setup-progress { margin-top: 1; }
    #setup-status { color: #a1a1aa; margin-top: 1; }
    #setup-manual { color: #71717a; margin-top: 1; }
    #setup-buttons { height: auto; margin-top: 1; }
    #setup-buttons Button { margin-right: 2; }
    """

    LABELS = {"ffmpeg": "Media converter (ffmpeg): joins video and audio, makes MP3s",
              "js": "YouTube helper (Deno): lets the downloader read YouTube"}

    def __init__(self, missing: list[str]) -> None:
        super().__init__()
        self.missing = missing
        self._installing = False

    def compose(self) -> ComposeResult:
        auto = kaisu_setup.assets() is not None
        with Vertical(id="setup-box"):
            yield Label("Let's get Kaisu ready", id="setup-title")
            yield Label("A few helper tools are missing. Kaisu can download them for you.")
            yield Label("\n".join(f"  - {self.LABELS[m]}" for m in self.missing), id="setup-parts")
            if auto:
                yield Label(f"Detected {kaisu_setup.platform_label()}. Roughly 100-200 MB from the official project pages, "
                            "verified before use. Nothing is installed system-wide.")
            else:
                yield Label(f"Automatic setup isn't available for {kaisu_setup.platform_label()}.")
            yield ProgressBar(id="setup-progress", total=100, show_eta=False)
            yield Label("", id="setup-status")
            with Horizontal(id="setup-buttons"):
                if auto:
                    yield Button("Install automatically", id="setup-install", variant="primary")
                yield Button("Continue without", id="setup-skip")
            yield Label("Or install by hand, then restart:\n  " + "\n  ".join(kaisu_setup.manual_steps()), id="setup-manual")

    def on_mount(self) -> None:
        self.query_one("#setup-progress", ProgressBar).display = False

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "setup-skip" and not self._installing:
            self.dismiss(False)
        elif event.button.id == "setup-install" and not self._installing:
            self._installing = True
            event.button.disabled = True
            self.query_one("#setup-progress", ProgressBar).display = True
            self.run_worker(self._install_worker, thread=True, exclusive=True)

    def _install_worker(self) -> None:
        def progress(component: str, pct: float, label: str) -> None:
            self.app.call_from_thread(self._show_progress, pct, label)

        try:
            kaisu_setup.install(self.missing, progress)
        except kaisu_setup.SetupError as e:
            self.app.call_from_thread(self._failed, str(e))
        except Exception as e:  # never leave the dialog stuck
            self.app.call_from_thread(self._failed, f"Unexpected error: {e}")
        else:
            self.app.call_from_thread(self.dismiss, True)

    def _show_progress(self, pct: float, label: str) -> None:
        self.query_one("#setup-progress", ProgressBar).update(progress=pct)
        self.query_one("#setup-status", Label).update(Text(label, style="cyan"))

    def _failed(self, message: str) -> None:
        self._installing = False
        self.query_one("#setup-install", Button).disabled = False
        self.query_one("#setup-install", Button).label = "Try again"
        self.query_one("#setup-status", Label).update(Text(message, style="bold red"))


class KaisuTUI(App):
    """Kaisu Terminal UI for yt-dlp."""

    CSS = """
    Screen { background: #09090b; color: #f4f4f5; }
    Header { background: #18181b; color: #f43f5e; text-style: bold; }
    #main-container { padding: 1 2; }
    .box { border: solid #27272a; background: #18181b; padding: 1; margin-bottom: 1; }
    #input-row { height: auto; margin-bottom: 1; }
    #url-input { width: 1fr; border: solid #3f3f46; background: #09090b; color: #ffffff; }
    #url-input:focus { border: solid #f43f5e; }
    .btn-action { margin-left: 1; background: #e11d48; color: #ffffff; text-style: bold; }
    .btn-action:hover { background: #f43f5e; }
    .btn-action:disabled { background: #3f3f46; color: #a1a1aa; }
    #options-container { height: auto; }
    RadioSet { layout: horizontal; background: transparent; border: none; height: auto; }
    RadioButton { padding-right: 2; }
    #progress-container { height: auto; padding: 1; background: #18181b; border: solid #27272a; margin-bottom: 1; }
    #status-label { color: #a1a1aa; margin-bottom: 1; }
    ProgressBar { padding: 0; }
    #results { height: 12; border: solid #27272a; background: #09090b; margin-bottom: 1; display: none; }
    #results:focus { border: solid #f43f5e; }
    #log-container { height: 1fr; border: solid #27272a; background: #09090b; }
    RichLog { background: #09090b; color: #a1a1aa; }
    """

    BINDINGS = [
        Binding("f2", "inspect", "Inspect"),
        Binding("f5", "start_download", "Download"),
        Binding("escape", "cancel", "Cancel"),
        Binding("f6", "clear_logs", "Clear log"),
        Binding("f1", "setup", "Setup"),
        Binding("ctrl+q", "quit", "Quit"),
    ]

    busy = reactive(False)

    def __init__(self, out_dir: Path | None = None) -> None:
        super().__init__()
        self.out_dir = out_dir or default_out_dir()
        self._refresh_tools()
        self._cancel = threading.Event()
        self._search_query, self._search_limit = "", kaisu_search.PAGE_SIZE

    def _refresh_tools(self) -> None:
        ffmpeg = kaisu_setup.locate_ffmpeg_dir()
        self.ffmpeg_dir = str(ffmpeg) if ffmpeg else None
        self.js_runtime = kaisu_setup.locate_js_runtime()

    def _tool_opts(self) -> dict:
        """yt-dlp options pointing at the helper tools we located."""
        opts: dict = {}
        if self.ffmpeg_dir:
            opts["ffmpeg_location"] = self.ffmpeg_dir
        if self.js_runtime:
            name, path = self.js_runtime
            opts["js_runtimes"] = {name: {"path": str(path)}}
        return opts

    # ---- layout -------------------------------------------------------------
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Vertical(id="main-container"):
            with Horizontal(id="input-row"):
                yield Input(
                    placeholder="Paste a video link, or type words and press Enter to search YouTube",
                    id="url-input",
                )
                yield Button("Search", id="btn-search", classes="btn-action")
                yield Button("Inspect", id="btn-inspect", classes="btn-action")
                yield Button("Download", id="btn-download", classes="btn-action")

            with Container(classes="box", id="options-container"):
                yield Label("Format preset:")
                with RadioSet(id="format-radio"):
                    first = True
                    for rid, preset in PRESETS.items():
                        yield RadioButton(preset["label"], id=rid, value=first)
                        first = False

            yield OptionList(id="results")

            with Container(id="progress-container"):
                yield Label("Ready. Paste a link or search above.", id="status-label")
                yield ProgressBar(id="progress-bar", total=100, show_eta=True)

            with VerticalScroll(id="log-container"):
                yield RichLog(id="rich-log", highlight=True, markup=False, wrap=True)

        yield Footer()

    def on_mount(self) -> None:
        self.title = "Kaisu - yt-dlp Suite"
        self.sub_title = f"yt-dlp {yt_dlp.version.__version__}"
        self._log(("Kaisu TUI ready.", "bold cyan"))
        self._log((f"yt-dlp {yt_dlp.version.__version__} | {kaisu_setup.platform_label()}", "dim"))
        self._log((f"Saving to: {self.out_dir}", "dim"))
        self._log(("Enter search/inspect, F2 inspect, F5 download, Esc cancel, F6 clear log, F1 setup, Ctrl+Q quit.\n", "dim"))
        self.action_setup(only_if_missing=True)

    def action_setup(self, only_if_missing: bool = False) -> None:
        """Offer to install missing helper tools (always shows the dialog when invoked with F1)."""
        missing = kaisu_setup.missing_components()
        if not missing:
            self._report_tools()
            if not only_if_missing:
                self._log(("All helper tools are already installed.", "green"))
            return
        self.push_screen(SetupScreen(missing), self._after_setup)

    def _after_setup(self, installed: bool | None) -> None:
        self._refresh_tools()
        if installed:
            self._log(("Helper tools installed.", "green"))
        self._report_tools()

    def _report_tools(self) -> None:
        js = f"{self.js_runtime[0]} ({self.js_runtime[1]})" if self.js_runtime else "NOT FOUND"
        self._log((f"ffmpeg: {self.ffmpeg_dir or 'NOT FOUND'} | js runtime: {js}", "dim"))
        if not self.ffmpeg_dir:
            self._log(("ffmpeg is missing: merging video and MP3 conversion won't work. Press F1 to set up.", "yellow"))
        if not self.js_runtime:
            self._log(("No JavaScript runtime: some YouTube formats may be missing. Press F1 to set up.", "yellow"))

    # ---- output helpers (never parse yt-dlp text as markup) ----------------------
    def _log(self, *parts: tuple[str, str] | str) -> None:
        text = Text()
        for part in parts:
            if isinstance(part, tuple):
                text.append(part[0], style=part[1])
            else:
                text.append(part)
        self.query_one(RichLog).write(text)

    def _status(self, message: str, style: str = "") -> None:
        self.query_one("#status-label", Label).update(Text(message, style=style))

    def watch_busy(self, busy: bool) -> None:
        for button in self.query(Button):
            button.disabled = busy

    # ---- actions ---------------------------------------------------------------
    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-download":
            self.action_start_download()
        elif event.button.id == "btn-inspect":
            self.action_inspect()
        elif event.button.id == "btn-search":
            self.action_search()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Enter: a link is inspected, anything else is searched."""
        text = event.value.strip()
        if valid_url(text):
            self.action_inspect()
        else:
            self.action_search()

    def action_clear_logs(self) -> None:
        self.query_one(RichLog).clear()

    def action_cancel(self) -> None:
        if self.busy:
            self._cancel.set()
            self._status("Cancelling...", "yellow")

    def _read_url(self) -> str | None:
        url = self.query_one("#url-input", Input).value.strip()
        if not valid_url(url):
            self._status("Enter a full http(s) link without spaces", "bold red")
            return None
        return url

    def action_inspect(self) -> None:
        if self.busy or not (url := self._read_url()):
            return
        self.busy = True
        self._status("Inspecting...", "yellow")
        self._log(("Fetching metadata: ", "bold blue"), url)
        self.run_worker(lambda: self._inspect_worker(url), thread=True, exclusive=True)

    # ---- search -------------------------------------------------------------------------------
    _MORE = "__more__"

    def action_search(self, limit: int = kaisu_search.PAGE_SIZE) -> None:
        if self.busy:
            return
        query = self.query_one("#url-input", Input).value.strip()
        try:
            query = kaisu_search.clean_query(query)
        except ValueError as e:
            self._status(str(e), "bold red")
            return
        self.busy = True
        self._search_query, self._search_limit = query, limit
        self._status(f"Searching YouTube for: {query}", "yellow")
        self.run_worker(lambda: self._search_worker(query, limit), thread=True, exclusive=True)

    def _search_worker(self, query: str, limit: int) -> None:
        try:
            results = kaisu_search.search(query, limit)
            self.call_from_thread(self._show_results, results)
        except ValueError as e:
            self.call_from_thread(self._fail, str(e))
        except Exception as e:
            self.call_from_thread(self._fail, str(e))

    def _show_results(self, results: list[kaisu_search.Result]) -> None:
        listing = self.query_one("#results", OptionList)
        listing.clear_options()
        if not results:
            self._status("No videos found. Try different words.", "yellow")
            listing.display = False
            self.busy = False
            return
        for r in results:
            line2 = " · ".join(
                x for x in (r.channel, "LIVE" if r.live else kaisu_search.fmt_duration(r.duration),
                            f"{kaisu_search.fmt_count(r.views)} views" if r.views is not None else "") if x
            )
            listing.add_option(Option(Text.assemble((r.title, "bold"), "\n  ", (line2, "dim")), id=r.url))
        if len(results) >= self._search_limit and self._search_limit < kaisu_search.MAX_RESULTS:
            listing.add_option(Option(Text("  Show more results...", style="cyan"), id=self._MORE))
        listing.display = True
        self._status(f"{len(results)} results for: {self._search_query}. Pick one with Up/Down and Enter.", "green")
        self.busy = False
        listing.focus()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        if self.busy:
            return
        choice = event.option.id
        if choice == self._MORE:
            self.action_search(min(self._search_limit + kaisu_search.PAGE_SIZE, kaisu_search.MAX_RESULTS))
            return
        self.query_one("#url-input", Input).value = str(choice)
        self.action_inspect()

    def _inspect_worker(self, url: str) -> None:
        opts = {"skip_download": True, "quiet": True, "no_warnings": True, "noplaylist": True, **self._tool_opts()}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            self.call_from_thread(self._show_info, info)
        except Exception as e:  # yt-dlp raises many types
            self.call_from_thread(self._fail, str(e))

    def _show_info(self, info: dict) -> None:
        title = info.get("title") or "Unknown"
        self._status(f"Found: {title[:60]}. Choose Video or Audio below, then press F5.", "green")
        self._log(("Video details", "green"))
        self._log("  Title:    ", title)
        self._log("  Channel:  ", info.get("uploader") or info.get("channel") or "Unknown")
        self._log("  Duration: ", "LIVE" if info.get("is_live") else kaisu_search.fmt_duration(info.get("duration")))
        if views := info.get("view_count"):
            self._log("  Views:    ", f"{views:,}")
        if likes := info.get("like_count"):
            self._log("  Likes:    ", f"{likes:,}")
        if date := kaisu_search.fmt_date(info.get("upload_date")):
            self._log("  Uploaded: ", date)
        if description := (info.get("description") or "").strip():
            lines = description.splitlines()
            snippet = " ".join(lines[:3])
            self._log("  About:    ", snippet[:240] + ("..." if len(snippet) > 240 or len(lines) > 3 else ""))
        if info.get("is_live"):
            self._log(("  This is a live stream; downloading may not work until it ends.", "yellow"))
        self._log(("  Pick 'Best quality (MP4)' for video or 'Audio only (MP3)' for audio, then F5.", "dim"))
        self._log("")
        self.busy = False

    def action_start_download(self) -> None:
        if self.busy or not (url := self._read_url()):
            return
        radio = self.query_one("#format-radio", RadioSet)
        preset_id = radio.pressed_button.id if radio.pressed_button else "fmt-best"
        self._cancel.clear()
        self.busy = True
        self.query_one("#progress-bar", ProgressBar).update(progress=0)
        self._status("Starting download...", "yellow")
        self._log(("Downloading: ", "bold magenta"), f"{url} [{PRESETS[preset_id]['label']}]")
        self.run_worker(lambda: self._download_worker(url, preset_id), thread=True, exclusive=True)

    def _build_opts(self, preset_id: str) -> dict:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        opts: dict = {
            "format": PRESETS[preset_id]["format"],
            "outtmpl": {"default": "%(title).150B [%(id)s].%(ext)s"},
            "paths": {"home": str(self.out_dir)},
            "noplaylist": True,
            "windows_filenames": True,
            "concurrent_fragment_downloads": 4,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "progress_hooks": [self._progress_hook],
            "postprocessor_hooks": [self._postprocessor_hook],
        }
        opts.update(self._tool_opts())
        if preset_id == "fmt-mp3":
            opts["postprocessors"] = [
                {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "0"},
                {"key": "FFmpegMetadata"},
            ]
        else:
            opts["format_sort"] = SORT
            opts["merge_output_format"] = "mp4"
        return opts

    def _download_worker(self, url: str, preset_id: str) -> None:
        self._streams_done = 0
        self._expected_streams = 1 if preset_id == "fmt-mp3" else 2
        self._last_format = None
        try:
            with yt_dlp.YoutubeDL(self._build_opts(preset_id)) as ydl:
                info = ydl.extract_info(url, download=True)
            downloads = info.get("requested_downloads") or []
            path = (downloads[0].get("filepath") if downloads else None) or "(unknown location)"
            self.call_from_thread(self._finish, path)
        except yt_dlp.utils.DownloadCancelled:
            self.call_from_thread(self._cancelled)
        except Exception as e:
            self.call_from_thread(self._fail, str(e))

    # ---- yt-dlp hooks (run on the worker thread) ----------------------------------
    def _progress_hook(self, d: dict) -> None:
        if self._cancel.is_set():
            raise Cancelled()
        if d["status"] != "downloading":
            return  # "finished" fires once per stream; completion is decided after extract_info returns

        fmt = d.get("info_dict", {}).get("format_id")
        if fmt != self._last_format:
            if self._last_format is not None:
                self._streams_done += 1
            self._last_format = fmt

        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        within = min(d.get("downloaded_bytes", 0) / total, 1.0) if total else 0.0
        idx = min(self._streams_done, self._expected_streams - 1)
        pct = min((idx + within) / self._expected_streams * 100, 99.0)
        speed = d.get("speed")
        eta = d.get("eta")
        self.call_from_thread(self._update_progress, pct, speed, eta)

    def _postprocessor_hook(self, d: dict) -> None:
        if self._cancel.is_set():
            raise Cancelled()
        if d["status"] == "started":
            self.call_from_thread(self._set_finalizing)

    # ---- UI callbacks (main thread) -----------------------------------------------
    def _update_progress(self, pct: float, speed: float | None, eta: int | None) -> None:
        self.query_one("#progress-bar", ProgressBar).update(progress=pct)
        parts = [f"Downloading {pct:.0f}%"]
        if speed:
            parts.append(f"{speed / 1_048_576:.1f} MB/s")
        if eta is not None:
            parts.append(f"ETA {eta}s")
        self._status(" | ".join(parts), "cyan")

    def _set_finalizing(self) -> None:
        self.query_one("#progress-bar", ProgressBar).update(progress=99)
        self._status("Finalizing (merging / converting)...", "yellow")

    def _finish(self, path: str) -> None:
        self.query_one("#progress-bar", ProgressBar).update(progress=100)
        self._status("Download complete", "bold green")
        self._log(("Saved: ", "bold green"), path, "\n")
        self.busy = False

    def _cancelled(self) -> None:
        self._status("Cancelled", "yellow")
        self._log(("Cancelled.", "yellow"), "\n")
        self.busy = False

    def _fail(self, message: str) -> None:
        self._status("Failed", "bold red")
        self._log(("Error: ", "bold red"), message, "\n")
        self.busy = False


def run(out_dir: Path | None = None) -> None:
    KaisuTUI(out_dir).run()
