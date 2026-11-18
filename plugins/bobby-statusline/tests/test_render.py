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
        self.append(
            self.agent("agent-c3.jsonl", "a", "b", "c"), assistant("msg_6", inp=4000)
        )
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
                good["sub"] = json.load(open(self.sidecar, encoding="utf-8"))["sub"]

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
        os.unlink(self.agent("agent-09.jsonl"))  # a removed transcript was still paid for
        self.assertEqual(self.totals()["sub"]["claude-opus-5-5"]["n"][0], 44)
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
            "anthropic.claude-opus-5-5-v2",
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
            json.dump({"v": 1, "path": self.transcript, "sub": {},
                       "main": {"off": os.path.getsize(self.transcript), "ids": {},
                                "t": {self.HAIKU: {"n": [0, 0, 40000000, 0, 0, 0]}}}}, fh)
        self.assertEqual(self.cost_segment(), "~$2.00")
        with open(self.sidecar, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["v"], 2)


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
        self.append(self.transcript, assistant("msg_1", inp=9 * 10**14))
        os.environ["BOBBY_STATUSLINE_COST_SOURCE"] = "estimate"
        row = self.plain(BS.render(json.dumps(self.payload(model={"display_name": "Opus 5"})), now=NOW))
        self.assertEqual(row, "ctx ?% | $? | cache ? | Opus 5")

    def test_token_total_above_the_sane_bound_shows_no_number(self):
        """Also when the price makes the cost look small."""
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"prices": {"my-model": [0, 0, 0, 0, 0]}}, fh)
        self.append(self.transcript, assistant("msg_1", model="my-model", read=2 * 10**12))
        self.assertEqual(self.cost_segment(), "$?")
        with open(self.transcript, "wb") as fh:
            fh.write(assistant("msg_22", model="my-model", read=5 * 10**11).encode() + b"\n")
        self.assertEqual(self.cost_segment(), "~$0.00")

    def test_cost_above_the_sane_bound_shows_no_number(self):
        self.append(self.transcript, assistant("msg_1", out=6 * 10**9))  # 120,000 USD
        self.assertEqual(self.cost_segment(), "$?")
        with open(self.transcript, "wb") as fh:
            fh.write(assistant("msg_22", out=4 * 10**9).encode() + b"\n")  # 80,000 USD
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
             "message": {"id": "msg\u001b[31m_1‮", "model": "claude-opus\u001b[31m-5-5\u009b‮",
                         "usage": usage(inp=1000000)}},
            separators=(",", ":"),
        )
        self.append(self.transcript, line)
        row = self.cost_segment()
        with open(self.sidecar, encoding="utf-8") as fh:
            text = fh.read()
        for bad in ("\u001b", "\\u001b", "‮", "\\u202e", "\u009b", "\\u009b"):
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


AUDIT_DRIVER = r"""
import io, json, runpy, sys
script, payloads = sys.argv[1], json.loads(sys.stdin.read())
events, rows = [], []
CALLS = ("socket.", "subprocess.", "os.system", "os.exec", "os.posix_spawn", "os.fork",
         "os.spawn", "urllib.", "http.", "ftplib.", "smtplib.", "pty.")
MODULES = {"socket", "_socket", "ssl", "_ssl", "subprocess", "_posixsubprocess", "asyncio",
           "urllib", "http", "ctypes", "multiprocessing"}
def hook(name, args):
    if name.startswith(CALLS):
        events.append(name)
    elif name == "import" and args and str(args[0]).split(".")[0] in MODULES:
        events.append("import " + str(args[0]))
sys.addaudithook(hook)
real = sys.stdout
for payload in payloads:
    sys.stdin, sys.stdout, sys.argv = io.StringIO(payload), io.StringIO(), [script]
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit:
        pass
    rows.append(sys.stdout.getvalue())
    sys.stdout = real
print(json.dumps({"events": events, "rows": rows}))
"""


class TestNoEgress(LedgerBase):
    """The status line opens no connection and a render starts no process.

    Two proofs. The static one is an allow-list: the script may import the
    modules named here and no other. The runtime one renders every fixture, and
    an estimate, under a Python audit hook that records every socket and
    process event.
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
    DYNAMIC = ("__import__", "import_module", "eval", "exec", "compile", "run_path", "run_module")

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

    def callers_of(self, name):
        return sorted(
            fn.name for fn in self.functions()
            if any(isinstance(n, self.ast.Name) and n.id == name for n in self.ast.walk(fn))
        )

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

    def test_no_import_by_a_computed_name(self):
        for node in self.ast.walk(self.tree):
            if isinstance(node, self.ast.Call):
                name = getattr(node.func, "id", getattr(node.func, "attr", ""))
                # re.compile is the one `compile` that is an attribute.
                if not (name == "compile" and isinstance(node.func, self.ast.Attribute)):
                    self.assertNotIn(name, self.DYNAMIC)
                if name == "getattr":
                    # getattr(os, "O_NOFOLLOW", 0) is the only use: an open flag.
                    arg = node.args[1]
                    self.assertIsInstance(arg, self.ast.Constant)
                    self.assertTrue(str(arg.value).startswith("O_"), arg.value)
            if isinstance(node, self.ast.Name):
                self.assertNotIn(node.id, ("__builtins__", "__loader__", "__spec__"))

    def test_process_modules_are_reached_from_the_selftest_only(self):
        self.assertEqual(self.callers_of("_measure"), ["run_selftest"])
        self.assertEqual(self.callers_of("_measure_estimate"), ["_measure"])
        self.assertEqual(self.callers_of("run_selftest"), ["main"])
        self.assertEqual(self.callers_of("run_demo"), ["main"])

    def test_no_process_is_started_through_os(self):
        for node in self.ast.walk(self.tree):
            if isinstance(node, self.ast.Attribute):
                self.assertIsNone(self.OS_CALLS.match(node.attr), node.attr)

    def test_no_address_in_a_string(self):
        for node in self.ast.walk(self.tree):
            if isinstance(node, self.ast.Constant) and isinstance(node.value, str):
                self.assertIsNone(re.search(r"[a-z][a-z0-9+.-]*://", node.value), node.value[:60])

    def test_the_price_script_is_unknown_to_the_status_line(self):
        self.assertTrue(os.path.isfile(PRICES_SCRIPT))
        for word in ("bobby-statusline-prices", "prices.py", "statusline_prices"):
            self.assertNotIn(word, self.source)

    # -- runtime ----------------------------------------------------------------

    def audit(self, script: str, payloads: list, **env) -> dict:
        environ = dict(os.environ)
        environ.update(env)
        result = subprocess.run(
            [sys.executable, "-c", AUDIT_DRIVER, script], input=json.dumps(payloads),
            capture_output=True, text=True, env=environ, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_audit_hook_sees_a_socket_and_a_process(self):
        """The control: a hook that sees nothing would also report zero events."""
        probe = os.path.join(self.config, "probe.py")
        with open(probe, "w", encoding="utf-8") as fh:
            fh.write(
                "import socket, subprocess, sys\n"
                "socket.socket().close()\n"
                "subprocess.run([sys.executable, '-c', 'pass'])\n"
            )
        events = self.audit(probe, ["{}"])["events"]
        self.assertTrue(any(e.startswith("socket.") for e in events), events)
        self.assertTrue(any(e.startswith("subprocess.") for e in events), events)
        self.assertIn("import socket", events)

    def test_render_of_every_fixture_makes_no_socket_and_no_process(self):
        payloads = [read_fixture(n) for n in sorted(os.listdir(FIXTURES)) if n.endswith(".json")]
        self.assertGreaterEqual(len(payloads), 8)
        for billing in ("auto", "both"):
            for source in ("auto", "payload", "estimate"):
                with self.subTest(billing=billing, source=source):
                    seen = self.audit(
                        SCRIPT, payloads,
                        BOBBY_STATUSLINE_BILLING=billing, BOBBY_STATUSLINE_COST_SOURCE=source,
                    )
                    self.assertEqual(seen["events"], [])
                    self.assertEqual(len(seen["rows"]), len(payloads))
                    self.assertTrue(any("ctx 132k/1M" in row for row in seen["rows"]))

    def test_estimate_with_transcripts_makes_no_socket_and_no_process(self):
        self.append(self.transcript, assistant("msg_1", inp=100000, out=40000))
        self.append(self.agent(), assistant("msg_2", inp=100000))
        payload = json.dumps(self.payload())
        seen = self.audit(SCRIPT, [payload, payload], BOBBY_STATUSLINE_COST_SOURCE="estimate")
        self.assertEqual(seen["events"], [])
        self.assertIn("~$1.60 (sub $0.40)", seen["rows"][0])
        self.assertIn("~$1.60 (sub $0.40)", seen["rows"][1])
        self.assertTrue(os.path.isfile(self.sidecar))

    def test_render_with_a_limit_guard_gate_makes_no_socket_and_no_process(self):
        gate = os.path.join(os.path.dirname(ROOT), "limit-guard", "hooks", "limit-guard-gate.py")
        if not os.path.isfile(gate):
            self.skipTest("sibling limit-guard checkout not present")
        seen = self.audit(
            SCRIPT, [read_fixture("full.json")],
            BOBBY_STATUSLINE_LIMIT_GUARD=gate,
            LIMIT_GUARD_HOME=os.path.join(self.config, "limit-guard-state"),
        )
        self.assertEqual(seen["events"], [])
        self.assertIn("ctx 132k/1M", seen["rows"][0])
        self.assertTrue(os.listdir(os.path.join(self.config, "limit-guard-state")), "the gate ran")


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
        self.assertNotIn("os.environ", source)
        self.assertNotIn("getenv", source)

    def test_through_a_real_terminal(self):
        try:
            import pty
            import select
        except ImportError:
            self.skipTest("no pty on this platform")
        for answer, code, written in ((b"n\n", 1, False), (b"y\n", 0, True)):
            with self.subTest(answer=answer):
                master, slave = pty.openpty()
                proc = subprocess.Popen(
                    [sys.executable, PRICES_SCRIPT, "--from", self.source],
                    stdin=slave, stdout=slave, stderr=slave, close_fds=True,
                )
                os.close(slave)
                os.write(master, answer)
                seen = b""
                deadline = time.time() + 30
                while time.time() < deadline:
                    ready, _, _ = select.select([master], [], [], 0.2)
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
                proc.wait(timeout=30)
                os.close(master)
                self.assertEqual(proc.returncode, code, seen.decode("utf-8", "replace"))
                self.assertIn(b"[y/N]", seen)
                self.assertEqual(os.path.exists(self.config_file), written)
                if written:
                    os.unlink(self.config_file)

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

    def test_redirect_to_plain_http_is_refused(self):
        import urllib.error
        import urllib.request

        handler = self.mod.redirect_handler()
        req = urllib.request.Request("https://prices.example/list.json")
        with self.assertRaises(urllib.error.HTTPError):
            handler.redirect_request(req, None, 302, "Found", {}, "http://prices.example/list.json")
        with self.assertRaises(urllib.error.HTTPError):
            handler.redirect_request(req, None, 302, "Found", {}, "ftp://prices.example/list.json")
        new = handler.redirect_request(req, None, 302, "Found", {}, "https://other.example/list.json")
        self.assertEqual(new.full_url, "https://other.example/list.json")

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
            top, {"__future__", "importlib.util", "json", "os", "re", "stat", "sys", "urllib.parse"}
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
            {"download": {"urllib.error", "urllib.request"},
             "redirect_handler": {"urllib.error", "urllib.request"}},
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

    def test_install_command_does_not_run_it(self):
        with open(os.path.join(ROOT, "commands", "install.md"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("bobby-statusline-prices.py", text)
        self.assertIn("Do not run it", text)


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
        self.assertRegex(result.stdout, r"estimate +files=4 .* ok\n")
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
