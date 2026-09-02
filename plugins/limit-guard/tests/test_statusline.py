"""The statusline wrapper: the data tap, the badge, and the never-fail promise."""

import json
import os
import shutil
import stat
import time
import unittest

from lgtest import TempHome, gate

SESSION = {
    "session_id": "abc",
    "model": {"id": "claude-opus-5", "display_name": "Opus"},
    "context_window": {"used_percentage": 8},
    "rate_limits": {
        "five_hour": {"used_percentage": 23.5, "resets_at": 1738425600},
        "seven_day": {"used_percentage": 41.2, "resets_at": 1738857600},
    },
}


def live(five=23.5, seven=41.2, ahead=3600):
    now = time.time()
    return {
        "model": {"display_name": "Opus"},
        "rate_limits": {
            "five_hour": {"used_percentage": five, "resets_at": now + ahead},
            "seven_day": {"used_percentage": seven, "resets_at": now + ahead * 24},
        },
    }


class TestCapture(TempHome):
    def test_cache_is_written_from_the_session_json(self):
        rc, out, err = self.run_statusline(json.dumps(SESSION))
        self.assertEqual(rc, 0, err)
        cached = json.loads(self.read("rate_limits.json"))
        self.assertEqual(cached["rate_limits"], SESSION["rate_limits"])
        self.assertEqual(cached["model"], SESSION["model"])
        self.assertEqual(cached["context_window"], {"used_percentage": 8})
        self.assertAlmostEqual(cached["captured_at"], time.time(), delta=30)

    def test_only_the_fields_we_read_are_kept(self):
        """The statusline payload carries cwd, transcript_path, session ids, PR
        and repo metadata. A cache that exists to answer "how full is the
        window" has no business storing any of it."""
        payload = dict(SESSION)
        payload.update(
            {
                "cwd": "/home/someone/secret-project",
                "transcript_path": "/home/someone/.claude/transcript.jsonl",
                "session_id": "s3cret",
                "workspace": {"repo": {"owner": "acme", "name": "internal"}},
                "cost": {"total_cost_usd": 1.23},
            }
        )
        self.run_statusline(json.dumps(payload))
        blob = self.read("rate_limits.json")
        for leaked in ("secret-project", "transcript", "s3cret", "acme", "total_cost"):
            self.assertNotIn(leaked, blob, leaked)
        self.assertEqual(
            set(json.loads(blob)),
            {"captured_at", "rate_limits", "context_window", "model", "version"},
        )

    def test_nested_junk_in_rate_limits_is_dropped(self):
        """`rate_limits` used to be stored verbatim, so "the cache holds only
        the fields the plugin reads" was false of everything nested inside it.
        The cache is read back and rendered into the status bar."""
        self.run_statusline(
            json.dumps(
                {
                    "rate_limits": {
                        "five_hour": {
                            "used_percentage": 23.5,
                            "resets_at": 1738425600,
                            "overage_status": {"deep": ["nested", "junk"]},
                            "note": "x" * 500,
                        }
                    }
                }
            )
        )
        blob = self.read("rate_limits.json")
        self.assertNotIn("nested", blob)
        self.assertNotIn("junk", blob)
        self.assertEqual(
            json.loads(blob)["rate_limits"],
            {"five_hour": {"used_percentage": 23.5, "resets_at": 1738425600}},
        )

    def test_a_flood_of_windows_is_capped(self):
        payload = {
            "rate_limits": {
                "w%03d" % i: {"used_percentage": 1, "resets_at": 2} for i in range(200)
            }
        }
        self.run_statusline(json.dumps(payload))
        kept = json.loads(self.read("rate_limits.json"))["rate_limits"]
        self.assertEqual(len(kept), gate.MAX_WINDOWS)

    def test_a_window_with_nothing_readable_is_dropped(self):
        self.run_statusline(json.dumps({"rate_limits": {"five_hour": {"junk": [1]}}}))
        self.assertIsNone(json.loads(self.read("rate_limits.json"))["rate_limits"])

    def test_nested_junk_in_model_is_dropped(self):
        self.run_statusline(
            json.dumps({"model": {"id": "m", "display_name": "M", "extra": {"a": 1}}})
        )
        self.assertEqual(
            json.loads(self.read("rate_limits.json"))["model"],
            {"id": "m", "display_name": "M"},
        )

    def test_cache_and_status_are_0600(self):
        self.run_statusline(json.dumps(SESSION))
        for name in ("rate_limits.json", "status.md"):
            self.assertEqual(stat.S_IMODE(os.stat(self.p(name)).st_mode), 0o600, name)

    def test_absent_rate_limits_are_recorded_as_null(self):
        """rate_limits is missing before the first API response of a session."""
        self.run_statusline(json.dumps({"model": {"display_name": "Opus"}}))
        self.assertIsNone(json.loads(self.read("rate_limits.json"))["rate_limits"])

    def test_write_is_atomic_and_leaves_no_temp_files(self):
        self.run_statusline(json.dumps(SESSION))
        leftovers = [n for n in os.listdir(self.statedir) if n.startswith(".lg-tmp-")]
        self.assertEqual(leftovers, [])

    def test_symlinked_cache_is_refused_without_writing_through_it(self):
        target = os.path.join(self.tmp, "victim.json")
        with open(target, "w") as fh:
            fh.write("ORIGINAL")
        os.symlink(target, self.p("rate_limits.json"))
        rc, out, err = self.run_statusline(json.dumps(SESSION))
        self.assertEqual(rc, 0, "the statusline must not fail")
        with open(target) as fh:
            self.assertEqual(fh.read(), "ORIGINAL", "symlink target was overwritten")


class TestBadge(TempHome):
    def badge_for(self, payload, env=None):
        rc, out, err = self.run_statusline(json.dumps(payload), env=env)
        self.assertEqual(rc, 0, err)
        return out

    def test_badge_shows_both_windows(self):
        out = self.badge_for(live(23.5, 41.2))
        self.assertRegex(out, r"^ \[5h 24%↻\d\d:\d\d \| 7d 41%↻\w{3} \d\d:\d\d\]$")

    def test_badge_is_empty_without_rate_limits(self):
        self.assertEqual(self.badge_for({"model": {"display_name": "Opus"}}), "")

    def test_badge_colors_by_severity(self):
        env = {"NO_COLOR": "", "LIMIT_GUARD_NO_COLOR": ""}
        self.assertIn("\033[32m", self.badge_for(live(10, 10), env=env))
        self.assertIn("\033[33m", self.badge_for(live(75, 10), env=env))
        self.assertIn("\033[31m", self.badge_for(live(92, 10), env=env))

    def test_paused_badge_replaces_the_numbers(self):
        until = time.time() + 3600
        self.write(
            "state.json",
            {"paused": True, "since": 1, "until": until, "window": "five_hour"},
        )
        out = self.badge_for(live(99, 10))
        self.assertIn("PAUSED", out)
        self.assertIn("⏸", out)
        self.assertNotIn("5h 99%", out)

    def test_expired_pause_clears_itself_on_a_statusline_run(self):
        """The statusline re-runs when a window resets, which is exactly when a
        pause should lift — even if no tool call happens."""
        self.write(
            "state.json",
            {"paused": True, "since": 1, "until": time.time() - 5, "window": "five_hour"},
        )
        out = self.badge_for(live(10, 10))
        self.assertNotIn("PAUSED", out)
        self.assertFalse(json.loads(self.read("state.json"))["paused"])
        self.assertIn("unpaused_time", self.read("log.jsonl"))


class TestInnerChaining(TempHome):
    def make_inner(self, body):
        path = os.path.join(self.tmp, "inner.sh")
        with open(path, "w") as fh:
            fh.write("#!/usr/bin/env bash\n" + body + "\n")
        os.chmod(path, 0o755)
        return "bash " + path

    def test_inner_output_precedes_the_badge_on_one_line(self):
        inner = self.make_inner('echo "[INNER]"')
        rc, out, err = self.run_statusline(
            json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": inner}
        )
        self.assertEqual(rc, 0, err)
        self.assertTrue(out.startswith("[INNER] ["), out)
        self.assertNotIn("\n", out, "the statusline must stay on one line")

    def test_inner_is_not_run_through_a_shell(self):
        """LIMIT_GUARD_INNER is executed as an argv vector. If it were passed to
        `bash -c`, whatever can set the environment could run anything."""
        canary = os.path.join(self.tmp, "PWNED")
        rc, out, err = self.run_statusline(
            json.dumps(live(23, 41)),
            env={"LIMIT_GUARD_INNER": "echo hi; touch " + canary},
        )
        self.assertEqual(rc, 0)
        self.assertFalse(os.path.exists(canary), "the inner command reached a shell")
        self.assertIn("5h", out, "the badge still renders when the inner fails")

    def test_inner_path_with_spaces_is_reported_not_guessed_at(self):
        """Quote-free paths only, documented as such. The old fallback retried
        the unsplit string, which was unreachable the moment argv[0] was a real
        command (`bash /my path/x.sh`) and would have meant running a failing
        inner statusline twice per render."""
        spaced = os.path.join(self.tmp, "my status line.sh")
        with open(spaced, "w") as fh:
            fh.write('#!/usr/bin/env bash\necho "[SPACED]"\n')
        os.chmod(spaced, 0o755)
        rc, out, err = self.run_statusline(
            json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": spaced}
        )
        self.assertEqual(rc, 0, err)
        self.assertNotIn("[SPACED]", out, "half a path was executed")
        self.assertIn("5h", out, "the badge still renders")
        entry = json.loads(self.read("log.jsonl").strip().splitlines()[-1])
        self.assertEqual(entry["event"], "inner_statusline_error")
        self.assertIn("spaces are not supported", entry["detail"])

    def test_an_unresolvable_inner_is_reported_in_the_log(self):
        rc, out, err = self.run_statusline(
            json.dumps(live(23, 41)),
            env={"LIMIT_GUARD_INNER": "/no/such/status line.sh"},
        )
        self.assertEqual(rc, 0, "the statusline still must not fail")
        self.assertIn("5h", out, "the badge still renders")
        entry = json.loads(self.read("log.jsonl").strip().splitlines()[-1])
        self.assertEqual(entry["event"], "inner_statusline_error")
        self.assertIn("not executable", entry["detail"])

    def test_a_crashing_inner_is_reported_in_the_log(self):
        path = os.path.join(self.tmp, "boom.sh")
        with open(path, "w") as fh:
            fh.write("#!/usr/bin/env bash\nexit 3\n")
        os.chmod(path, 0o755)
        self.run_statusline(json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": path})
        entry = json.loads(self.read("log.jsonl").strip().splitlines()[-1])
        self.assertEqual(entry["event"], "inner_statusline_error")
        self.assertIn("non-zero", entry["detail"])

    def test_a_healthy_inner_logs_nothing(self):
        inner = self.make_inner('echo "[INNER]"')
        self.run_statusline(json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": inner})
        self.assertFalse(os.path.exists(self.p("log.jsonl")))

    def test_inner_receives_the_same_stdin_json(self):
        inner = self.make_inner("python3 -c 'import sys,json; print(json.load(sys.stdin)[\"probe\"])'")
        payload = dict(live(23, 41))
        payload["probe"] = "SEEN"
        rc, out, _ = self.run_statusline(
            json.dumps(payload), env={"LIMIT_GUARD_INNER": inner}
        )
        self.assertTrue(out.startswith("SEEN"), out)

    def test_a_crashing_inner_statusline_still_yields_the_badge(self):
        inner = self.make_inner("echo boom >&2; exit 3")
        rc, out, err = self.run_statusline(
            json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": inner}
        )
        self.assertEqual(rc, 0)
        self.assertIn("5h", out)

    def test_chaining_is_off_by_default(self):
        """With LIMIT_GUARD_INNER unset the wrapper used to glob the plugin
        cache and EXECUTE caveman's statusline out of it — third-party code,
        auto-updating, run by default. Chaining is opt-in now."""
        cache_dir = os.path.join(
            self.cfgdir, "plugins", "cache", "caveman", "caveman", "1.2.3", "hooks"
        )
        os.makedirs(cache_dir)
        planted = os.path.join(cache_dir, "caveman-statusline.sh")
        canary = os.path.join(self.tmp, "EXECUTED")
        with open(planted, "w") as fh:
            fh.write("#!/usr/bin/env bash\ntouch %s\necho '[CAVEMAN]'\n" % canary)
        os.chmod(planted, 0o755)

        rc, out, err = self.run_statusline(
            json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": None}
        )
        self.assertEqual(rc, 0, err)
        self.assertFalse(os.path.exists(canary), "a plugin-cache script was executed")
        self.assertNotIn("[CAVEMAN]", out)
        self.assertTrue(out.startswith(" ["), out)

    @unittest.skipUnless(shutil.which("timeout"), "coreutils timeout not installed")
    def test_a_hanging_inner_cannot_cost_us_the_capture(self):
        """The inner used to run first and unbounded. Claude Code cancels an
        in-flight statusline script when a new update arrives, so a hung inner
        meant no capture — and no capture means the gate has no numbers."""
        inner = self.make_inner("sleep 60")
        started = time.time()
        rc, out, err = self.run_statusline(
            json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": inner}, timeout=45
        )
        elapsed = time.time() - started
        self.assertEqual(rc, 0, err)
        self.assertLess(elapsed, 30, "the inner statusline was not bounded")
        self.assertTrue(os.path.exists(self.p("rate_limits.json")), "capture lost")
        self.assertIn("5h", out, "the badge still renders")
        entry = json.loads(self.read("log.jsonl").strip().splitlines()[-1])
        self.assertEqual(entry["event"], "inner_statusline_error")
        self.assertIn("timed out", entry["detail"])

    def test_the_capture_runs_before_the_inner(self):
        """Ordering, checked directly: the cache is already on disk by the time
        the inner statusline gets its turn."""
        probe = os.path.join(self.tmp, "seen-by-inner.txt")
        inner = self.make_inner(
            "cp %s %s 2>/dev/null; echo '[INNER]'" % (self.p("rate_limits.json"), probe)
        )
        rc, out, _ = self.run_statusline(
            json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": inner}
        )
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(probe), "the inner ran before the capture")

    def test_inner_none_disables_chaining(self):
        rc, out, _ = self.run_statusline(
            json.dumps(live(23, 41)), env={"LIMIT_GUARD_INNER": "none"}
        )
        self.assertEqual(rc, 0)
        self.assertTrue(out.startswith(" ["), out)


class TestNeverFails(TempHome):
    def test_empty_stdin(self):
        rc, out, err = self.run_statusline("")
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_garbage_stdin(self):
        for payload in ("not json", "{", "[]", "\x00\x01\x02"):
            rc, out, err = self.run_statusline(payload)
            self.assertEqual(rc, 0, payload)

    def test_unwritable_state_dir(self):
        os.chmod(self.statedir, 0o500)
        self.addCleanup(os.chmod, self.statedir, 0o700)
        rc, out, err = self.run_statusline(json.dumps(live()))
        self.assertEqual(rc, 0, "an unwritable state dir must not break the status bar")

    def test_broken_python_interpreter(self):
        rc, out, err = self.run_statusline(
            json.dumps(live()), env={"LIMIT_GUARD_PYTHON": "/nonexistent/python"}
        )
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")


class TestCliAndStatus(TempHome):
    def test_status_reports_running_when_idle(self):
        rc, out, err = self.run_cli("status")
        self.assertEqual(rc, 0, err)
        self.assertIn("running", out)
        self.assertIn("cache: none", out)
        self.assertIn("PAUSE_PCT=95", out)

    def test_status_exits_0_and_says_paused(self):
        """The skill tells the model to run `limit-guard status` first on every
        wake. A non-zero exit surfaces there as a failed command and invites a
        retry loop; the printed line already carries the state."""
        self.run_statusline(json.dumps(live(99, 10)))
        self.write(
            "state.json",
            {"paused": True, "since": 1, "until": time.time() + 600, "window": "five_hour"},
        )
        rc, out, err = self.run_cli("status")
        self.assertEqual(rc, 0, "status must not read as a command failure")
        self.assertIn("PAUSED (auto)", out)
        self.assertIn("5h", out)

    def test_resume_clears_the_pause(self):
        self.write(
            "state.json",
            {"paused": True, "since": 1, "until": time.time() + 99999, "window": "seven_day"},
        )
        rc, out, err = self.run_cli("resume")
        self.assertEqual(rc, 0, err)
        self.assertFalse(json.loads(self.read("state.json"))["paused"])
        self.assertIn("unpaused_manual", self.read("log.jsonl"))
        rc, out, _ = self.run_cli("resume")
        self.assertIn("not paused", out)

    def test_off_and_on_toggle_the_override(self):
        rc, out, err = self.run_cli("off")
        self.assertEqual(rc, 0, err)
        self.assertTrue(os.path.exists(self.p("override")))
        self.assertEqual(stat.S_IMODE(os.stat(self.p("override")).st_mode), 0o600)
        rc, out, err = self.run_cli("on")
        self.assertEqual(rc, 0, err)
        self.assertFalse(os.path.exists(self.p("override")))

    def test_off_and_on_refuse_a_symlinked_state_dir(self):
        """`mkdir -p` follows a symlink, and `rm -f $STATE_DIR/override` would
        then delete a file somewhere else. The gate's ensure_dir() refuses a
        symlinked state dir; the CLI must too."""
        victim = os.path.join(self.tmp, "victim")
        os.makedirs(victim)
        link = os.path.join(self.tmp, "linked-state")
        os.symlink(victim, link)
        for sub_cmd in ("off", "on"):
            rc, out, err = self.run_cli(sub_cmd, env={"LIMIT_GUARD_HOME": link})
            self.assertEqual(rc, 1, sub_cmd)
            self.assertIn("symlink", err)
        self.assertEqual(os.listdir(victim), [], "wrote through the symlink")

    def test_install_prints_the_statusline_snippet_and_edits_nothing(self):
        settings = os.path.join(self.cfgdir, "settings.json")
        with open(settings, "w") as fh:
            fh.write('{"untouched": true}')
        rc, out, err = self.run_cli("install")
        self.assertEqual(rc, 0, err)
        self.assertIn('"statusLine"', out)
        self.assertIn("limit-guard-statusline.sh", out)
        with open(settings) as fh:
            self.assertEqual(fh.read(), '{"untouched": true}')

    def test_unknown_command_exits_2(self):
        rc, out, err = self.run_cli("frobnicate")
        self.assertEqual(rc, 2)

    def test_help_prints_the_header_and_stops_at_the_code(self):
        """A fixed sed line range drifts with the header; it once printed
        `set -euo pipefail` as if it were help text."""
        rc, out, err = self.run_cli("help")
        self.assertEqual(rc, 0, err)
        self.assertIn("limit-guard status", out)
        self.assertIn("limit-guard selftest", out)
        self.assertNotIn("set -euo pipefail", out)
        self.assertNotIn("#!", out)
        self.assertNotIn("PY=", out)
        self.assertTrue(out.strip().endswith("trust."), repr(out[-60:]))


if __name__ == "__main__":
    unittest.main()
