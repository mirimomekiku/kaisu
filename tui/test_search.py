"""Offline tests for kaisu_search. Run: uv run python -m unittest -v"""

import unittest

import kaisu_search as ks


class Parsing(unittest.TestCase):
    def test_only_real_videos_are_kept(self):
        info = {
            "entries": [
                {"id": "jNQXAC9IVRw", "title": "Me at the zoo", "channel": "jawed", "duration": 19, "view_count": 5},
                {"id": "UC4QobU6STFB0P71PMvOGN5A", "title": "a channel"},
                {"id": "short", "title": "bad id"},
                {"id": "abcdefghijk", "title": "Live", "live_status": "is_live"},
                {"id": "abcdefghijl"},
            ]
        }
        r = ks.parse_results(info)
        self.assertEqual([x.id for x in r], ["jNQXAC9IVRw", "abcdefghijk"])
        self.assertEqual(r[0].url, "https://www.youtube.com/watch?v=jNQXAC9IVRw")
        self.assertTrue(r[1].live and not r[0].live)

    def test_missing_entries(self):
        self.assertEqual(ks.parse_results({}), [])
        self.assertEqual(ks.parse_results({"entries": None}), [])


class Query(unittest.TestCase):
    def test_normalised_and_bounded(self):
        self.assertEqual(ks.clean_query("  lo   fi \n beats "), "lo fi beats")
        with self.assertRaises(ValueError):
            ks.clean_query("   ")
        with self.assertRaises(ValueError):
            ks.clean_query("a" * 201)
        self.assertEqual(ks.clean_query("--exec calc"), "--exec calc")  # plain text, never an option


class Formatting(unittest.TestCase):
    def test_duration(self):
        self.assertEqual(ks.fmt_duration(None), "--:--")
        self.assertEqual(ks.fmt_duration(65), "1:05")
        self.assertEqual(ks.fmt_duration(3725), "1:02:05")

    def test_count(self):
        self.assertEqual([ks.fmt_count(n) for n in (None, 999, 1234, 45210, 445392114, 2_000_000_000)], ["", "999", "1.2K", "45.2K", "445M", "2B"])

    def test_date(self):
        self.assertEqual(ks.fmt_date("20050219"), "Feb 19, 2005")
        self.assertEqual(ks.fmt_date("20140530"), "May 30, 2014")
        self.assertEqual(ks.fmt_date("20140503"), "May 3, 2014")
        self.assertEqual(ks.fmt_date(None), "")
        self.assertEqual(ks.fmt_date("garbage"), "")


if __name__ == "__main__":
    unittest.main()
