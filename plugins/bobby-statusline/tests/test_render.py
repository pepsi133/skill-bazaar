#!/usr/bin/env python3
"""bobby-statusline tests. python3 -m unittest discover -s tests -p 'test_*.py'

Every test isolates CLAUDE_CONFIG_DIR into a temporary directory. The renderer
reads flag files and limit-guard state from there, so without the isolation a
test would read the developer's own session state and write into it.
"""

import importlib.util
import io
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
PRICES_SCRIPT = os.path.join(ROOT, "bin", "bobby-statusline-prices.py")
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
        self.assertIn("\033[38;5;179mcache 5m cold", line)
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


class TestSelftestVerdict(Base):
    """The verdict counts the render of every keystroke, not the catch-up renders."""

    def verdict(self, scan: float, idle: float) -> tuple:
        import contextlib

        saved = BS._measure_estimate, BS.BUDGET_MS
        BS._measure_estimate = lambda timed: [(BS.SCAN_LABEL, [scan]), ("estimate idle", [idle])]
        BS.BUDGET_MS = 5000.0  # the real renders of this test are not what is judged
        out, err = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = BS._measure(ROOT, [os.path.join(FIXTURES, "full.json")])
        finally:
            BS._measure_estimate, BS.BUDGET_MS = saved
        return code, out.getvalue(), err.getvalue()

    def test_slow_catch_up_render_is_shown_and_does_not_fail(self):
        code, out, err = self.verdict(scan=9000.0, idle=1.0)
        self.assertEqual(code, 0, err)
        self.assertRegex(out, r"estimate scan .*p95=9000\.0ms .*catch-up only, over budget")
        self.assertIn("OK: p95 within", out)

    def test_catch_up_render_inside_the_budget_has_the_plain_mark(self):
        code, out, err = self.verdict(scan=1.0, idle=1.0)
        self.assertEqual(code, 0, err)
        self.assertRegex(out, r"estimate scan .*catch-up only\n")
        self.assertNotIn("over budget", out)

    def test_slow_steady_render_fails(self):
        code, out, err = self.verdict(scan=1.0, idle=9000.0)
        self.assertEqual(code, 1)
        self.assertIn("FAIL: p95 9000.0ms exceeds", err)


class TestAuditRegressions(Base):
    """One test per fixed defect. Each fails on the code before its fix."""

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


class TestPromptCache(Base):
    """The cache segment, against the prompt_cache shape Claude Code sends."""

    def cache(self, **fields) -> str:
        base = {"warm": True, "caching_observed": True, "ttl": "1h", "expires_at": NOW + 1800,
                "requests": 5, "misses": 0, "hit_ratio": 0.8, "last_miss_cause": None,
                "recache_tokens_if_cold": 40000}
        base.update(fields)
        line = BS.render(json.dumps({"prompt_cache": base}), now=NOW)
        return self.plain(line)

    def segment(self, **fields) -> str:
        return [p for p in self.cache(**fields).split(" | ") if p.startswith("cache")][0]

    def test_warm_shows_ttl_and_expiry_clock(self):
        self.assertEqual(self.segment(), "cache 1h warm >00:56 80%")

    def test_five_minute_ttl(self):
        self.assertEqual(self.segment(ttl="5m", expires_at=NOW + 240), "cache 5m warm >00:30 80%")

    def test_cold_shows_since_and_recache_tokens(self):
        self.assertEqual(self.segment(warm=False, expires_at=NOW - 600),
                         "cache 1h cold since 00:16 ~40k 80%")

    def test_warm_flag_past_expiry_renders_cold(self):
        """warm is computed when the payload is built; the clock decides at render."""
        self.assertIn("cold since 00:26", self.segment(expires_at=NOW))

    def test_null_recache_estimate_is_omitted(self):
        """null means the next turn re-caches a compacted prompt of unknown size."""
        self.assertNotIn("~", self.segment(warm=False, recache_tokens_if_cold=None))

    def test_first_request_hides_the_zero_hit_ratio(self):
        self.assertEqual(self.segment(requests=1, hit_ratio=0), "cache 1h warm >00:56")

    def test_misses_show_count_and_last_cause(self):
        seg = self.segment(misses=2, last_miss_cause={"causes": ["tools_changed", "model_changed"]})
        self.assertTrue(seg.endswith("2 miss: tools/model"), seg)

    def test_unknown_miss_cause_is_cleaned_not_dropped(self):
        seg = self.segment(misses=1, last_miss_cause={"causes": ["New\u001b[31m_Cause"]})
        self.assertTrue(seg.endswith("1 miss: new31m_cause"), seg)

    def test_non_string_miss_cause_is_skipped(self):
        seg = self.segment(misses=1, last_miss_cause={"causes": [["x"], {"y": 1}, "model_changed"]})
        self.assertTrue(seg.endswith("1 miss: model"), seg)

    def test_miss_without_cause(self):
        self.assertTrue(self.segment(misses=3).endswith("3 miss"))

    def test_caching_not_observed_is_off(self):
        self.assertEqual(self.segment(warm=False, caching_observed=False, expires_at=None), "cache off")

    def test_unknown_ttl_is_omitted_not_echoed(self):
        self.assertEqual(self.segment(ttl="forever"), "cache warm >00:56 80%")

    def test_huge_expiry_is_unknown_not_blank(self):
        self.assertEqual(self.segment(expires_at=1e300), "cache ?")

    def test_unicode_glyph(self):
        os.environ["BOBBY_STATUSLINE_GLYPHS"] = "unicode"
        self.assertIn("warm \u21bb00:56", self.cache())


class TestPromptCacheColor(Base):
    def setUp(self):
        super().setUp()
        del os.environ["NO_COLOR"]

    def raw(self, **fields) -> str:
        base = {"warm": True, "caching_observed": True, "ttl": "1h", "expires_at": NOW + 1800}
        base.update(fields)
        return BS.render(json.dumps({"prompt_cache": base}), now=NOW)

    def test_warm_with_time_left_is_green(self):
        self.assertIn("\033[38;5;108mcache 1h warm", self.raw())

    def test_last_fifth_of_the_ttl_is_amber(self):
        self.assertIn("\033[38;5;179mcache 1h warm", self.raw(expires_at=NOW + 700))
        self.assertIn("\033[38;5;179mcache 5m warm", self.raw(ttl="5m", expires_at=NOW + 50))
        self.assertIn("\033[38;5;108mcache 5m warm", self.raw(ttl="5m", expires_at=NOW + 70))


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


SESSION = "0a1b2c3d-0000-4000-8000-00000000abcd"


def usage(inp=0, out=0, read=0, w5=0, w1=0, search=0, speed="standard", detail=True, created=None):
    val = {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_input_tokens": read,
        "cache_creation_input_tokens": w5 + w1 if created is None else created,
        "server_tool_use": {"web_search_requests": search},
        "speed": speed,
    }
    if detail:
        val["cache_creation"] = {
            "ephemeral_5m_input_tokens": w5,
            "ephemeral_1h_input_tokens": w1,
        }
    return val


def assistant(mid, model="claude-opus-5-5", **fields) -> str:
    """One transcript line in the compact form Claude Code writes."""
    return json.dumps(
        {"type": "assistant", "message": {"id": mid, "model": model, "usage": usage(**fields)}},
        separators=(",", ":"),
    )


class LedgerBase(Base):
    """Synthetic transcripts under the temporary config directory."""

    def setUp(self):
        super().setUp()
        self.project = os.path.join(self.config, "projects", "sample")
        os.makedirs(self.project)
        self.transcript = os.path.join(self.project, SESSION + ".jsonl")
        self.subagents = os.path.join(self.project, SESSION, "subagents")
        self.sidecar = os.path.join(
            self.config, "bobby-statusline", "usage", SESSION + ".json"
        )
        budget = BS.LEDGER_BUDGET_MS
        self.addCleanup(lambda: setattr(BS, "LEDGER_BUDGET_MS", budget))
        # A loaded machine must not turn a correct total into a partial one.
        BS.LEDGER_BUDGET_MS = 5000.0

    def append(self, path, *lines, newline=True):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "ab") as fh:
            fh.write("\n".join(lines).encode("utf-8") + (b"\n" if newline else b""))

    def agent(self, name="agent-a1.jsonl", *parts):
        return os.path.join(self.subagents, *parts, name)

    def payload(self, **fields) -> dict:
        base = {"session_id": SESSION, "transcript_path": self.transcript}
        base.update(fields)
        return base

    def totals(self, **fields):
        return BS.ledger_totals(self.payload(**fields))

    def cost_segment(self, source="estimate", **fields) -> str:
        if source:
            os.environ["BOBBY_STATUSLINE_COST_SOURCE"] = source
        row = self.plain(BS.render(json.dumps(self.payload(**fields)), now=NOW))
        found = [part for part in row.split(" | ") if "$" in part]
        return found[0] if found else ""


class TestLedger(LedgerBase):
    def test_one_message_id_counts_once(self):
        """One response is several lines, one per content block, same usage."""
        line = assistant("msg_1", inp=100, out=50)
        self.append(self.transcript, line, line, line, assistant("msg_2", inp=7))
        self.assertEqual(
            self.totals()["main"], {"claude-opus-5-5": {"n": [107, 50, 0, 0, 0, 0]}}
        )

    def test_later_line_of_a_known_id_adds_only_what_grew(self):
        self.append(
            self.transcript,
            assistant("msg_1", inp=100, out=10),
            assistant("msg_1", inp=100, out=60),
            assistant("msg_1", inp=90, out=60),
        )
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][:2], [100, 60])

    def test_dedup_survives_two_renders(self):
        self.append(self.transcript, assistant("msg_1", inp=100, out=10))
        self.totals()
        self.append(self.transcript, assistant("msg_1", inp=100, out=10))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][:2], [100, 10])

    def test_user_line_with_nested_usage_is_not_counted(self):
        """A finished subagent's result is quoted in a `user` line of the parent.

        The quoted object is itself an assistant message with a usage, so the
        raw line passes the cheap text check. Only the parsed top-level type
        keeps it out.
        """
        nested = {"type": "assistant", "message": {"id": "msg_8", "model": "claude-opus-5-5",
                                                   "usage": usage(inp=999999)}}
        for kind in ("user", "api-request-blob", "system"):
            quoted = json.dumps(
                {
                    "type": kind,
                    "toolUseResult": nested,
                    "message": {"id": "msg_9", "model": "claude-opus-5-5",
                                "usage": usage(inp=999999), "content": [nested]},
                },
                separators=(",", ":"),
            )
            self.assertIn('"type":"assistant"', quoted)
            self.assertIn('"usage"', quoted)
            self.append(self.transcript, quoted)
        self.append(self.transcript, assistant("msg_1", inp=5))
        self.assertEqual(self.totals()["main"], {"claude-opus-5-5": {"n": [5, 0, 0, 0, 0, 0]}})

    def test_spaced_json_is_counted_too(self):
        line = json.dumps(json.loads(assistant("msg_1", inp=5)))
        self.append(self.transcript, line)
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 5)

    def test_main_and_subagents_are_kept_apart(self):
        self.append(self.transcript, assistant("msg_1", inp=1000))
        self.append(self.agent(), assistant("msg_2", inp=200))
        self.append(self.agent("agent-b2.jsonl", "workflows", "wf-1"), assistant("msg_3", inp=30))
        # Not transcripts: every other file in the directory is ignored.
        self.append(self.agent("journal.jsonl"), assistant("msg_4", inp=4000))
        self.append(self.agent("agent-a1.meta.json"), assistant("msg_5", inp=4000))
        self.append(self.agent("notes.jsonl", "workflows", "wf-1"), assistant("msg_6", inp=4000))
        result = self.totals()
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 1000)
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 230)
        self.assertFalse(result["partial"])

    def test_second_render_reads_only_the_new_bytes(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.append(self.agent(), assistant("msg_2", inp=10))
        first = self.totals()
        size = os.path.getsize(self.transcript) + os.path.getsize(self.agent())
        self.assertEqual(first["read"], size)
        self.assertEqual(self.totals()["read"], 0)

        more = assistant("msg_3", inp=1)
        self.append(self.agent(), more)
        third = self.totals()
        self.assertEqual(third["read"], len(more) + 1)
        self.assertEqual(third["main"]["claude-opus-5-5"]["n"][0], 100)
        self.assertEqual(third["sub"]["claude-opus-5-5"]["n"][0], 11)

    def test_unchanged_transcripts_do_not_rewrite_the_sidecar(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.totals()
        os.utime(self.sidecar, (1000, 1000))
        self.totals()
        self.assertEqual(os.stat(self.sidecar).st_mtime, 1000)

    def test_truncated_file_is_rescanned(self):
        self.append(self.transcript, assistant("msg_1", inp=100), assistant("msg_2", inp=100))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 200)
        with open(self.transcript, "wb") as fh:
            fh.write(assistant("msg_3", inp=7).encode() + b"\n")
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 7)

    def test_partial_last_line_is_not_consumed(self):
        whole = assistant("msg_1", inp=100)
        tail = assistant("msg_2", inp=50)
        self.append(self.transcript, whole)
        self.append(self.transcript, tail[:40], newline=False)
        result = self.totals()
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 100)
        self.assertEqual(result["read"], len(whole) + 1)
        self.append(self.transcript, tail[40:])
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 150)

    def test_symlinked_main_transcript_is_refused(self):
        real = os.path.join(self.project, "real.jsonl")
        self.append(real, assistant("msg_1", inp=100))
        os.symlink(real, self.transcript)
        self.assertIsNone(self.totals())
        self.assertEqual(self.cost_segment(), "$?")

    def test_symlinked_subagent_transcript_is_refused(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        real = os.path.join(self.project, "real.jsonl")
        self.append(real, assistant("msg_2", inp=100))
        os.makedirs(self.subagents)
        os.symlink(real, self.agent())
        os.symlink(self.project, os.path.join(self.subagents, "workflows"))
        self.assertEqual(self.totals()["sub"], {})

    def test_symlinked_sidecar_is_not_read_or_followed(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.totals()
        target = os.path.join(self.config, "elsewhere.json")
        os.replace(self.sidecar, target)
        with open(target, "rb") as fh:
            body = fh.read()
        os.symlink(target, self.sidecar)
        self.append(self.transcript, assistant("msg_2", inp=1))
        result = self.totals()
        # Started from zero, so the whole file was read again.
        self.assertEqual(result["read"], os.path.getsize(self.transcript))
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 101)
        with open(target, "rb") as fh:
            self.assertEqual(fh.read(), body)

    def test_sidecar_modes(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.totals()
        self.assertEqual(os.stat(self.sidecar).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(os.path.dirname(self.sidecar)).st_mode & 0o777, 0o700)
        self.assertEqual(os.listdir(os.path.dirname(self.sidecar)), [SESSION + ".json"])

    def test_other_schema_version_starts_from_zero(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.totals()
        with open(self.sidecar, encoding="utf-8") as fh:
            stored = json.load(fh)
        stored["v"] = 99
        stored["main"]["t"] = {"claude-opus-5-5": {"n": [5000, 0, 0, 0, 0, 0]}}
        with open(self.sidecar, "w", encoding="utf-8") as fh:
            json.dump(stored, fh)
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 100)

    def test_garbage_sidecar_starts_from_zero(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.totals()
        for body in ("{ not json", '{"v":1}', '{"v":1,"path":"x","main":[],"sub":{}}', "[]"):
            with self.subTest(body=body):
                with open(self.sidecar, "w", encoding="utf-8") as fh:
                    fh.write(body)
                self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 100)

    def test_zero_budget_still_moves_and_marks_the_result_partial(self):
        """With no time at all a render reads one line, so it can never stall."""
        self.append(self.transcript, assistant("msg_1", inp=1000000), assistant("msg_2", inp=1000000))
        BS.LEDGER_BUDGET_MS = 0
        self.assertEqual(self.cost_segment(), "~$4.00+")
        self.assertEqual(self.cost_segment(), "~$8.00")

    def test_budget_that_runs_out_is_continued_by_the_next_render(self):
        lines = [assistant("msg_%d" % i, inp=1) for i in range(400)]
        self.append(self.transcript, *lines)
        clock = {"calls": 0}
        real = BS.time.perf_counter

        def ticking():
            clock["calls"] += 1
            return clock["calls"] * 0.001  # every look at the clock costs 1 ms

        BS.LEDGER_BUDGET_MS = 100.0
        BS.time.perf_counter = ticking
        try:
            first = self.totals()
            clock["calls"] = 0
            seen = first["main"]["claude-opus-5-5"]["n"][0]
            self.assertTrue(first["partial"])
            self.assertTrue(0 < seen < 400, seen)
            renders = 1
            while renders < 20:
                clock["calls"] = 0
                result = self.totals()
                renders += 1
                if not result["partial"]:
                    break
        finally:
            BS.time.perf_counter = real
        self.assertFalse(result["partial"])
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 400)

    def test_missing_cache_detail_counts_as_five_minute_writes(self):
        self.append(self.transcript, assistant("msg_1", w5=300, detail=False))
        self.assertEqual(
            self.totals()["main"]["claude-opus-5-5"]["n"], [0, 0, 0, 300, 0, 0]
        )

    def test_fast_speed_is_kept_apart(self):
        self.append(
            self.transcript,
            assistant("msg_1", inp=10),
            assistant("msg_2", inp=20, speed="fast"),
        )
        model = self.totals()["main"]["claude-opus-5-5"]
        self.assertEqual((model["n"][0], model["f"][0]), (10, 20))

    def test_id_map_keeps_sixteen_and_an_idle_file_keeps_its_newest_id(self):
        self.append(self.transcript, *[assistant("msg_%d" % i, inp=1) for i in range(40)])
        self.totals()
        with open(self.sidecar, encoding="utf-8") as fh:
            ids = json.load(fh)["main"]["ids"]
        self.assertEqual(list(ids), ["msg_%d" % i for i in range(24, 40)])

        self.append(self.transcript, assistant("msg_40", inp=1))
        old = time.time() - 3600
        os.utime(self.transcript, (old, old))
        self.totals()
        with open(self.sidecar, encoding="utf-8") as fh:
            self.assertEqual(list(json.load(fh)["main"]["ids"]), ["msg_40"])
        # A resumed transcript writes one more block of the last response.
        self.append(self.transcript, assistant("msg_40", inp=1))
        os.utime(self.transcript, (old, old))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 41)

    def test_a_known_id_seen_again_becomes_the_newest(self):
        self.append(self.transcript, *[assistant("msg_%d" % i, inp=1) for i in range(16)])
        self.append(self.transcript, assistant("msg_0", inp=1))
        self.append(self.transcript, *[assistant("msg_%d" % i, inp=1) for i in range(16, 31)])
        self.append(self.transcript, assistant("msg_0", inp=1))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 31)

    def test_new_sidecar_prunes_old_ones(self):
        folder = os.path.dirname(self.sidecar)
        os.makedirs(folder)
        old, recent, other = (os.path.join(folder, n) for n in ("old.json", "recent.json", "notes.txt"))
        for path in (old, recent, other):
            with open(path, "w") as fh:
                fh.write("{}")
        stamp = time.time() - 31 * 86400
        os.utime(old, (stamp, stamp))
        os.utime(other, (stamp, stamp))
        self.append(self.transcript, assistant("msg_1", inp=1))
        self.totals()
        self.assertEqual(
            sorted(os.listdir(folder)), sorted(["recent.json", "notes.txt", SESSION + ".json"])
        )

    def test_bad_session_id_gives_no_estimate(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        for bad in ("../../etc/passwd", "a b", "", "x" * 65, None, 7, "a/b"):
            with self.subTest(session_id=bad):
                self.assertEqual(self.cost_segment(session_id=bad), "$?")
        self.assertFalse(os.path.exists(os.path.join(self.config, "bobby-statusline")))

    def test_missing_transcript_gives_no_estimate(self):
        self.assertEqual(self.cost_segment(), "$?")
        for bad in (None, 7, "relative.jsonl", self.project, self.transcript[:-1]):
            with self.subTest(transcript_path=bad):
                self.assertEqual(self.cost_segment(transcript_path=bad), "$?")
        self.assertFalse(os.path.exists(os.path.join(self.config, "bobby-statusline")))

    def test_broken_subagent_entry_in_the_sidecar_is_rebuilt(self):
        """Subagent entries are checked when they are used, not when they are loaded."""
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.append(self.agent(), assistant("msg_2", inp=20))
        self.append(self.agent("agent-b2.jsonl"), assistant("msg_3", inp=3))
        self.totals()
        with open(self.sidecar, encoding="utf-8") as fh:
            good = json.load(fh)
        for broken in ("text", {"off": "0"}, {"off": -1, "ino": 0, "mt": 0},
                       dict(good["sub"]["agent-a1.jsonl"], t={"m": {"n": [1, 2]}}),
                       dict(good["sub"]["agent-a1.jsonl"], ids={"x": "y"})):
            with self.subTest(broken=str(broken)[:40]):
                stored = json.loads(json.dumps(good))
                stored["sub"]["agent-a1.jsonl"] = broken
                with open(self.sidecar, "w", encoding="utf-8") as fh:
                    json.dump(stored, fh)
                # A change in the other file makes the sum be added up again.
                self.append(self.agent("agent-b2.jsonl"), assistant("more", inp=0, out=1))
                self.append(self.agent(), assistant("more", inp=0, out=1))
                result = self.totals()
                self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 23)
                self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 100)
                with open(self.sidecar, encoding="utf-8") as fh:
                    good["sub"] = json.load(fh)["sub"]

    def test_subagent_sum_follows_every_change(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        for i in range(40):
            self.append(self.agent("agent-%02d.jsonl" % i), assistant("msg_a%d" % i, inp=1))
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 40)
        self.append(self.transcript, assistant("msg_2", inp=100))
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 40)
        self.append(self.agent("agent-07.jsonl"), assistant("msg_b", inp=5))
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 45)
        with open(self.agent("agent-08.jsonl"), "wb") as fh:  # truncated to nothing
            fh.write(b"")
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 44)
        os.unlink(self.agent("agent-09.jsonl"))  # a removed transcript leaves the sum
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 43)
        with open(self.sidecar, encoding="utf-8") as fh:
            stored = json.load(fh)
        # Only the transcripts written last keep a whole id map.
        self.assertLessEqual(len(stored["live"]), BS.LEDGER_ID_FILES)
        self.assertTrue(all(len(e["ids"]) <= 1 for k, e in stored["sub"].items() if k not in stored["live"]))

    def test_garbage_transcript_never_raises(self):
        with open(self.transcript, "wb") as fh:
            fh.write(b'\xff\xfe"usage""type":"assistant"\n')
            fh.write(b'{"type":"assistant","message":"usage"}\n')
            fh.write(b'{"type":"assistant","message":{"usage":[1],"id":3}}\n')
            fh.write(b'{"type":"assistant","message":{"usage":{"input_tokens":"x",'
                     b'"output_tokens":-5,"cache_creation":7,"server_tool_use":[]},'
                     b'"id":{"a":1},"model":["m"]}}\n')
            fh.write(b'["type":"assistant","usage"]\n')
            fh.write(b"[" * 100000 + b'"usage""type":"assistant"\n')
            fh.write(b"\x00" * 5000 + b"\n\n\n")
            fh.write(assistant("msg_1", inp=1000000).encode() + b"\n")
        self.assertEqual(self.cost_segment(), "~$4.00")

    def test_sidecar_that_cannot_be_written_still_renders(self):
        if os.geteuid() == 0:
            self.skipTest("root writes into a read-only directory")
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        folder = os.path.dirname(self.sidecar)
        os.makedirs(folder)
        os.chmod(folder, 0o500)
        self.addCleanup(os.chmod, folder, 0o700)
        self.assertEqual(self.cost_segment(), "~$4.00")
        self.assertEqual(os.listdir(folder), [])

    def test_a_file_where_the_ledger_directory_should_be_gives_no_estimate(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        with open(os.path.join(self.config, "bobby-statusline"), "w") as fh:
            fh.write("a file where the directory should be")
        self.assertEqual(self.cost_segment(), "$?")


class TestPrices(LedgerBase):
    FULL = (1000000, 1000000, 1000000, 1000000, 1000000, 0)

    # input, output, cache read: every built-in row, written out a second time
    # on purpose. A wrong digit in the table must not agree with itself.
    LIST = {
        "claude-fable-5-2": (8, 40, 0.20),
        "claude-fable-5-1": (10, 50, 0.25),
        "claude-fable-5": (10, 50, 1.00),
        "claude-mythos-5-2": (8, 40, 0.20),
        "claude-mythos-5-1": (10, 50, 0.25),
        "claude-mythos-5": (10, 50, 1.00),
        "claude-opus-5-5": (4, 20, 0.20),
        "claude-opus-5": (5, 25, 0.50),
        "claude-opus-4-8": (5, 25, 0.50),
        "claude-opus-4-7": (5, 25, 0.50),
        "claude-opus-4-6": (5, 25, 0.50),
        "claude-sonnet-5-5": (2, 10, 0.10),
        "claude-sonnet-5": (2, 10, 0.20),
        "claude-sonnet-4-6": (3, 15, 0.30),
        "claude-haiku-5-5": (0.10, 0.50, 0.01),
        "claude-haiku-4-5": (1, 5, 0.10),
    }

    def table(self, user=None):
        return BS.price_table(BS._user_prices(user or {}))

    def cost(self, model, user=None, bucket="n", tup=FULL):
        return BS.ledger_cost({model: {bucket: list(tup)}}, self.table(user))

    def test_every_built_in_row(self):
        self.assertEqual(sorted(BS.PRICES), sorted(self.LIST))
        for model, (inp, out, read) in self.LIST.items():
            with self.subTest(model=model):
                usd, unknown = self.cost(model)
                self.assertAlmostEqual(usd, inp + out + read + 1.25 * inp + 2 * inp)
                self.assertFalse(unknown)
                for i, price in enumerate((inp, out, read, 1.25 * inp, 2 * inp)):
                    one = [0] * 6
                    one[i] = 1000000
                    self.assertAlmostEqual(self.cost(model, tup=one)[0], price)

    def test_model_id_normalisation(self):
        for name in (
            "claude-opus-5-5",
            "Claude-Opus-5-5",
            "claude-opus-5-5-20260101",
            "claude-opus-5-5[1m]",
            "claude-opus-5-5@20260101",
            "us.anthropic.claude-opus-5-5-20260101-v1:0",
            "anthropic.claude-opus-5-5-v2:1",
            "arn:aws:bedrock:us-west-2:123456789012:inference-profile/us.anthropic.claude-opus-5-5-v1:0",
            "claude-opus-5-5-20991231",
            "global.anthropic.claude-opus-5-5-20260101-v1:0[1m]",
        ):
            with self.subTest(model=name):
                self.assertEqual(BS.normalise_model(name), "claude-opus-5-5")
                self.assertAlmostEqual(self.cost(name)[0], 37.2)

    def test_a_row_never_prices_another_version(self):
        """No prefix match: a newer model gets the mark, not an older price."""
        for name in (
            "claude-opus-5-1",
            "claude-opus-5-50",
            "claude-opus-5-5-1",
            "claude-opus-5x",
            "claude-fable-5-3",
            "claude-haiku-5",
            "claude-opus",
            "claude-opus-5-5-preview",
        ):
            with self.subTest(model=name):
                self.assertEqual(self.cost(name), (0.0, True))
        # The dated form of the shorter id is still that model.
        self.assertAlmostEqual(self.cost("claude-opus-5-20260101")[0], 46.75)
        self.assertAlmostEqual(self.cost("claude-fable-5@20260101")[0], 10 + 50 + 1 + 12.5 + 20)

    def test_tail_that_only_looks_like_a_date_or_a_version_gets_no_row(self):
        for name in (
            "claude-opus-5-5-12345678",
            "claude-opus-5-5-19991231",
            "claude-opus-5-5-20000101",
            "claude-opus-5-5-20191231",
            "claude-opus-5-5-20260101-fast-20260101",
            "claude-opus-5-5@not-a-date",
            "claude-opus-5-5@20261301",
            "claude-opus-5-5@latest",
            "claude-opus-5-5-20261301",
            "claude-opus-5-5-20260100",
            "claude-opus-5-5-20260230",
            "claude-opus-5-5-20260431",
            "claude-opus-5-5-20270229",
            "claude-opus-5-5-20260101-20260101",
            "claude-opus-5-5-v2",
            "claude-opus-5-5-v1:0",  # the version tail belongs to the Bedrock form only
            "us.anthropic.claude-opus-5-5-v2",
            "claude-opus-5-5-fast-fast",
            "us.anthropic.claude-opus-5-5-v1:0-v1:0",
        ):
            with self.subTest(model=name):
                self.assertEqual(self.cost(name), (0.0, True))
        self.assertAlmostEqual(self.cost("claude-opus-5-5-20280229")[0], 37.2)  # a leap day
        self.assertAlmostEqual(self.cost("claude-opus-5-5-20200101")[0], 37.2)  # the first year that counts
        for name in ("claude-opus-5-5@20260101", "claude-opus-5-5@20260101[1m]", "claude-opus-5-5[1m]@20260101",
                     "us.anthropic.claude-opus-5-5-v2:0", "us.anthropic.claude-opus-5-5-v999:999"):
            with self.subTest(model=name):
                self.assertAlmostEqual(self.cost(name)[0], 37.2)
        self.assertAlmostEqual(self.cost("claude-opus-5-5-20260101-fast")[0], 74.4)
        self.append(self.transcript, assistant("msg_1", model="claude-opus-5-5-12345678", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$0.00?")

    def test_price_limit_holds_for_the_price_that_is_used(self):
        base = {"output": 1, "cacheRead": 0, "cacheWrite": 0}
        # The limit itself is a price. One step above it is not.
        self.assertEqual(BS.price_row([100000, 1, 0, 0, 0])[0], 100000.0)
        self.assertIsNone(BS.price_row([100000.01, 1, 0, 0, 0]))
        self.assertEqual(BS.price_row(dict(base, input=100000))[0], 100000.0)
        # A multiplier counts: the product is what a request pays.
        self.assertEqual(BS.price_row(dict(base, input=100, multiplier=1000))[0], 100000.0)
        self.assertIsNone(BS.price_row(dict(base, input=100.01, multiplier=1000)))
        self.assertIsNone(BS.price_row(dict(base, input=100000, multiplier=2)))
        self.assertIsNone(BS.price_row(dict(base, input=0.001, multiplier=1001)), "the multiplier has a limit too")
        high = dict(base, input=60000, threshold=1000)
        self.assertIsNone(BS.price_row(dict(base, input=1, multiplier=2, above=high)))
        self.assertEqual(BS.price_row(dict(base, input=1, multiplier=1.5, above=high))[5][1], 90000.0)

    def test_plain_user_key_wins_over_another_key_for_the_same_model(self):
        """Whatever the order of the keys is, the plain id is the row of its model."""
        for other in ("claude-opus-5-5-20260101", "anthropic.claude-opus-5-5"):  # sorts after, sorts before
            with self.subTest(other=other):
                user = BS._user_prices({other: [9, 9, 9, 9, 9], "claude-opus-5-5": [1, 1, 1, 1, 1]})
                table = BS.price_table(user)
                self.assertEqual(BS.price_for("claude-opus-5-5-20270101", table)[0][0], 1.0)
                self.assertEqual(BS.price_for(other, table)[0][0], 9.0)  # the key as written keeps its row

    def test_reset_time_far_away_has_no_stamp(self):
        self.assertNotEqual(BS._clock(NOW + 399 * 86400, NOW), "")
        self.assertEqual(BS._clock(NOW + 401 * 86400, NOW), "")
        self.assertEqual(BS._clock(NOW - 401 * 86400, NOW), "")

    def test_mythos_5_has_a_row(self):
        self.assertAlmostEqual(self.cost("claude-mythos-5")[0], 10 + 50 + 1 + 12.5 + 20)

    def test_fast_deployment_name_takes_the_fast_rate(self):
        self.assertEqual(BS.model_name("claude-opus-5-5-fast"), ("claude-opus-5-5", True))
        for name in ("claude-opus-5-5-fast", "us.anthropic.claude-opus-5-5-fast-v1:0",
                     "claude-opus-5-5-fast-20260101"):
            with self.subTest(model=name):
                self.assertAlmostEqual(self.cost(name)[0], 74.4)
        # Once, not twice, when the request also says fast.
        self.assertAlmostEqual(self.cost("claude-opus-5-5-fast", bucket="f")[0], 74.4)

    def test_user_row_covers_the_forms_of_its_own_model_only(self):
        user = {"claude-opus-5-5": [1, 2, 3, 4, 5]}
        for name in ("claude-opus-5-5", "us.anthropic.claude-opus-5-5-v1:0",
                     "claude-opus-5-5@20260101", "claude-opus-5-5-20260101", "CLAUDE-OPUS-5-5[1m]"):
            with self.subTest(model=name):
                self.assertAlmostEqual(self.cost(name, user)[0], 15)
        self.assertAlmostEqual(self.cost("claude-opus-5", user)[0], 46.75)
        self.assertEqual(self.cost("claude-opus-5-5-1", user), (0.0, True))

    def test_user_key_in_provider_or_dated_form_matches_its_model(self):
        for key in ("us.anthropic.claude-opus-5-5-v1:0", "claude-opus-5-5-20260101",
                    "Claude-Opus-5-5@20260101"):
            with self.subTest(key=key):
                user = {key: [1, 2, 3, 4, 5]}
                self.assertAlmostEqual(self.cost("claude-opus-5-5", user)[0], 15)
                self.assertAlmostEqual(self.cost("claude-opus-5-5-20270101", user)[0], 15)

    def test_user_row_always_wins_over_the_built_in_row(self):
        user = {"claude-opus-5": [1, 1, 1, 1, 1], "my-model": [1, 1, 1, 1, 1]}
        self.assertAlmostEqual(self.cost("claude-opus-5", user)[0], 5)
        self.assertAlmostEqual(self.cost("claude-opus-5-20260101", user)[0], 5)
        self.assertAlmostEqual(self.cost("my-model", user)[0], 5)
        self.assertEqual(self.cost("my-model-large", user), (0.0, True))
        # The row for claude-opus-5 does not reach claude-opus-5-5.
        self.assertAlmostEqual(self.cost("claude-opus-5-5", user)[0], 37.2)

    def test_exact_user_key_wins_over_the_key_of_the_model(self):
        user = {"claude-opus-5-5": [1, 1, 1, 1, 1], "us.anthropic.claude-opus-5-5-v1:0": [2, 2, 2, 2, 2]}
        self.assertAlmostEqual(self.cost("us.anthropic.claude-opus-5-5-v1:0", user)[0], 10)
        self.assertAlmostEqual(self.cost("claude-opus-5-5", user)[0], 5)
        self.assertAlmostEqual(self.cost("eu.anthropic.claude-opus-5-5-v1:0", user)[0], 5)

    def test_model_pricing_row_shape_is_accepted(self):
        user = {"claude-opus-5-5": {"input": 1, "output": 2, "cacheRead": 3, "cacheWrite": 4}}
        self.assertAlmostEqual(self.cost("claude-opus-5-5", user)[0], 1 + 2 + 3 + 4 + 4)
        user = {"claude-opus-5-5": {"input": 1, "output": 2, "cacheRead": 3,
                                    "cacheWrite5m": 4, "cacheWrite1h": 5, "multiplier": 0.5}}
        self.assertAlmostEqual(self.cost("claude-opus-5-5", user)[0], 7.5)

    def test_malformed_user_prices_are_ignored(self):
        good = {"input": 1, "output": 2, "cacheRead": 3, "cacheWrite": 4}
        user = BS._user_prices(
            {
                "claude-opus-5-5": [1, 2, 3],
                "claude-opus-5": "cheap",
                "claude-sonnet-5": [1, 2, 3, 4, "5"],
                "claude-haiku-5-5": [1, 2, 3, 4, -5],
                "claude-haiku-4-5": [True, 2, 3, 4, 5],
                "claude-fable-5": [1, 2, 3, 4, float("nan")],
                "claude-fable-5-1": [1, 2, 3, 4, float("inf")],
                "claude-fable-5-2": [1, 2, 3, 4, 1e9],
                "claude-mythos-5": {"input": 1, "output": 2},
                "claude-mythos-5-1": dict(good, multiplier="2"),
                "claude-mythos-5-2": dict(good, above={"threshold": 0, **good}),
                "claude-sonnet-5-5": dict(good, above={"threshold": 1000}),
                "claude-sonnet-4-6": dict(good, above=[1000, 1, 2, 3, 4]),
                "": [1, 2, 3, 4, 5],
                "ok": [1, 2, 3, 4, 5],
            }
        )
        self.assertEqual(user, {"ok": (1.0, 2.0, 3.0, 4.0, 5.0, None)})

    def test_unknown_model_counts_as_zero_and_is_marked(self):
        self.assertEqual(self.cost("some-other-model"), (0.0, True))

    def test_model_without_tokens_is_ignored(self):
        self.assertEqual(self.cost("<synthetic>", tup=(0, 0, 0, 0, 0, 0)), (0.0, False))

    def test_fast_speed_doubles_the_token_prices(self):
        self.assertAlmostEqual(self.cost("claude-opus-5-5", bucket="f")[0], 74.4)

    def test_web_search_is_a_cent_per_request_at_any_speed(self):
        for bucket in ("n", "f", "a", "af"):
            usd, _ = self.cost("claude-opus-5-5", bucket=bucket, tup=(0, 0, 0, 0, 0, 3))
            self.assertAlmostEqual(usd, 0.03)

    def test_prices_from_the_config_file_reach_the_row(self):
        self.append(self.transcript, assistant("msg_1", model="my-model", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$0.00?")
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"prices": {"my-model": [3, 0, 0, 0, 0], "bad": [1]}}, fh)
        self.assertEqual(self.cost_segment(), "~$3.00")


class TestLongPromptRate(LedgerBase):
    """Haiku 5.5: a request with a prompt above 100,000 tokens pays more."""

    HAIKU = "claude-haiku-5-5"

    def test_rates_above_the_threshold(self):
        table = BS.price_table()
        usd, _ = BS.ledger_cost({self.HAIKU: {"a": [1000000] * 5 + [0]}}, table)
        self.assertAlmostEqual(usd, 0.50 + 2.50 + 0.05 + 0.625 + 1.0)
        usd, _ = BS.ledger_cost({self.HAIKU: {"af": [1000000] * 5 + [0]}}, table)
        self.assertAlmostEqual(usd, 2 * (0.50 + 2.50 + 0.05 + 0.625 + 1.0))
        usd, _ = BS.ledger_cost({self.HAIKU: {"n": [1000000] * 5 + [0]}}, table)
        self.assertAlmostEqual(usd, 0.10 + 0.50 + 0.01 + 0.125 + 0.20)

    def test_each_request_is_priced_on_its_own(self):
        self.append(
            self.transcript,
            # 100,000 prompt tokens: not above. Output does not count.
            assistant("msg_1", model=self.HAIKU, inp=10, read=99000, w5=990, out=500000),
            # 100,001: above, by input + cache read + both cache writes.
            assistant("msg_2", model=self.HAIKU, inp=10, read=99000, w5=490, w1=501, out=1000),
            assistant("msg_3", model=self.HAIKU, inp=200000, speed="fast"),
        )
        self.assertEqual(
            self.totals()["main"][self.HAIKU],
            {
                "n": [10, 500000, 99000, 990, 0, 0],
                "a": [10, 1000, 99000, 490, 501, 0],
                "af": [200000, 0, 0, 0, 0, 0],
            },
        )

    def test_the_row_shows_the_higher_rate(self):
        self.append(self.transcript, assistant("msg_1", model=self.HAIKU, read=40000000))
        self.assertEqual(self.cost_segment(), "~$2.00")  # 40M cache read at 0.05
        with open(self.transcript, "wb") as fh:
            fh.write(b"")
        self.append(self.transcript, *[
            assistant("msg_%d" % i, model=self.HAIKU, read=100000) for i in range(400)
        ])
        self.assertEqual(self.cost_segment(), "~$0.40")  # the same 40M at 0.01

    def test_other_models_have_no_threshold(self):
        self.append(self.transcript, assistant("msg_1", read=40000000))
        self.assertEqual(list(self.totals()["main"]["claude-opus-5-5"]), ["n"])

    def test_user_row_can_carry_a_threshold(self):
        row = {"input": 1, "output": 1, "cacheRead": 1, "cacheWrite": 1,
               "above": {"threshold": 1000, "input": 10, "output": 10, "cacheRead": 10, "cacheWrite": 10}}
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"prices": {"my-model": row}}, fh)
        self.append(
            self.transcript,
            assistant("msg_1", model="my-model", inp=1000),
            assistant("msg_2", model="my-model", inp=1000000),
        )
        self.assertEqual(self.cost_segment(), "~$10.00")

    def test_changed_threshold_rebuilds_the_ledger(self):
        self.append(self.transcript, assistant("msg_1", model=self.HAIKU, read=40000000))
        self.assertEqual(self.cost_segment(), "~$2.00")
        row = {"input": 0.1, "output": 0.5, "cacheRead": 0.01, "cacheWrite": 0.125}
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"prices": {self.HAIKU: row}}, fh)
        # No threshold in the user's row, so the request is not above anything.
        self.assertEqual(self.cost_segment(), "~$0.40")
        with open(self.sidecar, encoding="utf-8") as fh:
            self.assertEqual(list(json.load(fh)["main"]["t"][self.HAIKU]), ["n"])

    def test_sidecar_of_the_earlier_format_is_rebuilt(self):
        self.append(self.transcript, assistant("msg_1", model=self.HAIKU, read=40000000))
        os.makedirs(os.path.dirname(self.sidecar))
        with open(self.sidecar, "w", encoding="utf-8") as fh:
            json.dump({"v": 2, "path": self.transcript, "sub": {}, "cur": "", "live": [], "sum": {},
                       "tiers": [["builtin", self.HAIKU, 100000]],
                       "main": {"off": os.path.getsize(self.transcript), "ids": {},
                                "t": {self.HAIKU: {"n": [0, 0, 40000000, 0, 0, 0]}}}}, fh)
        self.assertEqual(self.cost_segment(), "~$2.00")
        with open(self.sidecar, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["v"], 3)


class TestCostSource(LedgerBase):
    def setUp(self):
        super().setUp()
        # Main: 0.4 + 0.8 = 1.20 USD. Subagent: 0.40 USD.
        self.append(self.transcript, assistant("msg_1", inp=100000, out=40000))
        self.append(self.agent(), assistant("msg_2", inp=100000))

    def test_estimate_shows_the_total_and_the_subagent_share(self):
        self.assertEqual(self.cost_segment(), "~$1.60 (sub $0.40)")

    def test_subagent_share_below_a_cent_is_not_shown(self):
        with open(self.agent(), "wb") as fh:
            fh.write(assistant("msg_2", inp=1000).encode() + b"\n")
        self.assertEqual(self.cost_segment(), "~$1.20")

    def test_partial_and_unknown_markers_sit_after_the_total(self):
        self.append(self.agent("agent-b2.jsonl"), assistant("msg_3", model="other", inp=5))
        self.assertEqual(self.cost_segment(), "~$1.60? (sub $0.40)")
        BS.LEDGER_BUDGET_MS = 0
        self.append(self.transcript, assistant("msg_4", inp=100000), assistant("msg_5", inp=100000))
        self.assertEqual(self.cost_segment(), "~$2.00+? (sub $0.40)")

    def test_estimate_ignores_the_payload_cost(self):
        self.assertEqual(
            self.cost_segment(cost={"total_cost_usd": 9.99}), "~$1.60 (sub $0.40)"
        )

    def test_payload_never_reads_transcripts(self):
        self.assertEqual(self.cost_segment("payload", cost={"total_cost_usd": 9.99}), "$9.99")
        self.assertEqual(self.cost_segment("payload"), "$?")
        self.assertFalse(os.path.exists(self.sidecar))

    def test_auto_prefers_the_payload_number(self):
        self.assertEqual(self.cost_segment("auto", cost={"total_cost_usd": 9.99}), "$9.99")
        self.assertEqual(self.cost_segment("auto", cost={"total_cost_usd": 0}), "$0.00")
        self.assertFalse(os.path.exists(self.sidecar))

    def test_auto_falls_back_to_the_estimate(self):
        self.assertEqual(self.cost_segment("auto"), "~$1.60 (sub $0.40)")
        self.assertEqual(
            self.cost_segment("auto", cost={"total_lines_added": 3}), "~$1.60 (sub $0.40)"
        )
        self.assertEqual(
            self.cost_segment("auto", cost={"total_cost_usd": None}), "~$1.60 (sub $0.40)"
        )

    def test_unknown_cost_source_falls_back_to_auto(self):
        self.assertEqual(self.cost_segment("nonsense", cost={"total_cost_usd": 9.99}), "$9.99")

    def test_cost_source_from_the_config_file(self):
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"cost_source": "estimate"}, fh)
        self.assertEqual(
            self.cost_segment(None, cost={"total_cost_usd": 9.99}), "~$1.60 (sub $0.40)"
        )

    def test_hidden_cost_segment_runs_no_ledger(self):
        os.environ["BOBBY_STATUSLINE_SEGMENTS"] = "-cost"
        self.assertEqual(self.cost_segment(), "")
        os.environ["BOBBY_STATUSLINE_SEGMENTS"] = ""
        os.environ["BOBBY_STATUSLINE_BILLING"] = "plan"
        self.assertEqual(self.cost_segment(), "")
        self.assertFalse(os.path.exists(self.sidecar))

    def test_estimate_keeps_the_cost_color(self):
        del os.environ["NO_COLOR"]
        os.environ["BOBBY_STATUSLINE_COST_SOURCE"] = "estimate"
        row = BS.render(json.dumps(self.payload()), now=NOW)
        self.assertIn("\033[38;5;109m~$1.60 (sub $0.40)\033[0m", row)


class TestBillingShapes(LedgerBase):
    """billing auto and cost_source auto, for the three account shapes."""

    LIMITS = {
        "five_hour": {"used_percentage": 26, "resets_at": NOW + 3600},
        "seven_day": {"used_percentage": 14, "resets_at": NOW + 86400},
    }

    def setUp(self):
        super().setUp()
        self.append(self.transcript, assistant("msg_1", inp=100000, out=40000))
        self.append(self.agent(), assistant("msg_2", inp=100000))

    def row(self, **fields) -> str:
        return self.plain(BS.render(json.dumps(self.payload(**fields)), now=NOW))

    def test_token_billing_with_a_payload_cost_shows_it_and_runs_no_ledger(self):
        row = self.row(cost={"total_cost_usd": 1.37, "total_lines_added": 2})
        self.assertIn("$1.37", row)
        self.assertNotIn("~$", row)
        self.assertNotIn("5h", row)
        self.assertFalse(os.path.exists(os.path.join(self.config, "bobby-statusline")))

    def test_token_billing_without_a_payload_cost_shows_the_estimate(self):
        row = self.row(cost={"total_lines_added": 2, "total_lines_removed": 1})
        self.assertIn("~$1.60 (sub $0.40)", row)
        self.assertNotIn("5h", row)
        self.assertIn("+2/-1", row)
        self.assertTrue(os.path.isfile(self.sidecar))

    def test_subscription_shows_no_cost_and_runs_no_ledger(self):
        row = self.row(rate_limits=self.LIMITS, cost={"total_cost_usd": 1.37})
        self.assertIn("5h 26%", row)
        self.assertNotIn("$", row)
        row = self.row(rate_limits=self.LIMITS, cost={"total_lines_added": 2})
        self.assertNotIn("$", row)
        self.assertFalse(os.path.exists(os.path.join(self.config, "bobby-statusline")))


class TestLedgerHardening(LedgerBase):
    """Inputs that are hostile, broken or only large."""

    def run_script(self, payload: dict, timeout=20, **env):
        environ = dict(os.environ, BOBBY_STATUSLINE_COST_SOURCE="estimate")
        environ.update(env)
        return subprocess.run(
            [sys.executable, SCRIPT], input=json.dumps(payload),
            capture_output=True, text=True, env=environ, timeout=timeout,
        )

    def renders_until_complete(self, limit: int):
        """(renders, result, slowest ms): render until the scan is complete."""
        slowest = 0.0
        for count in range(1, limit + 1):
            start = time.perf_counter()
            result = self.totals()
            slowest = max(slowest, (time.perf_counter() - start) * 1000)
            if not result["partial"]:
                return count, result, slowest
        self.fail("the scan was not complete after %d renders" % limit)

    # -- a very long line -------------------------------------------------

    def long_line_transcript(self, size: int):
        self.append(self.transcript, assistant("msg_1", inp=100))
        blob = json.dumps({"type": "user", "message": {"content": "x" * size}})
        self.append(self.transcript, blob)
        self.append(self.transcript, assistant("msg_2", inp=20), assistant("msg_3", inp=3))

    def test_ten_megabyte_line_is_passed_in_a_few_renders(self):
        self.long_line_transcript(10 << 20)
        BS.LEDGER_BUDGET_MS = 15.0
        count, result, slowest = self.renders_until_complete(8)
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 123)
        # Loose on purpose: the point is "bounded", and a loaded machine is slow.
        self.assertLess(slowest, 500.0)
        self.assertEqual(self.totals()["read"], 0)

    def test_long_line_makes_progress_with_no_time_at_all(self):
        """The offset moves inside the line, so no render starts over."""
        self.long_line_transcript(10 << 20)
        BS.LEDGER_BUDGET_MS = 0
        offsets = []
        for _ in range(40):
            result = self.totals()
            with open(self.sidecar, encoding="utf-8") as fh:
                offsets.append(json.load(fh)["main"]["off"])
            if not result["partial"]:
                break
        self.assertFalse(result["partial"])
        self.assertEqual(offsets, sorted(set(offsets)), "every render moved the offset")
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 123)

    def test_long_line_is_passed_when_the_clock_is_slow(self):
        """Progress inside the line is kept, so a slow machine still gets past it.

        Every look at the clock costs 3 ms here, which leaves five looks for
        each render. A scan that starts the line again on every render never
        reaches its end.
        """
        self.long_line_transcript(10 << 20)
        BS.LEDGER_BUDGET_MS = 15.0
        clock = {"calls": 0}
        real = BS.time.perf_counter

        def ticking():
            clock["calls"] += 1
            return clock["calls"] * 0.003

        BS.time.perf_counter = ticking
        try:
            for count in range(1, 13):
                clock["calls"] = 0
                result = self.totals()
                if not result["partial"]:
                    break
        finally:
            BS.time.perf_counter = real
        self.assertFalse(result["partial"], "not complete after %d renders" % count)
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 123)

    def test_line_just_under_the_limit_is_still_parsed(self):
        big = json.dumps(
            {"type": "assistant", "pad": "x" * (3 << 20),
             "message": {"id": "msg_1", "model": "claude-opus-5-5", "usage": usage(inp=7)}},
            separators=(",", ":"),
        )
        self.append(self.transcript, big, assistant("msg_2", inp=1))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 8)

    # -- many files ---------------------------------------------------------

    def test_two_thousand_files_reach_a_complete_total(self):
        self.append(self.transcript, assistant("msg_0", inp=1))
        os.makedirs(self.subagents)
        for i in range(2000):
            with open(self.agent("agent-%04d.jsonl" % i), "wb") as fh:
                fh.write(assistant("msg_%d" % i, inp=1).encode() + b"\n")
        BS.LEDGER_BUDGET_MS = 15.0
        count, result, _ = self.renders_until_complete(60)
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 2000)
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 1)
        self.assertNotIn("+", self.cost_segment())

    def test_slow_sidecar_load_does_not_use_up_the_reading_time(self):
        """The time limit is for reading transcripts. It starts after the load."""
        self.append(self.transcript, assistant("msg_0", inp=1))
        os.makedirs(self.subagents)
        for i in range(300):
            with open(self.agent("agent-%03d.jsonl" % i), "wb") as fh:
                fh.write(assistant("msg_%d" % i, inp=1).encode() + b"\n")
        BS.LEDGER_BUDGET_MS = 15.0
        late = [0.0]
        real_clock, real_load = BS.time.perf_counter, BS.ledger_load

        def slow_load(*args):
            late[0] += 0.050  # the load alone takes longer than the whole limit
            return real_load(*args)

        BS.time.perf_counter = lambda: real_clock() + late[0]
        BS.ledger_load = slow_load
        try:
            count, result, _ = self.renders_until_complete(30)
        finally:
            BS.time.perf_counter, BS.ledger_load = real_clock, real_load
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 300)

    def test_scan_goes_on_after_the_last_file_it_read(self):
        """A main transcript that grows on every render must not starve the rest."""
        self.append(self.transcript, assistant("msg_0", inp=1), assistant("msg_1", inp=1))
        for name in ("agent-a.jsonl", "agent-b.jsonl", "agent-c.jsonl"):
            self.append(self.agent(name), assistant(name + "1", inp=1), assistant(name + "2", inp=1))
        BS.LEDGER_BUDGET_MS = 0
        seen = []
        for i in range(12):
            self.append(self.transcript, assistant("more_%d" % i, inp=1), assistant("again_%d" % i, inp=1))
            result = self.totals()
            seen.append(result["sub"].get("claude-opus-5-5", {"n": [0]})["n"][0])
        self.assertEqual(seen[-1], 6, seen)
        BS.LEDGER_BUDGET_MS = 5000.0
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 26)

    # -- things that are not regular files ------------------------------------

    def test_named_pipe_at_the_sidecar_path_does_not_hang(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        os.makedirs(os.path.dirname(self.sidecar))
        os.mkfifo(self.sidecar)
        result = self.run_script(self.payload())
        self.assertIn("~$4.00", result.stdout)
        self.assertTrue(stat_is_fifo(self.sidecar), "the pipe was not replaced")

    def test_named_pipe_with_a_writer_is_not_believed(self):
        """A pipe that has data in it opens and reads like a file. It is not one."""
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$4.00")
        with open(self.sidecar, encoding="utf-8") as fh:
            stored = json.load(fh)
        stored["main"]["t"]["claude-opus-5-5"]["n"][0] = 5000000
        os.unlink(self.sidecar)
        os.mkfifo(self.sidecar)
        writer = os.open(self.sidecar, os.O_RDWR | os.O_NONBLOCK)
        self.addCleanup(os.close, writer)
        os.write(writer, json.dumps(stored, separators=(",", ":")).encode())
        self.assertEqual(self.cost_segment(), "~$4.00")

    def test_named_pipe_as_a_transcript_does_not_hang(self):
        os.mkfifo(self.transcript)
        self.assertIn("$?", self.run_script(self.payload()).stdout)
        os.unlink(self.transcript)
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        os.makedirs(self.subagents)
        os.mkfifo(self.agent())
        self.assertIn("~$4.00 ", self.run_script(self.payload()).stdout)

    def test_named_pipe_as_a_config_or_flag_file_does_not_hang(self):
        for name in ("bobby-statusline.json", ".caveman-active", ".ste-active"):
            os.mkfifo(os.path.join(self.config, name))
        result = self.run_script(self.payload())
        self.assertIn("ctx ?%", result.stdout)

    def test_directory_as_a_sidecar_gives_the_total_and_stays(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        os.makedirs(self.sidecar)
        self.assertEqual(self.cost_segment(), "~$4.00")
        self.assertTrue(os.path.isdir(self.sidecar))

    # -- symlinks -------------------------------------------------------------

    def test_symlinked_session_directory_is_refused(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.append(self.agent(), assistant("msg_2", inp=100))
        session = os.path.join(self.project, SESSION)
        moved = os.path.join(self.project, "moved")
        os.rename(session, moved)
        os.symlink(moved, session)
        self.assertEqual(self.totals()["sub"], {})

    def test_symlinked_subagents_directory_is_refused(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.append(self.agent(), assistant("msg_2", inp=100))
        moved = os.path.join(self.project, "moved")
        os.rename(self.subagents, moved)
        os.symlink(moved, self.subagents)
        self.assertEqual(self.totals()["sub"], {})

    def test_symlinked_ledger_directory_is_refused(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        elsewhere = os.path.join(self.config, "elsewhere")
        usage_dir = os.path.dirname(self.sidecar)
        base = os.path.dirname(usage_dir)
        os.makedirs(elsewhere)
        os.symlink(elsewhere, base)  # the parent is a link
        self.assertIsNone(self.totals())
        self.assertEqual(self.cost_segment(), "$?")
        self.assertEqual(os.listdir(elsewhere), [])
        os.unlink(base)
        os.makedirs(base)
        os.symlink(elsewhere, usage_dir)  # the directory itself is a link
        self.assertIsNone(self.totals())
        self.assertEqual(self.cost_segment(), "$?")
        self.assertEqual(os.listdir(elsewhere), [])

    def test_symlink_at_the_temporary_name_is_not_written_through(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        folder = os.path.dirname(self.sidecar)
        os.makedirs(folder)
        target = os.path.join(self.config, "target")
        with open(target, "w") as fh:
            fh.write("keep")
        os.symlink(target, os.path.join(folder, ".%s.%d.tmp" % (SESSION, os.getpid())))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 100)
        self.assertTrue(os.path.isfile(self.sidecar))
        with open(target) as fh:
            self.assertEqual(fh.read(), "keep")

    def test_prune_does_not_follow_or_delete_a_symlink(self):
        folder = os.path.dirname(self.sidecar)
        os.makedirs(folder)
        target = os.path.join(self.config, "target.json")
        with open(target, "w") as fh:
            fh.write("{}")
        stamp = time.time() - 40 * 86400
        os.utime(target, (stamp, stamp))
        os.symlink(target, os.path.join(folder, "linked.json"))
        os.makedirs(os.path.join(folder, "folder.json"))
        self.append(self.transcript, assistant("msg_1", inp=1))
        self.totals()
        self.assertEqual(sorted(os.listdir(folder)), sorted(["linked.json", "folder.json", SESSION + ".json"]))
        self.assertTrue(os.path.isfile(target))

    # -- a transcript that is another file now --------------------------------

    def test_transcript_rewritten_in_place_and_larger_is_rebuilt(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 100)
        with open(self.transcript, "wb") as fh:  # same inode, other content, more bytes
            fh.write((assistant("msg_8", inp=7) + "\n" + assistant("msg_9", inp=7) + "\n").encode())
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 14)

    def test_transcript_rewritten_in_place_with_the_same_size_is_rebuilt(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.totals()
        with open(self.transcript, "r+b") as fh:
            fh.write(assistant("msg_5", inp=700).encode() + b"\n")
        later = time.time() + 5
        os.utime(self.transcript, (later, later))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 700)
        # The same bytes with a new time are the same file: nothing is read again.
        os.utime(self.transcript, (later + 5, later + 5))
        result = self.totals()
        self.assertEqual((result["read"], result["main"]["claude-opus-5-5"]["n"][0]), (0, 700))

    def test_transcript_replaced_by_a_file_of_the_same_size_is_rebuilt(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        self.append(self.agent(), assistant("msg_2", inp=100))
        self.totals()
        for path, mid in ((self.transcript, "msg_3"), (self.agent(), "msg_4")):
            size = os.path.getsize(path)
            stamp = os.stat(path).st_mtime_ns
            other = path + ".new"
            with open(other, "wb") as fh:
                fh.write(assistant(mid, inp=700).encode() + b"\n")
            self.assertEqual(os.path.getsize(other), size)
            os.replace(other, path)
            # Same size and same time: only the inode says it is another file.
            os.utime(path, ns=(stamp, stamp))
        result = self.totals()
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 700)
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 700)

    # -- usage numbers ----------------------------------------------------------

    def test_cache_write_total_is_the_authority_over_the_split(self):
        # A split that is empty, with a total that is not.
        self.assertEqual(BS.usage_tuple(usage(created=300))[3:5], [300, 0])
        # A split left over on a line whose numbers are all zero.
        self.assertEqual(BS.usage_tuple(usage(w5=823, created=0)), [0, 0, 0, 0, 0, 0])
        self.assertEqual(BS.usage_tuple(usage(w1=823, created=0)), [0, 0, 0, 0, 0, 0])
        # A split that adds up is kept.
        self.assertEqual(BS.usage_tuple(usage(w5=100, w1=200))[3:5], [100, 200])
        self.append(
            self.transcript,
            assistant("msg_1", created=1000000),
            assistant("msg_2", w5=823, created=0),
        )
        self.assertEqual(self.cost_segment(), "~$5.00")

    def test_session_id_is_matched_as_a_whole(self):
        self.append(self.transcript, assistant("msg_1", inp=100))
        for bad in (SESSION + "\n", "abc\n", "\nabc"):
            with self.subTest(session_id=bad):
                self.assertEqual(self.cost_segment(session_id=bad), "$?")
        self.assertFalse(os.path.exists(os.path.join(self.config, "bobby-statusline")))

    def test_absurd_total_shows_no_number_and_keeps_the_row(self):
        """One request cannot be this large, so it takes many: 2000 of 900M tokens."""
        self.append(self.transcript, *[assistant("msg_%d" % i, read=9 * 10**8) for i in range(2000)])
        os.environ["BOBBY_STATUSLINE_COST_SOURCE"] = "estimate"
        row = self.plain(BS.render(json.dumps(self.payload(model={"display_name": "Opus 5"})), now=NOW))
        self.assertEqual(row, "ctx ?% | $? | cache ? | Opus 5")

    def test_token_total_above_the_sane_bound_shows_no_number(self):
        """Also when the price makes the cost look small."""
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"prices": {"my-model": [0, 0, 0, 0, 0]}}, fh)
        lines = [assistant("msg_%d" % i, model="my-model", read=9 * 10**8) for i in range(1200)]
        self.append(self.transcript, *lines)
        self.assertEqual(self.cost_segment(), "$?")
        with open(self.transcript, "wb") as fh:
            fh.write(("\n".join(lines[:1000]) + "\n").encode())
        self.assertEqual(self.cost_segment(), "~$0.00")

    def test_cost_above_the_sane_bound_shows_no_number(self):
        lines = [assistant("msg_%d" % i, out=10**9) for i in range(6)]  # 20,000 USD each
        self.append(self.transcript, *lines)
        self.assertEqual(self.cost_segment(), "$?")
        with open(self.transcript, "wb") as fh:
            fh.write(("\n".join(lines[:4]) + "\n").encode())
        self.assertEqual(self.cost_segment(), "~$80000.00")

    def test_huge_number_in_the_sidecar_is_not_shown(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$4.00")
        with open(self.sidecar, encoding="utf-8") as fh:
            stored = json.load(fh)
        for planted, want in ((10**14, "$?"), (10**40, "~$4.00"), (-5, "~$4.00"), (1.5, "~$4.00")):
            with self.subTest(planted=planted):
                stored["main"]["t"] = {"claude-opus-5-5": {"n": [planted, 0, 0, 0, 0, 0]}}
                with open(self.sidecar, "w", encoding="utf-8") as fh:
                    json.dump(stored, fh)
                # Inside the range it is believed and too large to show.
                # Outside the range the file is not believed and is rebuilt.
                self.assertEqual(self.cost_segment(), want)

    def test_control_characters_of_model_and_id_stay_out_of_the_sidecar(self):
        line = json.dumps(
            {"type": "assistant",
             "message": {"id": "msg\u001b[31m_1\u202e", "model": "claude-opus\u001b[31m-5-5\u009b\u202e",
                         "usage": usage(inp=1000000)}},
            separators=(",", ":"),
        )
        self.append(self.transcript, line)
        row = self.cost_segment()
        with open(self.sidecar, encoding="utf-8") as fh:
            text = fh.read()
        for bad in ("\u001b", "\\u001b", "\u202e", "\\u202e", "\u009b", "\\u009b"):
            self.assertNotIn(bad, text)
            self.assertNotIn(bad, row)
        self.assertIn("claude-opus[31m-5-5", json.loads(text)["main"]["t"])


def stat_is_fifo(path: str) -> bool:
    import stat

    return stat.S_ISFIFO(os.lstat(path).st_mode)


class TestPayloadTypes(LedgerBase):
    """A payload field of the wrong type costs that segment, never the row."""

    def setUp(self):
        super().setUp()
        self.append(self.transcript, assistant("msg_1", inp=100000, out=40000))

    def test_numeric_string_cost_is_a_cost(self):
        self.assertEqual(self.cost_segment("auto", cost={"total_cost_usd": "1.50"}), "$1.50")
        self.assertEqual(self.cost_segment("payload", cost={"total_cost_usd": "1.50"}), "$1.50")
        self.assertFalse(os.path.exists(self.sidecar))

    def test_cost_that_is_no_number_is_absent(self):
        for bad in ("abc", "", [1], {"a": 1}, True):
            with self.subTest(cost=bad):
                self.assertEqual(self.cost_segment("payload", cost={"total_cost_usd": bad}), "$?")
                self.assertEqual(self.cost_segment("auto", cost={"total_cost_usd": bad}), "~$1.20")

    def test_nan_and_infinity_are_never_printed(self):
        for bad in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(value=bad):
                payload = '{"cost":{"total_cost_usd":%s,"total_lines_added":%s},"model":{"display_name":"Opus 5"}}' % (bad, bad)
                for source in ("payload", "auto"):
                    os.environ["BOBBY_STATUSLINE_COST_SOURCE"] = source
                    row = self.plain(BS.render(payload, now=NOW)).lower()
                    self.assertIn("opus 5", row)
                    self.assertIn("$?", row)
                    self.assertNotIn("nan", row)
                    self.assertNotIn("inf", row)

    def test_field_that_is_not_an_object_does_not_empty_the_row(self):
        for key in ("cost", "vim", "context_window", "rate_limits", "model", "effort",
                    "thinking", "agent", "pr", "worktree", "workspace"):
            for bad in ("text", 5, [1, 2], True):
                with self.subTest(key=key, value=bad):
                    payload = {"model": {"display_name": "Opus 5"}, "effort": {"level": "high"}}
                    payload[key] = bad
                    row = self.plain(BS.render(json.dumps(payload), now=NOW))
                    self.assertIn("ctx ?%", row)
                    self.assertTrue("Opus 5" in row or "high effort" in row, row)


class TestLedgerLimits(LedgerBase):
    """The limits of the scan, and what the row shows when one of them cuts."""

    def one_line_files(self, count: int, *parts, start: int = 0):
        folder = os.path.join(self.subagents, *parts)
        os.makedirs(folder, exist_ok=True)
        for i in range(start, start + count):
            with open(os.path.join(folder, "agent-%05d.jsonl" % i), "wb") as fh:
                fh.write(assistant("msg_%d" % i, inp=1).encode() + b"\n")

    def stored(self) -> dict:
        with open(self.sidecar, encoding="utf-8") as fh:
            return json.load(fh)

    def settle_directories(self):
        """Make every directory look as if nothing was added to it for a while."""
        old = time.time() - 60
        for folder, _, _ in os.walk(self.subagents):
            os.utime(folder, (old, old))

    # -- more than the scan takes -----------------------------------------

    def test_more_files_than_the_limit_keeps_the_mark(self):
        self.append(self.transcript, assistant("msg_main", inp=1000000))
        self.one_line_files(2001)
        result = self.totals()
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 2000)
        self.assertTrue(result["partial"], "one transcript is not counted, so the total is a floor")
        self.assertEqual(self.cost_segment(), "~$4.01+ (sub $0.01)")
        self.assertEqual(len(self.stored()["sub"]), 2000)

    def test_more_directories_than_the_limit_keeps_the_mark(self):
        self.append(self.transcript, assistant("msg_main", inp=1000000))
        for i in range(513):
            self.one_line_files(1, "workflows", "wf-%04d" % i, start=i)
        result = self.totals()
        # `subagents` and `workflows` are two of the 512 directories.
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 510)
        self.assertTrue(result["partial"])
        self.assertIn("+", self.cost_segment())

    def test_directory_below_the_depth_limit_keeps_the_mark(self):
        self.append(self.transcript, assistant("msg_1", inp=1000))
        self.append(self.agent("agent-b2.jsonl", "a", "b"), assistant("msg_2", inp=30))
        self.assertFalse(self.totals()["partial"])
        self.append(self.agent("agent-c3.jsonl", "a", "b", "c"), assistant("msg_3", inp=4000))
        result = self.totals()
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 30)
        self.assertTrue(result["partial"])

    def test_file_list_above_the_limit_does_not_discard_the_ledger(self):
        """A sidecar that was saved always loads, so no render starts over."""
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(2003)
        self.totals()
        whole = self.totals()
        self.assertEqual(whole["read"], 0)
        counted = sorted(self.stored()["sub"])
        for name in ("agent-zz-new.jsonl", "agent-zy-new.jsonl", "agent-!first.jsonl"):
            with self.subTest(new=name):
                self.append(self.agent(name), assistant("new_" + name, inp=1))
                result = self.totals()
                self.assertLess(result["read"], 4096, "the ledger was built again from zero")
                self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 2000)
                self.assertEqual(len(self.stored()["sub"]), 2000)
                self.assertIsNotNone(
                    BS.ledger_load(self.sidecar, self.transcript, BS.price_tiers(BS.price_table()))
                )
        # A new file does not put a counted one out, wherever it sorts: the
        # number would go down.
        self.assertEqual(sorted(self.stored()["sub"]), counted)
        self.assertTrue(self.totals()["partial"])
        # A place that a removed transcript leaves goes to the first new one.
        os.unlink(self.agent(counted[5]))
        self.settle_directories()
        result = self.totals()
        self.assertIn("agent-!first.jsonl", self.stored()["sub"])
        self.assertNotIn(counted[5], self.stored()["sub"])
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 2000)

    def test_removed_transcript_leaves_the_sum(self):
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(5)
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 5)
        os.unlink(self.agent("agent-00002.jsonl"))
        result = self.totals()
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 4)
        self.assertNotIn("agent-00002.jsonl", self.stored()["sub"])

    # -- the list of transcripts is kept ----------------------------------

    def test_unchanged_directories_are_not_listed_again(self):
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(3)
        self.one_line_files(2, "workflows", "wf-1", start=10)
        self.settle_directories()
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 5)
        real = BS.ledger_files

        def listed(*args):
            raise AssertionError("the directories were listed again")

        BS.ledger_files = listed
        try:
            # An append changes no directory. It is found by looking at the file.
            self.append(self.agent("agent-00001.jsonl"), assistant("more", inp=7))
            self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 12)
        finally:
            BS.ledger_files = real
        # A new file changes its directory, and that is seen.
        self.one_line_files(1, "workflows", "wf-1", start=50)
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 13)
        self.settle_directories()
        self.totals()
        self.one_line_files(1, "workflows", "wf-2", start=60)
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 14)

    def test_session_without_subagents_does_not_write_on_every_render(self):
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.totals()
        os.utime(self.sidecar, (1000, 1000))
        self.assertEqual(self.totals()["read"], 0)
        self.assertEqual(os.stat(self.sidecar).st_mtime, 1000)

    def test_append_to_a_transcript_that_is_not_looked_at_every_render(self):
        """Only the 32 written last are looked at first. The rest take their turn."""
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(80)
        self.settle_directories()
        self.totals()
        cold = [key for key in self.stored()["sub"] if key not in self.stored()["live"]]
        self.assertEqual(len(cold), 48)
        self.append(self.agent(cold[-1]), assistant("late", inp=100))
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 180)

    def test_looking_at_the_other_transcripts_stops_at_the_time_limit(self):
        """With no time, an append far down the list is seen some renders late."""
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(200)
        self.settle_directories()
        self.totals()
        stored = self.stored()
        cold = [key for key in stored["sub"] if key not in stored["live"]]
        self.append(self.agent(cold[-1]), assistant("late", inp=100))
        BS.LEDGER_BUDGET_MS = 0
        # The real start comes from the clock. Here it goes round in order.
        turn, start = {"at": 0}, BS._walk_start
        self.addCleanup(lambda: setattr(BS, "_walk_start", start))

        def in_order(count):
            turn["at"] += 16
            return (turn["at"] - 16) % count

        BS._walk_start = in_order
        seen, found_and_left = [], False
        for _ in range(40):
            result = self.totals()
            seen.append(result["sub"]["claude-opus-5-5"]["n"][0])
            if seen[-1] == 300:
                break
            if cold[-1] in self.stored()["todo"]:
                # The round found it after the time was over, so it only put
                # it on the list. The next render reads it.
                found_and_left = True
                self.assertEqual(result["read"], 0)
        self.assertEqual(seen[0], 200, "the first render did not get that far")
        self.assertEqual(seen[-1], 300, seen)
        self.assertTrue(found_and_left, "the round read a transcript after its time was over")
        # And a render with no time does not look at all 200 of them.
        looked, lstat = [], os.lstat

        def counting(path, *args, **kwargs):
            looked.append(path)
            return lstat(path, *args, **kwargs)

        os.lstat = counting
        try:
            self.totals()
        finally:
            os.lstat = lstat
        files = [path for path in looked if str(path).endswith(".jsonl")]
        self.assertGreater(len(files), 16)
        self.assertLess(len(files), 80)

    def test_the_round_starts_at_another_place_on_every_render(self):
        self.assertEqual(BS._walk_start(1), 0)
        # A clock that stands still, as a coarse one does between two renders.
        clock = BS.time.time_ns
        BS.time.time_ns = lambda: 1789000000 * 10**9
        try:
            starts = {BS._walk_start(7) for _ in range(2000)}
        finally:
            BS.time.time_ns = clock
        self.assertEqual(starts, set(range(7)), "a part of the list never gets its turn")
        # The place is not kept, so a render that finds nothing new writes nothing.
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(200)
        self.settle_directories()
        self.totals()
        self.assertNotIn("walk", self.stored())
        BS.LEDGER_BUDGET_MS = 0
        stamp = os.stat(self.sidecar).st_mtime_ns
        os.utime(self.sidecar, ns=(stamp - 10**9, stamp - 10**9))
        for _ in range(5):
            self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 200)
        self.assertEqual(os.stat(self.sidecar).st_mtime_ns, stamp - 10**9)

    def test_time_limit_holds_between_transcripts(self):
        """Every look at the clock costs 1 ms here, so 5 ms is a few files."""
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(30)
        BS.LEDGER_BUDGET_MS = 5.0
        clock = {"calls": 0}
        real = BS.time.perf_counter

        def ticking():
            clock["calls"] += 1
            return clock["calls"] * 0.001

        BS.time.perf_counter = ticking
        try:
            first = self.totals()
        finally:
            BS.time.perf_counter = real
        self.assertTrue(first["partial"])
        self.assertLess(first["sub"].get("claude-opus-5-5", {"n": [0]})["n"][0], 12)
        BS.LEDGER_BUDGET_MS = 5000.0
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 30)

    def test_the_time_limit_is_five_milliseconds(self):
        self.assertEqual(load_module().LEDGER_BUDGET_MS, 5.0)

    # -- a sidecar that cannot be written ---------------------------------

    def test_unfinished_scan_that_cannot_be_kept_shows_no_number(self):
        """Without a sidecar every render starts over, and a part is not a total."""
        if os.geteuid() == 0:
            self.skipTest("root writes into a read-only directory")
        self.append(self.transcript, assistant("msg_1", inp=1000000), assistant("msg_2", inp=1000000))
        folder = os.path.dirname(self.sidecar)
        os.makedirs(folder)
        os.chmod(folder, 0o500)
        self.addCleanup(os.chmod, folder, 0o700)
        BS.LEDGER_BUDGET_MS = 0
        self.assertIsNone(self.totals())
        self.assertEqual(self.cost_segment(), "$?")
        BS.LEDGER_BUDGET_MS = 5000.0
        self.assertEqual(self.cost_segment(), "~$8.00")
        os.chmod(folder, 0o700)
        BS.LEDGER_BUDGET_MS = 0
        self.assertEqual(self.cost_segment(), "~$4.00+")

    def test_unfinished_scan_with_something_else_at_the_sidecar_path(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000), assistant("msg_2", inp=1000000))
        os.makedirs(self.sidecar)  # a directory where the file should be
        BS.LEDGER_BUDGET_MS = 0
        self.assertEqual(self.cost_segment(), "$?")
        BS.LEDGER_BUDGET_MS = 5000.0
        self.assertEqual(self.cost_segment(), "~$8.00")

    # -- one line, one request ----------------------------------------------

    def test_absurd_request_is_left_out_and_the_total_keeps_working(self):
        self.append(
            self.transcript,
            assistant("msg_1", inp=1000000),
            assistant("msg_2", inp=9 * 10**14),
            assistant("msg_3", out=2 * 10**9),
            assistant("msg_4", read=10**9 + 1),
            assistant("msg_5", w1=5 * 10**9),
            assistant("msg_6", search=10**10),
            assistant("msg_7", inp=1000000),
        )
        self.assertEqual(self.cost_segment(), "~$8.00")
        self.assertEqual(self.totals()["main"], {"claude-opus-5-5": {"n": [2000000, 0, 0, 0, 0, 0]}})
        self.assertEqual(list(self.stored()["main"]["ids"]), ["msg_1", "msg_7"])
        self.append(self.transcript, assistant("msg_8", inp=10**9))  # the largest that counts
        self.assertEqual(self.cost_segment(), "~$4008.00")

    def test_spaces_around_the_colon_are_read(self):
        for separators in ((",", ": "), (", ", " : "), (" , ", "  :  "), (",", "\t:\t")):
            with self.subTest(separators=separators):
                with open(self.transcript, "wb") as fh:
                    fh.write(b"")
                line = json.dumps(json.loads(assistant("msg_%d" % len(separators[1]), inp=1000000)),
                                  separators=separators)
                self.append(self.transcript, line)
                self.assertEqual(self.cost_segment(), "~$4.00")

    def test_long_provider_id_is_matched_before_it_is_cut(self):
        long_id = ("arn:aws:bedrock:us-west-2:123456789012:application-inference-profile/"
                   "us.anthropic.claude-opus-5-5-20260101-v1:0")
        self.assertGreater(len(long_id), 96)
        self.append(self.transcript, assistant("msg_1", model=long_id, inp=1000000))
        self.assertEqual(self.cost_segment(), "~$4.00")
        self.assertEqual(list(self.stored()["main"]["t"]), ["claude-opus-5-5"])
        with open(self.transcript, "wb") as fh:
            fh.write(b"")
        self.append(self.transcript, assistant("msg_2", model=long_id[:-5] + "-fast-v1:0", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$8.00")
        with open(self.transcript, "wb") as fh:
            fh.write(b"")
        self.append(self.transcript, assistant("msg_3", model="x" * 600, inp=1000000))
        self.assertEqual(self.cost_segment(), "~$0.00?")
        self.assertEqual([len(key) for key in self.stored()["main"]["t"]], [96])

    # -- one test for each behaviour that had none --------------------------

    def test_assistant_line_above_the_line_limit_is_stepped_over(self):
        """The line is not held in memory, so its usage is not counted."""
        big = json.dumps(
            {"type": "assistant", "pad": "x" * (5 << 20),
             "message": {"id": "msg_big", "model": "claude-opus-5-5", "usage": usage(inp=1000000)}},
            separators=(",", ":"),
        )
        self.append(self.transcript, assistant("msg_1", inp=1000000), big, assistant("msg_2", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$8.00")

    def test_long_line_sets_the_skip_mark_in_the_sidecar(self):
        self.append(self.transcript, assistant("msg_1", inp=1))
        self.append(self.transcript, json.dumps({"type": "user", "message": {"content": "x" * (6 << 20)}}))
        self.append(self.transcript, assistant("msg_2", inp=1))
        BS.LEDGER_BUDGET_MS = 0
        marks = []
        for _ in range(30):
            result = self.totals()
            marks.append(self.stored()["main"]["skip"])
            if not result["partial"]:
                break
        self.assertIn(True, marks)
        self.assertFalse(marks[-1])
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 2)

    def test_symlinked_flag_is_refused_without_o_nofollow(self):
        """Not every platform has O_NOFOLLOW. The check before the open still holds."""
        secret = os.path.join(self.config, "secret")
        with open(secret, "w", encoding="utf-8") as fh:
            fh.write("full")
        os.symlink(secret, os.path.join(self.config, ".caveman-active"))
        saved = os.O_NOFOLLOW
        del os.O_NOFOLLOW
        try:
            self.assertIsNone(BS.read_text(os.path.join(self.config, ".caveman-active")))
            self.assertNotIn("CAVEMAN", self.render("full.json"))
        finally:
            os.O_NOFOLLOW = saved

    def test_symlink_that_appears_at_the_temporary_name_is_not_written_through(self):
        """The name is removed first. A link put there right after must not be followed."""
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        target = os.path.join(self.config, "target")
        with open(target, "w") as fh:
            fh.write("keep")
        real = os.unlink

        def racing_unlink(path, *args, **kwargs):
            try:
                real(path, *args, **kwargs)
            finally:
                if str(path).endswith(".tmp") and not os.path.lexists(path):
                    os.symlink(target, path)

        os.unlink = racing_unlink
        try:
            self.assertEqual(self.cost_segment(), "~$4.00")
        finally:
            os.unlink = real
        with open(target) as fh:
            self.assertEqual(fh.read(), "keep")
        self.assertFalse(os.path.exists(self.sidecar))

    def test_transcripts_in_work_keep_their_whole_id_map(self):
        self.append(self.transcript, assistant("msg_main", inp=1))
        for name in ("agent-a.jsonl", "agent-b.jsonl", "agent-c.jsonl"):
            self.append(self.agent(name), *[assistant("%s_%d" % (name, i), inp=1) for i in range(5)])
        self.totals()
        stored = self.stored()
        self.assertEqual(sorted(stored["live"]), ["agent-a.jsonl", "agent-b.jsonl", "agent-c.jsonl"])
        self.assertEqual([len(entry["ids"]) for entry in stored["sub"].values()], [5, 5, 5])
        # A block of an earlier response, written late, is not counted twice.
        for name in ("agent-a.jsonl", "agent-b.jsonl", "agent-c.jsonl"):
            self.append(self.agent(name), assistant(name + "_1", inp=1))
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 15)

    def test_sidecar_above_the_size_limit_is_not_loaded(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        self.totals()
        stored = self.stored()
        stored["main"]["t"]["claude-opus-5-5"]["n"][0] = 5000000
        with open(self.sidecar, "w", encoding="utf-8") as fh:
            json.dump(dict({"pad": "x" * (9 << 20)}, **stored), fh)
        result = self.totals()
        self.assertEqual(result["read"], os.path.getsize(self.transcript))
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 1000000)

    def test_sidecar_of_another_transcript_is_not_used(self):
        """The same session id with another path is another session."""
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        self.totals()
        other = os.path.join(self.project, "other", SESSION + ".jsonl")
        self.append(other, assistant("msg_2", inp=2000000))
        self.assertEqual(self.cost_segment(transcript_path=other), "~$8.00")
        self.assertEqual(self.stored()["path"], other)
        self.assertEqual(self.cost_segment(), "~$4.00")
        # The path decides, not only the checks of the file: this sidecar has
        # no inode, no time and no checksum to compare, and the two transcripts
        # have the same size.
        self.assertEqual(os.path.getsize(other), os.path.getsize(self.transcript))
        stored = self.stored()
        self.assertEqual(stored["path"], self.transcript)
        stored["main"].update(ino=0, mt=0, hn=0, hc=0)
        with open(self.sidecar, "w", encoding="utf-8") as fh:
            json.dump(stored, fh)
        self.assertEqual(self.cost_segment(transcript_path=other), "~$8.00")

    def test_larger_file_with_the_same_first_bytes_under_the_name_is_read_from_its_start(self):
        """Another file was moved over the transcript. Only the inode says so."""
        same = [assistant("msg_1", inp=100), assistant("msg_2", inp=100)]
        for path in (self.transcript, self.agent()):
            self.append(path, *same, assistant("msg_3", inp=100))
        self.totals()
        for path in (self.transcript, self.agent()):
            other = path + ".new"
            self.append(other, *same, assistant("msg_4", inp=5000), assistant("msg_5", inp=5000))
            with open(path, "rb") as old, open(other, "rb") as new:
                self.assertEqual(old.read(256), new.read(256))
            self.assertGreater(os.path.getsize(other), os.path.getsize(path))
            os.replace(other, path)
        result = self.totals()
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 10200)
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 10200)

    def test_symlinked_entries_are_not_on_the_list_of_transcripts(self):
        real = os.path.join(self.config, "elsewhere")
        self.append(os.path.join(real, "agent-x.jsonl"), assistant("msg_9", inp=1000000))
        self.append(self.transcript, assistant("msg_0", inp=1))
        self.append(self.agent(), assistant("msg_1", inp=100))
        os.symlink(os.path.join(real, "agent-x.jsonl"), self.agent("agent-link.jsonl"))
        os.symlink(real, os.path.join(self.subagents, "linked"))
        found, cut, dirs = BS.ledger_files(self.transcript, time.time_ns())
        self.assertEqual(found, ["agent-a1.jsonl"])
        self.assertEqual(sorted(dirs), [""])
        self.assertFalse(cut)
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 100)

    def test_relative_transcript_path_names_no_transcript(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        here = os.getcwd()
        os.chdir(self.project)
        try:
            self.assertTrue(os.path.isfile(SESSION + ".jsonl"))
            for path in (SESSION + ".jsonl", "./" + SESSION + ".jsonl"):
                self.assertEqual(self.cost_segment(transcript_path=path), "$?")
        finally:
            os.chdir(here)
        self.assertFalse(os.path.exists(self.sidecar))

    def test_malformed_entry_in_the_sidecar_is_not_accepted(self):
        """Every part of an entry has a shape. A sidecar with another one is rebuilt."""
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        self.totals()
        good = self.stored()
        size = os.path.getsize(self.transcript)
        wrong = {
            "a list": [1, 2, 3],
            "a string": "entry",
            "a key missing": {k: v for k, v in good["main"].items() if k != "hc"},
            "a key too many": dict(good["main"], extra=1),
            "offset a string": dict(good["main"], off="0"),
            "offset negative": dict(good["main"], off=-1),
            "offset a bool": dict(good["main"], off=True),
            "skip a number": dict(good["main"], skip=1),
            "head length too large": dict(good["main"], hn=4096),
            "checksum too large": dict(good["main"], hc=2**40),
            "totals a list": dict(good["main"], t=[]),
            "bucket of another name": dict(good["main"], t={"m": {"x": [5000000, 0, 0, 0, 0, 0]}}),
            "tuple of five": dict(good["main"], t={"m": {"n": [5000000, 0, 0, 0, 0]}}),
            "tuple with a float": dict(good["main"], t={"m": {"n": [5000000.5, 0, 0, 0, 0, 0]}}),
            "ids a list": dict(good["main"], ids=[]),
            "too many ids": dict(good["main"], ids={"id%d" % i: [0] * 6 for i in range(17)}),
            "id with a short tuple": dict(good["main"], ids={"x": [1]}),
        }
        for name, entry in wrong.items():
            with self.subTest(entry=name):
                with open(self.sidecar, "w", encoding="utf-8") as fh:
                    json.dump(dict(good, main=entry), fh)
                result = self.totals()
                self.assertEqual(result["read"], size, "the sidecar was believed")
                self.assertEqual(result["main"], {"claude-opus-5-5": {"n": [1000000, 0, 0, 0, 0, 0]}})
        for name, change in {
            "sum of another shape": {"sum": {"m": {"n": [1]}}},
            "todo not a list": {"todo": "x"},
            "live with a number": {"live": [1]},
            "cut not a bool": {"cut": 0},
        }.items():
            with self.subTest(part=name):
                with open(self.sidecar, "w", encoding="utf-8") as fh:
                    json.dump(dict(good, **change), fh)
                self.assertEqual(self.totals()["read"], size, "the sidecar was believed")

    def test_malformed_subagent_entry_is_found_when_it_is_read(self):
        """The entries of subagent transcripts are checked when they are read, not at the load."""
        self.append(self.transcript, assistant("msg_1", inp=1))
        self.append(self.agent(), assistant("msg_2", inp=100))
        self.totals()
        good = self.stored()
        wrong = {
            "bucket of another name": {"t": {"m": {"x": [5000000, 0, 0, 0, 0, 0]}}},
            "tuple of five": {"t": {"m": {"n": [5000000, 0, 0, 0, 0]}}},
            "a key too many": {"extra": 1},
            "skip a number": {"skip": 1},
        }
        for number, (name, change) in enumerate(wrong.items(), 2):
            with self.subTest(entry=name):
                stored = json.loads(json.dumps(good))
                stored["sub"]["agent-a1.jsonl"].update(change)
                with open(self.sidecar, "w", encoding="utf-8") as fh:
                    json.dump(stored, fh)
                self.append(self.agent(), assistant("more_%d" % number, inp=100))  # so it is read
                result = self.totals()
                self.assertEqual(result["sub"], {"claude-opus-5-5": {"n": [100 * number, 0, 0, 0, 0, 0]}})
                self.assertEqual(sorted(self.stored()["sub"]["agent-a1.jsonl"]), sorted(good["main"]))

    def test_sidecar_key_cannot_name_a_file_elsewhere(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        outside = os.path.join(self.project, "agent-outside.jsonl")
        self.append(outside, assistant("msg_out", inp=5000000))
        self.append(self.agent(), assistant("msg_2", inp=1000000))
        self.settle_directories()
        self.totals()
        good = self.stored()
        for key in ("../../agent-outside.jsonl", "/" + outside.lstrip("/"), "a/../../../agent-outside.jsonl",
                    "agent-a1.jsonl/../../../agent-outside.jsonl"):
            with self.subTest(key=key):
                planted = json.loads(json.dumps(good))
                planted["sub"][key] = BS._new_entry()
                planted["todo"] = [key]
                planted["live"] = ["", key]
                with open(self.sidecar, "w", encoding="utf-8") as fh:
                    json.dump(planted, fh)
                self.assertEqual(self.cost_segment(), "~$8.00 (sub $4.00)")


class TestPayloadShapes(LedgerBase):
    """No payload gives an empty row."""

    def row(self, payload: str) -> str:
        return self.plain(BS.render(payload, now=NOW))

    def test_very_deep_nesting_is_no_payload(self):
        for payload in ("[" * 200000, '{"a":' * 200000 + "1" + "}" * 200000,
                        '{"model":{"display_name":"Opus 5"},"x":' + "[" * 200000 + "]" * 200000 + "}"):
            with self.subTest(start=payload[:12]):
                self.assertEqual(self.row(payload), "ctx ?% | $? | cache ?")

    def test_four_hundred_digit_integer(self):
        huge = "9" * 400
        fields = {
            "context_window used_percentage": '{"context_window":{"used_percentage":%s}}',
            "context_window size": '{"context_window":{"used_percentage":13,"context_window_size":%s}}',
            "context_window tokens": '{"context_window":{"used_percentage":13,"context_window_size":1000,"total_input_tokens":%s}}',
            "cost": '{"cost":{"total_cost_usd":%s}}',
            "lines": '{"cost":{"total_cost_usd":1.5,"total_lines_added":%s,"total_lines_removed":%s}}',
            "rate limit percentage": '{"rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":1789003600}}}',
            "rate limit reset": '{"rate_limits":{"five_hour":{"used_percentage":26,"resets_at":%s}}}',
            "cache expiry": '{"prompt_cache":{"warm":true,"ttl":"1h","expires_at":%s}}',
            "cache recache": '{"prompt_cache":{"warm":false,"recache_tokens_if_cold":%s}}',
            "cache ratio": '{"prompt_cache":{"warm":true,"hit_ratio":%s,"requests":%s,"misses":%s}}',
            "pr number": '{"pr":{"number":%s}}',
        }
        for name, template in fields.items():
            with self.subTest(field=name):
                row = self.row(template.replace("%s", huge))
                self.assertTrue(row, "an empty row")
                self.assertRegex(row, r"^ctx ")
                self.assertNotIn("inf", row.lower())

    def test_reset_time_that_is_no_date(self):
        for value in ("1e300", "1e18", "-1e18", "253402300800000"):
            with self.subTest(resets_at=value):
                row = self.row(
                    '{"rate_limits":{"five_hour":{"used_percentage":26,"resets_at":%s},'
                    '"seven_day":{"used_percentage":14,"resets_at":%d}}}' % (value, NOW + 86400)
                )
                self.assertRegex(row, r"5h (26%|\?%)( \||$)")
                self.assertIn("7d 14% >", row)

    def test_pause_time_that_is_no_date(self):
        folder = os.path.join(self.config, "limit-guard")
        os.makedirs(folder)
        for until in (1e300, 1e18, "9" * 400):
            with self.subTest(until=str(until)[:8]):
                with open(os.path.join(folder, "state.json"), "w") as fh:
                    fh.write('{"paused": true, "until": %s}' % until)
                self.assertTrue(self.row("{}").startswith("PAUSED"))

    def test_segment_failure_falls_back_to_the_row_of_no_data(self):
        """Whatever a payload does to one segment, the row is not empty."""
        real = BS.cache_segment

        def broken(*args):
            raise KeyError("a failure nobody listed")

        BS.cache_segment = broken
        try:
            row = self.row('{"prompt_cache":{"warm":true},"model":{"display_name":"Opus 5"}}')
        finally:
            BS.cache_segment = real
        self.assertEqual(row, "ctx ?% | $? | cache ?")

    def test_main_prints_an_empty_line_and_no_traceback(self):
        """The last net: a render that raises is one empty line and exit code 0."""
        real_render, real_stdin, real_stdout = BS.render, sys.stdin, sys.stdout

        def broken(text):
            raise RuntimeError("boom")

        BS.render, sys.stdin, sys.stdout = broken, io.StringIO("{}"), io.StringIO()
        try:
            code = BS.main(["bobby-statusline.py"])
            written = sys.stdout.getvalue()
        finally:
            BS.render, sys.stdin, sys.stdout = real_render, real_stdin, real_stdout
        self.assertEqual((code, written), (0, "\n"))

    def test_percentage_that_cannot_be_read_is_a_question_mark(self):
        for bad in ('"abc"', "[13]", '{"a":1}', "true", '""', "NaN", "Infinity"):
            with self.subTest(used_percentage=bad):
                row = self.row('{"context_window":{"used_percentage":%s,"context_window_size":1000000,'
                               '"total_input_tokens":1000},"rate_limits":{"five_hour":{"used_percentage":%s,'
                               '"resets_at":%d}}}' % (bad, bad, NOW + 3600))
                self.assertIn("ctx ?%", row)
                self.assertIn("5h ?%", row)
                self.assertNotIn("0%", row)
        row = self.row('{"context_window":{"used_percentage":"13"},"rate_limits":{"five_hour":'
                       '{"used_percentage":"26","resets_at":%d}}}' % (NOW + 3600))
        self.assertIn("ctx 13%", row)
        self.assertIn("5h 26% >", row)
        del os.environ["NO_COLOR"]
        colored = BS.render('{"context_window":{"used_percentage":"abc"}}', now=NOW)
        self.assertIn("\033[38;5;245mctx ?%", colored)

    def test_direction_and_line_marks_are_stripped(self):
        marks = {
            "left-to-right mark": 0x200E, "right-to-left mark": 0x200F, "arabic letter mark": 0x061C,
            "line separator": 0x2028, "paragraph separator": 0x2029,
            "embedding": 0x202A, "override": 0x202E, "isolate": 0x2066, "pop isolate": 0x2069,
            "delete": 0x7F, "escape": 0x1B, "c1 csi": 0x9B, "newline": 0x0A,
        }
        for name, code in marks.items():
            with self.subTest(mark=name):
                mark = chr(code)
                self.assertEqual(BS.clean("a" + mark + "b"), "ab")
                payload = json.dumps({"agent": {"name": "a" + mark + "b"},
                                      "model": {"display_name": "M" + mark + "x"}})
                row = BS.render(payload, now=NOW)
                self.assertNotIn(mark, row)
                self.assertIn("@ab", row)

    def test_clean_caps_the_length(self):
        self.assertEqual(BS.clean("x" * 500, 10), "x" * 10)
        self.assertEqual(len(BS.clean("x" * 500)), 64)
        os.environ["COLUMNS"] = "2000"
        row = self.plain(BS.render(json.dumps({"model": {"display_name": "M" * 500},
                                               "agent": {"name": "a" * 500}}), now=NOW))
        self.assertIn(" | " + "M" * 32 + " | ", row)
        self.assertIn("@" + "a" * 32, row)
        self.assertNotIn("M" * 33, row)
        self.assertNotIn("a" * 33, row)

    def test_separator_from_the_config_is_cleaned(self):
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"separator": " \u001b[31m\u202e| "}, fh)
        row = BS.render(read_fixture("full.json"), now=NOW)
        self.assertNotIn("\u001b", row)
        self.assertNotIn("\u202e", row)
        self.assertIn(" [31m| ", row)


class TestLedgerEdges(LedgerBase):
    """What the row shows when a transcript cannot be read, and the edges of the limits."""

    one_line_files = TestLedgerLimits.one_line_files
    stored = TestLedgerLimits.stored
    settle_directories = TestLedgerLimits.settle_directories

    def not_root(self):
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            self.skipTest("root reads every file")

    # -- time ---------------------------------------------------------------------

    def test_clock_is_looked_at_after_every_long_line(self):
        """A run of lines of 1 to 4 MB: each is one buffer, and each buffer ends at the clock."""
        blob = json.dumps({"type": "user", "message": {"content": "x" * (3 << 19)}})
        self.append(self.transcript, *([blob] * 12), assistant("msg_1", inp=1000000))
        size = os.path.getsize(self.transcript)
        BS.LEDGER_BUDGET_MS = 0
        reads = []
        for _ in range(60):
            result = self.totals()
            reads.append(result["read"])
            if not result["partial"]:
                break
        self.assertFalse(result["partial"])
        self.assertEqual(sum(reads), size)
        self.assertLess(max(reads), 4 << 20, "one render read more than a few buffers")
        self.assertGreaterEqual(len(reads), 6)
        self.assertEqual(result["main"]["claude-opus-5-5"]["n"][0], 1000000)

    # -- what cannot be read ------------------------------------------------------

    def test_transcript_that_cannot_be_read_keeps_the_mark(self):
        self.not_root()
        self.append(self.transcript, assistant("msg_main", inp=1000000))
        self.one_line_files(3)
        locked = self.agent("agent-00001.jsonl")
        os.chmod(locked, 0)
        self.addCleanup(os.chmod, locked, 0o600)
        for _ in range(3):
            result = self.totals()
            self.assertTrue(result["partial"], "a transcript is missing from the number and the row does not say so")
            self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 2, "the others are counted")
        self.assertEqual(self.cost_segment(), "~$4.00+")
        # Nothing new was read, so nothing is written again.
        stamp = os.stat(self.sidecar).st_mtime_ns
        os.utime(self.sidecar, ns=(stamp - 10**9, stamp - 10**9))
        self.assertTrue(self.totals()["partial"])
        self.assertEqual(os.stat(self.sidecar).st_mtime_ns, stamp - 10**9)
        # An append to another transcript is still seen.
        self.append(self.agent("agent-00002.jsonl"), assistant("more", inp=7))
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 9)
        os.chmod(locked, 0o600)
        result = self.totals()
        self.assertFalse(result["partial"])
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 10)

    def test_unreadable_transcript_does_not_stop_the_look_at_the_others(self):
        """With one on the list for ever, a transcript that is not in work still gets its turn."""
        self.not_root()
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(80)
        self.settle_directories()
        locked = self.agent("agent-00040.jsonl")
        os.chmod(locked, 0)
        self.addCleanup(os.chmod, locked, 0o600)
        self.totals()
        stored = self.stored()
        self.assertEqual(stored["todo"], ["agent-00040.jsonl"])
        cold = [key for key in stored["sub"] if key not in stored["live"] and key != "agent-00040.jsonl"]
        self.append(self.agent(cold[-1]), assistant("late", inp=100))
        result = self.totals()
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 179)
        self.assertTrue(result["partial"])

    def test_directory_that_cannot_be_listed_keeps_the_mark(self):
        self.not_root()
        self.append(self.transcript, assistant("msg_main", inp=1000000))
        self.one_line_files(2)
        self.one_line_files(2, "workflows", "wf1")
        locked = os.path.join(self.subagents, "workflows", "wf1")
        os.chmod(locked, 0)
        self.addCleanup(os.chmod, locked, 0o700)
        for _ in range(2):
            result = self.totals()
            self.assertTrue(result["partial"])
            self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 2)
        os.chmod(locked, 0o700)
        result = self.totals()
        self.assertFalse(result["partial"])
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 4)

    def test_session_without_a_subagents_directory_has_no_mark(self):
        self.append(self.transcript, assistant("msg_main", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$4.00")
        self.assertEqual(BS.ledger_files(self.transcript, time.time_ns()), ([], False, {"": 0}))

    # -- the limits ------------------------------------------------------------------

    def test_empty_directory_below_the_depth_limit_has_no_mark(self):
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(1, "a", "b")
        deep = os.path.join(self.subagents, "a", "b", "c")
        os.makedirs(os.path.join(deep, "d"))
        self.settle_directories()
        self.assertFalse(self.totals()["partial"])
        self.assertFalse(self.totals()["partial"])
        # A transcript that appears there later brings the mark.
        with open(os.path.join(deep, "agent-late.jsonl"), "wb") as fh:
            fh.write(assistant("late", inp=1).encode() + b"\n")
        result = self.totals()
        self.assertTrue(result["partial"])
        self.assertEqual(result["sub"]["claude-opus-5-5"]["n"][0], 1)

    def test_directory_that_changed_just_now_is_listed_again(self):
        self.one_line_files(1)
        changed = os.lstat(self.subagents).st_mtime_ns
        settle = BS.LEDGER_SETTLE_NS
        self.assertEqual(settle, 2 * 10**9)
        self.assertEqual(BS.ledger_files(self.transcript, changed + settle)[2], {"": 0})
        self.assertEqual(BS.ledger_files(self.transcript, changed + settle + 1)[2], {"": changed})
        self.assertFalse(BS.ledger_listed(self.transcript, {"": 0}))
        self.assertTrue(BS.ledger_listed(self.transcript, {"": changed}))

    def test_more_model_ids_than_the_sum_holds_go_to_the_unknown_one(self):
        """The sidecar that was written is one that loads, however many model ids there are."""
        self.append(self.transcript, assistant("msg_main", inp=1))
        for i in range(140):
            self.append(self.agent("agent-%03d.jsonl" % i), assistant("m%d" % i, model="model-%03d" % i, inp=10))
        self.settle_directories()
        result = self.totals()
        self.assertFalse(result["partial"])
        stored = self.stored()
        self.assertEqual(len(stored["sum"]), BS.LEDGER_SUM_MODELS)
        self.assertIn("?", stored["sum"])
        self.assertIsNotNone(BS.ledger_load(self.sidecar, self.transcript, BS.price_tiers(BS.price_table())))
        again = self.totals()
        self.assertEqual(again["read"], 0, "the ledger was built again from zero")
        tokens = sum(tup[0] for buckets in again["sub"].values() for tup in buckets.values())
        self.assertEqual(tokens, 1400)
        self.assertEqual(again["sub"]["?"]["n"][0], 10 * (140 - BS.LEDGER_SUM_MODELS + 1))
        self.assertTrue(self.cost_segment().endswith("?"))
        # A transcript that goes takes its tokens out of the place they went to.
        os.unlink(self.agent("agent-139.jsonl"))
        os.unlink(self.agent("agent-000.jsonl"))
        self.settle_directories()
        after = self.totals()
        tokens = sum(tup[0] for buckets in after["sub"].values() for tup in buckets.values())
        self.assertEqual(tokens, 1380)
        self.assertNotIn("model-000", after["sub"])

    def test_merge_with_a_limit(self):
        into = {}
        for i in range(6):
            BS._merge_totals(into, {"m%d" % i: {"n": [1, 0, 0, 0, 0, 0]}}, 1, 4)
        self.assertEqual(sorted(into), ["?", "m0", "m1", "m2"])
        self.assertEqual(into["?"]["n"][0], 3)
        BS._merge_totals(into, {"m5": {"n": [1, 0, 0, 0, 0, 0]}}, -1, 4)
        self.assertEqual(into["?"]["n"][0], 2)
        BS._merge_totals(into, {"m0": {"n": [1, 0, 0, 0, 0, 0]}}, -1, 4)
        self.assertNotIn("m0", into)
        BS._merge_totals(into, {"gone": {"n": [9, 0, 0, 0, 0, 0]}}, -1, 4)
        self.assertNotIn("?", into)
        self.assertNotIn("gone", into)
        # Without a limit every model has its own entry.
        free = {}
        for i in range(200):
            BS._merge_totals(free, {"m%d" % i: {"n": [1, 0, 0, 0, 0, 0]}})
        self.assertEqual(len(free), 200)

    def test_request_with_an_absurd_raw_number_is_left_out(self):
        """The raw value decides, before a number that cannot be held is turned into 0."""
        def line(mid, **fields):
            base = {"input_tokens": 0, "output_tokens": 5}
            base.update(fields)
            return json.dumps({"type": "assistant", "message": {"id": mid, "model": "claude-opus-5-5", "usage": base}})

        self.append(
            self.transcript,
            assistant("msg_1", inp=1000000),
            line("big_int", input_tokens=10**15),
            line("bigger_int", input_tokens=10**30),
            line("big_float", cache_read_input_tokens=1e30),
            line("infinite", input_tokens=float("inf")),
            line("not_a_number", output_tokens=float("nan")),
            line("split", cache_creation_input_tokens=5, cache_creation={"ephemeral_1h_input_tokens": 10**16}),
            line("search", server_tool_use={"web_search_requests": 10**12}),
            line("just_over", input_tokens=10**9 + 1),
        )
        result = self.totals()
        self.assertEqual(result["main"], {"claude-opus-5-5": {"n": [1000000, 0, 0, 0, 0, 0]}})
        self.assertEqual(self.cost_segment(), "~$4.00")
        self.assertEqual(list(self.stored()["main"]["ids"]), ["msg_1"])
        # The limit itself is a request.
        self.append(self.transcript, line("at_the_limit", input_tokens=10**9, output_tokens=0))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 1000000 + 10**9)

    # -- which transcripts are looked at first ------------------------------------------

    def test_the_thirty_two_written_last_are_the_ones_in_work(self):
        self.append(self.transcript, assistant("msg_main", inp=1))
        self.one_line_files(40)
        now = time.time()
        for i in range(40):  # agent-00000 is the newest
            os.utime(self.agent("agent-%05d.jsonl" % i), (now - i, now - i))
        self.totals()
        self.assertEqual(self.stored()["live"], ["agent-%05d.jsonl" % i for i in range(32)])

    def test_transcript_in_work_is_read_before_the_ones_that_wait(self):
        self.append(self.transcript, assistant("msg_1", inp=1))
        self.one_line_files(5)
        BS.LEDGER_BUDGET_MS = 0
        first = self.totals()
        self.assertEqual(first["main"]["claude-opus-5-5"]["n"][0], 1)
        self.assertEqual(self.stored()["todo"], ["agent-%05d.jsonl" % i for i in range(5)])
        self.append(self.transcript, assistant("msg_2", inp=1))
        second = self.totals()
        self.assertEqual(second["main"]["claude-opus-5-5"]["n"][0], 2, "the main transcript waited behind the others")
        self.assertEqual(second["sub"], {})

    # -- the sidecar directory -------------------------------------------------------------

    def test_sidecars_are_pruned_after_thirty_days(self):
        folder = BS.ledger_dir()
        os.makedirs(folder)
        now = time.time()
        for name, days in (("young.json", 29), ("old.json", 31)):
            path = os.path.join(folder, name)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{}")
            os.utime(path, (now - days * 86400, now - days * 86400))
        BS.ledger_prune(now)
        self.assertEqual(os.listdir(folder), ["young.json"])

    def test_directories_are_private_whatever_the_umask_is(self):
        self.append(self.transcript, assistant("msg_1", inp=1))
        before = os.umask(0o277)
        try:
            result = self.totals()
        finally:
            os.umask(before)
        self.assertIsNotNone(result)
        for folder in (os.path.dirname(BS.ledger_dir()), BS.ledger_dir()):
            self.assertEqual(os.stat(folder).st_mode & 0o777, 0o700)
        self.assertTrue(os.path.isfile(self.sidecar))


class TestOutputEdges(Base):
    """Input and output that no encoding takes: the row is still a row."""

    def run_bytes(self, payload: bytes, **env) -> subprocess.CompletedProcess:
        environ = dict(os.environ, BOBBY_STATUSLINE_BILLING="cost")
        environ.update(env)
        return subprocess.run([sys.executable, SCRIPT], input=payload, capture_output=True, env=environ)

    def test_half_of_a_surrogate_pair_in_a_name(self):
        half = chr(92) + "ud800"  # the JSON escape of half a surrogate pair
        payload = ('{"model": {"display_name": "Op%sus"}, "agent": {"name": "a%sb"}}' % (half, chr(92) + "udfff")).encode()
        self.assertEqual(BS.clean(json.loads(payload)["model"]["display_name"]), "Opus")
        for env in ({}, {"PYTHONIOENCODING": "ascii"}, {"PYTHONIOENCODING": "utf-8"}):
            with self.subTest(env=env):
                result = self.run_bytes(payload, **env)
                self.assertEqual(result.returncode, 0)
                self.assertIn(b"Opus", result.stdout)
                self.assertIn(b"@ab", result.stdout)
                self.assertEqual(result.stderr, b"")

    def test_output_that_cannot_hold_a_character(self):
        payload = json.dumps({"model": {"display_name": "Opus " + chr(0xE9) + chr(0x4E2D)}}).encode()
        for encoding, want in (("ascii", b"Opus ??"), ("latin-1", b"Opus \xe9?"), ("utf-8", b"Opus \xc3\xa9\xe4\xb8\xad")):
            with self.subTest(encoding=encoding):
                result = self.run_bytes(payload, PYTHONIOENCODING=encoding)
                self.assertEqual(result.returncode, 0)
                self.assertIn(want, result.stdout)
                self.assertIn(b"ctx ?%", result.stdout)
                self.assertEqual(result.stderr, b"")
        result = self.run_bytes(payload, PYTHONIOENCODING="ascii", BOBBY_STATUSLINE_GLYPHS="unicode",
                                BOBBY_STATUSLINE_SEPARATOR=" " + chr(0xB7) + " ")
        self.assertIn(b"ctx ?% ? ", result.stdout)

    def test_emit_and_read_take_a_stream_of_text_only(self):
        saved = sys.stdout, sys.stdin
        sys.stdout, sys.stdin = io.StringIO(), io.StringIO('{"model": {"display_name": "Opus"}}')
        try:
            code = BS.main(["bobby-statusline"])
            row = sys.stdout.getvalue()
        finally:
            sys.stdout, sys.stdin = saved
        self.assertEqual(code, 0)
        self.assertIn("Opus", row)

    def test_byte_that_is_not_utf8_on_stdin(self):
        payload = b'{"model": {"display_name": "Op\x9bus"}, "agent": {"name": "a\xffb"}}'
        for env in ({}, {"LC_ALL": "C", "PYTHONCOERCECLOCALE": "0", "PYTHONUTF8": "0"}, {"PYTHONIOENCODING": "latin-1"}):
            with self.subTest(env=env):
                result = self.run_bytes(payload, **env)
                self.assertEqual(result.returncode, 0)
                self.assertNotIn(b"\x9b", result.stdout)
                self.assertNotIn(b"\xff", result.stdout)
                self.assertNotIn(b"\x1b", result.stdout)
                self.assertIn(b"Op", result.stdout)
                self.assertIn(b"ctx ?%", result.stdout)

    def test_brackets_thousands_deep_in_a_file_that_is_read(self):
        deep = "[" * 70000
        state = os.path.join(self.config, "limit-guard")
        os.makedirs(state)
        for path in (os.path.join(self.config, "bobby-statusline.json"), os.path.join(state, "state.json")):
            with self.subTest(file=os.path.basename(path)):
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(deep)
                self.assertIsNone(BS.read_json(path, BS.CONFIG_MAX))
                result = self.run_bytes(read_fixture("full.json").encode())
                self.assertEqual(result.returncode, 0)
                self.assertIn(b"ctx 132k/1M", result.stdout)
                self.assertEqual(result.stderr, b"")
                os.unlink(path)

    def test_config_file_with_a_byte_order_mark_is_read(self):
        with open(os.path.join(self.config, "bobby-statusline.json"), "w", encoding="utf-8-sig") as fh:
            json.dump({"layout": "two-row", "prices": {"my-model": [1, 2, 3, 4, 5]}}, fh)
        cfg = BS.load_config()
        self.assertEqual(cfg["layout"], "two-row")
        self.assertEqual(cfg["prices"], {"my-model": (1.0, 2.0, 3.0, 4.0, 5.0, None)})

    def test_large_config_file_is_read_and_has_its_limits(self):
        path = os.path.join(self.config, "bobby-statusline.json")
        rows = {"model-%03d" % i: [1, 2, 3, 4, 5] for i in range(300)}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"note": "x" * 300000, "layout": "two-row", "prices": rows}, fh)
        cfg = BS.load_config()
        self.assertEqual(cfg["layout"], "two-row", "a file of 300 KB was not read")
        self.assertEqual(len(cfg["prices"]), 256)
        self.assertEqual(BS.CONFIG_MAX, 1 << 20)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"note": "x" * (BS.CONFIG_MAX + 10), "layout": "two-row"}, fh)
        self.assertEqual(BS.load_config()["layout"], "one-row", "above the limit the file is not used")

    def test_install_prints_samples_that_are_json(self):
        result = subprocess.run([sys.executable, SCRIPT, "install"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        blocks, block = [], None
        for line in result.stdout.split("\n"):
            if line == "{":
                block = []
            if block is not None:
                block.append(line)
            if line == "}" and block is not None:
                blocks.append(json.loads("\n".join(block)))
                block = None
        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["statusLine"]["type"], "command")
        self.assertEqual(blocks[1]["layout"], "one-row")
        self.assertEqual(blocks[1]["priority"], list(BS.PRIORITY))
        self.assertNotIn("//", result.stdout.replace(os.path.abspath(SCRIPT), ""))


# Runs one render under an audit hook, in a process of its own. The hook writes
# each event to a pipe that the test holds. There is no list in this process
# that the audited code could find and empty, and neither `runpy` nor
# `unittest` is loaded, so the render cannot tell this run from a real one by
# looking for them. The driver runs with -B: a render that loads the limit-guard
# gate would write the bytecode cache of the gate on its first run, and those
# events are not the ones of a later run.
AUDIT_DRIVER = r"""
import os, sys
def arm(fd, write=os.write):
    def hook(name, args):
        if name == "import":
            name = "import:%s" % (args[0],)
        try:
            write(fd, (name + "\n").encode())
        except OSError:
            os._exit(97)
    sys.addaudithook(hook)
script = sys.argv[1]
arm(int(sys.argv[2]))
del arm
sys.argv = [script]
with open(script, "rb") as fh:
    code = compile(fh.read(), script, "exec")
exec(code, {"__name__": "__main__", "__file__": script, "__builtins__": __builtins__})
"""

# What a clean render does, and nothing else. An event that is not here fails
# the test, whatever its name is: this is a list of what is allowed.
AUDIT_EVENTS = {
    "compile", "exec", "open", "marshal.loads", "object.__setattr__", "object.__delattr__",
    "os.listdir", "os.scandir", "os.mkdir", "os.chmod", "os.rename", "os.remove",
    "glob.glob", "glob.glob/2", "sys._getframemodulename", "code.__new__",
}
if sys.version_info < (3, 12):
    AUDIT_EVENTS.add("sys._getframe")  # collections.namedtuple, before 3.12
# The limit-guard gate keeps a cache and a state file.
AUDIT_EVENTS_GATE = AUDIT_EVENTS | {"tempfile.mkstemp", "os.utime"}
# Modules the status line imports by name, and the pure Python modules those
# pull in. An extension module of the interpreter (a name that starts with an
# underscore) is allowed unless it is one of the denied ones.
AUDIT_IMPORTS = {
    "__future__", "binascii", "glob", "io", "json", "os", "re", "stat", "sys", "time",
    "abc", "codecs", "collections", "contextlib", "copyreg", "encodings", "enum", "fnmatch",
    "functools", "genericpath", "itertools", "keyword", "ntpath", "operator", "posixpath",
    "reprlib", "sre_compile", "sre_constants", "sre_parse", "types", "typing", "warnings",
}
AUDIT_DENIED = {
    "socket", "_socket", "socketserver", "ssl", "_ssl", "select", "selectors", "asyncio", "_asyncio",
    "subprocess", "_posixsubprocess", "multiprocessing", "_multiprocessing", "pty", "_winapi",
    "ctypes", "_ctypes", "urllib", "urllib3", "http", "ftplib", "smtplib", "poplib", "imaplib",
    "telnetlib", "xmlrpc", "webbrowser", "requests", "httpx", "aiohttp", "websockets",
}


def audit_violations(events: list, gate: bool = False) -> list:
    """The events of one render that a clean render does not have."""
    allowed = AUDIT_EVENTS_GATE if gate else AUDIT_EVENTS
    bad = []
    for event in events:
        if event.startswith("import:"):
            root = event[len("import:"):].split(".")[0]
            if root in AUDIT_DENIED:
                bad.append(event)
            elif not gate and root not in AUDIT_IMPORTS and not root.startswith("_"):
                bad.append(event)
        elif event not in allowed and not event.startswith("cpython."):
            bad.append(event)
    return sorted(set(bad))


class TestNoEgress(LedgerBase):
    """The status line opens no connection and a render starts no process.

    Two guards. The static one is an allow-list: the script may import the
    modules named here and no other, and may not reach a module in a roundabout
    way. The runtime one renders every fixture, and an estimate, under a Python
    audit hook, and fails on every event that a clean render does not have.

    They guard against a change that adds network or process code by mistake
    or by habit. They are not a proof against code written to get past them.
    """

    TOP_LEVEL = {"__future__", "binascii", "glob", "io", "json", "os", "re", "stat", "sys", "time"}
    # Imports inside one function, for the commands that are not a render.
    LOCAL = {
        "limit_guard_module": {"importlib"},  # loads the limit-guard gate from its file
        "limit_guard_capture": {"contextlib"},
        "run_demo": {"shutil", "tempfile"},
        "run_selftest": {"tempfile"},
        "_measure_estimate": {"tempfile"},
        "_measure": {"subprocess"},
    }
    OS_CALLS = re.compile(
        r"^(system|popen|fork|forkpty|exec[lv]p?e?|spawn[lv]p?e?|posix_spawnp?|startfile)$"
    )
    # Names that reach a module, a namespace or a frame without an import statement.
    BANNED_CALLS = ("__import__", "import_module", "eval", "exec", "compile", "run_path", "run_module",
                    "vars", "globals", "locals", "setattr", "delattr", "breakpoint", "find_spec")
    BANNED_ATTRIBUTES = ("__dict__", "__builtins__", "__globals__", "__subclasses__", "__loader__",
                         "__import__", "_getframe", "f_globals", "f_back", "f_builtins", "modules",
                         "meta_path", "path_hooks", "find_spec", "import_module", "startfile")
    IMPORTLIB_ATTRIBUTES = {"util", "spec_from_file_location", "module_from_spec"}
    # A module name as a string is what a load without an import statement needs.
    BANNED_STRINGS = {"socket", "_socket", "ssl", "_ssl", "subprocess", "_posixsubprocess", "ctypes",
                      "_ctypes", "urllib", "asyncio", "builtins", "importlib", "posix", "nt"}

    @classmethod
    def setUpClass(cls):
        import ast

        cls.ast = ast
        with open(SCRIPT, encoding="utf-8") as fh:
            cls.source = fh.read()
        cls.tree = ast.parse(cls.source)

    def imports(self, node):
        """Root module of every import below `node`."""
        for item in self.ast.walk(node):
            if isinstance(item, self.ast.Import):
                for alias in item.names:
                    yield alias.name.split(".")[0]
            elif isinstance(item, self.ast.ImportFrom):
                yield (item.module or "").split(".")[0]

    def functions(self):
        return [
            n for n in self.ast.walk(self.tree)
            if isinstance(n, (self.ast.FunctionDef, self.ast.AsyncFunctionDef))
        ]

    def callers_of(self, name, tree=None):
        """The functions that name `name`, and "<module>" when code outside every function does."""
        tree = tree or self.tree
        kinds = (self.ast.FunctionDef, self.ast.AsyncFunctionDef)

        def names(node):
            return any(isinstance(n, self.ast.Name) and n.id == name for n in self.ast.walk(node))

        found = [fn.name for fn in self.ast.walk(tree) if isinstance(fn, kinds) and names(fn)]
        if any(names(stmt) for stmt in tree.body if not isinstance(stmt, kinds)):
            found.append("<module>")
        return sorted(found)

    def problems(self, source: str) -> list:
        """What the roundabout-access rules find in a piece of source."""
        found = []
        for node in self.ast.walk(self.ast.parse(source)):
            if isinstance(node, self.ast.Call):
                name = getattr(node.func, "id", getattr(node.func, "attr", ""))
                # re.compile is the one `compile` that is an attribute.
                if name in self.BANNED_CALLS and not (
                    name == "compile" and isinstance(node.func, self.ast.Attribute)
                ):
                    found.append("call %s" % name)
                if name == "getattr":
                    # getattr(os, "O_NOFOLLOW", 0) is the only use: an open flag.
                    arg = node.args[1] if len(node.args) > 1 else None
                    if not (isinstance(arg, self.ast.Constant) and str(arg.value).startswith("O_")):
                        found.append("getattr with a name that is not an open flag")
            if isinstance(node, self.ast.Attribute):
                if node.attr in self.BANNED_ATTRIBUTES:
                    found.append("attribute %s" % node.attr)
                if self.OS_CALLS.match(node.attr):
                    found.append("process call %s" % node.attr)
                base = node
                while isinstance(base, self.ast.Attribute):
                    base = base.value
                if isinstance(base, self.ast.Name) and base.id == "importlib":
                    if node.attr not in self.IMPORTLIB_ATTRIBUTES:
                        found.append("importlib.%s" % node.attr)
            if isinstance(node, self.ast.Name) and node.id in ("__builtins__", "__loader__", "__spec__"):
                found.append("name %s" % node.id)
            if isinstance(node, self.ast.Constant) and isinstance(node.value, str):
                if node.value in self.BANNED_STRINGS:
                    found.append("module name %r as a string" % node.value)
                if "://" in node.value:
                    found.append("an address in a string")
        return sorted(set(found))

    # -- static -----------------------------------------------------------------

    def test_top_level_imports_are_on_the_allow_list(self):
        top = {
            root for stmt in self.tree.body
            if isinstance(stmt, (self.ast.Import, self.ast.ImportFrom))
            for root in self.imports(stmt)
        }
        self.assertEqual(top, self.TOP_LEVEL)

    def test_local_imports_are_on_the_allow_list(self):
        found = {}
        for fn in self.functions():
            roots = set(self.imports(fn))
            if roots:
                found[fn.name] = roots
        self.assertEqual(found, self.LOCAL)
        everything = set(self.imports(self.tree))
        self.assertEqual(everything, self.TOP_LEVEL.union(*self.LOCAL.values()))

    def test_only_future_is_imported_by_name(self):
        """`from os import system` would pass a check of module names."""
        for node in self.ast.walk(self.tree):
            if isinstance(node, self.ast.ImportFrom):
                self.assertEqual(node.module, "__future__")
            if isinstance(node, self.ast.Import):
                for alias in node.names:
                    self.assertIn(alias.name, self.TOP_LEVEL.union(*self.LOCAL.values()) | {"importlib.util"})

    def test_no_roundabout_way_to_a_module(self):
        self.assertEqual(self.problems(self.source), [])

    def test_the_roundabout_rules_see_each_form(self):
        """The control for the test above: each form is found when it is there."""
        forms = {
            "os.__dict__['system']('true')": "attribute __dict__",
            "sys.modules['builtins']": "attribute modules",
            "json.__builtins__['open']": "attribute __builtins__",
            "sys._getframe()": "attribute _getframe",
            "f = frame.f_back": "attribute f_back",
            "vars(os)['posix_spawn']": "call vars",
            "importlib.util.find_spec('x')": "attribute find_spec",
            "importlib.import_module('x')": "attribute import_module",
            "importlib.machinery.SourceFileLoader": "importlib.machinery",
            "__import__('os')": "call __import__",
            "getattr(os, 'sys' + 'tem')": "getattr with a name that is not an open flag",
            "getattr(os, name)": "getattr with a name that is not an open flag",
            "os.startfile('x')": "attribute startfile",
            "os.posix_spawn('x', [], {})": "process call posix_spawn",
            "x = '_posixsubprocess'": "module name '_posixsubprocess' as a string",
            "x = '_ctypes'": "module name '_ctypes' as a string",
            "x = 'socket'": "module name 'socket' as a string",
            "x = 'https' + '://prices.example'": "an address in a string",
            "eval('1')": "call eval",
            "globals()['x']": "call globals",
        }
        for source, want in forms.items():
            with self.subTest(source=source):
                self.assertIn(want, self.problems(source))
        self.assertEqual(self.problems("flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)"), [])
        self.assertEqual(self.problems("PATTERN = re.compile('x')"), [])

    def test_process_modules_are_reached_from_the_selftest_only(self):
        self.assertEqual(self.callers_of("_measure"), ["run_selftest"])
        self.assertEqual(self.callers_of("_measure_estimate"), ["_measure"])
        self.assertEqual(self.callers_of("run_selftest"), ["main"])
        self.assertEqual(self.callers_of("run_demo"), ["main"])

    def test_a_name_at_module_level_is_a_caller(self):
        """`TIMER = _measure` outside every function, and `TIMER()` in the render, is a way to it."""
        source = "def _measure():\n    pass\n\nTIMER = _measure\n\ndef main():\n    TIMER()\n"
        self.assertEqual(self.callers_of("_measure", self.ast.parse(source)), ["<module>"])
        source = "class Holder:\n    timer = _measure\n"
        self.assertEqual(self.callers_of("_measure", self.ast.parse(source)), ["<module>"])
        source = "def run_selftest():\n    def inner():\n        _measure()\n"
        self.assertEqual(self.callers_of("_measure", self.ast.parse(source)), ["inner", "run_selftest"])

    def test_the_price_script_is_unknown_to_the_status_line(self):
        self.assertTrue(os.path.isfile(PRICES_SCRIPT))
        for word in ("bobby-statusline-prices", "prices.py", "statusline_prices"):
            self.assertNotIn(word, self.source)

    def test_the_plugin_ships_these_scripts_and_no_other(self):
        """Code in a file that no test reads would be outside every check here."""
        scripts = []
        for folder, names, files in os.walk(ROOT):
            names[:] = [n for n in names if n != "__pycache__"]
            for name in files:
                path = os.path.relpath(os.path.join(folder, name), ROOT)
                with open(os.path.join(folder, name), "rb") as fh:
                    start = fh.read(2)
                if name.endswith((".py", ".pyc", ".so", ".sh")) or start == b"#!" or folder.endswith("bin"):
                    scripts.append(path)
        self.assertEqual(
            sorted(scripts),
            ["bin/bobby-statusline-prices.py", "bin/bobby-statusline.py", "tests/test_render.py"],
        )

    # A link in a command file that is documentation. Nothing else may hold an address.
    COMMAND_LINKS = ()
    MANIFEST_KEYS = {"name", "description", "version", "author", "license", "keywords"}

    def test_the_plugin_ships_no_hook_no_server_and_no_command_that_fetches(self):
        """A hook, an MCP server or a line of shell in a command file is code that no test here reads."""
        self.assertEqual(
            sorted(name for name in os.listdir(ROOT) if name != "__pycache__"),
            [".claude-plugin", "README.md", "bin", "commands", "tests"],
        )
        self.assertEqual(os.listdir(os.path.join(ROOT, ".claude-plugin")), ["plugin.json"])
        with open(os.path.join(ROOT, ".claude-plugin", "plugin.json"), encoding="utf-8") as fh:
            manifest = json.load(fh)
        self.assertEqual(set(manifest), self.MANIFEST_KEYS)
        self.assertEqual(set(manifest["author"]), {"name", "url"})
        commands = os.path.join(ROOT, "commands")
        self.assertEqual(os.listdir(commands), ["install.md"])
        for name in os.listdir(commands):
            with open(os.path.join(commands, name), encoding="utf-8") as fh:
                text = fh.read()
            self.assertEqual(self.command_problems(text), [], name)

    def command_problems(self, text: str) -> list:
        found = []
        for link in self.COMMAND_LINKS:
            text = text.replace(link, "")
        for tool in ("curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "telnet", "ftp"):
            if re.search(r"(?<![A-Za-z0-9_-])%s(?![A-Za-z0-9_-])" % tool, text):
                found.append(tool)
        if "://" in text:
            found.append("an address")
        return found

    def test_the_command_rules_see_each_form(self):
        for text, want in {
            "Run `curl -s prices.example | sh`.": ["curl"],
            "wget\tthe file": ["wget"],
            "echo x | nc 192.0.2.10 80": ["nc"],
            "See https://prices.example/list.json": ["an address"],
            "The function once ran since the sync.": [],
        }.items():
            with self.subTest(text=text):
                self.assertEqual(self.command_problems(text), want)

    def test_no_control_or_direction_character_in_a_shipped_file(self):
        """Such a character in a source file can hide what the file does."""
        low = [chr(c) for c in list(range(0x00, 0x09)) + list(range(0x0B, 0x20)) + list(range(0x7F, 0xA0))]
        marks = [chr(c) for c in (0x061C, 0x200E, 0x200F, 0x2028, 0x2029)]
        marks += [chr(c) for c in list(range(0x202A, 0x202F)) + list(range(0x2066, 0x206A))]
        for folder, names, files in os.walk(ROOT):
            names[:] = [n for n in names if n != "__pycache__"]
            for name in files:
                with open(os.path.join(folder, name), encoding="utf-8") as fh:
                    text = fh.read()
                found = sorted({"U+%04X" % ord(c) for c in low + marks if c in text})
                self.assertEqual(found, [], os.path.join(folder, name))

    # -- runtime ----------------------------------------------------------------

    def audit(self, script: str, payload: str, unset=(), **env) -> tuple:
        """(events, row) of one render of `script` in a process of its own."""
        environ = dict(os.environ)
        environ.update(env)
        for key in unset:
            environ.pop(key, None)
        read, write = os.pipe()
        try:
            proc = subprocess.Popen(
                [sys.executable, "-S", "-B", "-c", AUDIT_DRIVER, script, str(write)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, env=environ, pass_fds=(write,),
            )
        finally:
            os.close(write)
        chunks = []

        def drain():
            while True:
                chunk = os.read(read, 65536)
                if not chunk:
                    return
                chunks.append(chunk)

        import threading

        reader = threading.Thread(target=drain)
        reader.start()
        row, err = proc.communicate(payload, timeout=60)
        reader.join(timeout=60)
        os.close(read)
        self.assertEqual(proc.returncode, 0, err)
        events = [line for line in b"".join(chunks).decode().split("\n") if line]
        self.assertIn("exec", events, "the hook was not armed")
        return events, row

    def test_audit_hook_sees_each_kind_of_egress(self):
        """The control: a check that sees nothing would also report no violation."""
        kinds = {
            "import socket\nsocket.socket().close()\n": "socket.__new__",
            "import subprocess, sys\nsubprocess.run([sys.executable, '-c', 'pass'])\n": "subprocess.Popen",
            "import os\nos.system('true')\n": "os.system",
            "import os\nos.posix_spawn('/bin/true', ['true'], {})\n": "os.posix_spawn",
            "import os\npid = os.fork()\nif not pid:\n    os._exit(0)\nos.waitpid(pid, 0)\n": "os.fork",
            "import os\nif not os.fork():\n    os.execv('/bin/true', ['true'])\nos.wait()\n": "os.exec",
            "import ctypes\n": "import:ctypes",
            "import urllib.request\n": "import:urllib.request",
            "import http.client\n": "import:http.client",
            "import _socket\n": "import:_socket",
            "import importlib.util as u\ns = u.find_spec('_posixsubprocess')\n": "import:importlib.util",
            "import time\ntime.sleep(0)\n": "time.sleep",
        }
        for number, (code, want) in enumerate(kinds.items()):
            with self.subTest(event=want):
                if want.startswith("os.") and not os.path.exists("/bin/true"):
                    self.skipTest("no /bin/true here")
                probe = os.path.join(self.config, "probe%d.py" % number)
                with open(probe, "w", encoding="utf-8") as fh:
                    fh.write(code)
                events, _ = self.audit(probe, "{}")
                self.assertIn(want, audit_violations(events))
                # With a gate, more modules are allowed. The hook does not see an
                # extension module that a spec loads: the static rules cover that.
                if want not in ("time.sleep", "import:importlib.util"):
                    self.assertIn(want, audit_violations(events, gate=True))
        # And the other way round: nothing is reported for a script that does nothing.
        probe = os.path.join(self.config, "quiet.py")
        with open(probe, "w", encoding="utf-8") as fh:
            fh.write("import json, os, re\nprint(json.dumps(sorted(os.listdir('.')))[:0])\n")
        self.assertEqual(audit_violations(self.audit(probe, "{}")[0]), [])

    def test_render_of_every_fixture_makes_only_the_allowed_events(self):
        names = sorted(n for n in os.listdir(FIXTURES) if n.endswith(".json"))
        self.assertGreaterEqual(len(names), 8)
        rows = []
        for name in names:
            for billing, source in (("both", "payload"), ("both", "estimate"), ("auto", "auto")):
                with self.subTest(fixture=name, billing=billing, source=source):
                    events, row = self.audit(
                        SCRIPT, read_fixture(name),
                        BOBBY_STATUSLINE_BILLING=billing, BOBBY_STATUSLINE_COST_SOURCE=source,
                    )
                    self.assertEqual(audit_violations(events), [])
                    rows.append(row)
        self.assertTrue(any("ctx 132k/1M" in row for row in rows))

    def test_estimate_with_transcripts_makes_only_the_allowed_events(self):
        self.append(self.transcript, assistant("msg_1", inp=100000, out=40000))
        self.append(self.agent(), assistant("msg_2", inp=100000))
        payload = json.dumps(self.payload())
        for _ in range(2):  # the first render writes the sidecar, the second reads it
            events, row = self.audit(SCRIPT, payload, BOBBY_STATUSLINE_COST_SOURCE="estimate")
            self.assertEqual(audit_violations(events), [])
            self.assertIn("~$1.60 (sub $0.40)", row)
        self.assertTrue(os.path.isfile(self.sidecar))
        self.assertIn("os.rename", self.audit(
            SCRIPT, json.dumps(self.payload(session_id="another-session")),
            BOBBY_STATUSLINE_COST_SOURCE="estimate")[0])

    def test_render_with_a_limit_guard_gate_makes_only_the_allowed_events(self):
        gate = os.path.join(os.path.dirname(ROOT), "limit-guard", "hooks", "limit-guard-gate.py")
        if not os.path.isfile(gate):
            self.skipTest("sibling limit-guard checkout not present")
        events, row = self.audit(
            SCRIPT, read_fixture("full.json"),
            BOBBY_STATUSLINE_LIMIT_GUARD=gate,
            LIMIT_GUARD_HOME=os.path.join(self.config, "limit-guard-state"),
        )
        self.assertEqual(audit_violations(events, gate=True), [])
        self.assertIn("ctx 132k/1M", row)
        self.assertTrue(os.listdir(os.path.join(self.config, "limit-guard-state")), "the gate ran")

    GATE = os.path.join(os.path.dirname(ROOT), "limit-guard", "hooks", "limit-guard-gate.py")
    # What the gate may import on top of the list of the status line.
    GATE_IMPORTS = {"tempfile", "shutil", "random"}

    def gate_or_skip(self) -> str:
        if not os.path.isfile(self.GATE):
            self.skipTest("sibling limit-guard checkout not present")
        with open(self.GATE, encoding="utf-8") as fh:
            return fh.read()

    def test_the_gate_of_this_repository_passes_the_static_rules(self):
        """A render runs the gate, so a lazy import in a branch of it that no fixture takes counts too."""
        source = self.gate_or_skip()
        self.assertEqual(self.problems(source), [])
        roots = set(self.imports(self.ast.parse(source)))
        self.assertEqual(roots - self.TOP_LEVEL - self.GATE_IMPORTS, set())
        lazy = "\ndef report(state):\n    if state.get('paused'):\n        import urllib.request\n"
        self.assertEqual(set(self.imports(self.ast.parse(source + lazy))) - self.TOP_LEVEL - self.GATE_IMPORTS, {"urllib"})

    def test_render_with_a_paused_limit_guard_makes_only_the_allowed_events(self):
        self.gate_or_skip()
        home = os.path.join(self.config, "limit-guard-state")
        os.makedirs(home)
        with open(os.path.join(home, "state.json"), "w", encoding="utf-8") as fh:
            json.dump({"paused": True, "manual": True, "until": time.time() + 1800, "reason": "test"}, fh)
        events, row = self.audit(
            SCRIPT, read_fixture("full.json"), BOBBY_STATUSLINE_LIMIT_GUARD=self.GATE, LIMIT_GUARD_HOME=home,
        )
        self.assertEqual(audit_violations(events, gate=True), [])
        self.assertIn("PAUSED", row)

    def test_audited_render_with_a_gate_writes_no_bytecode_file(self):
        """The audit runs with -B, so its events are the same on a first run and on a later one."""
        source = self.gate_or_skip()
        hooks = os.path.join(self.config, "fresh", "hooks")
        os.makedirs(hooks)
        gate = os.path.join(hooks, "limit-guard-gate.py")
        with open(gate, "w", encoding="utf-8") as fh:
            fh.write(source)
        events, row = self.audit(
            SCRIPT, read_fixture("full.json"), unset=("PYTHONDONTWRITEBYTECODE",),
            BOBBY_STATUSLINE_LIMIT_GUARD=gate, LIMIT_GUARD_HOME=os.path.join(self.config, "limit-guard-state"),
        )
        self.assertEqual(audit_violations(events, gate=True), [])
        self.assertIn("ctx 132k/1M", row)
        self.assertEqual(os.listdir(hooks), ["limit-guard-gate.py"])

    def test_render_that_finds_its_gate_by_itself_makes_only_the_allowed_events(self):
        """With no path given, the script looks for a gate next to itself and in
        the plugin cache. Whatever it finds and runs there is audited too."""
        events, row = self.audit(
            SCRIPT, read_fixture("full.json"), unset=("BOBBY_STATUSLINE_LIMIT_GUARD",),
            LIMIT_GUARD_HOME=os.path.join(self.config, "limit-guard-state"),
        )
        self.assertEqual(audit_violations(events, gate=True), [])
        self.assertIn("ctx 132k/1M", row)


def on_a_pty(argv: list, answers=(), ahead: bytes = b"", hold: float = 0.0, env=None, close: bool = False) -> dict:
    """Run a command on a pseudo terminal and answer its questions.

    `ahead` is typed at once, before the command wrote anything. Each of
    `answers` is typed when a new `[y/N]` is on the screen. With `hold`, the
    run waits that long after the last answer was used up and a further
    question appeared, and reports whether the command still waited then.
    With `close`, the terminal is closed after that instead of a kill.
    """
    import pty
    import select

    master, slave = pty.openpty()
    proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, close_fds=True, env=env)
    os.close(slave)
    if ahead:
        os.write(master, ahead)
    answers, seen, used, waited, held = list(answers), b"", 0, None, None
    deadline = time.time() + 60
    while time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            if not data:
                break
            seen += data
        elif proc.poll() is not None:
            break
        if seen.count(b"[y/N]") > used:
            if answers:
                os.write(master, answers.pop(0))
                used += 1
            elif hold:
                held = held or time.time()
                if time.time() - held >= hold:
                    waited = proc.poll() is None
                    break
    if waited and close:
        os.close(master)
        master = None
    elif proc.poll() is None:
        proc.kill()
    proc.wait(timeout=30)
    if master is not None:
        os.close(master)
    return {"code": proc.returncode, "seen": seen, "waited": waited}


def load_prices_script():
    spec = importlib.util.spec_from_file_location("bobby_statusline_prices", PRICES_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestPriceScript(Base):
    """The optional price update: manual, asked twice, and never by the status line."""

    LITELLM = {
        "sample_spec": {"input_cost_per_token": 0, "output_cost_per_token": 0},
        "claude-opus-5-5": {
            "input_cost_per_token": 3e-06, "output_cost_per_token": 1.5e-05,
            "cache_read_input_token_cost": 3e-07, "cache_creation_input_token_cost": 3.75e-06,
            "cache_creation_input_token_cost_above_1hr": 6e-06,
            "litellm_provider": "anthropic", "mode": "chat",
        },
        "claude-opus-5-5-20260101": {
            "input_cost_per_token": 9e-06, "output_cost_per_token": 9e-06, "mode": "chat",
        },
        "claude-sonnet-5-5-20260101": {
            "input_cost_per_token": 2e-06, "output_cost_per_token": 1e-05,
            "cache_read_input_token_cost": 1e-07, "mode": "chat",
        },
        "claude-haiku-5-5": {
            "input_cost_per_token": 2e-07, "output_cost_per_token": 1e-06, "mode": "chat",
        },
        "claude-new-9": {"input_cost_per_token": 1e-06, "output_cost_per_token": 2e-06},
        "claude-embed-1": {"input_cost_per_token": 1e-06, "output_cost_per_token": 0, "mode": "embedding"},
        "claude-broken": {"input_cost_per_token": "cheap", "output_cost_per_token": 1e-06},
        "claude-absurd": {"input_cost_per_token": 5, "output_cost_per_token": 1e-06},
        "claude-negative": {"input_cost_per_token": -1e-06, "output_cost_per_token": 1e-06},
        "gpt-4o": {"input_cost_per_token": 1e-06, "output_cost_per_token": 2e-06, "mode": "chat"},
        "vertex_ai/claude-opus-5-5": {"input_cost_per_token": 7e-06, "output_cost_per_token": 7e-06},
        "us.anthropic.claude-opus-5-5-v1:0": {"input_cost_per_token": 7e-06, "output_cost_per_token": 7e-06},
        "openrouter/anthropic/claude-opus-5-5": {"input_cost_per_token": 7e-06, "output_cost_per_token": 7e-06},
    }

    def setUp(self):
        super().setUp()
        self.mod = load_prices_script()
        self.config_file = os.path.join(self.config, "bobby-statusline.json")
        self.source = os.path.join(self.config, "list.json")
        with open(self.source, "w", encoding="utf-8") as fh:
            json.dump(self.LITELLM, fh)
        self.asked = []
        self.fetched = []

        def no_download(url):
            self.fetched.append(url)
            raise AssertionError("a download was started")

        self.mod.download = no_download

    def run_main(self, *args, answers=(), tty=True):
        answers = list(answers)
        out = io.StringIO()

        def ask(question):
            self.asked.append(question)
            return answers.pop(0) if answers else ""

        code = self.mod.main(["prices", *args], ask=ask, tty=lambda: tty, out=out)
        return code, out.getvalue()

    def stored(self):
        with open(self.config_file, encoding="utf-8") as fh:
            return json.load(fh)

    # -- the questions ----------------------------------------------------------

    def test_local_file_asks_once_and_writes_on_yes(self):
        with open(self.config_file, "w", encoding="utf-8") as fh:
            json.dump({"layout": "two-row", "prices": {"my-model": [1, 2, 3, 4, 5]}}, fh)
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 0, text)
        self.assertEqual(len(self.asked), 1)
        self.assertIn("Write these", self.asked[0])
        self.assertEqual(self.fetched, [])
        stored = self.stored()
        self.assertEqual(stored["layout"], "two-row")
        self.assertEqual(stored["prices"]["my-model"], [1, 2, 3, 4, 5])
        self.assertEqual(
            stored["prices"]["claude-opus-5-5"],
            {"input": 3.0, "output": 15.0, "cacheRead": 0.3, "cacheWrite5m": 3.75, "cacheWrite1h": 6.0},
        )
        self.assertEqual(os.stat(self.config_file).st_mode & 0o777, 0o600)
        self.assertEqual(sorted(os.listdir(self.config)), ["bobby-statusline.json", "list.json"])

    def test_table_shows_old_and_new_price(self):
        code, text = self.run_main("--from", self.source, "--dry-run")
        self.assertEqual(code, 0, text)
        self.assertRegex(text, r"claude-opus-5-5\n\s+input\s+4 -> 3\s+<-")
        self.assertRegex(text, r"output\s+20 -> 15")
        self.assertRegex(text, r"claude-new-9\n\s+input\s+- -> 1")

    def test_no_at_the_write_question_writes_nothing(self):
        for answer in ("n", "", "no", "maybe", "yes please"):
            with self.subTest(answer=answer):
                code, text = self.run_main("--from", self.source, answers=[answer])
                self.assertEqual(code, 1)
                self.assertIn("Nothing written", text)
                self.assertFalse(os.path.exists(self.config_file))

    def test_dry_run_asks_nothing_and_writes_nothing(self):
        code, text = self.run_main("--from", self.source, "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(self.asked, [])
        self.assertIn("Dry run. Nothing written.", text)
        self.assertFalse(os.path.exists(self.config_file))

    def test_without_a_terminal_it_does_nothing(self):
        code, text = self.run_main("--from", self.source, answers=["y", "y"], tty=False)
        self.assertEqual(code, 2)
        self.assertEqual(self.asked, [])
        self.assertFalse(os.path.exists(self.config_file))

    def test_without_a_terminal_as_a_real_process(self):
        result = subprocess.run(
            [sys.executable, PRICES_SCRIPT, "--from", self.source],
            input="y\ny\n", capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("needs a terminal", result.stderr)
        self.assertFalse(os.path.exists(self.config_file))

    def test_no_flag_and_no_variable_answers_the_questions(self):
        for flag in ("--yes", "-y", "--force", "--assume-yes", "--no-confirm"):
            with self.subTest(flag=flag):
                code, _ = self.run_main("--from", self.source, flag, answers=["y"])
                self.assertEqual(code, 2)
                self.assertFalse(os.path.exists(self.config_file))
        with open(PRICES_SCRIPT, encoding="utf-8") as fh:
            source = fh.read()
        self.assertNotIn("getenv", source)
        # The environment is read in three places. Two make a line of the
        # banner: which proxy applies, and where the certificates come from.
        # The third keeps the key log variable away from the TLS settings.
        import ast

        readers = set()
        for fn in ast.walk(ast.parse(source)):
            if isinstance(fn, ast.FunctionDef) and any(
                isinstance(node, ast.Attribute) and node.attr == "environ" for node in ast.walk(fn)
            ):
                readers.add(fn.name)
        self.assertEqual(readers, {"proxy_note", "trust_note", "tls_context"})
        for name in ("BOBBY_YES", "CI", "DEBIAN_FRONTEND", "BOBBY_STATUSLINE_YES"):
            os.environ[name] = "1"
        code, _ = self.run_main("--from", self.source, answers=[])
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(self.config_file))

    def pty_or_skip(self):
        try:
            import pty  # noqa: F401
            import termios  # noqa: F401
        except ImportError:
            self.skipTest("no pseudo terminal on this platform")

    def test_through_a_real_terminal(self):
        self.pty_or_skip()
        for answer, code, written in ((b"n\n", 1, False), (b"y\n", 0, True)):
            with self.subTest(answer=answer):
                run = on_a_pty([sys.executable, PRICES_SCRIPT, "--from", self.source], answers=[answer])
                self.assertEqual(run["code"], code, run["seen"].decode("utf-8", "replace"))
                self.assertIn(b"[y/N]", run["seen"])
                self.assertEqual(os.path.exists(self.config_file), written)
                if written:
                    os.unlink(self.config_file)

    def test_answer_typed_before_the_question_is_thrown_away(self):
        """A `y` typed ahead, or pasted with the command, answers nothing."""
        self.pty_or_skip()
        run = on_a_pty(
            [sys.executable, PRICES_SCRIPT, "--from", self.source], ahead=b"y\ny\n", hold=1.0, close=True
        )
        self.assertIn(b"Write these", run["seen"])
        self.assertTrue(run["waited"], "the question was answered by what was typed before it")
        self.assertNotIn(b"Written", run["seen"])
        self.assertFalse(os.path.exists(self.config_file))
        # The same question takes an answer that is typed after it.
        run = on_a_pty(
            [sys.executable, PRICES_SCRIPT, "--from", self.source], ahead=b"n\nn\n", answers=[b"y\n"]
        )
        self.assertEqual(run["code"], 0, run["seen"].decode("utf-8", "replace"))
        self.assertTrue(os.path.exists(self.config_file))

    def test_without_termios_it_does_nothing(self):
        self.mod.typed_ahead_guard = lambda: None
        out = io.StringIO()
        saved = sys.stderr
        sys.stderr = io.StringIO()
        try:
            code = self.mod.main(["prices", "--from", self.source], tty=lambda: True, out=out)
            said = sys.stderr.getvalue()
        finally:
            sys.stderr = saved
        self.assertEqual(code, 2)
        self.assertIn("termios", said)
        self.assertFalse(os.path.exists(self.config_file))

    def test_question_is_not_asked_when_the_typed_input_cannot_be_thrown_away(self):
        def broken():
            raise OSError("no terminal")

        self.assertFalse(self.mod.confirmed(lambda q: "y", "Go?", broken))
        calls = []
        self.assertTrue(self.mod.confirmed(lambda q: "y", "Go?", lambda: calls.append(1)))
        self.assertEqual(calls, [1])

    # -- the address ------------------------------------------------------------

    def test_plain_http_and_other_schemes_are_refused(self):
        for address in ("http://prices.example/list.json", "ftp://prices.example/list.json",
                        "file:///etc/passwd", "HTTP://prices.example/x", "gopher://prices.example/"):
            with self.subTest(address=address):
                code, text = self.run_main("--from", address, answers=["y", "y"])
                self.assertEqual(code, 1)
                self.assertIn("refused", text)
                self.assertEqual(self.asked, [])
                self.assertEqual(self.fetched, [])
                self.assertFalse(os.path.exists(self.config_file))

    def test_address_with_credentials_is_refused(self):
        code, text = self.run_main("--from", "https://user:secret@prices.example/x", answers=["y", "y"])
        self.assertEqual(code, 1)
        self.assertEqual(self.asked + self.fetched, [])

    def test_no_at_the_download_question_downloads_nothing(self):
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n", "y"])
        self.assertEqual(code, 1)
        self.assertEqual(len(self.asked), 1)
        self.assertIn("prices.example", self.asked[0])
        self.assertIn("https://prices.example/list.json", text)
        self.assertIn("No cookie", text)
        self.assertEqual(self.fetched, [])
        self.assertFalse(os.path.exists(self.config_file))

    def fake_download(self):
        with open(self.source, "rb") as fh:
            body = fh.read()

        def download(url):
            self.fetched.append(url)
            return body

        self.mod.download = download

    def test_address_asks_twice_and_no_at_the_second_writes_nothing(self):
        self.fake_download()
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["y", "n"])
        self.assertEqual(code, 1)
        self.assertEqual(len(self.asked), 2)
        self.assertEqual(self.fetched, ["https://prices.example/list.json"])
        self.assertFalse(os.path.exists(self.config_file))

    def test_address_with_two_yes_writes(self):
        self.fake_download()
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["yes", "Y"])
        self.assertEqual(code, 0, text)
        self.assertEqual(self.stored()["prices"]["claude-opus-5-5"]["input"], 3.0)

    # -- the file itself --------------------------------------------------------

    def test_file_has_no_address_and_reaches_the_network_in_one_place(self):
        import ast

        with open(PRICES_SCRIPT, encoding="utf-8") as fh:
            source = fh.read()
        self.assertIsNone(re.search(r"[A-Za-z][A-Za-z0-9+.-]*://", source))
        self.assertIsNone(re.search(r"\b[a-z0-9-]+\.(com|org|net|io|dev|ai)\b", source))
        tree = ast.parse(source)
        top = set()
        for stmt in tree.body:
            if isinstance(stmt, ast.Import):
                top.update(alias.name for alias in stmt.names)
            elif isinstance(stmt, ast.ImportFrom):
                top.add(stmt.module)
        self.assertEqual(
            top, {"__future__", "importlib.util", "json", "os", "re", "stat", "sys", "unicodedata", "urllib.parse"}
        )
        local = {}
        for fn in ast.walk(tree):
            if isinstance(fn, ast.FunctionDef):
                names = {
                    alias.name for node in ast.walk(fn) if isinstance(node, ast.Import)
                    for alias in node.names
                } | {node.module for node in ast.walk(fn) if isinstance(node, ast.ImportFrom)}
                if names:
                    local[fn.name] = names
        self.assertEqual(
            local,
            {"download": {"http.client", "time", "urllib.error", "urllib.request"},
             "redirect_handler": {"urllib.error", "urllib.request"},
             "proxy_note": {"urllib.request"},
             "tls_context": {"ssl"},
             "watchdog": {"threading"},
             "typed_ahead_guard": {"termios"}},
        )
        for word in ("subprocess", "socket", "os.system", "popen", "Cookie", "Authorization"):
            self.assertNotIn(word, source)

    def test_local_file_run_imports_no_network_module(self):
        code = (
            "import sys, importlib.util\n"
            "spec = importlib.util.spec_from_file_location('p', sys.argv[1])\n"
            "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\n"
            "rc = mod.main(['p', '--from', sys.argv[2], '--dry-run'], tty=lambda: True)\n"
            "bad = sorted(m for m in ('socket', 'ssl', 'urllib.request', 'http.client') if m in sys.modules)\n"
            "print('RESULT', rc, bad)\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code, PRICES_SCRIPT, self.source], capture_output=True, text=True,
        )
        self.assertIn("RESULT 0 []", result.stdout, result.stderr)

    # -- parsing ----------------------------------------------------------------

    def test_only_usable_claude_rows_are_kept(self):
        with open(self.source, "rb") as fh:
            found = self.mod.parse_prices(fh.read(), BS)
        self.assertEqual(
            sorted(found),
            ["claude-haiku-5-5", "claude-new-9", "claude-opus-5-5", "claude-sonnet-5-5"],
        )
        # The plain id wins over the dated form of the same model.
        self.assertEqual(found["claude-opus-5-5"], (3.0, 15.0, 0.3, 3.75, 6.0, None))
        # Cache prices that the list leaves out are the standard multiples.
        self.assertEqual(found["claude-sonnet-5-5"], (2.0, 10.0, 0.1, 2.5, 4.0, None))
        self.assertEqual(found["claude-new-9"], (1.0, 2.0, 0.1, 1.25, 2.0, None))

    def test_unchanged_rows_are_not_written(self):
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 0)
        # claude-sonnet-5-5 in the list equals the built-in row.
        self.assertEqual(
            sorted(self.stored()["prices"]), ["claude-haiku-5-5", "claude-new-9", "claude-opus-5-5"]
        )
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 0)
        self.assertIn("Nothing to write", text)

    def test_long_prompt_rates_in_use_are_kept(self):
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertIn("long-prompt rates kept", text)
        row = self.stored()["prices"]["claude-haiku-5-5"]
        self.assertEqual(row["input"], 0.2)
        self.assertEqual(row["above"]["threshold"], 100000)
        self.assertEqual(row["above"]["input"], 0.5)

    def test_model_pricing_shape_is_read(self):
        rows = {"claude-opus-5-5": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75},
                "claude-odd": {"input": 3}, "other-model": {"input": 1, "output": 1,
                                                           "cacheRead": 1, "cacheWrite": 1}}
        for body in (rows, {"modelPricing": rows}):
            with self.subTest(wrapped="modelPricing" in body):
                found = self.mod.parse_prices(json.dumps(body).encode(), BS)
                self.assertEqual(found, {"claude-opus-5-5": (3.0, 15.0, 0.3, 3.75, 3.75, None)})

    def test_unusable_lists_are_refused(self):
        for body in (b"not json", b"[1, 2]", b"{}", json.dumps({"gpt-4o": {"input": 1}}).encode()):
            with self.subTest(body=body[:12]):
                with open(self.source, "wb") as fh:
                    fh.write(body)
                code, text = self.run_main("--from", self.source, answers=["y"])
                self.assertEqual(code, 1)
                self.assertEqual(self.asked, [])
                self.assertFalse(os.path.exists(self.config_file))
        code, _ = self.run_main("--from", os.path.join(self.config, "absent.json"), answers=["y"])
        self.assertEqual(code, 1)

    # -- the configuration file -------------------------------------------------

    def test_broken_config_file_is_left_alone(self):
        for body in ("{ not json", "[1]"):
            with self.subTest(body=body):
                with open(self.config_file, "w", encoding="utf-8") as fh:
                    fh.write(body)
                code, text = self.run_main("--from", self.source, answers=["y"])
                self.assertEqual(code, 1)
                self.assertIn("left alone", text)
                with open(self.config_file, encoding="utf-8") as fh:
                    self.assertEqual(fh.read(), body)

    def test_symlinked_config_file_is_refused(self):
        target = os.path.join(self.config, "target.json")
        with open(target, "w", encoding="utf-8") as fh:
            fh.write("{}")
        os.symlink(target, self.config_file)
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 1)
        with open(target, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "{}")

    def test_written_rows_are_the_ones_the_status_line_uses(self):
        self.run_main("--from", self.source, answers=["y"])
        table = BS.price_table(BS.load_config()["prices"])
        usd, unknown = BS.ledger_cost({"claude-opus-5-5-20260101": {"n": [1000000] * 5 + [0]}}, table)
        self.assertAlmostEqual(usd, 3 + 15 + 0.3 + 3.75 + 6)
        usd, unknown = BS.ledger_cost({"claude-new-9": {"n": [1000000, 0, 0, 0, 0, 0]}}, table)
        self.assertEqual((usd, unknown), (1.0, False))

    # -- the terminal -----------------------------------------------------------

    def test_each_of_the_three_streams_must_be_a_terminal(self):
        try:
            import pty
        except ImportError:
            self.skipTest("no pty on this platform")
        for stream in ("stdin", "stdout", "stderr"):
            with self.subTest(not_a_terminal=stream):
                master, slave = pty.openpty()
                streams = {"stdin": slave, "stdout": slave, "stderr": slave}
                streams[stream] = subprocess.PIPE
                proc = subprocess.Popen(
                    [sys.executable, PRICES_SCRIPT, "--from", self.source], close_fds=True, **streams
                )
                os.close(slave)
                os.write(master, b"y\ny\n")
                if stream == "stdin":
                    proc.stdin.write(b"y\ny\n")
                    proc.stdin.close()
                    proc.wait(timeout=30)
                else:
                    proc.communicate(timeout=30)
                os.close(master)
                self.assertEqual(proc.returncode, 2)
                self.assertFalse(os.path.exists(self.config_file))

    def test_on_a_terminal_asks_all_three_streams(self):
        class Stream:
            def __init__(self, tty):
                self.tty = tty

            def isatty(self):
                return self.tty

        saved = sys.stdin, sys.stdout, sys.stderr
        try:
            for mask in range(8):
                flags = [bool(mask & bit) for bit in (1, 2, 4)]
                sys.stdin, sys.stdout, sys.stderr = (Stream(flag) for flag in flags)
                result = self.mod.on_a_terminal()
                sys.stdin, sys.stdout, sys.stderr = saved
                self.assertEqual(result, all(flags), flags)
            sys.stdin = None  # a closed stream is not a terminal
            result = self.mod.on_a_terminal()
        finally:
            sys.stdin, sys.stdout, sys.stderr = saved
        self.assertFalse(result)

    def test_end_of_input_is_not_a_yes(self):
        for error in (EOFError, KeyboardInterrupt):
            with self.subTest(error=error.__name__):
                out = io.StringIO()

                def ask(question):
                    self.asked.append(question)
                    raise error()

                code = self.mod.main(["prices", "--from", self.source], ask=ask, tty=lambda: True, out=out)
                self.assertEqual(code, 1)
                self.assertIn("Nothing written", out.getvalue())
                self.assertFalse(os.path.exists(self.config_file))
        self.fake_download()
        self.fetched.clear()
        code = self.mod.main(
            ["prices", "--from", "https://prices.example/list.json"],
            ask=lambda q: (_ for _ in ()).throw(EOFError()), tty=lambda: True, out=io.StringIO(),
        )
        self.assertEqual((code, self.fetched), (1, []))

    # -- the address and the list -----------------------------------------------

    def test_redirect_handler_stays_with_the_confirmed_host_and_port(self):
        import urllib.error
        import urllib.request

        handler = self.mod.redirect_handler("https://prices.example/list.json")
        req = urllib.request.Request("https://prices.example/list.json")
        refused = {
            "http://prices.example/list.json": "to prices.example:443 (http) refused",
            "ftp://prices.example/list.json": "(ftp) refused",
            "https://other.example/list.json": "redirect from prices.example:443 to other.example:443",
            "https://prices.example:8443/list.json": "to prices.example:8443",
            "https://prices.example.other.example/x": "to prices.example.other.example:443",
            "https://prices.example:99999/x": "refused",
            "https://user:secret@prices.example/x": "a user name or a password refused",
            "https://user@prices.example/x": "a user name or a password refused",
        }
        for target, words in refused.items():
            with self.subTest(target=target):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    handler.redirect_request(req, None, 302, "Found", {}, target)
                self.assertIn(words, str(caught.exception))
                caught.exception.close()
        for target in ("https://prices.example/other.json", "https://PRICES.example:443/other.json"):
            with self.subTest(target=target):
                new = handler.redirect_request(req, None, 302, "Found", {}, target)
                self.assertEqual(new.full_url, target)
                self.assertEqual(new.get_method(), "GET")

    def test_address_that_cannot_be_read_is_refused(self):
        for address in ("https://prices.example/a\nb", "https://prices.example/a b", "https://prices.example/\x1b[2J",
                        "https://[prices.example/x", "https://prices.example:99999/x", "https:///list.json"):
            with self.subTest(address=address):
                code, text = self.run_main("--from", address, answers=["y", "y"])
                self.assertEqual(code, 1)
                self.assertIn("refused", text)
                self.assertNotIn("\x1b", text)
                self.assertEqual(self.asked + self.fetched, [])

    def test_price_of_hundreds_of_digits_is_not_a_row(self):
        huge = int("9" * 400)
        for row in ({"input_cost_per_token": huge, "output_cost_per_token": 1e-06},
                    {"input": huge, "output": 1, "cacheRead": 1, "cacheWrite": 1}):
            with self.subTest(row=sorted(row)[0]):
                with open(self.source, "w", encoding="utf-8") as fh:
                    json.dump({"claude-huge-1": row, "claude-fine-1": {"input_cost_per_token": 1e-06,
                                                                       "output_cost_per_token": 2e-06}}, fh)
                code, text = self.run_main("--from", self.source, "--dry-run")
                self.assertEqual(code, 0, text)
                self.assertIn("claude-fine-1", text)
                self.assertNotIn("claude-huge-1", text)

    def test_source_that_is_not_a_regular_file_is_refused(self):
        for source in (os.devnull, self.config):
            with self.subTest(source=source):
                code, text = self.run_main("--from", source, answers=["y"])
                self.assertEqual(code, 1)
                self.assertIn("not a regular file", text)
                self.assertEqual(self.asked, [])

    def test_local_file_above_the_size_cap_is_refused(self):
        import types
        from unittest import mock

        self.mod.SIZE_CAP = 1000
        with open(self.source, "wb") as fh:
            fh.write(b" " * 5000)
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 1)
        self.assertIn("larger than", text)
        # A file that grew after its size was read is refused at the read.
        stat_of = os.stat

        def small(path, *args, **kwargs):
            info = stat_of(path, *args, **kwargs)
            if path == self.source:
                return types.SimpleNamespace(st_mode=info.st_mode, st_size=10)
            return info

        with mock.patch.object(os, "stat", small):
            code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 1)
        self.assertIn("larger than", text)
        self.assertEqual(self.asked, [])

    def test_list_with_a_byte_order_mark_is_read(self):
        with open(self.source, "w", encoding="utf-8-sig") as fh:
            json.dump(self.LITELLM, fh)
        code, text = self.run_main("--from", self.source, "--dry-run")
        self.assertEqual(code, 0, text)
        self.assertIn("claude-opus-5-5", text)

    # -- what is printed --------------------------------------------------------

    def test_clean_strips_control_characters_and_has_a_length_cap(self):
        hostile = "a\x1b[2Jb\x07c\x7fd\x9be" + "".join(
            chr(c) for c in (0x061C, 0x200E, 0x200F, 0x2028, 0x2029, 0x202A, 0x202E, 0x2066, 0x2069)
        ) + "f"
        self.assertEqual(self.mod.clean(hostile), "a[2Jbcdef")
        # Format characters that are not seen: zero-width space, soft hyphen,
        # byte order mark, word joiner. And half of a surrogate pair.
        unseen = "".join(chr(c) for c in (0x200B, 0x00AD, 0xFEFF, 0x2060, 0xD800, 0xDFFF))
        self.assertEqual(self.mod.clean("pri" + unseen + "ces"), "prices")
        accented = "caf" + chr(0xE9) + " 1.5"  # a letter above ASCII stays
        self.assertEqual(self.mod.clean(accented), accented)
        self.assertEqual(len(self.mod.clean("x" * 5000)), 400)
        self.assertEqual(self.mod.clean("x" * 50, 8), "x" * 8)
        self.assertEqual(self.mod.clean(OSError(5, "bad\x1b[0m")), "[Errno 5] bad[0m")

    def test_file_name_and_stored_key_are_printed_clean(self):
        source = os.path.join(self.config, "li\x1b[31mst.json")
        os.rename(self.source, source)
        # A key that is the plain id with characters around it that strip() takes off.
        hostile = "\x1f" + chr(0x2028) + "Claude-Opus-5-5" + chr(0x2029)
        with open(self.config_file, "w", encoding="utf-8") as fh:
            json.dump({"prices": {hostile: [9, 9, 9, 9, 9]}}, fh)
        code, text = self.run_main("--from", source, answers=["n"])
        self.assertEqual(code, 1)
        self.assertIn("removed: the stored key Claude-Opus-5-5, which", text)
        for char in text + "".join(self.asked):
            self.assertTrue(char == "\n" or 0x20 <= ord(char) < 0x7F, repr(char))

    def test_refusal_text_is_printed_clean(self):
        """A refusal names the file, and a file name can hold an escape sequence."""
        code, text = self.run_main("--from", os.path.join(self.config, "ab\x1b[2Jsent\x9b.json"), answers=["y"])
        self.assertEqual(code, 1)
        self.assertIn("ab[2Jsent.json", text)
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\x9b", text)

    def test_script_file_holds_no_control_character(self):
        with open(PRICES_SCRIPT, encoding="utf-8") as fh:
            source = fh.read()
        self.assertEqual([c for c in source if c != "\n" and self.mod.clean(c) == ""], [])

    # -- the configuration file -------------------------------------------------

    def test_stored_key_for_the_same_model_is_removed_in_the_same_write(self):
        """Only the plain id with a date, or in other letter case, would keep the old price in use."""
        goes = {
            "claude-opus-5-5-20260101": [9, 9, 9, 9, 9],
            " Claude-Opus-5-5 ": [9, 9, 9, 9, 9],
            "CLAUDE-OPUS-5-5-20250301": [9, 9, 9, 9, 9],
        }
        stays = {
            "us.anthropic.claude-opus-5-5-v1:0": [8, 8, 8, 8, 8],  # a regional price, as the README says
            "anthropic.claude-opus-5-5": [8, 8, 8, 8, 8],
            "claude-opus-5-5[1m]": [8, 8, 8, 8, 8],
            "claude-opus-5-5@20260101": [8, 8, 8, 8, 8],
            "claude-opus-5-5-fast": [7, 7, 7, 7, 7],
            "claude-opus-5-5-20260102": "a note, not a row",
            "claude-opus-5-5-12345678": [6, 6, 6, 6, 6],
            "my-model": [1, 2, 3, 4, 5],
        }
        before = {"prices": dict(goes, **stays)}
        with open(self.config_file, "w", encoding="utf-8") as fh:
            json.dump(before, fh)
        code, text = self.run_main("--from", self.source, answers=["n"])
        self.assertEqual(code, 1)
        for key in goes:
            self.assertIn("removed: the stored key %s, which is the same model as claude-opus-5-5" % key, text)
        for key in stays:
            self.assertNotIn("the stored key %s," % key, text)
        self.assertEqual(text.count("removed:"), len(goes))
        self.assertEqual(self.stored(), before, "No at the question leaves every key")

        code, text = self.run_main("--from", self.source, "--dry-run")
        self.assertEqual(text.count("would remove: the stored key"), len(goes))
        self.assertNotIn("\nremoved:", text)
        self.assertEqual(self.stored(), before)

        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 0, text)
        prices = self.stored()["prices"]
        for key in goes:
            self.assertNotIn(key, prices)
        for key, row in stays.items():
            self.assertEqual(prices[key], row)
        self.assertEqual(prices["claude-opus-5-5"]["input"], 3.0)
        # The dated id now takes the new price, not the old stored one.
        table = BS.price_table(BS.load_config()["prices"])
        usd, _ = BS.ledger_cost({"claude-opus-5-5-20260101": {"n": [1000000, 0, 0, 0, 0, 0]}}, table)
        self.assertEqual(usd, 3.0)

    def test_newest_dated_row_wins_when_the_list_has_no_plain_id(self):
        row = {"input_cost_per_token": 1e-06, "output_cost_per_token": 2e-06}
        newer = {"input_cost_per_token": 5e-06, "output_cost_per_token": 6e-06}
        found = self.mod.parse_prices(json.dumps({
            "claude-new-9-20250101": row, "claude-new-9-20260101": newer, "claude-new-9-20240101": row,
        }).encode(), BS)
        self.assertEqual(found["claude-new-9"][:2], (5.0, 6.0))
        # The plain id wins over every dated one, wherever it sorts.
        for plain in ("claude-new-9", "Claude-New-9"):
            found = self.mod.parse_prices(json.dumps({
                plain: row, "claude-new-9-20260101": newer, "claude-new-9-20990101": newer,
            }).encode(), BS)
            self.assertEqual(found["claude-new-9"][:2], (1.0, 2.0), plain)

    def test_fast_row_of_a_list_is_not_taken(self):
        row = {"input_cost_per_token": 1e-06, "output_cost_per_token": 2e-06}
        found = self.mod.parse_prices(json.dumps({"claude-new-9-fast": row, "claude-other-1": row}).encode(), BS)
        self.assertEqual(sorted(found), ["claude-other-1"])

    def test_cache_price_of_the_wrong_type_drops_the_row(self):
        base = {"input_cost_per_token": 1e-06, "output_cost_per_token": 2e-06}
        for field in ("cache_read_input_token_cost", "cache_creation_input_token_cost",
                      "cache_creation_input_token_cost_above_1hr"):
            for value in ("cheap", True, [1]):
                with self.subTest(field=field, value=value):
                    self.assertIsNone(self.mod.litellm_row(dict(base, **{field: value})))
            self.assertEqual(self.mod.litellm_row(dict(base, **{field: None}))["cacheRead"], 0.1)

    def test_row_above_the_price_limit_after_its_multiplier_is_not_written(self):
        """A row that the status line would drop is not shown and not written."""
        rows = {
            "claude-big-1": {"input": 100000, "output": 1, "cacheRead": 0, "cacheWrite": 0, "multiplier": 1000},
            "claude-fine-1": {"input": 100, "output": 1, "cacheRead": 0, "cacheWrite": 0, "multiplier": 1000},
        }
        with open(self.source, "w", encoding="utf-8") as fh:
            json.dump(rows, fh)
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 0, text)
        self.assertNotIn("claude-big-1", text)
        self.assertEqual(sorted(self.stored()["prices"]), ["claude-fine-1"])
        self.assertEqual(sorted(BS.load_config()["prices"]), ["claude-fine-1"])
        self.assertEqual(BS.load_config()["prices"]["claude-fine-1"][0], 100000.0)

    def test_drive_letter_path_is_a_file_and_not_an_address(self):
        self.assertFalse(self.mod.is_url("c:/prices/list.json"))
        self.assertTrue(self.mod.is_url("ab:/x"))
        code, text = self.run_main("--from", "c:/prices/list.json", answers=["y"])
        self.assertEqual(code, 1)
        self.assertIn("cannot read c:/prices/list.json", text)

    def test_limits_of_the_download_are_the_stated_ones(self):
        self.assertEqual(self.mod.TOTAL_S, 30)
        self.assertEqual(self.mod.SIZE_CAP, 20 * 1024 * 1024)
        self.assertEqual(self.mod.REDIRECTS, 3)
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertIn("at most 3 redirects and only to this host and port", text)
        self.assertIn("30 s for the whole download with the name lookup, 20 MB", text)
        self.assertIn("one GET request for each address", text)

    # -- the banner -------------------------------------------------------------------

    def test_banner_names_the_proxy_and_never_its_credentials(self):
        for key in list(os.environ):
            if key.lower().endswith("_proxy"):
                del os.environ[key]
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertIn("  proxy   : none\n", text)
        os.environ["https_proxy"] = "http://puser:psecret@192.0.2.10:3128"
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertIn("  proxy   : 192.0.2.10:3128, from https_proxy.", text)
        self.assertIn("Credentials in that setting go to the proxy", text)
        self.assertNotIn("psecret", text + "".join(self.asked))
        self.assertNotIn("puser", text + "".join(self.asked))
        # A host on the no_proxy list gets no proxy, and the banner says so.
        os.environ["no_proxy"] = "prices.example"
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertIn("  proxy   : none\n", text)
        del os.environ["https_proxy"], os.environ["no_proxy"]
        os.environ["HTTPS_PROXY"] = "proxy.example:8080"
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertIn("  proxy   : proxy.example:8080, from HTTPS_PROXY.", text)
        self.assertEqual(self.fetched, [])

    def test_banner_names_a_certificate_store_from_the_environment(self):
        os.environ.pop("SSL_CERT_FILE", None)
        os.environ.pop("SSL_CERT_DIR", None)
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertNotIn("certificate store", text)
        os.environ["SSL_CERT_FILE"] = "/etc/other\x1b[2J/bundle.pem"
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertIn("  trust   : certificate store /etc/other[2J/bundle.pem (from SSL_CERT_FILE)\n", text)
        os.environ["SSL_CERT_DIR"] = "/etc/other-certs"
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["n"])
        self.assertIn("/etc/other-certs (from SSL_CERT_DIR)", text)

    def test_tls_settings_write_no_key_log(self):
        keys = os.path.join(self.config, "keys.log")
        os.environ["SSLKEYLOGFILE"] = keys
        self.assertIsNone(self.mod.tls_context().keylog_filename)
        self.assertFalse(os.path.exists(keys))
        self.assertEqual(os.environ["SSLKEYLOGFILE"], keys, "the variable of the user is put back")
        import ssl

        self.assertEqual(self.mod.tls_context().verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(self.mod.tls_context().check_hostname)

    def test_question_names_the_host_and_the_port(self):
        code, text = self.run_main("--from", "https://prices.example:8443/list.json", answers=["n"])
        self.assertEqual(self.asked, ["Download from prices.example:8443? [y/N] "])
        self.assertIn("  host    : prices.example:8443\n", text)
        self.asked.clear()
        code, text = self.run_main("--from", "https://Prices.Example/list.json", answers=["n"])
        self.assertEqual(self.asked, ["Download from prices.example:443? [y/N] "])

    def test_host_that_can_differ_from_the_one_shown_is_refused(self):
        dot = chr(0x3002)  # a full stop of another script, which a resolver reads as "."
        for address in (
            "https://127.0.0.1%3A8443/list.json",
            "https://prices%2Eexample/list.json",
            "https://prices" + dot + "example/list.json",
            "https://pric" + chr(0x0435) + "s.example/list.json",  # a Cyrillic letter
            "https://prices" + chr(0x200B) + ".example/list.json",
            "https://prices" + chr(0x00AD) + ".example/list.json",
            "https://" + chr(0xFEFF) + "prices.example/list.json",
        ):
            with self.subTest(address=address.encode("unicode_escape")):
                code, text = self.run_main("--from", address, answers=["y", "y"])
                self.assertEqual(code, 1)
                self.assertIn("refused", text)
                self.assertEqual(self.asked + self.fetched, [])
        # A percent sign in the path is not in the host part.
        code, text = self.run_main("--from", "https://prices.example/a%20b.json", answers=["n"])
        self.assertEqual(len(self.asked), 1)

    # -- the configuration file, while the question waits ------------------------------

    def test_config_that_changed_during_the_question_is_not_written_over(self):
        with open(self.config_file, "w", encoding="utf-8") as fh:
            json.dump({"layout": "two-row", "separator": " | "}, fh)
        other = json.dumps({"layout": "one-row", "billing": "cost", "prices": {"my-model": [1, 2, 3, 4, 5]}})

        def another_program_writes(question):
            self.asked.append(question)
            with open(self.config_file, "w", encoding="utf-8") as fh:
                fh.write(other)
            return "y"

        out = io.StringIO()
        code = self.mod.main(["prices", "--from", self.source], ask=another_program_writes, tty=lambda: True, out=out)
        self.assertEqual(code, 1)
        self.assertIn("the configuration file changed", out.getvalue())
        self.assertIn("Nothing written", out.getvalue())
        with open(self.config_file, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), other)
        self.assertEqual(sorted(os.listdir(self.config)), ["bobby-statusline.json", "list.json"])

    def test_config_that_appeared_or_went_during_the_question_is_not_written(self):
        def appears(question):
            with open(self.config_file, "w", encoding="utf-8") as fh:
                fh.write("{}")
            return "y"

        out = io.StringIO()
        self.assertEqual(self.mod.main(["prices", "--from", self.source], ask=appears, tty=lambda: True, out=out), 1)
        with open(self.config_file, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "{}")

        def goes(question):
            os.unlink(self.config_file)
            return "y"

        out = io.StringIO()
        self.assertEqual(self.mod.main(["prices", "--from", self.source], ask=goes, tty=lambda: True, out=out), 1)
        self.assertIn("the configuration file changed", out.getvalue())
        self.assertFalse(os.path.exists(self.config_file))

    def test_same_size_rewrite_during_the_question_is_seen(self):
        with open(self.config_file, "w", encoding="utf-8") as fh:
            fh.write('{"layout": "two-row"}')
        stamp = os.stat(self.config_file).st_mtime_ns

        def same_size(question):
            with open(self.config_file, "w", encoding="utf-8") as fh:
                fh.write('{"layout": "one-row"}')
            os.utime(self.config_file, ns=(stamp + 5 * 10**6, stamp + 5 * 10**6))
            return "y"

        out = io.StringIO()
        self.assertEqual(self.mod.main(["prices", "--from", self.source], ask=same_size, tty=lambda: True, out=out), 1)
        with open(self.config_file, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), '{"layout": "one-row"}')

    def test_config_with_half_a_surrogate_pair_is_left_alone(self):
        body = '{"note": "\\ud800", "layout": "two-row"}'
        with open(self.config_file, "w", encoding="utf-8") as fh:
            fh.write(body)
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 1)
        self.assertIn("cannot be written as UTF-8", text)
        with open(self.config_file, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), body)
        self.assertEqual(sorted(os.listdir(self.config)), ["bobby-statusline.json", "list.json"])

    def test_interrupt_during_the_download_gives_no_traceback(self):
        def interrupted(url):
            raise KeyboardInterrupt()

        self.mod.download = interrupted
        code, text = self.run_main("--from", "https://prices.example/list.json", answers=["y", "y"])
        self.assertEqual(code, 1)
        self.assertIn("Stopped. Nothing written.", text)
        self.assertFalse(os.path.exists(self.config_file))

    def test_a_run_leaves_no_bytecode_file_next_to_the_scripts(self):
        """The script writes one key of one file. A cache of the status line script is a second thing."""
        import shutil

        copy = os.path.join(self.config, "copy")
        shutil.copytree(os.path.join(ROOT, "bin"), os.path.join(copy, "bin"), ignore=shutil.ignore_patterns("__pycache__"))
        self.pty_or_skip()
        environ = {k: v for k, v in os.environ.items() if k != "PYTHONDONTWRITEBYTECODE"}
        run = on_a_pty(
            [sys.executable, os.path.join(copy, "bin", "bobby-statusline-prices.py"), "--from", self.source, "--dry-run"],
            env=environ,
        )
        self.assertEqual(run["code"], 0, run["seen"])
        self.assertIn(b"Dry run", run["seen"])
        self.assertEqual(sorted(os.listdir(os.path.join(copy, "bin"))), ["bobby-statusline-prices.py", "bobby-statusline.py"])

    def test_prices_key_that_is_not_an_object_is_refused(self):
        for value in ([1, 2], "cheap", 5, None):
            with self.subTest(value=value):
                body = json.dumps({"layout": "two-row", "prices": value})
                with open(self.config_file, "w", encoding="utf-8") as fh:
                    fh.write(body)
                code, text = self.run_main("--from", self.source, answers=["y"])
                self.assertEqual(code, 1)
                self.assertIn("prices key", text)
                self.assertIn("Nothing written", text)
                self.assertEqual(self.asked, [])
                with open(self.config_file, encoding="utf-8") as fh:
                    self.assertEqual(fh.read(), body)

    def test_config_file_with_a_byte_order_mark_is_read_and_kept(self):
        with open(self.config_file, "w", encoding="utf-8-sig") as fh:
            json.dump({"layout": "two-row"}, fh)
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 0, text)
        stored = self.stored()
        self.assertEqual(stored["layout"], "two-row")
        self.assertEqual(stored["prices"]["claude-opus-5-5"]["input"], 3.0)
        self.assertEqual(BS.load_config()["layout"], "two-row")

    def test_config_file_without_write_permission_is_left_alone(self):
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            self.skipTest("root may write to every file")
        body = json.dumps({"layout": "two-row"})
        with open(self.config_file, "w", encoding="utf-8") as fh:
            fh.write(body)
        os.chmod(self.config_file, 0o400)
        code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 1)
        self.assertIn("read-only", text)
        self.assertEqual(self.asked, [])
        with open(self.config_file, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), body)
        self.assertEqual(os.stat(self.config_file).st_mode & 0o777, 0o400)
        self.assertEqual(sorted(os.listdir(self.config)), ["bobby-statusline.json", "list.json"])

    def test_link_that_appears_at_the_temporary_name_is_not_written_through(self):
        from unittest import mock

        victim = os.path.join(self.config, "victim.txt")
        with open(victim, "w", encoding="utf-8") as fh:
            fh.write("keep")
        unlink = os.unlink

        def unlink_then_plant(path, *args, **kwargs):
            try:
                unlink(path, *args, **kwargs)
            finally:
                if str(path).endswith(".tmp") and not os.path.lexists(path):
                    os.symlink(victim, path)

        with mock.patch.object(os, "unlink", unlink_then_plant):
            code, text = self.run_main("--from", self.source, answers=["y"])
        self.assertEqual(code, 1)
        self.assertIn("cannot write", text)
        with open(victim, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "keep")
        self.assertFalse(os.path.exists(self.config_file))

    def test_install_command_does_not_run_it(self):
        with open(os.path.join(ROOT, "commands", "install.md"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("bobby-statusline-prices.py", text)
        self.assertIn("Do not run it", text)


class TlsListener:
    """A TLS listener on 127.0.0.1 that records each request and answers by path.

    The certificate is made for one test run, in a temporary directory, with
    the `openssl` command. No key and no certificate is kept in the repository.
    """

    @staticmethod
    def certificate(folder: str) -> tuple:
        """(certificate, key): two new files in `folder`, for 127.0.0.1 and localhost."""
        cert, key = os.path.join(folder, "cert.pem"), os.path.join(folder, "key.pem")
        made = subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
             "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"],
            capture_output=True, text=True,
        )
        if made.returncode != 0:
            raise unittest.SkipTest("openssl could not make a certificate: %s" % made.stderr[-200:])
        return cert, key

    def __init__(self, cert: str, key: str, body: bytes):
        import socket
        import ssl
        import threading

        self.server_side = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.server_side.load_cert_chain(cert, key)
        self.client_side = ssl.create_default_context(cafile=cert)
        self.body = body
        self.requests = []
        self.connections = 0
        self.done = threading.Event()
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        self.threading = threading
        threading.Thread(target=self.accept, daemon=True).start()

    def url(self, path: str, host: str = "127.0.0.1") -> str:
        return "https://%s:%d%s" % (host, self.port, path)

    def close(self):
        self.done.set()
        self.sock.close()

    def accept(self):
        while not self.done.is_set():
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.connections += 1
            self.threading.Thread(target=self.serve, args=(conn,), daemon=True).start()

    def serve(self, conn):
        try:
            conn = self.server_side.wrap_socket(conn, server_side=True)
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                head += chunk
            self.requests.append(head)
            self.answer(conn, head.split(b" ", 2)[1].decode("latin-1"))
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def answer(self, conn, path: str):
        def send(status, headers, body=b""):
            lines = ["HTTP/1.1 %s" % status] + headers + ["Connection: close", "", ""]
            conn.sendall("\r\n".join(lines).encode("latin-1") + body)

        cookie = "Set-Cookie: sid=secret-value; Path=/"
        if path.startswith("/list.json"):
            send("200 OK", ["Content-Type: application/json", "Content-Length: %d" % len(self.body), cookie],
                 self.body)
        elif path.startswith("/hop"):
            send("302 Found", ["Location: /hop%d" % (int(path[4:]) + 1), "Content-Length: 0"])
        elif path == "/cut-off":
            send("200 OK", ["Content-Length: 100000"], self.body)
        elif path == "/again":
            send("302 Found", ["Location: /list.json", "Content-Length: 0", cookie])
        elif path == "/other-host":
            send("302 Found", ["Location: " + self.url("/list.json", "localhost"), "Content-Length: 0"])
        elif path == "/with-user":
            send("302 Found", ["Location: https://user:secret@127.0.0.1:%d/list.json" % self.port, "Content-Length: 0"])
        elif path == "/other-port":
            send("302 Found", ["Location: https://127.0.0.1:%d/list.json" % (self.port + 1), "Content-Length: 0"])
        elif path == "/plain":
            send("302 Found", ["Location: http://127.0.0.1:%d/list.json" % self.port, "Content-Length: 0"])
        elif path == "/big":
            send("200 OK", ["Content-Length: 5000"], b" " * 5000)
        elif path == "/reason":
            send("404 Not\x1b[2J\x1b[31m Found\x9b1m", ["Content-Length: 0"])
        elif path == "/garbage":
            conn.sendall(b"this is not HTTP\r\n\r\n")
        elif path == "/stall":
            send("200 OK", ["Content-Length: 100"])
            self.done.wait(20)
        elif path == "/slow-head":
            for byte in b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nX-Pad: " + b"x" * 400:
                if self.done.is_set():
                    return
                conn.sendall(bytes([byte]))
                time.sleep(0.05)
        elif path == "/slow":
            send("200 OK", [])
            for _ in range(400):  # one byte at a time: no single read is slow
                if self.done.is_set():
                    return
                conn.sendall(b" ")
                time.sleep(0.05)


class TestPriceDownload(Base):
    """download() against a TLS listener on 127.0.0.1: what is sent, and what is refused."""

    BODY = json.dumps({"claude-opus-5-5": {"input_cost_per_token": 3e-06, "output_cost_per_token": 1.5e-05}})

    @classmethod
    def setUpClass(cls):
        import shutil

        if not shutil.which("openssl"):
            raise unittest.SkipTest("no openssl command here")
        cls.folder = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.folder.cleanup)
        cls.pair = TlsListener.certificate(cls.folder.name)

    def setUp(self):
        super().setUp()
        self.mod = load_prices_script()
        # The real one ends the process. Here it is recorded.
        self.gave_up = []
        self.mod.give_up = lambda: self.gave_up.append(time.monotonic())
        self.listener = TlsListener(*self.pair, self.BODY.encode())
        self.addCleanup(self.listener.close)
        # A proxy from the environment would take the request somewhere else.
        for key in list(os.environ):
            if key.lower().endswith("_proxy"):
                del os.environ[key]
        os.environ["no_proxy"] = "127.0.0.1,localhost"

    def get(self, path: str) -> bytes:
        return self.mod.download(self.listener.url(path), context=self.listener.client_side)

    def refused(self, path: str) -> str:
        with self.assertRaises(self.mod.Refused) as caught:
            self.get(path)
        return str(caught.exception)

    def head(self, number: int = 0) -> tuple:
        """(request line, {header: value}) of a recorded request."""
        lines = self.listener.requests[number].split(b"\r\n\r\n")[0].decode("latin-1").split("\r\n")
        return lines[0], {k.lower(): v.strip() for k, v in (line.split(":", 1) for line in lines[1:])}

    def test_one_request_with_these_headers_and_no_other(self):
        self.assertEqual(self.get("/list.json?x=1"), self.BODY.encode())
        self.assertEqual(len(self.listener.requests), 1)
        line, headers = self.head()
        self.assertEqual(line, "GET /list.json?x=1 HTTP/1.1")
        self.assertEqual(
            headers,
            {
                "host": "127.0.0.1:%d" % self.listener.port,
                "user-agent": "price-list-fetch",
                "accept": "application/json",
                "accept-encoding": "identity",
                "connection": "close",
            },
        )
        self.assertTrue(self.listener.requests[0].endswith(b"\r\n\r\n"), "the request has no body")

    def test_certificate_that_the_context_does_not_know_is_refused(self):
        with self.assertRaises(self.mod.Refused) as caught:
            self.mod.download(self.listener.url("/list.json"))  # the system's store, as the command line uses
        self.assertIn("download failed", str(caught.exception))
        self.assertEqual(self.listener.requests, [])

    def test_redirect_to_the_same_host_is_followed_without_a_cookie(self):
        self.assertEqual(self.get("/again"), self.BODY.encode())
        self.assertEqual(len(self.listener.requests), 2)
        for number in (0, 1):
            line, headers = self.head(number)
            self.assertNotIn("cookie", headers)
            self.assertNotIn(b"secret-value", self.listener.requests[number])
            self.assertEqual(sorted(headers), ["accept", "accept-encoding", "connection", "host", "user-agent"])
        self.assertEqual(self.head(1)[0], "GET /list.json HTTP/1.1")

    def test_redirect_to_another_host_is_refused_and_names_both(self):
        text = self.refused("/other-host")
        self.assertIn("redirect from 127.0.0.1:%d to localhost:%d" % ((self.listener.port,) * 2), text)
        self.assertEqual(len(self.listener.requests), 1, "the other host got no request")

    def test_redirect_to_an_address_with_credentials_is_refused(self):
        text = self.refused("/with-user")
        self.assertIn("a user name or a password refused", text)
        self.assertNotIn("secret", text)
        self.assertEqual(len(self.listener.requests), 1)

    def test_redirect_to_another_port_is_refused(self):
        text = self.refused("/other-port")
        self.assertIn("to 127.0.0.1:%d" % (self.listener.port + 1), text)
        self.assertEqual(len(self.listener.requests), 1)

    def test_redirect_to_plain_http_is_refused(self):
        text = self.refused("/plain")
        self.assertIn("(http) refused", text)
        self.assertEqual(len(self.listener.requests), 1)

    def test_body_above_the_size_cap_is_refused(self):
        self.mod.SIZE_CAP = 1000
        self.assertIn("larger than", self.refused("/big"))
        self.mod.SIZE_CAP = 5000
        self.assertEqual(len(self.get("/big")), 5000)

    def test_stalled_server_ends_at_the_socket_timeout(self):
        self.mod.TIMEOUT_S = 0.5
        start = time.monotonic()
        text = self.refused("/stall")
        self.assertLess(time.monotonic() - start, 10)
        self.assertIn("download failed", text)

    def test_slow_server_ends_at_the_limit_for_the_whole_download(self):
        """A body that comes a byte at a time: the read loop asks the clock, in any thread."""
        import threading

        for runner in ("main thread", "another thread"):
            with self.subTest(runner=runner):
                self.mod.TOTAL_S = 1
                seen = []

                def work():
                    start = time.monotonic()
                    try:
                        self.get("/slow")
                    except self.mod.Refused as err:
                        seen.append((str(err), time.monotonic() - start))

                if runner == "main thread":
                    work()
                else:
                    worker = threading.Thread(target=work)
                    worker.start()
                    worker.join(20)
                self.assertEqual(len(seen), 1)
                self.assertIn("took longer than 1 s", seen[0][0])
                self.assertGreaterEqual(seen[0][1], 0.9)
                self.assertLess(seen[0][1], 5)

    def test_watchdog_fires_at_the_limit_and_not_after_the_download_returned(self):
        self.mod.TOTAL_S = 0.5
        self.assertEqual(self.get("/list.json"), self.BODY.encode())
        time.sleep(1.0)
        self.assertEqual(self.gave_up, [], "the watchdog fired after the download was over")
        # A download that is refused ends the watchdog too.
        self.refused("/garbage")
        time.sleep(1.0)
        self.assertEqual(self.gave_up, [])
        # And it does fire while a download is still going.
        self.mod.TIMEOUT_S = 3
        start = time.monotonic()
        self.refused("/stall")
        self.assertEqual(len(self.gave_up), 1)
        self.assertLess(self.gave_up[0] - start, 1.5)
        self.assertGreaterEqual(self.gave_up[0] - start, 0.45)

    LATE_DRIVER = (
        "import importlib.util, signal, socket, ssl, sys, time\n"
        # Nothing may reach the main thread, as in a name lookup that never
        # answers: no alarm is delivered, and the stand-in below does not return.
        "if hasattr(signal, 'pthread_sigmask'):\n"
        "    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM})\n"
        "spec = importlib.util.spec_from_file_location('prices', sys.argv[1])\n"
        "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\n"
        "mod.TOTAL_S = 1\n"
        "if sys.argv[4] == 'lookup':\n"
        "    socket.getaddrinfo = lambda *a, **k: time.sleep(25)\n"
        "real = mod.download\n"
        "mod.download = lambda url: real(url, context=ssl.create_default_context(cafile=sys.argv[3]))\n"
        "sys.exit(mod.main(['prices', '--from', sys.argv[2]], ask=lambda q: 'y', tty=lambda: True))\n"
    )

    def test_whole_download_ends_at_the_limit_where_no_signal_arrives(self):
        """Headers a byte at a time, and a name lookup that does not answer.

        Neither reaches the read loop, and an alarm does not reach a main
        thread that is inside a name lookup. The watchdog ends the process.
        """
        config_file = os.path.join(self.config, "bobby-statusline.json")
        for case, path in (("headers", "/slow-head"), ("lookup", "/list.json")):
            with self.subTest(case=case):
                before = self.listener.connections
                start = time.monotonic()
                result = subprocess.run(
                    [sys.executable, "-c", self.LATE_DRIVER, PRICES_SCRIPT, self.listener.url(path),
                     self.pair[0], case],
                    capture_output=True, text=True, timeout=120,
                )
                took = time.monotonic() - start
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("refused: the download took longer than 1 s\nNothing written.\n", result.stdout)
                self.assertNotIn("Traceback", result.stderr)
                self.assertLess(took, 8)
                self.assertFalse(os.path.exists(config_file))
                if case == "lookup":
                    self.assertEqual(self.listener.connections, before)

    def test_body_that_stops_before_its_stated_length_is_refused(self):
        self.assertIn("stopped early", self.refused("/cut-off"))

    def test_no_more_than_three_redirects_are_followed(self):
        text = self.refused("/hop0")
        self.assertIn("download failed", text)
        self.assertEqual(len(self.listener.requests), 4, "the first request and three redirects")
        self.assertEqual(self.head(3)[0], "GET /hop3 HTTP/1.1")

    def test_certificate_store_from_the_environment_is_used_and_no_key_log_is_written(self):
        """What the banner names is what happens: SSL_CERT_FILE decides, SSLKEYLOGFILE does nothing."""
        keys = os.path.join(self.config, "keys.log")
        os.environ["SSL_CERT_FILE"] = self.pair[0]
        os.environ["SSLKEYLOGFILE"] = keys
        self.assertEqual(self.mod.download(self.listener.url("/list.json")), self.BODY.encode())
        self.assertFalse(os.path.exists(keys))

    def test_answer_typed_before_the_download_question_starts_no_download(self):
        try:
            import pty  # noqa: F401
            import termios  # noqa: F401
        except ImportError:
            self.skipTest("no pseudo terminal on this platform")
        environ = dict(os.environ, SSL_CERT_FILE=self.pair[0])
        run = on_a_pty(
            [sys.executable, PRICES_SCRIPT, "--from", self.listener.url("/list.json")],
            ahead=b"y\ny\n", hold=1.0, close=True, env=environ,
        )
        self.assertIn(b"Download from 127.0.0.1:%d? [y/N]" % self.listener.port, run["seen"])
        self.assertTrue(run["waited"], "the question was answered by what was typed before it")
        self.assertEqual(self.listener.connections, 0)
        self.assertNotIn(b"Written", run["seen"])
        self.assertFalse(os.path.exists(os.path.join(self.config, "bobby-statusline.json")))
        # With the answers typed after the questions, the same command downloads and writes.
        run = on_a_pty(
            [sys.executable, PRICES_SCRIPT, "--from", self.listener.url("/list.json")],
            ahead=b"n\n", answers=[b"y\n", b"y\n"], env=environ,
        )
        self.assertEqual(run["code"], 0, run["seen"].decode("utf-8", "replace"))
        self.assertEqual(len(self.listener.requests), 1)
        self.assertIn(b"certificate store", run["seen"])

    def test_reply_that_is_not_http_is_refused(self):
        self.assertIn("download failed", self.refused("/garbage"))

    def test_reason_phrase_of_the_server_is_printed_clean(self):
        """The server chooses the text after the status code."""
        self.assertIn("\x1b[2J", self.refused("/reason"))  # the raw text does hold the sequence
        real = self.mod.download
        self.mod.download = lambda url: real(url, context=self.listener.client_side)
        out = io.StringIO()
        code = self.mod.main(
            ["prices", "--from", self.listener.url("/reason")], ask=lambda q: "y", tty=lambda: True, out=out
        )
        self.assertEqual(code, 1)
        text = out.getvalue()
        self.assertIn("download failed: HTTP Error 404: Not[2J[31m Found1m", text)
        for char in text:
            self.assertTrue(char == "\n" or 0x20 <= ord(char) < 0x7F, repr(char))
        self.assertFalse(os.path.exists(os.path.join(self.config, "bobby-statusline.json")))

    def test_whole_run_from_the_listener_writes_after_two_yes(self):
        real = self.mod.download
        self.mod.download = lambda url: real(url, context=self.listener.client_side)
        asked, out = [], io.StringIO()

        def ask(question):
            asked.append(question)
            return "y"

        code = self.mod.main(["prices", "--from", self.listener.url("/list.json")], ask=ask, tty=lambda: True, out=out)
        self.assertEqual(code, 0, out.getvalue())
        self.assertEqual(len(asked), 2)
        self.assertEqual(len(self.listener.requests), 1)
        with open(os.path.join(self.config, "bobby-statusline.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["prices"]["claude-opus-5-5"]["input"], 3.0)


class TestSlashCommand(unittest.TestCase):
    """The install command is a prompt, so what is testable is its contract."""

    def setUp(self):
        # Markdown with frontmatter, because Claude Code's loader globs
        # commands/ for .md and silently ignores every other extension. This
        # file shipped as .toml once, and the command simply never registered.
        path = os.path.join(ROOT, "commands", "install.md")
        self.assertTrue(os.path.isfile(path), "the command must be a .md file to load")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        _, frontmatter, body = text.split("---\n", 2)
        self.command = {
            "description": frontmatter.split("description:", 1)[1].strip(),
            "prompt": body,
        }

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
        # The fixtures never reach the ledger, so the estimate has its own line.
        self.assertRegex(result.stdout, r"estimate scan +runs=\d+ +median=")
        self.assertRegex(result.stdout, r"estimate idle +runs=20 +median=")
        self.assertIn("p95", result.stdout)
        self.assertIn(result.returncode, (0, 1))

    def test_selftest_writes_nothing_to_the_real_limit_guard_state(self):
        """With the real gate wired in, every selftest render runs the capture,
        which writes a cache and can lift a pause. That must land in a
        throwaway directory, not in the one LIMIT_GUARD_HOME names."""
        gate = os.path.join(
            os.path.dirname(ROOT), "limit-guard", "hooks", "limit-guard-gate.py"
        )
        if not os.path.isfile(gate):
            self.skipTest("sibling limit-guard checkout not present")
        with tempfile.TemporaryDirectory() as home:
            env = dict(
                os.environ,
                NO_COLOR="1",
                COLUMNS="200",
                TZ="UTC",
                CLAUDE_CONFIG_DIR=self.tmp.name,
                LIMIT_GUARD_HOME=home,
                BOBBY_STATUSLINE_LIMIT_GUARD=gate,
            )
            result = subprocess.run(
                [sys.executable, SCRIPT, "--selftest"],
                capture_output=True, text=True, env=env,
            )
            self.assertIn("end to end", result.stdout)
            self.assertIn("temporary, removed on exit", result.stdout)
            self.assertEqual(os.listdir(home), [])
            self.assertEqual(os.listdir(self.tmp.name), [])


if __name__ == "__main__":
    unittest.main()
