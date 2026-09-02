#!/usr/bin/env python3
"""Validate SKILL.md frontmatter, plugin manifests, the marketplace manifest, and
roadmap frontmatter across the repo.

Python 3 standard library only — no third-party dependencies (no PyYAML). This
script implements a tiny parser for the `key: value` frontmatter subset this
repo actually uses. Structures it does not need to read into — nested maps
(`metadata:`, `hooks:`), sequences (`allowed-tools:`), flow collections — are
accepted as opaque raw text so a spec-valid skill is never rejected; only
genuinely malformed frontmatter raises.

Usage:
    python3 scripts/validate-skills.py [--json] [root]

Exit status is non-zero if any check fails. On failure, prints one
`path: message` line per problem (or a JSON array of {path, message} objects
with --json).
"""
# ---------------------------------------------------------------------------
# Open questions
#
# 1. Plugin manifest location: both `<plugin>/.claude-plugin/plugin.json` and a
#    flat `<plugin>/plugin.json` are accepted, `.claude-plugin/` first. The
#    documented layout is `.claude-plugin/`; drop the flat fallback once no
#    plugin in the tree uses it.
# 2. The frontmatter parser stays hand-rolled (stdlib-only, no install step).
#    It reads the scalars the checks need and treats everything else as opaque.
#    If a check ever needs to look *inside* a nested map or list, add PyYAML to
#    the workflow rather than growing this parser into a YAML implementation.
# 3. Security scanning is deliberately not here — secret scanning, CodeQL,
#    skill scanners, and the egress grep AGENTS.md requires belong to the
#    `security-scanning-ci` scoping and should land as a second workflow file.
# 4. Content quality (does a description trigger, do bundled hooks work) is not
#    machine-checkable at this layer and stays a human review step.
# ---------------------------------------------------------------------------
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath

KEBAB_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ROADMAP_TYPES = {"skill", "mcp", "plugin", "meta"}
BLOCK_SCALAR_HEADERS = (">-", ">", ">+", "|-", "|", "|+")
LIST_ITEM_RE = re.compile(r"^-(\s|$)")


class Problem:
    __slots__ = ("path", "message")

    def __init__(self, path: str, message: str):
        self.path = path
        self.message = message

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


class FrontmatterError(Exception):
    """Raised when frontmatter can't be parsed as the subset we support."""


def split_frontmatter(text: str) -> tuple[str | None, str]:
    """Return (frontmatter_block, body) for a file's text.

    frontmatter_block is the raw text between the `---` delimiters (not
    including the delimiters), or None if the file has no frontmatter block
    at all. Raises FrontmatterError if a frontmatter block is opened but never
    closed. A UTF-8 BOM is stripped before anything else.
    """
    if text.startswith("\ufeff"):
        text = text[1:]
    if not text.startswith("---"):
        return None, text
    # First line must be exactly '---' (allow trailing whitespace/CRLF).
    lines = text.split("\n")
    if lines[0].rstrip("\r") != "---":
        return None, text
    for i in range(1, len(lines)):
        if lines[i].rstrip("\r") == "---":
            fm = "\n".join(lines[1:i])
            body = "\n".join(lines[i + 1 :])
            return fm, body
    raise FrontmatterError("frontmatter opened with '---' but never closed")


def _fold_block(stripped: list[str]) -> str:
    """Fold a `>`/`>-` block: line breaks become spaces, blank lines newlines."""
    parts: list[str] = []
    pending_blanks = 0
    for line in stripped:
        if line == "":
            pending_blanks += 1
            continue
        if parts:
            parts.append("\n" * pending_blanks if pending_blanks else " ")
        parts.append(line)
        pending_blanks = 0
    return "".join(parts)


def _strip_quotes(value: str) -> str:
    """Strip one layer of quotes only from a single balanced quoted scalar.

    `"hello"` -> `hello`, but `"a" or "b"` is left alone (stripping there would
    silently drop the outer quotes of two separate quoted words).
    """
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        quote = value[0]
        if value.count(quote) == 2:
            return value[1:-1]
    return value


def parse_flat_frontmatter(fm_text: str) -> dict[str, str]:
    """Parse the `key: value` frontmatter subset this repo uses.

    Supports:
      - `key: value` on one line, with plain multi-line scalars: continuation
        lines (indented, no block indicator) fold into the value with a space.
      - `key: >-` / `key: |` style block scalars, folded (`>`) or kept with
        literal newlines (`|`).
      - Opaque structures: a nested block (a `key:` with an empty value
        followed by indented lines or `- ` items) and flow collections
        (`[a, b]`, `{a: b}`) are accepted and stored as their raw text. The
        checks in this script only read plain scalars, so the exact shape does
        not matter — what matters is that a spec-valid `metadata:` map,
        `hooks:` map, or list-valued `allowed-tools:` is not rejected.
      - Full-line `#` comments are skipped. An inline `#` is NOT a comment;
        it is treated as part of the value.
      - A `key:` with neither a value nor a block under it is a YAML null,
        stored as an empty string.

    Raises FrontmatterError on tabs, duplicate keys, or a line that is not a
    `key: value` pair.
    """
    result: dict[str, str] = {}
    raw_lines = fm_text.split("\n")
    if any("\t" in line for line in raw_lines):
        raise FrontmatterError("tab character in frontmatter (use spaces)")

    i = 0
    n = len(raw_lines)
    key_line_re = re.compile(r"^([A-Za-z0-9_-]+):(.*)$")

    def store(key: str, value: str) -> None:
        if key in result:
            raise FrontmatterError(f"duplicate key '{key}' in frontmatter")
        result[key] = value

    while i < n:
        line = raw_lines[i]
        if line.strip() == "" or line.lstrip().startswith("#"):
            i += 1
            continue
        if line[:1] == " " or LIST_ITEM_RE.match(line):
            raise FrontmatterError(
                f"unexpected indented/list line outside a mapping value: {line!r}"
            )
        m = key_line_re.match(line)
        if not m:
            raise FrontmatterError(f"line is not a simple 'key: value' pair: {line!r}")
        key, rest = m.group(1), m.group(2).strip()
        i += 1

        if rest in BLOCK_SCALAR_HEADERS:
            fold = rest.startswith(">")
            block_lines: list[str] = []
            while i < n and (raw_lines[i].startswith(" ") or raw_lines[i].strip() == ""):
                block_lines.append(raw_lines[i])
                i += 1
            while block_lines and block_lines[-1].strip() == "":
                block_lines.pop()
            if fold:
                value = _fold_block([ln.strip() for ln in block_lines])
            else:
                non_blank = [ln for ln in block_lines if ln.strip() != ""]
                common_indent = (
                    min(len(ln) - len(ln.lstrip(" ")) for ln in non_blank) if non_blank else 0
                )
                value = "\n".join(ln[common_indent:] for ln in block_lines)
            store(key, value)
            continue

        if rest == "":
            # A nested block: an indented map, or a block sequence whose items
            # may sit at column 0. Accepted opaquely as its raw text.
            block_lines = []
            while i < n and (
                raw_lines[i].startswith(" ")
                or raw_lines[i].strip() == ""
                or LIST_ITEM_RE.match(raw_lines[i])
            ):
                block_lines.append(raw_lines[i])
                i += 1
            while block_lines and block_lines[-1].strip() == "":
                block_lines.pop()
            # No block under it: a YAML null, stored as an empty string.
            store(key, "\n".join(block_lines))
            continue

        # Plain scalar or flow collection, plus any folded continuation lines.
        continuation: list[str] = []
        while i < n and raw_lines[i].startswith(" ") and raw_lines[i].strip() != "":
            if not raw_lines[i].lstrip().startswith("#"):
                continuation.append(raw_lines[i].strip())
            i += 1
        if continuation:
            rest = " ".join([rest] + continuation)
        elif not (rest.startswith("[") or rest.startswith("{")):
            rest = _strip_quotes(rest)
        store(key, rest)

    return result


def load_frontmatter(path: Path) -> tuple[dict[str, str] | None, str, list[Problem]]:
    """Load and parse a file's frontmatter.

    Returns (fields_or_None, body, problems). fields is None if frontmatter
    could not be parsed at all (a problem is appended explaining why).
    """
    problems: list[Problem] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, "", [Problem(str(path), f"could not read file: {exc}")]
    try:
        fm_text, body = split_frontmatter(text)
    except FrontmatterError as exc:
        return None, "", [Problem(str(path), f"frontmatter error: {exc}")]
    if fm_text is None:
        return None, text, [Problem(str(path), "missing YAML frontmatter block")]
    try:
        fields = parse_flat_frontmatter(fm_text)
    except FrontmatterError as exc:
        return None, body, [Problem(str(path), f"frontmatter error: {exc}")]
    return fields, body, problems


def check_skill_md(path: Path, repo_root: Path) -> list[Problem]:
    problems: list[Problem] = []
    rel = str(path.relative_to(repo_root))
    dirname = path.parent.name

    if not KEBAB_RE.match(dirname):
        problems.append(Problem(rel, f"directory name '{dirname}' is not kebab-case"))

    fields, body, fm_problems = load_frontmatter(path)
    problems.extend(fm_problems)
    if fields is None:
        return problems

    name = fields.get("name")
    if not name:
        problems.append(Problem(rel, "frontmatter missing required 'name' field"))
    else:
        if name != dirname:
            problems.append(
                Problem(rel, f"frontmatter name '{name}' does not match directory '{dirname}'")
            )
        if not KEBAB_RE.match(name):
            problems.append(
                Problem(rel, f"'name' value '{name}' is not valid kebab-case (a-z0-9, single hyphens)")
            )
        if len(name) > 64:
            problems.append(Problem(rel, f"'name' is {len(name)} characters, max is 64"))

    description = fields.get("description")
    if description is None:
        problems.append(Problem(rel, "frontmatter missing required 'description' field"))
    else:
        if description.strip() == "":
            problems.append(Problem(rel, "'description' is empty"))
        if len(description) > 1024:
            problems.append(Problem(rel, f"'description' is {len(description)} characters, max is 1024"))

    # Optional "## Platform execution notes" placement check: if present, it
    # must be the last H2 section in the document body.
    h2_headings = re.findall(r"(?m)^##\s+(.+?)\s*$", body)
    normalized = [h.strip() for h in h2_headings]
    if "Platform execution notes" in normalized:
        idx = normalized.index("Platform execution notes")
        if idx != len(normalized) - 1:
            problems.append(
                Problem(
                    rel,
                    "'## Platform execution notes' must be the last H2 section "
                    f"(found before '## {normalized[-1]}')",
                )
            )

    return problems


def _child_dirs(parent: Path) -> list[Path]:
    """Sorted visible sub-directories of `parent` (dot-directories skipped)."""
    if not parent.is_dir():
        return []
    return sorted(p for p in parent.iterdir() if p.is_dir() and not p.name.startswith("."))


def find_skill_dirs(repo_root: Path) -> list[Path]:
    """Every directory that is expected to hold a SKILL.md."""
    dirs = list(_child_dirs(repo_root / "skills"))
    for plugin_dir in _child_dirs(repo_root / "plugins"):
        dirs.extend(_child_dirs(plugin_dir / "skills"))
    return dirs


def find_skill_md_files(repo_root: Path) -> list[Path]:
    return [d / "SKILL.md" for d in find_skill_dirs(repo_root) if (d / "SKILL.md").is_file()]


def check_skill_dirs(repo_root: Path) -> list[Problem]:
    """Report a skill directory that has no SKILL.md at all."""
    problems: list[Problem] = []
    for skill_dir in find_skill_dirs(repo_root):
        if not (skill_dir / "SKILL.md").is_file():
            problems.append(
                Problem(str(skill_dir.relative_to(repo_root)), "directory has no SKILL.md")
            )
    return problems


def find_plugin_manifest(plugin_dir: Path) -> Path | None:
    """Return the plugin manifest for a directory, or None.

    `.claude-plugin/plugin.json` (Claude Code's convention) wins over a flat
    `plugin.json` (this repo's older convention).
    """
    dotted = plugin_dir / ".claude-plugin" / "plugin.json"
    if dotted.is_file():
        return dotted
    flat = plugin_dir / "plugin.json"
    if flat.is_file():
        return flat
    return None


def check_plugin_manifest(plugin_dir: Path, repo_root: Path) -> list[Problem]:
    problems: list[Problem] = []
    rel_dir = str(plugin_dir.relative_to(repo_root))
    dirname = plugin_dir.name

    manifest_path = find_plugin_manifest(plugin_dir)
    if manifest_path is None:
        problems.append(
            Problem(rel_dir, "no plugin manifest found (.claude-plugin/plugin.json or plugin.json)")
        )
        return problems

    rel_manifest = str(manifest_path.relative_to(repo_root))
    try:
        raw = manifest_path.read_text(encoding="utf-8")
    except OSError as exc:
        problems.append(Problem(rel_manifest, f"could not read file: {exc}"))
        return problems
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        problems.append(Problem(rel_manifest, f"invalid JSON: {exc}"))
        return problems
    if not isinstance(data, dict):
        problems.append(Problem(rel_manifest, "top-level JSON value must be an object"))
        return problems

    for required in ("name", "description", "version"):
        if required not in data or not isinstance(data[required], str) or not data[required].strip():
            problems.append(Problem(rel_manifest, f"missing or empty required field '{required}'"))

    name = data.get("name")
    if isinstance(name, str) and name != dirname:
        problems.append(
            Problem(rel_manifest, f"'name' ('{name}') does not match plugin directory ('{dirname}')")
        )

    return problems


def check_plugins(repo_root: Path) -> list[Problem]:
    problems: list[Problem] = []
    for plugin_dir in _child_dirs(repo_root / "plugins"):
        problems.extend(check_plugin_manifest(plugin_dir, repo_root))
    # Standalone skills packaged as plugins get the same manifest checks.
    for skill_dir in _child_dirs(repo_root / "skills"):
        if (skill_dir / ".claude-plugin" / "plugin.json").is_file():
            problems.extend(check_plugin_manifest(skill_dir, repo_root))
    return problems


def _manifest_name(manifest_path: Path) -> str | None:
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and isinstance(data.get("name"), str):
        return data["name"]
    return None


def _packaged_plugin_dirs(repo_root: Path) -> list[Path]:
    """Directories that must be listed in marketplace.json.

    Every `plugins/<x>/` with a manifest, plus every `skills/<x>/` that is
    packaged as a standalone plugin (it has its own `.claude-plugin/plugin.json`).
    A plain skill directory without a manifest is not a plugin and is exempt.
    """
    dirs = [d for d in _child_dirs(repo_root / "plugins") if find_plugin_manifest(d) is not None]
    dirs.extend(
        d
        for d in _child_dirs(repo_root / "skills")
        if (d / ".claude-plugin" / "plugin.json").is_file()
    )
    return dirs


def check_marketplace_json(repo_root: Path) -> list[Problem]:
    problems: list[Problem] = []
    path = repo_root / ".claude-plugin" / "marketplace.json"
    if not path.is_file():
        problems.append(Problem(str(path.relative_to(repo_root)), "file not found"))
        return problems
    rel = str(path.relative_to(repo_root))
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        problems.append(Problem(rel, f"could not read file: {exc}"))
        return problems
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        problems.append(Problem(rel, f"invalid JSON: {exc}"))
        return problems
    if not isinstance(data, dict):
        problems.append(Problem(rel, "top-level JSON value must be an object"))
        return problems

    plugins = data.get("plugins")
    if not isinstance(plugins, list):
        problems.append(Problem(rel, "'plugins' field missing or not a list"))
        return problems

    resolved_root = repo_root.resolve()
    listed_sources: set[Path] = set()
    for idx, entry in enumerate(plugins):
        if not isinstance(entry, dict):
            problems.append(Problem(rel, f"plugins[{idx}] is not an object"))
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(Problem(rel, f"plugins[{idx}] missing or empty 'name' field"))
            name = None
        source = entry.get("source")
        if not isinstance(source, str) or not source:
            problems.append(Problem(rel, f"plugins[{idx}] missing 'source' field"))
            continue
        if PurePosixPath(source).is_absolute():
            problems.append(
                Problem(rel, f"plugins[{idx}].source '{source}' must be a relative path")
            )
            continue
        source_path = (repo_root / source).resolve()
        if not source_path.is_relative_to(resolved_root):
            problems.append(
                Problem(rel, f"plugins[{idx}].source '{source}' resolves outside the repo ({source_path})")
            )
            continue
        if not source_path.exists():
            problems.append(Problem(rel, f"plugins[{idx}].source '{source}' does not exist ({source_path})"))
            continue
        listed_sources.add(source_path)

        # Every listed source must be a plugin: a directory with a manifest
        # whose 'name' is the name the marketplace advertises.
        if not source_path.is_dir():
            problems.append(
                Problem(rel, f"plugins[{idx}].source '{source}' is not a directory")
            )
            continue
        manifest_path = find_plugin_manifest(source_path)
        if manifest_path is None:
            problems.append(
                Problem(
                    rel,
                    f"plugins[{idx}].source '{source}' has no plugin manifest "
                    "(.claude-plugin/plugin.json)",
                )
            )
            continue
        manifest_name = _manifest_name(manifest_path)
        if name is not None and manifest_name is not None and manifest_name != name:
            problems.append(
                Problem(
                    rel,
                    f"plugins[{idx}].name '{name}' does not match "
                    f"'{manifest_name}' in {manifest_path.relative_to(resolved_root)}",
                )
            )

    # Reverse direction: nothing packaged as a plugin may go unlisted.
    for plugin_dir in _packaged_plugin_dirs(repo_root):
        if plugin_dir.resolve() not in listed_sources:
            problems.append(
                Problem(
                    rel,
                    f"'{plugin_dir.relative_to(repo_root)}' has a plugin manifest but is "
                    "not listed in marketplace.json",
                )
            )

    return problems


def check_roadmap(repo_root: Path) -> list[Problem]:
    problems: list[Problem] = []
    roadmap_dir = repo_root / "roadmap"
    if not roadmap_dir.is_dir():
        return problems
    for status in ("backlog", "in-progress", "done"):
        status_dir = roadmap_dir / status
        if not status_dir.is_dir():
            continue
        for path in sorted(status_dir.glob("*.md")):
            if path.name == ".gitkeep":
                continue
            rel = str(path.relative_to(repo_root))
            fields, _body, fm_problems = load_frontmatter(path)
            problems.extend(fm_problems)
            if fields is None:
                continue

            rtype = fields.get("type")
            if not rtype:
                problems.append(Problem(rel, "frontmatter missing required 'type' field"))
            elif rtype not in ROADMAP_TYPES:
                problems.append(
                    Problem(rel, f"'type' is '{rtype}', must be one of {sorted(ROADMAP_TYPES)}")
                )

            proposed_by = fields.get("proposed_by")
            if not proposed_by or not proposed_by.strip():
                problems.append(Problem(rel, "frontmatter missing required 'proposed_by' field"))

            created = fields.get("created")
            if not created:
                problems.append(Problem(rel, "frontmatter missing required 'created' field"))
            elif not DATE_RE.match(created):
                problems.append(Problem(rel, f"'created' value '{created}' is not YYYY-MM-DD"))

    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="repo root (default: current directory)")
    parser.add_argument("--json", action="store_true", help="print problems as a JSON array")
    args = parser.parse_args(argv)

    repo_root = Path(args.root).resolve()
    problems: list[Problem] = []

    problems.extend(check_skill_dirs(repo_root))
    for skill_md in find_skill_md_files(repo_root):
        problems.extend(check_skill_md(skill_md, repo_root))

    problems.extend(check_plugins(repo_root))
    problems.extend(check_marketplace_json(repo_root))
    problems.extend(check_roadmap(repo_root))

    if args.json:
        print(json.dumps([{"path": p.path, "message": p.message} for p in problems], indent=2))
    else:
        for p in problems:
            print(str(p))
        if not problems:
            print("validate-skills: all checks passed")

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
