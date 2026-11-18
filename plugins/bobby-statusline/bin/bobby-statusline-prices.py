#!/usr/bin/env python3
"""bobby-statusline-prices — optional, manual update of the price overrides.

The status line never runs this file and never imports it. A person runs it
from a terminal, on purpose, when the built-in price table is out of date:

  bobby-statusline-prices.py --from <https URL or local file> [--dry-run]

It reads a price list, shows which prices differ from the ones the status line
uses now, and writes the rows that differ into the `prices` key of
bobby-statusline.json. Nothing else in that file changes.

Rules this file keeps:
  * No built-in address. The source is what the user typed after --from.
  * A terminal is required. With stdin or stdout redirected it does nothing.
    There is no flag and no environment variable that answers the questions.
  * Two questions, both with No as the default: before the download, and
    before the write. A local file has no download, so it has one question.
  * The download is one GET request over TLS. No cookie, no credentials, and
    nothing about the machine, the user or the session is sent.
  * Python standard library only.

Two price list formats are read:
  * The LiteLLM price file: an object of model id -> object with
    `input_cost_per_token`, `output_cost_per_token`,
    `cache_read_input_token_cost`, `cache_creation_input_token_cost` and
    `cache_creation_input_token_cost_above_1hr`, in USD per token.
  * The row shape of Claude Code's `modelPricing` setting: model id -> object
    with `input`, `output`, `cacheRead`, `cacheWrite`, in USD per million
    tokens, alone or under a `modelPricing` key.

Only rows whose model id starts with `claude-` are kept. A row with a provider
prefix is not taken: add such a row to `prices` by hand.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import stat
import sys
from urllib.parse import urlsplit

TIMEOUT_S = 15
SIZE_CAP = 20 * 1024 * 1024
USER_AGENT = "price-list-fetch"
ACCEPT = "application/json"
SCHEME = "https"

MODEL_KEY = re.compile(r"claude-[a-z0-9][a-z0-9._:@\[\]-]{0,100}")
FIELDS = ("input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h")
LABELS = ("input", "output", "cache read", "write 5m", "write 1h")

USAGE = """\
usage: bobby-statusline-prices.py --from <https URL or local file> [--dry-run]

Optional and manual. Reads a price list, shows old price -> new price for each
Claude model, and writes the rows that differ into the `prices` key of
bobby-statusline.json. It asks before a download and again before the write.
--dry-run shows the table and writes nothing.
"""


class Refused(Exception):
    """A reason to stop that is shown to the user as one line."""


# --------------------------------------------------------------------------
# The status line script: one source for the paths, the table and the checks
# --------------------------------------------------------------------------


def load_render():
    """The status line script, loaded as a module. It is read, never started."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bobby-statusline.py")
    spec = importlib.util.spec_from_file_location("_bobby_statusline", path)
    if spec is None or spec.loader is None:
        raise Refused("cannot load %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------------------
# Source: a local file, or a download the user confirmed
# --------------------------------------------------------------------------


def is_url(source: str) -> bool:
    return re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:/", source) is not None


def checked_url(source: str) -> tuple:
    """(url, host) for an address this script may fetch, or Refused."""
    parts = urlsplit(source)
    if parts.scheme.lower() != SCHEME:
        raise Refused("refused: only %s addresses are fetched, not %s" % (SCHEME, parts.scheme or "?"))
    if not parts.hostname:
        raise Refused("refused: the address has no host")
    if parts.username is not None or parts.password is not None:
        raise Refused("refused: an address with a user name or a password is not fetched")
    return source, parts.hostname


def read_local(path: str) -> bytes:
    try:
        info = os.stat(path)
        if not stat.S_ISREG(info.st_mode):
            raise Refused("refused: %s is not a regular file" % path)
        if info.st_size > SIZE_CAP:
            raise Refused("refused: %s is larger than %d MB" % (path, SIZE_CAP >> 20))
        with open(path, "rb") as fh:
            return fh.read(SIZE_CAP + 1)
    except OSError as err:
        raise Refused("cannot read %s: %s" % (path, err.strerror or err))


def redirect_handler():
    """A redirect handler that follows a redirect only to a TLS address."""
    import urllib.error
    import urllib.request

    class TlsOnly(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if urlsplit(newurl).scheme.lower() != SCHEME:
                raise urllib.error.HTTPError(
                    req.full_url, code, "redirect to an address that is not %s" % SCHEME, headers, fp
                )
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    return TlsOnly()


def download(url: str) -> bytes:
    """One GET request. The body, at most SIZE_CAP bytes, or Refused."""
    import urllib.error
    import urllib.request

    opener = urllib.request.build_opener(redirect_handler())
    opener.addheaders = [("User-Agent", USER_AGENT), ("Accept", ACCEPT)]
    try:
        with opener.open(url, timeout=TIMEOUT_S) as resp:
            body = resp.read(SIZE_CAP + 1)
    except (urllib.error.URLError, OSError, ValueError) as err:
        raise Refused("download failed: %s" % err)
    if len(body) > SIZE_CAP:
        raise Refused("refused: the download is larger than %d MB" % (SIZE_CAP >> 20))
    return body


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


def _per_million(val):
    """A per-token price as a per-million price, or None."""
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        return None
    return round(val * 1e6, 6) if val == val else None


def litellm_row(raw: dict):
    """A LiteLLM row in the object form of the `prices` key, or None."""
    inp = _per_million(raw.get("input_cost_per_token"))
    out = _per_million(raw.get("output_cost_per_token"))
    if inp is None or out is None:
        return None
    if raw.get("mode") not in (None, "chat"):
        return None
    read = _per_million(raw.get("cache_read_input_token_cost"))
    five = _per_million(raw.get("cache_creation_input_token_cost"))
    hour = _per_million(raw.get("cache_creation_input_token_cost_above_1hr"))
    # A list that leaves a cache price out gets the standard multiple of input.
    return {
        "input": inp,
        "output": out,
        "cacheRead": round(inp * 0.1, 6) if read is None else read,
        "cacheWrite5m": round(inp * 1.25, 6) if five is None else five,
        "cacheWrite1h": round(inp * 2.0, 6) if hour is None else hour,
    }


def parse_prices(body: bytes, render) -> dict:
    """{model id: (5 prices..., tier)} for the Claude rows of a price list."""
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, RecursionError):
        raise Refused("the price list is not JSON")
    if isinstance(data, dict) and isinstance(data.get("modelPricing"), dict):
        data = data["modelPricing"]
    if not isinstance(data, dict):
        raise Refused("the price list is not a JSON object of model id -> prices")

    found = {}
    for key in sorted(k for k in data if isinstance(k, str)):
        raw = data[key]
        name = key.strip().lower()
        if not isinstance(raw, dict) or not MODEL_KEY.fullmatch(name):
            continue
        if "input_cost_per_token" in raw:
            raw = litellm_row(raw)
        row = render.price_row(raw) if raw is not None else None
        if row is None:
            continue  # not a price row, or a number outside the sane range
        model, fast = render.model_name(name)
        if fast:
            continue
        # The plain id wins over a dated form of the same model.
        if model not in found or name == model:
            found[model] = row
    if not found:
        raise Refused("the price list has no usable row for a Claude model")
    return found


# --------------------------------------------------------------------------
# The configuration file
# --------------------------------------------------------------------------


def read_config(path: str) -> dict:
    """The configuration file as an object. Refused when it cannot be kept safe."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return {}
    except OSError as err:
        raise Refused("cannot read %s: %s" % (path, err.strerror or err))
    if not stat.S_ISREG(info.st_mode):
        raise Refused("refused: %s is not a regular file" % path)
    try:
        with open(path, "rb") as fh:
            data = json.loads(fh.read(SIZE_CAP).decode("utf-8"))
    except (OSError, ValueError, RecursionError):
        raise Refused("refused: %s is not valid JSON, so it is left alone" % path)
    if not isinstance(data, dict):
        raise Refused("refused: %s is not a JSON object, so it is left alone" % path)
    return data


def write_config(path: str, data: dict) -> None:
    """Temp file in the same directory, mode 0600, then rename."""
    folder = os.path.dirname(path)
    if not os.path.isdir(folder):
        raise Refused("refused: %s does not exist" % folder)
    tmp = os.path.join(folder, ".%s.%d.tmp" % (os.path.basename(path), os.getpid()))
    body = (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    try:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(tmp, flags, 0o600)
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(body)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except OSError as err:
        raise Refused("cannot write %s: %s" % (path, err.strerror or err))


def as_object(row: tuple) -> dict:
    """A price row in the object form the `prices` key takes."""
    out = dict(zip(FIELDS, row[:5]))
    if row[5]:
        out["above"] = dict(zip(("threshold",) + FIELDS, row[5]))
    return out


# --------------------------------------------------------------------------
# The table
# --------------------------------------------------------------------------


def _num(val) -> str:
    return ("%.6f" % val).rstrip("0").rstrip(".")


def _same(old, new) -> bool:
    return old is not None and all(abs(a - b) < 1e-9 for a, b in zip(old, new))


def changes(found: dict, render, current: dict) -> list:
    """(model, old row or None, new row, note) for every row that differs."""
    out = []
    for model in sorted(found):
        new = found[model]
        hit = render.price_for(model, current)
        old = hit[0] if hit else None
        note = ""
        if new[5] is None and old is not None and old[5]:
            # The list has no long-prompt rates. Dropping them would lower the
            # estimate without a word, so the ones in use stay.
            new, note = new[:5] + (old[5],), "long-prompt rates kept"
        if old is not None and _same(old[:5], new[:5]) and old[5] == new[5]:
            continue
        out.append((model, old, new, note))
    return out


def print_table(rows: list, out) -> None:
    out.write("USD per million tokens, old -> new. '-' means no price today.\n\n")
    for model, old, new, note in rows:
        out.write("%s%s\n" % (model, "  (%s)" % note if note else ""))
        for i, label in enumerate(LABELS):
            before = _num(old[i]) if old else "-"
            mark = "" if old and abs(old[i] - new[i]) < 1e-9 else "   <-"
            out.write("  %-10s %10s -> %-10s%s\n" % (label, before, _num(new[i]), mark))
        if new[5] and not note:
            out.write("  above %d prompt tokens: %s\n" % (new[5][0], " / ".join(_num(p) for p in new[5][1:])))
    out.write("\n")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def confirmed(ask, question: str) -> bool:
    try:
        answer = ask(question + " [y/N] ")
    except (EOFError, KeyboardInterrupt):
        return False
    return isinstance(answer, str) and answer.strip().lower() in ("y", "yes")


def parse_args(argv: list):
    source, dry = None, False
    args = list(argv)
    while args:
        arg = args.pop(0)
        if arg == "--dry-run":
            dry = True
        elif arg == "--from" and args:
            source = args.pop(0)
        elif arg.startswith("--from="):
            source = arg[len("--from="):]
        else:
            return None
    return (source, dry) if source else None


def run(argv: list, ask, out) -> int:
    parsed = parse_args(argv)
    if parsed is None:
        out.write(USAGE)
        return 2
    source, dry = parsed
    render = load_render()

    if is_url(source):
        url, host = checked_url(source)
        out.write(
            "Download a price list.\n"
            "  address : %s\n"
            "  host    : %s\n"
            "  sends   : one GET request with the headers User-Agent: %s and Accept: %s,\n"
            "            plus the headers HTTP itself needs. No cookie, no credentials,\n"
            "            nothing about this machine, this user or a session.\n"
            "  limits  : TLS only, a redirect only to a TLS address, %d s timeout, %d MB.\n"
            "            A proxy from the environment is used when one is set.\n"
            % (url, host, USER_AGENT, ACCEPT, TIMEOUT_S, SIZE_CAP >> 20)
        )
        if not confirmed(ask, "Download from %s?" % host):
            out.write("Nothing downloaded. Nothing written.\n")
            return 1
        body = download(url)
    else:
        body = read_local(source)
        out.write("Read %s (%d bytes). Nothing was downloaded.\n" % (source, len(body)))

    found = parse_prices(body, render)
    path = os.path.join(render.config_home(), render.CONFIG_FILE)
    config = read_config(path)
    stored = config.get("prices") if isinstance(config.get("prices"), dict) else {}
    current = render.price_table(render._user_prices(stored))
    rows = changes(found, render, current)

    out.write("%d Claude models in the list, %d with a price that differs.\n\n" % (len(found), len(rows)))
    if not rows:
        out.write("Nothing to write.\n")
        return 0
    print_table(rows, out)
    if dry:
        out.write("Dry run. Nothing written.\n")
        return 0
    if not confirmed(ask, "Write these %d rows into the prices key of %s?" % (len(rows), path)):
        out.write("Nothing written.\n")
        return 1

    for model, _, new, _ in rows:
        stored[model] = as_object(new)
    config["prices"] = stored
    write_config(path, config)
    out.write("Written: %d rows in %s. The status line uses them from its next render.\n" % (len(rows), path))
    return 0


def main(argv: list, ask=None, tty=None, out=None) -> int:
    out = out or sys.stdout
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        out.write(USAGE)
        return 0
    interactive = tty() if tty else sys.stdin.isatty() and sys.stdout.isatty()
    if not interactive:
        sys.stderr.write(
            "bobby-statusline-prices: this needs a terminal, because it asks before it\n"
            "downloads and before it writes. Nothing was done.\n"
        )
        return 2
    try:
        return run(argv[1:], ask or input, out)
    except Refused as err:
        out.write("%s\nNothing written.\n" % err)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
