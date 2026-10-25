import os
import sys
import threading
import time
import unittest

import kaisu_jobs as jobs


class Jobs(unittest.TestCase):
    def test_result_is_read_before_exit(self):
        result = jobs.run_job("inspect", "", {}, threading.Event(), command=[sys.executable, "-c", 'import sys,json;sys.stdin.readline();print(json.dumps({"kind":"result","data":{"title":"ok"}}))'])
        self.assertEqual(result, {"title": "ok"})

    def test_cancel_interrupts_a_stalled_process(self):
        cancel = threading.Event()
        timer = threading.Timer(.15, cancel.set)
        timer.start()
        start = time.monotonic()
        try:
            with self.assertRaises(jobs.Cancelled):
                jobs.run_job("download", "", {}, cancel, timeout=20, command=[sys.executable, "-c", "import sys,time;sys.stdin.readline();time.sleep(30)"])
        finally:
            timer.cancel()
        self.assertLess(time.monotonic() - start, 4)
        self.assertFalse(jobs._jobs)

    def test_timeout_and_exit_without_result_are_errors(self):
        with self.assertRaises(TimeoutError):
            jobs.run_job("search", "", {}, threading.Event(), timeout=.1, command=[sys.executable, "-c", "import sys,time;sys.stdin.readline();time.sleep(30)"])
        with self.assertRaisesRegex(RuntimeError, "without a result"):
            jobs.run_job("inspect", "", {}, threading.Event(), command=[sys.executable, "-c", "import sys;sys.stdin.readline()"])

    @unittest.skipIf(os.name == "nt", "POSIX process-group inspection")
    def test_cancel_also_kills_a_spawned_helper(self):
        cancel = threading.Event()
        helper = []
        def event(message):
            helper.append(message["pid"])
            cancel.set()
        code = 'import sys,time,subprocess,json;sys.stdin.readline();p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]);print(json.dumps({"kind":"helper","pid":p.pid}),flush=True);time.sleep(30)'
        with self.assertRaises(jobs.Cancelled):
            jobs.run_job("download", "", {}, cancel, event, command=[sys.executable, "-c", code])
        self.assertTrue(helper)
        state = __import__("pathlib").Path(f"/proc/{helper[0]}/stat")
        def gone():
            try:
                return state.read_text().split()[2] == "Z"
            except (FileNotFoundError, ProcessLookupError):
                return True
        for _ in range(50):
            if gone():
                break
            time.sleep(.02)
        self.assertTrue(gone())

