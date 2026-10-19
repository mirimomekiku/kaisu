"""Offline tests for kaisu_setup. Run: uv run python -m unittest -v"""

import io
import os
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import kaisu_setup as ks


class ChecksumParsing(unittest.TestCase):
    def test_sha256sum_list(self):
        sums = "abc123  yt-dlp_linux\ndef456 *ffmpeg.zip\n"
        self.assertEqual(ks.checksum_for(sums, "ffmpeg.zip"), "def456")
        self.assertIsNone(ks.checksum_for(sums, "missing"))

    def test_single_file_formats(self):
        h = "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490"
        self.assertEqual(ks.single_checksum(f"{h}  deno.zip\n"), h)
        ps = f"\r\nAlgorithm : SHA256\r\nHash      : {h.upper()}\r\nPath      : C:\\a\\deno.zip\r\n"
        self.assertEqual(ks.single_checksum(ps), h)
        self.assertIsNone(ks.single_checksum("nope"))


class Extraction(unittest.TestCase):
    def test_zip_member_is_matched_as_a_path_segment(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("pkg/bin/ffmpeg.exe", "FF")
            z.writestr("pkg/bin/ffprobe.exe", "FP")
            z.writestr("pkg/bin/notffmpeg.exe", "NO")
        buf.seek(0)
        with zipfile.ZipFile(buf) as z, tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            self.assertTrue(ks._extract_member(z.open, z.namelist(), "bin/ffmpeg.exe", out))
            self.assertEqual(out.read_bytes(), b"FF")
            self.assertFalse(ks._extract_member(z.open, z.namelist(), "bin/missing.exe", out))

    def test_tar_xz_member(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:xz") as t:
            for name, body in (("pkg/bin/ffmpeg", b"FF"), ("pkg/doc/ffmpeg", b"NO")):
                info = tarfile.TarInfo(name)
                info.size = len(body)
                t.addfile(info, io.BytesIO(body))
        buf.seek(0)
        with tarfile.open(fileobj=buf, mode="r:xz") as t, tempfile.TemporaryDirectory() as d:
            members = {m.name: m for m in t.getmembers() if m.isfile()}
            out = Path(d) / "out"
            self.assertTrue(ks._extract_member(lambda n: t.extractfile(members[n]), list(members), "bin/ffmpeg", out))
            self.assertEqual(out.read_bytes(), b"FF")


class Locating(unittest.TestCase):
    def _fake_tools(self, directory: Path, *names: str) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        for n in names:
            (directory / f"{n}{ks.EXE}").write_bytes(b"")
            (directory / f"{n}{ks.EXE}").chmod(0o755)

    def test_managed_dir_follows_xdg_data_home(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"XDG_DATA_HOME": d}):
            if os.name != "nt":
                self.assertEqual(ks.managed_dir(), Path(d) / "com.kaisu.app" / "engine")

    def test_everything_missing_then_found_in_managed_dir(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(
            os.environ, {"XDG_DATA_HOME": d, "APPDATA": d, "PATH": ""}
        ), mock.patch.object(ks, "REPO_BIN", Path(d) / "no-such-bin"):
            self.assertEqual(ks.missing_components(), ["ffmpeg", "js"])
            self._fake_tools(ks.managed_dir(), "ffmpeg", "ffprobe", "deno")
            self.assertEqual(ks.missing_components(), [])
            self.assertEqual(ks.locate_js_runtime()[0], "deno")

    def test_ffmpeg_without_ffprobe_does_not_count(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(
            os.environ, {"XDG_DATA_HOME": d, "APPDATA": d, "PATH": ""}
        ), mock.patch.object(ks, "REPO_BIN", Path(d) / "no-such-bin"):
            self._fake_tools(ks.managed_dir(), "ffmpeg")
            self.assertIn("ffmpeg", ks.missing_components())

    def test_js_runtime_falls_back_to_node_on_path(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(
            os.environ, {"XDG_DATA_HOME": d, "APPDATA": d, "PATH": str(Path(d) / "bin")}
        ):
            self._fake_tools(Path(d) / "bin", "node")
            self.assertEqual(ks.locate_js_runtime()[0], "node")


class PlatformTables(unittest.TestCase):
    def test_supported_platforms_have_assets_and_steps(self):
        for key in (("windows", "x86_64"), ("linux", "x86_64"), ("linux", "aarch64")):
            self.assertIn(key, ks.ASSETS)
        self.assertTrue(ks.manual_steps())


if __name__ == "__main__":
    unittest.main()
