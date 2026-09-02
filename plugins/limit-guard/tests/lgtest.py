"""Shared harness for the limit-guard tests.

Every test runs against a throwaway HOME/CLAUDE_CONFIG_DIR so nothing real is
ever read or written.
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

PLUGIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE_PATH = os.path.join(PLUGIN, "hooks", "limit-guard-gate.py")
STATUSLINE_PATH = os.path.join(PLUGIN, "hooks", "limit-guard-statusline.sh")
CLI_PATH = os.path.join(PLUGIN, "bin", "limit-guard")


def load_gate():
    spec = importlib.util.spec_from_file_location("limit_guard_gate", GATE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = load_gate()

NOW = 1_700_000_000.0


def cache(**windows):
    """Build a cache dict: cache(five_hour=(97, NOW + 600))."""
    limits = {}
    for name, (pct, resets) in windows.items():
        limits[name] = {"used_percentage": pct, "resets_at": resets}
    return {"captured_at": NOW, "rate_limits": limits}


def state(**kw):
    st = dict(gate.EMPTY_STATE)
    st.update(kw)
    return st


def config(**kw):
    cfg = dict(gate.DEFAULTS)
    cfg.update(kw)
    return cfg


class TempHome(unittest.TestCase):
    """Redirects HOME and CLAUDE_CONFIG_DIR at a temp dir for every test."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="limit-guard-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, "home")
        self.cfgdir = os.path.join(self.home, ".claude")
        self.statedir = os.path.join(self.cfgdir, "limit-guard")
        os.makedirs(self.statedir, mode=0o700)
        self.env = dict(os.environ)
        self.env.update(
            {
                "HOME": self.home,
                "CLAUDE_CONFIG_DIR": self.cfgdir,
                "LIMIT_GUARD_HOME": self.statedir,
                "NO_COLOR": "1",
            }
        )
        for key in list(self.env):
            if key.startswith("LIMIT_GUARD_") and key != "LIMIT_GUARD_HOME":
                del self.env[key]
        self._saved = dict(os.environ)
        os.environ.clear()
        os.environ.update(self.env)
        self.addCleanup(self._restore)

    def _restore(self):
        os.environ.clear()
        os.environ.update(self._saved)

    # --- helpers -----------------------------------------------------------

    def p(self, name):
        return os.path.join(self.statedir, name)

    def write(self, name, obj, raw=None):
        with open(self.p(name), "w", encoding="utf-8") as fh:
            fh.write(raw if raw is not None else json.dumps(obj))

    def read(self, name):
        with open(self.p(name), "r", encoding="utf-8") as fh:
            return fh.read()

    def run_gate(self, payload, args=(), env=None):
        """Run the gate as a real subprocess and return (rc, stdout, stderr)."""
        proc = subprocess.run(
            [sys.executable, GATE_PATH, *args],
            input=json.dumps(payload) if not isinstance(payload, str) else payload,
            capture_output=True,
            text=True,
            env={**self.env, **(env or {})},
            timeout=30,
        )
        return proc.returncode, proc.stdout, proc.stderr

    def decision(self, payload, env=None):
        """Run the gate and return the parsed decision, or None for allow."""
        rc, out, err = self.run_gate(payload, env=env)
        self.assertEqual(rc, 0, "gate must always exit 0; stderr=%s" % err)
        if not out.strip():
            return None
        return json.loads(out)

    def paused_now(self, **kw):
        """Write a state file that is paused far into the future."""
        st = dict(gate.EMPTY_STATE)
        st.update({"paused": True, "since": 1, "until": 2**40, "window": "five_hour"})
        st.update(kw)
        self.write("state.json", st)

    def hot_cache(self, pct=99.0):
        """Write a fresh cache well above the pause threshold."""
        self.write(
            "rate_limits.json",
            {
                "captured_at": int(time.time()),
                "rate_limits": {
                    "five_hour": {"used_percentage": pct, "resets_at": time.time() + 3600}
                },
            },
        )

    def run_statusline(self, stdin_text, env=None, timeout=30):
        """Chaining defaults to LIMIT_GUARD_INNER=none here so a test that does
        not care cannot depend on the wrapper's own default. Pass None as a
        value to UNSET a variable — which is how the default is tested."""
        merged = {**self.env, "LIMIT_GUARD_INNER": "none", **(env or {})}
        proc = subprocess.run(
            ["bash", STATUSLINE_PATH],
            input=stdin_text,
            capture_output=True,
            text=True,
            env={k: v for k, v in merged.items() if v is not None},
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr

    def run_cli(self, *args, env=None):
        proc = subprocess.run(
            ["bash", CLI_PATH, *args],
            capture_output=True,
            text=True,
            env={**self.env, **(env or {})},
            timeout=30,
        )
        return proc.returncode, proc.stdout, proc.stderr
