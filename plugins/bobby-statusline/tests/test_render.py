#!/usr/bin/env python3
"""bobby-statusline tests. python3 -m unittest discover -s tests -p 'test_*.py'

Every test isolates CLAUDE_CONFIG_DIR into a temporary directory. The renderer
reads flag files and limit-guard state from there, so without the isolation a
test would read the developer's own session state and write into it.
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "bin", "bobby-statusline.py")
FIXTURES = os.path.join(HERE, "fixtures")
EXPECTED = os.path.join(HERE, "expected")

# The clock every fixture was generated against. Rate-limit resets are absolute
# timestamps, so a floating "now" would make the expectations drift daily. The
# renderer takes it as an argument, so nothing in the environment pins it.
NOW = 1789000000

ANSI = re.compile(r"\033\[[0-9;]*m")


def load_module():
    spec = importlib.util.spec_from_file_location("bobby_statusline", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BS = load_module()


def read_fixture(name: str) -> str:
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
        return fh.read()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = self.tmp.name
        self.saved = dict(os.environ)
        os.environ.update(
            {
                "TZ": "UTC",
                "NO_COLOR": "1",
                "COLUMNS": "200",
                "CLAUDE_CONFIG_DIR": self.config,
                # A real limit-guard would write into the temporary config dir,
                # which is harmless, but the bridge is tested on its own terms.
                "BOBBY_STATUSLINE_LIMIT_GUARD": os.path.join(self.config, "absent.py"),
            }
        )
        for key in list(os.environ):
            if key.startswith("BOBBY_STATUSLINE_") and key != "BOBBY_STATUSLINE_LIMIT_GUARD":
                del os.environ[key]
        time.tzset()
        self.addCleanup(self.restore)

    def restore(self):
        os.environ.clear()
        os.environ.update(self.saved)
        time.tzset()
        self.tmp.cleanup()

    def render(self, fixture: str, **env) -> str:
        os.environ.update({k: str(v) for k, v in env.items()})
        return BS.render(read_fixture(fixture), now=NOW)

    def plain(self, text: str) -> str:
        return ANSI.sub("", text)

    def write_flag(self, name: str, content: str):
        path = os.path.join(self.config, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return path


class TestGolden(Base):
    """Every fixture renders exactly what tests/expected/<name>.txt says."""

    def test_golden(self):
        for name in sorted(os.listdir(FIXTURES)):
            if not name.endswith(".json"):
                continue
            with self.subTest(fixture=name):
                path = os.path.join(EXPECTED, name.replace(".json", ".txt"))
                with open(path, encoding="utf-8") as fh:
                    want = fh.read().rstrip("\n")
                self.assertEqual(self.render(name), want)


class TestWidth(Base):
    def test_never_exceeds_columns(self):
        """The row is kept inside the width by construction, never by the terminal."""
        for width in (40, 52, 60, 80, 100, 120, 160, 200, 240):
            for name in ("full.json", "high-usage.json", "plan-only.json"):
                with self.subTest(width=width, fixture=name):
                    line = self.plain(self.render(name, COLUMNS=width))
                    self.assertLessEqual(len(line), width)

    def test_drops_lowest_priority_first(self):
        wide = self.render("full.json", COLUMNS=200)
        narrow = self.render("full.json", COLUMNS=100)
        self.assertIn("+156/-23", wide)
        self.assertNotIn("+156/-23", narrow)
        self.assertIn("INSERT", narrow)

    def test_missing_columns_falls_back_to_eighty(self):
        del os.environ["COLUMNS"]
        self.assertLessEqual(len(self.plain(self.render("full.json"))), 80)

    def test_non_numeric_columns_falls_back(self):
        self.assertLessEqual(len(self.plain(self.render("full.json", COLUMNS="wide"))), 80)


class TestBadges(Base):
    def test_both_badges(self):
        self.write_flag(".caveman-active", "full")
        self.write_flag(".ste-active", "on")
        self.assertIn("[CAVEMAN] [STE]", self.render("full.json"))

    def test_caveman_level(self):
        self.write_flag(".caveman-active", "ultra")
        self.assertIn("[CAVEMAN:ULTRA]", self.render("full.json"))

    def test_absent_flag_renders_no_empty_brackets(self):
        line = self.render("full.json")
        self.assertNotIn("[", line)

    def test_unknown_mode_is_refused(self):
        self.write_flag(".caveman-active", "pwned")
        self.assertNotIn("CAVEMAN", self.render("full.json"))

    def test_escape_bytes_are_refused(self):
        self.write_flag(".caveman-active", "\033]8;;http://evil\033\\full")
        self.assertNotIn("\033]8", self.render("full.json"))

    def test_oversized_flag_is_refused(self):
        self.write_flag(".caveman-active", "full" + "x" * 4096)
        self.assertNotIn("CAVEMAN", self.render("full.json"))

    def test_symlink_flag_is_refused(self):
        secret = os.path.join(self.config, "secret")
        with open(secret, "w", encoding="utf-8") as fh:
            fh.write("full")
        os.symlink(secret, os.path.join(self.config, ".caveman-active"))
        self.assertNotIn("CAVEMAN", self.render("full.json"))

    def test_badge_colors_are_distinct(self):
        del os.environ["NO_COLOR"]
        self.write_flag(".caveman-active", "full")
        self.write_flag(".ste-active", "on")
        line = self.render("full.json")
        self.assertIn("\033[38;5;173m[CAVEMAN]", line)
        self.assertIn("\033[38;5;109m[STE]", line)


class TestBilling(Base):
    def test_auto_hides_cost_when_rate_limits_present(self):
        line = self.render("full.json")
        self.assertIn("5h 26%", line)
        self.assertNotIn("$0.42", line)

    def test_auto_shows_cost_when_rate_limits_absent(self):
        line = self.render("cost-only.json")
        self.assertIn("$1.37", line)
        self.assertNotIn("5h", line)

    def test_both_shows_everything(self):
        line = self.render("full.json", BOBBY_STATUSLINE_BILLING="both")
        self.assertIn("5h 26%", line)
        self.assertIn("$0.42", line)

    def test_plan_forces_windows_with_placeholders(self):
        line = self.render("cost-only.json", BOBBY_STATUSLINE_BILLING="plan")
        self.assertIn("5h ?%", line)
        self.assertNotIn("$1.37", line)

    def test_cost_forces_dollars(self):
        line = self.render("full.json", BOBBY_STATUSLINE_BILLING="cost")
        self.assertIn("$0.42", line)
        self.assertNotIn("5h 26%", line)

    def test_unknown_billing_value_falls_back_to_auto(self):
        line = self.render("full.json", BOBBY_STATUSLINE_BILLING="nonsense")
        self.assertIn("5h 26%", line)
        self.assertNotIn("$0.42", line)


class TestSegments(Base):
    def test_placeholders_for_missing_data(self):
        line = self.render("startup.json")
        self.assertIn("ctx ?%", line)

    def test_gitlab_merge_request_marker(self):
        self.assertIn("!123 approved", self.render("gitlab-mr.json"))

    def test_github_pull_request_marker(self):
        self.assertIn("#1234 pending", self.render("full.json"))

    def test_worktree_is_off_by_default(self):
        self.assertNotIn("git:main", self.render("full.json"))

    def test_segment_delta_turns_worktree_on(self):
        line = self.render("full.json", BOBBY_STATUSLINE_SEGMENTS="+worktree,-lines")
        self.assertIn("git:main", line)
        self.assertNotIn("+156/-23", line)

    def test_unicode_glyphs_on_request(self):
        self.assertIn("5h 26% ↻", self.render("full.json", BOBBY_STATUSLINE_GLYPHS="unicode"))

    def test_ascii_glyphs_by_default(self):
        line = self.render("full.json")
        self.assertIn("5h 26% >", line)
        self.assertNotIn("↻", line)

    def test_reset_time_shows_weekday_when_not_today(self):
        line = self.render("full.json")
        self.assertIn("7d 14% >Mon", line)

    def test_priority_override(self):
        """A hand-written order protects what the user put first."""
        line = self.render(
            "full.json", COLUMNS=60, BOBBY_STATUSLINE_PRIORITY="lines,vim,ctx"
        )
        self.assertIn("+156/-23", line)

    def test_priority_override_keeps_unlisted_segments(self):
        line = self.render("full.json", BOBBY_STATUSLINE_PRIORITY="lines")
        self.assertIn("INSERT", line)


class TestColor(Base):
    def setUp(self):
        super().setUp()
        del os.environ["NO_COLOR"]

    def test_red_only_at_ninety_five(self):
        line = self.render("high-usage.json")
        self.assertIn("\033[38;5;160m5h 96%", line)   # 96.4% -> red
        self.assertIn("\033[38;5;179m7d 88%", line)   # 88%   -> amber

    def test_low_usage_is_green(self):
        self.assertIn("\033[38;5;108m5h 26%", self.render("full.json"))

    def test_cold_cache_is_amber_never_red(self):
        line = self.render("cost-only.json")
        self.assertIn("\033[38;5;179mcache cold", line)
        self.assertNotIn("\033[38;5;160mcache", line)

    def test_vim_modes_differ(self):
        self.assertIn("\033[38;5;114mINSERT", self.render("full.json"))
        self.assertIn("\033[38;5;111mNORMAL", self.render("high-usage.json"))

    def test_no_color_env_disables_color(self):
        self.assertNotIn("\033[", self.render("full.json", NO_COLOR="1"))

    def test_config_color_false_disables_color(self):
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"color": False}, fh)
        self.assertNotIn("\033[", self.render("full.json"))


class TestLayout(Base):
    def test_two_row_splits_identity_from_numbers(self):
        rows = self.render("full.json", BOBBY_STATUSLINE_LAYOUT="two-row").split("\n")
        self.assertEqual(len(rows), 2)
        self.assertIn("INSERT", rows[0])
        self.assertIn("Opus 5 1M", rows[0])
        self.assertIn("ctx 132k/1M", rows[1])
        self.assertIn("5h 26%", rows[1])

    def test_one_row_is_the_default(self):
        self.assertNotIn("\n", self.render("full.json"))


class TestConfigFile(Base):
    def write_config(self, obj):
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump(obj, fh)

    def test_file_sets_layout(self):
        self.write_config({"layout": "two-row"})
        self.assertIn("\n", self.render("full.json"))

    def test_environment_beats_file(self):
        self.write_config({"layout": "two-row"})
        self.assertNotIn("\n", self.render("full.json", BOBBY_STATUSLINE_LAYOUT="one-row"))

    def test_sparse_segments_leave_the_rest_alone(self):
        self.write_config({"segments": {"lines": False}})
        line = self.render("full.json")
        self.assertNotIn("+156/-23", line)
        self.assertIn("INSERT", line)

    def test_broken_config_file_is_ignored(self):
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            fh.write("{ not json")
        self.assertIn("INSERT", self.render("full.json"))

    def test_custom_separator(self):
        self.write_config({"separator": " * "})
        self.assertIn(" * ", self.render("full.json"))


class TestPaused(Base):
    def write_state(self, **fields):
        d = os.path.join(self.config, "limit-guard")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "state.json"), "w") as fh:
            json.dump(fields, fh)

    def test_paused_renders_first(self):
        self.write_state(paused=True, until=NOW + 1800)
        line = self.render("full.json")
        self.assertTrue(line.startswith("PAUSED >"))

    def test_manual_pause_is_labeled(self):
        self.write_state(paused=True, manual=True, until=NOW + 1800)
        self.assertIn("PAUSED(manual)", self.render("full.json"))

    def test_paused_survives_a_narrow_terminal(self):
        self.write_state(paused=True, until=NOW + 1800)
        self.assertIn("PAUSED", self.render("full.json", COLUMNS=30))

    def test_not_paused_renders_nothing(self):
        self.write_state(paused=False)
        self.assertNotIn("PAUSED", self.render("full.json"))

    def test_broken_state_fails_open(self):
        d = os.path.join(self.config, "limit-guard")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "state.json"), "w") as fh:
            fh.write("{ broken")
        self.assertNotIn("PAUSED", self.render("full.json"))


class TestLimitGuardBridge(Base):
    """The seam with limit-guard: import in process, never a second interpreter."""

    def write_gate(self, body: str) -> str:
        path = os.path.join(self.config, "gate.py")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
        os.environ["BOBBY_STATUSLINE_LIMIT_GUARD"] = path
        return path

    def test_capture_is_called(self):
        marker = os.path.join(self.config, "captured")
        self.write_gate(
            "def capture(text):\n"
            "    with open(%r, 'w') as fh:\n"
            "        fh.write(text)\n" % marker
        )
        self.render("full.json")
        self.assertTrue(os.path.exists(marker))
        with open(marker, encoding="utf-8") as fh:
            self.assertIn("rate_limits", fh.read())

    def test_older_run_capture_output_is_swallowed(self):
        """An old limit-guard prints a badge. It must not land inside our row."""
        self.write_gate(
            "import sys\n"
            "def run_capture(text):\n"
            "    sys.stdout.write(' [5h 26%]')\n"
            "    return 0\n"
        )
        self.assertNotIn("[5h 26%]", self.render("full.json"))

    def test_raising_gate_does_not_break_the_row(self):
        self.write_gate("def capture(text):\n    raise RuntimeError('boom')\n")
        self.assertIn("INSERT", self.render("full.json"))

    def test_absent_gate_still_renders_windows_from_stdin(self):
        self.assertIn("5h 26%", self.render("full.json"))

    def test_symlinked_gate_is_refused(self):
        real = self.write_gate("def capture(text):\n    raise SystemExit(1)\n")
        link = os.path.join(self.config, "gate-link.py")
        os.symlink(real, link)
        os.environ["BOBBY_STATUSLINE_LIMIT_GUARD"] = link
        self.assertIn("INSERT", self.render("full.json"))

    def test_capture_is_skipped_for_an_empty_payload(self):
        marker = os.path.join(self.config, "captured")
        self.write_gate(
            "def capture(text):\n"
            "    with open(%r, 'w') as fh:\n"
            "        fh.write('x')\n" % marker
        )
        BS.render("", now=NOW)
        self.assertFalse(os.path.exists(marker))


class TestRobustness(Base):
    def test_malformed_json_still_renders(self):
        self.assertIn("ctx ?%", self.render("malformed.json"))

    def test_empty_stdin_still_renders(self):
        self.assertIn("ctx ?%", BS.render("", now=NOW))

    def test_control_bytes_in_model_name_are_stripped(self):
        payload = json.dumps({"model": {"display_name": "Opus\033[31m evil"}})
        self.assertNotIn("\033[31m", BS.render(payload, now=NOW))

    def test_long_model_name_is_capped(self):
        payload = json.dumps({"model": {"display_name": "M" * 500}})
        self.assertLessEqual(len(self.plain(BS.render(payload, now=NOW))), 200)

    def test_json_array_is_not_a_session(self):
        self.assertIn("ctx ?%", BS.render("[1, 2, 3]", now=NOW))


class TestAuditRegressions(Base):
    """One test per defect found in the 2026-09-06 audit of these commits."""

    def payload(self, **fields) -> str:
        base = {"model": {"display_name": "Opus 5"}}
        base.update(fields)
        return json.dumps(base)

    def test_narrow_terminal_renders_something(self):
        """fit() used to return an empty list, so a tiny terminal showed nothing."""
        self.write_state_paused()
        for width in (5, 10, 20, 30):
            with self.subTest(width=width):
                line = self.plain(self.render("full.json", COLUMNS=width))
                self.assertTrue(line, "empty row at COLUMNS=%d" % width)
                self.assertLessEqual(len(line), width)
        self.assertTrue(self.plain(self.render("full.json", COLUMNS=10)).startswith("PAUSE"))

    def write_state_paused(self):
        d = os.path.join(self.config, "limit-guard")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "state.json"), "w") as fh:
            json.dump({"paused": True, "until": NOW + 1800}, fh)

    def test_expired_window_shows_no_stale_time(self):
        """A window past its reset carries a stale percentage and a past clock."""
        line = self.render_payload(
            rate_limits={
                "five_hour": {"used_percentage": 88, "resets_at": NOW - 60},
                "seven_day": {"used_percentage": 14, "resets_at": NOW + 86400},
            }
        )
        self.assertIn("5h ?%", line)
        self.assertIn("7d 14%", line)

    def test_prompt_cache_without_warm_is_unknown_not_cold(self):
        line = self.render_payload(prompt_cache={"hit_ratio": 0.9})
        self.assertIn("cache ?", line)
        self.assertNotIn("cache cold", line)

    def test_prompt_cache_with_warm_false_is_cold(self):
        self.assertIn("cache cold", self.render_payload(prompt_cache={"warm": False}))

    def test_token_count_above_the_window_falls_back_to_percent(self):
        """Input tokens include cache reads, so the sum can exceed the window."""
        line = self.render_payload(
            context_window={
                "total_input_tokens": 300000,
                "total_output_tokens": 4000,
                "context_window_size": 200000,
                "used_percentage": 61,
            }
        )
        self.assertIn("ctx 61%", line)
        self.assertNotIn("/200k", line)

    def test_limit_guard_home_is_honored_by_the_fallback(self):
        home = os.path.join(self.config, "elsewhere")
        os.makedirs(home)
        with open(os.path.join(home, "state.json"), "w") as fh:
            json.dump({"paused": True, "until": NOW + 600}, fh)
        os.environ["LIMIT_GUARD_HOME"] = home
        self.assertIn("PAUSED", self.render("full.json"))

    def test_c1_control_characters_are_stripped(self):
        """0x9b is a CSI introducer in some terminals."""
        line = BS.render(self.payload(agent={"name": "a\u009b31mred"}), now=NOW)
        self.assertNotIn("\u009b", line)

    def test_bidi_overrides_are_stripped(self):
        """A right-to-left override can reorder a percentage on screen."""
        line = BS.render(self.payload(agent={"name": "a\u202eb"}), now=NOW)
        self.assertNotIn("\u202e", line)

    def test_version_key_orders_ten_above_nine(self):
        paths = [
            "/c/limit-guard/0.9.0/hooks/limit-guard-gate.py",
            "/c/limit-guard/0.10.0/hooks/limit-guard-gate.py",
        ]
        self.assertEqual(max(paths, key=BS._version_key), paths[1])

    def render_payload(self, **fields) -> str:
        return BS.render(self.payload(**fields), now=NOW)


class TestMultiColorSegments(Base):
    def setUp(self):
        super().setUp()
        del os.environ["NO_COLOR"]

    def test_added_and_removed_lines_carry_their_own_colors(self):
        line = self.render("full.json")
        self.assertIn("\033[38;5;108m+156\033[0m", line)
        self.assertIn("\033[38;5;174m-23\033[0m", line)

    def test_badges_keep_separate_colors(self):
        self.write_flag(".caveman-active", "ultra")
        self.write_flag(".ste-active", "on")
        line = self.render("full.json")
        self.assertIn("\033[38;5;173m[CAVEMAN:ULTRA]\033[0m", line)
        self.assertIn("\033[38;5;109m[STE]\033[0m", line)

    def test_truncation_keeps_color(self):
        self.assertIn("\033[", self.render("full.json", COLUMNS=8))


class TestSlashCommand(unittest.TestCase):
    """The install command is a prompt, so what is testable is its contract."""

    def setUp(self):
        import tomllib

        path = os.path.join(ROOT, "commands", "install.toml")
        with open(path, "rb") as fh:
            self.command = tomllib.load(fh)

    def test_has_a_description_and_a_prompt(self):
        self.assertTrue(self.command["description"].strip())
        self.assertTrue(self.command["prompt"].strip())

    def test_sets_both_required_keys(self):
        for key in ("statusLine", "hideVimModeIndicator"):
            self.assertIn(key, self.command["prompt"])

    def test_refuses_to_replace_an_existing_statusline_silently(self):
        prompt = self.command["prompt"]
        self.assertIn("already set", prompt)
        self.assertIn("Ask", prompt)

    def test_confines_the_edit_to_settings_json(self):
        self.assertIn("do not edit files outside", self.command["prompt"])


class TestCommandLine(unittest.TestCase):
    def setUp(self):
        # Without this, `--selftest` renders against the developer's real
        # CLAUDE_CONFIG_DIR, imports the sibling limit-guard, and writes to the
        # actual rate-limit cache. Its capture also unpauses an expired window,
        # so a test run could clear a real pause.
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def run_script(self, *args, stdin="", config=None):
        env = dict(
            os.environ,
            NO_COLOR="1",
            COLUMNS="200",
            TZ="UTC",
            CLAUDE_CONFIG_DIR=config or self.tmp.name,
            BOBBY_STATUSLINE_LIMIT_GUARD=os.path.join(self.tmp.name, "absent.py"),
        )
        return subprocess.run(
            [sys.executable, SCRIPT, *args],
            input=stdin, capture_output=True, text=True, env=env,
        )

    def test_install_prints_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_script("install", config=tmp)
            self.assertEqual(result.returncode, 0)
            self.assertIn("hideVimModeIndicator", result.stdout)
            self.assertIn("statusLine", result.stdout)
            self.assertEqual(os.listdir(tmp), [])

    def test_malformed_stdin_exits_zero(self):
        result = self.run_script(stdin="not json")
        self.assertEqual(result.returncode, 0)
        self.assertNotIn("Traceback", result.stderr)

    def test_demo_runs_and_shows_several_widths(self):
        result = self.run_script("demo")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("COLUMNS 120", result.stdout)
        self.assertIn("COLUMNS 80", result.stdout)
        self.assertIn("temporary", result.stdout)

    def test_demo_writes_nothing_to_the_config_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_script("demo", config=tmp)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(os.listdir(tmp), [])

    def test_demo_names_a_fixture(self):
        self.assertIn("$1.37", self.run_script("demo", "cost-only").stdout)

    def test_demo_rejects_an_unknown_fixture(self):
        result = self.run_script("demo", "nope")
        self.assertEqual(result.returncode, 1)
        self.assertIn("fixtures:", result.stderr)

    def test_version(self):
        self.assertIn("bobby-statusline", self.run_script("--version").stdout)

    def test_selftest_reports_both_measurements(self):
        """Asserts that it measures, not that this machine was fast.

        The budget check lives in the command itself, where a person or CI
        reads the number. Asserting the exit code here makes a loaded laptop
        fail the suite, which teaches people to ignore a red run.
        """
        result = self.run_script("--selftest")
        self.assertIn("render only", result.stdout)
        self.assertIn("end to end", result.stdout)
        self.assertIn("p95", result.stdout)
        self.assertIn(result.returncode, (0, 1))


if __name__ == "__main__":
    unittest.main()
