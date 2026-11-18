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
  * A terminal is required. With stdin, stdout or stderr redirected it does
    nothing. There is no flag and no environment variable that answers the
    questions. A terminal is not proof of a person: another program can make
    one. The check keeps the script out of pipelines; it is for a manual run.
  * Two questions, both with No as the default: before the download, and
    before the write. A local file has no download, so it has one question.
  * The download is one GET request over TLS. No cookie, no credentials, and
    nothing about the machine, the user or the session is sent. A redirect is
    followed only to the same host and port. The whole download has 30 seconds.
  * Every string that comes from the server or from a file is stripped of
    control characters before it is printed.
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

TIMEOUT_S = 15  # one connect or one read
TOTAL_S = 30  # the whole download, wall clock
SIZE_CAP = 20 * 1024 * 1024
TLS_PORT = 443
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


class TimeUp(Exception):
    """The whole download took longer than TOTAL_S."""


# C0, DEL and C1, the direction marks, overrides and isolates, and the line
# separators: the same set the status line strips, as numbers, so that this
# file holds none of those characters itself.
UNPRINTABLE = (
    (0x00, 0x1F), (0x7F, 0x9F), (0x061C, 0x061C), (0x200E, 0x200F), (0x2028, 0x202E), (0x2066, 0x2069),
)


def clean(text, cap: int = 400) -> str:
    """A string that is safe to print: no control characters, and not endless.

    A server chooses its own error text, and a file holds what its writer put
    there. Neither may move the cursor, clear the screen or reorder the line.
    """
    text = text if isinstance(text, str) else str(text)
    kept = "".join(c for c in text if not any(low <= ord(c) <= high for low, high in UNPRINTABLE))
    return kept[:cap]


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


def host_port(url: str) -> tuple:
    """(host, port) of an address, lower case, with the TLS port when none is given."""
    parts = urlsplit(url)
    return (parts.hostname or "").lower(), parts.port or TLS_PORT


def checked_url(source: str) -> tuple:
    """(url, host) for an address this script may fetch, or Refused."""
    if source != clean(source, len(source)) or any(c.isspace() for c in source):
        raise Refused("refused: the address has a space or a control character in it")
    try:
        parts = urlsplit(source)
        host, _ = host_port(source)
    except ValueError:
        raise Refused("refused: the address cannot be read")
    if parts.scheme.lower() != SCHEME:
        raise Refused("refused: only %s addresses are fetched, not %s" % (SCHEME, parts.scheme or "?"))
    if not host:
        raise Refused("refused: the address has no host")
    if parts.username is not None or parts.password is not None:
        raise Refused("refused: an address with a user name or a password is not fetched")
    return source, host


def read_local(path: str) -> bytes:
    try:
        info = os.stat(path)
        if not stat.S_ISREG(info.st_mode):
            raise Refused("refused: %s is not a regular file" % path)
        if info.st_size > SIZE_CAP:
            raise Refused("refused: %s is larger than %d MB" % (path, SIZE_CAP >> 20))
        with open(path, "rb") as fh:
            body = fh.read(SIZE_CAP + 1)
    except OSError as err:
        raise Refused("cannot read %s: %s" % (path, err.strerror or err))
    if len(body) > SIZE_CAP:
        raise Refused("refused: %s is larger than %d MB" % (path, SIZE_CAP >> 20))
    return body


def redirect_handler(url: str):
    """A redirect handler that stays with the host the user confirmed.

    The question before the download names one host. A redirect to another
    host, another port or another scheme goes somewhere nobody was asked
    about, so it is refused, and the message names both.
    """
    import urllib.error
    import urllib.request

    confirmed = host_port(url)

    class SameHost(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            try:
                parts = urlsplit(newurl)
                scheme, target = parts.scheme.lower(), host_port(newurl)
                named = parts.username is not None or parts.password is not None
            except ValueError:
                scheme, target, named = "", ("?", 0), False
            if named:
                reason = "redirect to an address with a user name or a password refused"
                raise urllib.error.HTTPError(req.full_url, code, reason, headers, fp)
            if scheme != SCHEME or target != confirmed:
                reason = "redirect from %s:%d to %s:%d (%s) refused" % (confirmed + target + (scheme or "?",))
                raise urllib.error.HTTPError(req.full_url, code, reason, headers, fp)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    return SameHost()


def wall_clock(seconds: float):
    """Start the limit for the whole download. Returns the function that ends it.

    A timeout on the connection limits one connect and one read. A server that
    answers one byte at a time never reaches it. The alarm limits the sum,
    where the platform has one; the read loop checks the clock in any case.
    """
    import signal
    import threading

    if not hasattr(signal, "setitimer") or threading.current_thread() is not threading.main_thread():
        return lambda: None

    def time_up(signum, frame):
        raise TimeUp()

    before = signal.signal(signal.SIGALRM, time_up)
    signal.setitimer(signal.ITIMER_REAL, seconds)

    def stop():
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, before)

    return stop


def download(url: str, context=None) -> bytes:
    """One GET request. The body, at most SIZE_CAP bytes, or Refused.

    `context` is an ssl context for a test against a local listener. The
    command line never sets it, so the system's certificate store decides.
    """
    import http.client
    import time
    import urllib.error
    import urllib.request

    handlers = [redirect_handler(url)]
    if context is not None:
        handlers.append(urllib.request.HTTPSHandler(context=context))
    opener = urllib.request.build_opener(*handlers)
    opener.addheaders = [("User-Agent", USER_AGENT), ("Accept", ACCEPT)]
    late = "refused: the download took longer than %d s" % TOTAL_S
    deadline = time.monotonic() + TOTAL_S
    stop = wall_clock(TOTAL_S)
    try:
        chunks, size = [], 0
        with opener.open(url, timeout=TIMEOUT_S) as resp:
            while True:
                if time.monotonic() > deadline:
                    raise Refused(late)
                chunk = resp.read1(65536)
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > SIZE_CAP:
                    raise Refused("refused: the download is larger than %d MB" % (SIZE_CAP >> 20))
    except TimeUp:
        raise Refused(late)
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as err:
        if isinstance(err, urllib.error.HTTPError):
            err.close()  # the reply of the server is not read
        raise Refused("download failed: %s" % err)
    finally:
        stop()
    return b"".join(chunks)


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


def _per_million(val):
    """A per-token price as a per-million price, or None."""
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        return None
    try:
        return round(val * 1e6, 6) if val == val else None
    except OverflowError:  # an integer of hundreds of digits
        return None


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
        data = json.loads(body.decode("utf-8-sig"))  # a byte order mark is accepted
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
    if not os.access(path, os.W_OK):
        # A rename would replace it all the same. Somebody took the write
        # permission away, and that is a decision this script does not undo.
        raise Refused("refused: %s is read-only, so it is left alone" % path)
    try:
        with open(path, "rb") as fh:
            data = json.loads(fh.read(SIZE_CAP).decode("utf-8-sig"))  # with or without a byte order mark
    except (OSError, ValueError, RecursionError):
        raise Refused("refused: %s is not valid JSON, so it is left alone" % path)
    if not isinstance(data, dict):
        raise Refused("refused: %s is not a JSON object, so it is left alone" % path)
    if "prices" in data and not isinstance(data["prices"], dict):
        raise Refused(
            "refused: the prices key of %s is not an object. Correct it or remove it first" % path
        )
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
        # O_EXCL and O_NOFOLLOW: a name that appears after the unlink, a symlink
        # included, makes the open fail. It is never written through.
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


def same_model_keys(stored: dict, rows: list, render) -> list:
    """Keys in the stored prices that name a model of a new row in another way.

    The new row is written under the plain id. An older key for the same
    model, such as a dated one, would still win for the id it is equal to, so
    the old price would stay in use for that id. Such a key is removed in the
    same write.
    """
    models = {row[0] for row in rows}
    doubles = []
    for key in sorted(k for k in stored if isinstance(k, str)):
        name, fast = render.model_name(key)
        if not fast and name in models and key.strip().lower() != name:
            doubles.append((key, name))
    return doubles


def print_table(rows: list, doubles: list, out) -> None:
    out.write("USD per million tokens, old -> new. '-' means no price today.\n\n")
    for model, old, new, note in rows:
        out.write("%s%s\n" % (clean(model), "  (%s)" % note if note else ""))
        for i, label in enumerate(LABELS):
            before = _num(old[i]) if old else "-"
            mark = "" if old and abs(old[i] - new[i]) < 1e-9 else "   <-"
            out.write("  %-10s %10s -> %-10s%s\n" % (label, before, _num(new[i]), mark))
        if new[5] and not note:
            out.write("  above %d prompt tokens: %s\n" % (new[5][0], " / ".join(_num(p) for p in new[5][1:])))
    for key, model in doubles:
        out.write("removed: the stored key %s, which is the same model as %s\n" % (clean(key), clean(model)))
    out.write("\n")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def confirmed(ask, question: str) -> bool:
    try:
        answer = ask(question + " [y/N] ")
    except (EOFError, KeyboardInterrupt):
        return False  # the end of input is not a yes
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
            "  limits  : TLS only, a redirect only to this host and port, %d s for the\n"
            "            whole download, %d MB.\n"
            "            A proxy from the environment is used when one is set.\n"
            % (clean(url), clean(host), USER_AGENT, ACCEPT, TOTAL_S, SIZE_CAP >> 20)
        )
        if not confirmed(ask, "Download from %s?" % clean(host)):
            out.write("Nothing downloaded. Nothing written.\n")
            return 1
        body = download(url)
    else:
        body = read_local(source)
        out.write("Read %s (%d bytes). Nothing was downloaded.\n" % (clean(source), len(body)))

    found = parse_prices(body, render)
    path = os.path.join(render.config_home(), render.CONFIG_FILE)
    config = read_config(path)
    stored = config.get("prices", {})
    current = render.price_table(render._user_prices(stored))
    rows = changes(found, render, current)
    doubles = same_model_keys(stored, rows, render)

    out.write("%d Claude models in the list, %d with a price that differs.\n\n" % (len(found), len(rows)))
    if not rows:
        out.write("Nothing to write.\n")
        return 0
    print_table(rows, doubles, out)
    if dry:
        out.write("Dry run. Nothing written.\n")
        return 0
    if not confirmed(ask, "Write these %d rows into the prices key of %s?" % (len(rows), clean(path))):
        out.write("Nothing written.\n")
        return 1

    for key, _ in doubles:
        del stored[key]
    for model, _, new, _ in rows:
        stored[model] = as_object(new)
    config["prices"] = stored
    write_config(path, config)
    out.write(
        "Written: %d rows in %s. The status line uses them from its next render.\n"
        % (len(rows), clean(path))
    )
    return 0


def on_a_terminal() -> bool:
    """True when input, output and the error stream are all terminals.

    All three: Python writes the question to the error stream when the output
    is not a terminal, and a question nobody sees must not be answered.
    """
    try:
        return all(stream.isatty() for stream in (sys.stdin, sys.stdout, sys.stderr))
    except (AttributeError, ValueError):
        return False


def main(argv: list, ask=None, tty=None, out=None) -> int:
    out = out or sys.stdout
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        out.write(USAGE)
        return 0
    if not (tty() if tty else on_a_terminal()):
        sys.stderr.write(
            "bobby-statusline-prices: this needs a terminal, because it asks before it\n"
            "downloads and before it writes. Nothing was done.\n"
        )
        return 2
    try:
        return run(argv[1:], ask or input, out)
    except Refused as err:
        out.write("%s\nNothing written.\n" % clean(err))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
