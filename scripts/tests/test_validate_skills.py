"""Unit tests for scripts/validate-skills.py.

Run with:
    python3 -m unittest discover -s scripts/tests -v

Each test builds a minimal, self-contained repo tree under a TemporaryDirectory
and runs the validator's checks against it directly (via importlib, since the
module lives at scripts/validate-skills.py — a filename that isn't a valid
Python module name for a plain `import`).
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parent.parent / "validate-skills.py"
_spec = importlib.util.spec_from_file_location("validate_skills", MODULE_PATH)
validate_skills = importlib.util.module_from_spec(_spec)
sys.modules["validate_skills"] = validate_skills
_spec.loader.exec_module(validate_skills)


VALID_DESCRIPTION = "Does a thing. Use this when the user asks for the thing."


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def make_valid_repo(root: Path) -> None:
    """Populate `root` with a minimal repo tree that should pass every check."""
    # A valid top-level skill.
    write(
        root / "skills" / "sample-skill" / "SKILL.md",
        f"---\nname: sample-skill\ndescription: {VALID_DESCRIPTION}\n---\n\n# Sample Skill\n\nBody.\n",
    )

    # A valid plugin, using the flat plugin.json location.
    write(
        root / "plugins" / "sample-plugin" / "plugin.json",
        json.dumps({"name": "sample-plugin", "description": "A sample plugin.", "version": "0.1.0"}),
    )
    # A valid plugin-scoped skill.
    write(
        root / "plugins" / "sample-plugin" / "skills" / "inner-skill" / "SKILL.md",
        f"---\nname: inner-skill\ndescription: {VALID_DESCRIPTION}\n---\n\n# Inner Skill\n\nBody.\n",
    )

    # The repo root is itself listed in the marketplace, so it needs a manifest.
    write(
        root / ".claude-plugin" / "plugin.json",
        json.dumps({"name": "root", "description": "The repo itself.", "version": "0.1.0"}),
    )

    # Marketplace manifest referencing both the plugin dir and the repo root.
    write(
        root / ".claude-plugin" / "marketplace.json",
        json.dumps(
            {
                "organization": "example",
                "description": "Example marketplace.",
                "plugins": [
                    {"name": "sample-plugin", "source": "plugins/sample-plugin"},
                    {"name": "root", "source": "."},
                ],
            }
        ),
    )

    # Roadmap files, one per status directory.
    write(
        root / "roadmap" / "backlog" / "idea-one.md",
        "---\ntype: skill\nproposed_by: someone\ncreated: 2026-01-02\n---\n\n# Idea One\n",
    )
    write(root / "roadmap" / "in-progress" / ".gitkeep", "")
    write(
        root / "roadmap" / "done" / "idea-two.md",
        "---\ntype: meta\nproposed_by: someone\ncreated: 2026-01-02\noutcome: implemented\n---\n\n# Idea Two\n",
    )


class ValidRepoTest(unittest.TestCase):
    def test_valid_repo_has_no_problems(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_valid_repo(root)
            problems = validate_skills.check_skill_dirs(root)
            for skill_md in validate_skills.find_skill_md_files(root):
                problems.extend(validate_skills.check_skill_md(skill_md, root))
            problems.extend(validate_skills.check_plugins(root))
            problems.extend(validate_skills.check_marketplace_json(root))
            problems.extend(validate_skills.check_roadmap(root))
            self.assertEqual([str(p) for p in problems], [])


class SkillMdTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def _write_skill(self, dirname: str, content: str) -> Path:
        path = self.root / "skills" / dirname / "SKILL.md"
        write(path, content)
        return path

    def test_missing_frontmatter(self):
        path = self._write_skill("no-frontmatter", "# Just a heading\n\nNo frontmatter here.\n")
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("missing YAML frontmatter" in p.message for p in problems))

    def test_missing_name_field(self):
        path = self._write_skill(
            "missing-name", f"---\ndescription: {VALID_DESCRIPTION}\n---\n\nBody.\n"
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("missing required 'name'" in p.message for p in problems))

    def test_missing_description_field(self):
        path = self._write_skill("missing-desc", "---\nname: missing-desc\n---\n\nBody.\n")
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("missing required 'description'" in p.message for p in problems))

    def test_name_does_not_match_directory(self):
        path = self._write_skill(
            "actual-dir-name",
            f"---\nname: different-name\ndescription: {VALID_DESCRIPTION}\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("does not match directory" in p.message for p in problems))

    def test_directory_not_kebab_case(self):
        path = self._write_skill(
            "Not_Kebab_Case",
            f"---\nname: Not_Kebab_Case\ndescription: {VALID_DESCRIPTION}\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("not kebab-case" in p.message for p in problems))

    def test_name_field_not_kebab_case(self):
        path = self._write_skill(
            "double--hyphen",
            f"---\nname: double--hyphen\ndescription: {VALID_DESCRIPTION}\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("not valid kebab-case" in p.message for p in problems))

    def test_description_empty(self):
        path = self._write_skill(
            "empty-desc", "---\nname: empty-desc\ndescription: \"\"\n---\n\nBody.\n"
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("is empty" in p.message for p in problems))

    def test_description_too_long(self):
        long_desc = "x" * 1025
        path = self._write_skill(
            "long-desc", f"---\nname: long-desc\ndescription: {long_desc}\n---\n\nBody.\n"
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("max is 1024" in p.message for p in problems))

    def test_tab_character_in_frontmatter(self):
        path = self._write_skill(
            "has-tab",
            "---\nname: has-tab\ndescription:\tTabbed description here.\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("tab character" in p.message for p in problems))

    def test_platform_execution_notes_not_last(self):
        body = (
            f"---\nname: notes-not-last\ndescription: {VALID_DESCRIPTION}\n---\n\n"
            "## Platform execution notes\n\nSome notes.\n\n"
            "## Trailing Section\n\nMore content after the notes.\n"
        )
        path = self._write_skill("notes-not-last", body)
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("must be the last H2" in p.message for p in problems))

    def test_platform_execution_notes_last_is_fine(self):
        body = (
            f"---\nname: notes-last\ndescription: {VALID_DESCRIPTION}\n---\n\n"
            "## Some Section\n\nContent.\n\n"
            "## Platform execution notes\n\nNotes at the end.\n"
        )
        path = self._write_skill("notes-last", body)
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_flow_list_is_accepted_opaquely(self):
        path = self._write_skill(
            "flow-collection",
            f"---\nname: flow-collection\ndescription: {VALID_DESCRIPTION}\n"
            "allowed-tools: [Read, Grep, Glob]\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])
        fields = validate_skills.parse_flat_frontmatter(
            "allowed-tools: [Read, Grep, Glob]\n"
        )
        self.assertEqual(fields["allowed-tools"], "[Read, Grep, Glob]")

    def test_metadata_map_is_accepted_opaquely(self):
        path = self._write_skill(
            "meta-map",
            f"---\nname: meta-map\ndescription: {VALID_DESCRIPTION}\n"
            "metadata:\n  author: someone\n  version: 1.2.3\n"
            "hooks:\n  PreToolUse:\n    - matcher: Bash\n"
            "---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_block_list_is_accepted_opaquely(self):
        # Both the indented and the column-0 block-sequence styles are legal
        # YAML for a list value, and both must survive the parser.
        indented = validate_skills.parse_flat_frontmatter(
            "allowed-tools:\n  - Read\n  - Grep\nname: listy\n"
        )
        self.assertEqual(indented["name"], "listy")
        self.assertIn("Read", indented["allowed-tools"])
        flush = validate_skills.parse_flat_frontmatter(
            "allowed-tools:\n- Read\n- Grep\nname: listy\n"
        )
        self.assertEqual(flush["name"], "listy")
        self.assertIn("Grep", flush["allowed-tools"])

    def test_key_with_no_value_and_no_block_is_a_null(self):
        fields = validate_skills.parse_flat_frontmatter("name: dangling\ndescription:\n")
        self.assertEqual(fields["description"], "")
        path = self._write_skill("null-desc", "---\nname: null-desc\ndescription:\n---\n\nBody.\n")
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("description" in str(p) for p in problems))

    def test_full_line_comments_are_skipped(self):
        fields = validate_skills.parse_flat_frontmatter(
            "# leading comment\nname: commented\n  # indented comment\ndescription: keep # inline\n"
        )
        self.assertEqual(fields["name"], "commented")
        self.assertEqual(fields["description"], "keep # inline")

    def test_plain_multi_line_scalar_folds_into_one_value(self):
        body = (
            "---\nname: plain-multiline\n"
            "description: A description that runs on\n"
            "  across a second line\n  and a third.\n---\n\nBody.\n"
        )
        path = self._write_skill("plain-multiline", body)
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])
        fields = validate_skills.parse_flat_frontmatter(
            "description: A description that runs on\n  across a second line\n  and a third.\n"
        )
        self.assertEqual(
            fields["description"],
            "A description that runs on across a second line and a third.",
        )

    def test_duplicate_key_is_rejected(self):
        with self.assertRaises(validate_skills.FrontmatterError):
            validate_skills.parse_flat_frontmatter("name: one\nname: two\n")
        path = self._write_skill(
            "dupe-key",
            f"---\nname: dupe-key\ndescription: {VALID_DESCRIPTION}\n"
            f"description: {VALID_DESCRIPTION}\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("duplicate key" in p.message for p in problems))

    def test_folded_block_turns_a_blank_line_into_a_newline(self):
        fields = validate_skills.parse_flat_frontmatter(
            "description: >-\n  First paragraph.\n\n  Second paragraph.\n"
        )
        self.assertEqual(fields["description"], "First paragraph.\nSecond paragraph.")

    def test_quote_stripping_only_applies_to_a_single_quoted_scalar(self):
        fields = validate_skills.parse_flat_frontmatter(
            'a: "hello"\n' "b: \"a\" or \"b\"\n" "c: 'single'\n"
        )
        self.assertEqual(fields["a"], "hello")
        self.assertEqual(fields["b"], '"a" or "b"')
        self.assertEqual(fields["c"], "single")

    def test_utf8_bom_before_frontmatter_is_tolerated(self):
        path = self._write_skill(
            "bom-skill",
            f"\ufeff---\nname: bom-skill\ndescription: {VALID_DESCRIPTION}\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_name_longer_than_64_characters(self):
        long_name = "a-" * 32 + "a"  # 65 characters, still valid kebab-case
        self.assertEqual(len(long_name), 65)
        path = self._write_skill(
            long_name,
            f"---\nname: {long_name}\ndescription: {VALID_DESCRIPTION}\n---\n\nBody.\n",
        )
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertTrue(any("max is 64" in p.message for p in problems))

    def test_skill_directory_without_skill_md_is_reported(self):
        write(self.root / "skills" / "empty-skill" / "README.md", "nothing here\n")
        write(
            self.root / "plugins" / "p" / "skills" / "hollow" / "notes.md",
            "nothing here\n",
        )
        # Dot-directories and loose files are not skill directories.
        write(self.root / "skills" / ".hidden" / "README.md", "ignored\n")
        write(self.root / "skills" / "loose.md", "ignored\n")
        problems = validate_skills.check_skill_dirs(self.root)
        messages = sorted(str(p) for p in problems)
        self.assertEqual(
            messages,
            ["plugins/p/skills/hollow: directory has no SKILL.md",
             "skills/empty-skill: directory has no SKILL.md"],
        )

    def test_multi_line_block_scalar_description_is_supported(self):
        body = (
            "---\nname: block-desc\ndescription: >-\n"
            "  A description that wraps\n  across multiple lines.\n---\n\nBody.\n"
        )
        path = self._write_skill("block-desc", body)
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_plain_folded_scalar_is_supported(self):
        body = (
            "---\nname: plain-fold\ndescription: >\n"
            "  Folded without the strip indicator.\n  Still one line.\n---\n\nBody.\n"
        )
        path = self._write_skill("plain-fold", body)
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_literal_block_scalar_dedents_by_common_indent(self):
        # Common indentation across the block is 4 spaces, with one line
        # carrying 2 extra spaces of *relative* indentation that must survive
        # the dedent. A naive "strip one leading space per line" dedent would
        # corrupt this instead of removing exactly the common 4.
        fm_text = (
            "name: literal-block\n"
            "description: |\n"
            "    Line one.\n"
            "      Indented extra.\n"
            "    Line three.\n"
        )
        fields = validate_skills.parse_flat_frontmatter(fm_text)
        self.assertEqual(
            fields["description"],
            "Line one.\n  Indented extra.\nLine three.",
        )

    def test_literal_block_scalar_end_to_end(self):
        body = (
            "---\nname: literal-desc\ndescription: |-\n"
            "  Line one.\n  Line two.\n---\n\nBody.\n"
        )
        path = self._write_skill("literal-desc", body)
        problems = validate_skills.check_skill_md(path, self.root)
        self.assertEqual([str(p) for p in problems], [])


class PluginTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_missing_manifest(self):
        write(self.root / "plugins" / "no-manifest" / "README.md", "nothing here\n")
        problems = validate_skills.check_plugins(self.root)
        self.assertTrue(any("no plugin manifest found" in p.message for p in problems))

    def test_manifest_missing_required_field(self):
        write(
            self.root / "plugins" / "incomplete" / "plugin.json",
            json.dumps({"name": "incomplete"}),
        )
        problems = validate_skills.check_plugins(self.root)
        self.assertTrue(any("missing or empty required field 'description'" in p.message for p in problems))
        self.assertTrue(any("missing or empty required field 'version'" in p.message for p in problems))

    def test_manifest_name_mismatch(self):
        write(
            self.root / "plugins" / "actual-name" / "plugin.json",
            json.dumps({"name": "wrong-name", "description": "desc", "version": "0.1.0"}),
        )
        problems = validate_skills.check_plugins(self.root)
        self.assertTrue(any("does not match plugin directory" in p.message for p in problems))

    def test_dot_claude_plugin_location_is_accepted(self):
        write(
            self.root / "plugins" / "dotted" / ".claude-plugin" / "plugin.json",
            json.dumps({"name": "dotted", "description": "desc", "version": "0.1.0"}),
        )
        problems = validate_skills.check_plugins(self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_invalid_json_manifest(self):
        write(self.root / "plugins" / "bad-json" / "plugin.json", "{not valid json")
        problems = validate_skills.check_plugins(self.root)
        self.assertTrue(any("invalid JSON" in p.message for p in problems))


class MarketplaceJsonTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_missing_file(self):
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("file not found" in p.message for p in problems))

    def test_invalid_json(self):
        write(self.root / ".claude-plugin" / "marketplace.json", "{not json at all")
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("invalid JSON" in p.message for p in problems))

    def test_source_path_does_not_exist(self):
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": [{"name": "ghost", "source": "plugins/does-not-exist"}]}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("does not exist" in p.message for p in problems))

    def _write_plugin(self, rel_dir: str, name: str) -> None:
        write(
            self.root / rel_dir / ".claude-plugin" / "plugin.json",
            json.dumps({"name": name, "description": "desc", "version": "0.1.0"}),
        )

    def test_valid_marketplace_json(self):
        self._write_plugin("plugins/real-plugin", "real-plugin")
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": [{"name": "real-plugin", "source": "plugins/real-plugin"}]}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_source_without_a_plugin_manifest_is_reported(self):
        (self.root / "plugins" / "manifestless").mkdir(parents=True)
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": [{"name": "manifestless", "source": "plugins/manifestless"}]}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("has no plugin manifest" in p.message for p in problems))

    def test_entry_name_must_match_the_manifest_name(self):
        self._write_plugin("plugins/real-plugin", "real-plugin")
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": [{"name": "advertised-name", "source": "plugins/real-plugin"}]}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("does not match 'real-plugin'" in p.message for p in problems))

    def test_unlisted_plugin_directory_is_reported(self):
        self._write_plugin("plugins/orphan", "orphan")
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": []}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(
            any("plugins/orphan" in p.message and "not listed" in p.message for p in problems)
        )

    def test_standalone_skill_manifest_is_checked_like_a_plugin(self):
        # skills/<x>/.claude-plugin/plugin.json gets the same name/field checks.
        self._write_plugin("skills/wrong-name-skill", "totally-wrong")
        problems = validate_skills.check_plugins(self.root)
        self.assertTrue(any("wrong-name-skill" in str(p) for p in problems))

    def test_standalone_skill_packaged_as_a_plugin_must_be_listed(self):
        # skills/<x>/ with its own plugin manifest is a plugin and must appear.
        self._write_plugin("skills/packaged-skill", "packaged-skill")
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": []}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(
            any("skills/packaged-skill" in p.message and "not listed" in p.message for p in problems)
        )

        # Listing it clears the problem.
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps(
                {"plugins": [{"name": "packaged-skill", "source": "./skills/packaged-skill"}]}
            ),
        )
        self.assertEqual([str(p) for p in validate_skills.check_marketplace_json(self.root)], [])

    def test_plain_skill_directory_without_a_manifest_is_exempt(self):
        write(
            self.root / "skills" / "plain-skill" / "SKILL.md",
            f"---\nname: plain-skill\ndescription: {VALID_DESCRIPTION}\n---\n\nBody.\n",
        )
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": []}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_absolute_source_is_rejected(self):
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": [{"name": "escapee", "source": "/absolute/path"}]}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("must be a relative path" in p.message for p in problems))

    def test_traversal_source_escaping_repo_root_is_rejected(self):
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": [{"name": "escapee", "source": "../../outside"}]}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("resolves outside the repo" in p.message for p in problems))

    def test_missing_plugin_name_is_reported(self):
        (self.root / "plugins" / "real-plugin").mkdir(parents=True)
        write(
            self.root / ".claude-plugin" / "marketplace.json",
            json.dumps({"plugins": [{"source": "plugins/real-plugin"}]}),
        )
        problems = validate_skills.check_marketplace_json(self.root)
        self.assertTrue(any("missing or empty 'name'" in p.message for p in problems))


class RoadmapTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def _write_idea(self, status: str, name: str, content: str) -> Path:
        path = self.root / "roadmap" / status / name
        write(path, content)
        return path

    def test_gitkeep_is_ignored(self):
        self._write_idea("backlog", ".gitkeep", "")
        problems = validate_skills.check_roadmap(self.root)
        self.assertEqual([str(p) for p in problems], [])

    def test_missing_type(self):
        self._write_idea(
            "backlog", "no-type.md", "---\nproposed_by: someone\ncreated: 2026-01-02\n---\n\nBody\n"
        )
        problems = validate_skills.check_roadmap(self.root)
        self.assertTrue(any("missing required 'type'" in p.message for p in problems))

    def test_invalid_type(self):
        self._write_idea(
            "backlog",
            "bad-type.md",
            "---\ntype: not-a-real-type\nproposed_by: someone\ncreated: 2026-01-02\n---\n\nBody\n",
        )
        problems = validate_skills.check_roadmap(self.root)
        self.assertTrue(any("must be one of" in p.message for p in problems))

    def test_missing_proposed_by(self):
        self._write_idea(
            "backlog", "no-proposer.md", "---\ntype: skill\ncreated: 2026-01-02\n---\n\nBody\n"
        )
        problems = validate_skills.check_roadmap(self.root)
        self.assertTrue(any("missing required 'proposed_by'" in p.message for p in problems))

    def test_bad_created_date_format(self):
        self._write_idea(
            "backlog",
            "bad-date.md",
            "---\ntype: skill\nproposed_by: someone\ncreated: Jan 2 2026\n---\n\nBody\n",
        )
        problems = validate_skills.check_roadmap(self.root)
        self.assertTrue(any("is not YYYY-MM-DD" in p.message for p in problems))

    def test_valid_roadmap_file(self):
        self._write_idea(
            "in-progress",
            "good-idea.md",
            "---\ntype: plugin\nproposed_by: someone\ncreated: 2026-01-02\n---\n\nBody\n",
        )
        problems = validate_skills.check_roadmap(self.root)
        self.assertEqual([str(p) for p in problems], [])


class MainEntryPointTests(unittest.TestCase):
    def test_exit_code_zero_on_valid_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_valid_repo(root)
            with contextlib.redirect_stdout(io.StringIO()):
                code = validate_skills.main([str(root)])
            self.assertEqual(code, 0)

    def test_exit_code_nonzero_on_broken_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / "skills" / "broken" / "SKILL.md", "# No frontmatter\n")
            with contextlib.redirect_stdout(io.StringIO()):
                code = validate_skills.main([str(root)])
            self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
