"""Cancellable yt-dlp subprocess jobs, including its ffmpeg children."""
from __future__ import annotations

import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


class Cancelled(Exception):
    pass


_jobs: set[subprocess.Popen] = set()
_lock = threading.Lock()


def _kill_tree(child: subprocess.Popen) -> None:
    # The group may still contain ffmpeg even if the direct child already exited.
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True, timeout=5,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            os.killpg(child.pid, signal.SIGKILL)
    except (OSError, subprocess.TimeoutExpired):
        try:
            child.kill()
        except OSError:
            pass


def shutdown_jobs() -> None:
    with _lock:
        jobs = list(_jobs)
    for child in jobs:
        _kill_tree(child)


def run_job(operation: str, payload: str, options: dict, cancel: threading.Event,
            on_event=lambda event: None, timeout: float = 1800, *, command: list[str] | None = None):
    if cancel.is_set():
        raise Cancelled()
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
    child = subprocess.Popen(command or [sys.executable, str(Path(__file__).with_name("kaisu_worker.py"))],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, encoding="utf-8", errors="replace", **kwargs)
    with _lock:
        _jobs.add(child)
    events: queue.Queue = queue.Queue(maxsize=256)
    stop_readers = threading.Event()

    def read(stream, kind):
        try:
            for line in stream:
                while not stop_readers.is_set():
                    try:
                        events.put((kind, line), timeout=.1)
                        break
                    except queue.Full:
                        pass
                if stop_readers.is_set():
                    break
        finally:
            stream.close()

    readers = [threading.Thread(target=read, args=(child.stdout, "event"), daemon=True),
               threading.Thread(target=read, args=(child.stderr, "error"), daemon=True)]
    for reader in readers:
        reader.start()
    result, got_result, errors = None, False, []
    deadline = time.monotonic() + timeout
    try:
        child.stdin.write(json.dumps({"operation": operation, "payload": payload, "options": options}) + "\n")
        child.stdin.close()
        while True:
            if cancel.is_set():
                raise Cancelled()
            if time.monotonic() >= deadline:
                raise TimeoutError("The operation took too long. Try again or check your connection.")
            try:
                kind, line = events.get(timeout=.05)
            except queue.Empty:
                if child.poll() is not None and not any(reader.is_alive() for reader in readers) and events.empty():
                    break
                continue
            if kind == "error":
                errors = (errors + [line.strip()])[-10:]
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("kind") == "result":
                result, got_result = event.get("data"), True
            elif event.get("kind") == "error":
                errors.append(str(event.get("message", "Download failed")))
            else:
                on_event(event)
        if cancel.is_set():
            raise Cancelled()
        if child.returncode != 0 or not got_result:
            raise RuntimeError("\n".join(errors[-10:]) or "The downloader exited without a result.")
        return result
    finally:
        stop_readers.set()
        _kill_tree(child)
        child.wait(timeout=10)
        with _lock:
            _jobs.discard(child)
        for reader in readers:
            reader.join(timeout=1)

