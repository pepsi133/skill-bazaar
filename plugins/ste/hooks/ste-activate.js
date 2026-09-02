#!/usr/bin/env node
// ste — SessionStart hook.
//
// Emits the Simple Technical English ruleset, plus one STE-BRIDGE block that
// names which style wins when caveman is also active.
//
// Output goes to plain stdout. That is a documented shape, not an inference:
// the Claude Code hooks reference (linked from README "References") names
// SessionStart — with UserPromptSubmit, UserPromptExpansion and PostModelSwitch —
// as an event whose plain-text stdout Claude Code adds to context. Upstream
// SimpleEnglish's own SessionStart hook does the same
// (src/hooks/simple-english-activate.js @ 34855f2a). See README "Verified behavior".
//
// Node standard library only. No network. Reads only files inside this plugin,
// plus this plugin's own state file.

const fs = require('node:fs');
const path = require('node:path');
const { readState, INDEPENDENT_CAVEMAN_MODES } = require('./ste-config');

// Claude Code caps hook stdout at 10,000 characters; above that the output is
// written to a file and replaced by a preview, which defeats the hook. Upstream
// SimpleEnglish uses 9500 as the working cap and this mirrors it.
const MAX_CHARS = 9500;

const FALLBACK_CONTEXT = `SIMPLE ENGLISH SKILL ACTIVE AUTOMATICALLY

Apply ASD-STE100 Simplified Technical English to technical-writing tasks. Use short sentences, active voice, one term for one meaning, and conditions before commands. Do not change code, identifiers, commands, or quoted errors.`;

const HEADER = [
  'SIMPLE ENGLISH SKILL ACTIVE AUTOMATICALLY',
  '',
  'Follow these writing rules without waiting for the user to name the skill. The full skill, with the rule catalog and the check mode, is at skills/simple-english/SKILL.md in this plugin. Read it for a compliance check or for strict mode.',
  '',
].join('\n');

// The precedence rule, stated once. Nothing else in this plugin restates it.
const BRIDGE_WITH_CAVEMAN = (mode) => [
  '',
  '',
  `STE-BRIDGE ACTIVE (caveman mode: ${mode}).`,
  '',
  'Precedence: caveman wins for ordinary turns. STE wins whenever caveman itself says to drop compression (security warnings, irreversible actions, multi-step sequences, ambiguity, or the user asking to clarify).',
  '',
  'On those turns, switch to the Simple Technical English rules above, not to unrestricted normal English: full grammar, no contractions, keep articles and "that", one instruction per sentence, condition before command, active voice, and only the modals can/will/must. Resume caveman compression once the clear part is done. Never shorten quoted error text, a security warning, or a confirmation before a destructive action.',
].join('\n');

const BRIDGE_SOLO = [
  '',
  '',
  'STE-BRIDGE ACTIVE (caveman mode: off).',
  '',
  'Simple Technical English is the sole style for this session. There is no compressed mode to yield to, so apply the rules above to every reply and to every document you write.',
].join('\n');

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');
}

function promptPath(root) {
  return path.join(root, 'prompts', 'system-prompt.md');
}

function readPrompt(root) {
  try {
    return fs.readFileSync(promptPath(root), 'utf8');
  } catch (e) {
    return '';
  }
}

function bridgeBlock(state) {
  const mode = state.caveman;
  if (mode === 'off' || INDEPENDENT_CAVEMAN_MODES.has(mode)) {
    return BRIDGE_SOLO;
  }
  return BRIDGE_WITH_CAVEMAN(mode);
}

// Returns the exact text this hook writes to stdout. '' means "emit nothing".
function buildContext(state, promptText) {
  if (!state.ste) {
    return '';
  }
  const bridge = bridgeBlock(state);
  const body = promptText ? HEADER + stripFrontmatter(promptText).trim() : FALLBACK_CONTEXT;
  const full = body + bridge;
  if (full.length <= MAX_CHARS) {
    return full;
  }
  const reduced = FALLBACK_CONTEXT + bridge;
  if (reduced.length <= MAX_CHARS) {
    return reduced;
  }
  return bridge.trim();
}

function main() {
  const state = readState();
  const out = buildContext(state, readPrompt(pluginRoot()));
  if (out) {
    process.stdout.write(out);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  BRIDGE_SOLO,
  BRIDGE_WITH_CAVEMAN,
  FALLBACK_CONTEXT,
  HEADER,
  MAX_CHARS,
  buildContext,
  bridgeBlock,
  pluginRoot,
  promptPath,
  readPrompt,
  stripFrontmatter
};
