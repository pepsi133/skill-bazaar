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


def usage(inp=0, out=0, read=0, w5=0, w1=0, search=0, speed="standard", detail=True):
    val = {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_input_tokens": read,
        "cache_creation_input_tokens": w5 + w1,
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
        quoted = json.dumps(
            {
                "type": "user",
                "note": '"type":"assistant"',
                "toolUseResult": {"usage": usage(inp=999999, out=999999)},
                "message": {"id": "msg_9", "model": "claude-opus-5-5",
                            "usage": usage(inp=999999)},
            },
            separators=(",", ":"),
        )
        self.append(self.transcript, quoted, assistant("msg_1", inp=5))
        self.assertEqual(self.totals()["main"]["claude-opus-5-5"]["n"][0], 5)

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

    def test_zero_budget_marks_the_result_partial(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        BS.LEDGER_BUDGET_MS = 0
        self.assertTrue(self.totals()["partial"])
        self.assertEqual(self.cost_segment(), "~$0.00+")
        BS.LEDGER_BUDGET_MS = 5000.0
        self.assertEqual(self.cost_segment(), "~$4.00")

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

    def test_id_map_keeps_sixteen_and_drops_when_the_file_is_idle(self):
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
            self.assertEqual(json.load(fh)["main"]["ids"], {})

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

    def test_unwritable_sidecar_directory_still_renders(self):
        self.append(self.transcript, assistant("msg_1", inp=1000000))
        with open(os.path.join(self.config, "bobby-statusline"), "w") as fh:
            fh.write("a file where the directory should be")
        self.assertEqual(self.cost_segment(), "~$4.00")


class TestPrices(LedgerBase):
    def cost(self, model, user=None, speed="n", tup=(1000000, 1000000, 1000000, 1000000, 1000000, 0)):
        return BS.ledger_cost({model: {speed: list(tup)}}, BS.price_table(user))

    def test_list_price_with_derived_cache_writes(self):
        # 4 + 20 + 0.20 + 1.25 * 4 + 2 * 4
        usd, unknown = self.cost("claude-opus-5-5")
        self.assertAlmostEqual(usd, 37.2)
        self.assertFalse(unknown)

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

    def test_longest_prefix_wins(self):
        self.assertAlmostEqual(self.cost("claude-opus-5-5-20260101")[0], 37.2)
        # 5 + 25 + 0.50 + 6.25 + 10
        self.assertAlmostEqual(self.cost("claude-opus-5-20260101")[0], 46.75)
        self.assertAlmostEqual(self.cost("claude-fable-5-2")[0], 8 + 40 + 0.2 + 10 + 16)
        self.assertAlmostEqual(self.cost("claude-fable-5")[0], 10 + 50 + 1 + 12.5 + 20)

    def test_user_price_wins_over_the_list(self):
        user = BS._user_prices({"claude-opus-5-5": [1, 2, 3, 4, 5], "my-model": [1, 1, 1, 1, 1]})
        self.assertAlmostEqual(self.cost("claude-opus-5-5", user)[0], 15)
        self.assertAlmostEqual(self.cost("my-model-large", user)[0], 5)
        self.assertAlmostEqual(self.cost("claude-opus-5", user)[0], 46.75)

    def test_malformed_user_prices_are_ignored(self):
        user = BS._user_prices(
            {
                "claude-opus-5-5": [1, 2, 3],
                "claude-opus-5": "cheap",
                "claude-sonnet-5": [1, 2, 3, 4, "5"],
                "claude-haiku-5-5": [1, 2, 3, 4, -5],
                "claude-haiku-4-5": [True, 2, 3, 4, 5],
                "": [1, 2, 3, 4, 5],
                "ok": [1, 2, 3, 4, 5],
            }
        )
        self.assertEqual(user, {"ok": [1.0, 2.0, 3.0, 4.0, 5.0]})

    def test_unknown_model_counts_as_zero_and_is_marked(self):
        self.assertEqual(self.cost("some-other-model"), (0.0, True))

    def test_model_without_tokens_is_ignored(self):
        self.assertEqual(self.cost("<synthetic>", tup=(0, 0, 0, 0, 0, 0)), (0.0, False))

    def test_fast_speed_doubles_the_token_prices(self):
        self.assertAlmostEqual(self.cost("claude-opus-5-5", speed="f")[0], 74.4)

    def test_web_search_is_a_cent_per_request_at_any_speed(self):
        for speed in ("n", "f"):
            usd, _ = self.cost("claude-opus-5-5", speed=speed, tup=(0, 0, 0, 0, 0, 3))
            self.assertAlmostEqual(usd, 0.03)

    def test_prices_from_the_config_file_reach_the_row(self):
        self.append(self.transcript, assistant("msg_1", model="my-model", inp=1000000))
        self.assertEqual(self.cost_segment(), "~$0.00?")
        with open(os.path.join(self.config, "bobby-statusline.json"), "w") as fh:
            json.dump({"prices": {"my-model": [3, 0, 0, 0, 0], "bad": [1]}}, fh)
        self.assertEqual(self.cost_segment(), "~$3.00")


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
        self.append(self.transcript, assistant("msg_4", inp=100000))
        self.assertEqual(self.cost_segment(), "~$1.60+? (sub $0.40)")

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


class TestNoEgress(unittest.TestCase):
    """The script opens no connection and a render forks no process."""

    NETWORK = {
        "socket", "socketserver", "ssl", "urllib", "http", "ftplib", "smtplib", "poplib",
        "imaplib", "telnetlib", "xmlrpc", "asyncio", "requests", "httpx", "aiohttp",
        "urllib3", "websockets",
    }
    PROCESS = {"subprocess", "multiprocessing", "pty", "pexpect"}
    OS_CALLS = re.compile(r"^(system|popen|fork|forkpty|exec[lv]p?e?|spawn[lv]p?e?|posix_spawnp?)$")

    @classmethod
    def setUpClass(cls):
        import ast

        cls.ast = ast
        with open(SCRIPT, encoding="utf-8") as fh:
            cls.tree = ast.parse(fh.read())

    def imports(self, node):
        """(root module, node) for every import below `node`."""
        for item in self.ast.walk(node):
            if isinstance(item, self.ast.Import):
                for alias in item.names:
                    yield alias.name.split(".")[0], item
            elif isinstance(item, self.ast.ImportFrom):
                yield (item.module or "").split(".")[0], item

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

    def test_no_network_module_is_imported(self):
        found = sorted({root for root, _ in self.imports(self.tree) if root in self.NETWORK})
        self.assertEqual(found, [])

    def test_no_dynamic_import_by_name(self):
        for node in self.ast.walk(self.tree):
            if isinstance(node, self.ast.Call):
                name = getattr(node.func, "id", getattr(node.func, "attr", ""))
                self.assertNotIn(name, ("__import__", "import_module", "eval", "exec"))

    def test_subprocess_is_imported_only_by_the_selftest(self):
        top = [
            root for stmt in self.tree.body
            if isinstance(stmt, (self.ast.Import, self.ast.ImportFrom))
            for root, _ in self.imports(stmt)
        ]
        self.assertEqual([m for m in top if m in self.PROCESS], [])
        holders = sorted(
            fn.name for fn in self.functions()
            if any(root in self.PROCESS for root, _ in self.imports(fn))
        )
        self.assertEqual(holders, ["_measure"])
        # The selftest is reached from the command line only, never from a render.
        self.assertEqual(self.callers_of("_measure"), ["run_selftest"])
        self.assertEqual(self.callers_of("run_selftest"), ["main"])

    def test_no_process_is_started_through_os(self):
        for node in self.ast.walk(self.tree):
            if isinstance(node, self.ast.Attribute):
                self.assertIsNone(self.OS_CALLS.match(node.attr), node.attr)

    def test_no_url_outside_comments_and_docstrings(self):
        for node in self.ast.walk(self.tree):
            if isinstance(node, self.ast.Constant) and isinstance(node.value, str):
                self.assertIsNone(re.search(r"[a-z][a-z0-9+.-]*://", node.value), node.value[:60])


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
