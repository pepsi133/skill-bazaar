'use strict';
// SessionStart hook: what it emits for each of the four state combinations.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { HOOKS, PLUGIN_ROOT, cleanupSandboxes, sandbox } = require('./helpers');

test.after(cleanupSandboxes);

const activate = require(path.join(HOOKS, 'ste-activate.js'));
const PROMPT = fs.readFileSync(path.join(PLUGIN_ROOT, 'prompts', 'system-prompt.md'), 'utf8');

test('ste on, caveman off: the ruleset plus the sole-style block', () => {
  const out = activate.buildContext({ ste: true, caveman: 'off' }, PROMPT);
  assert.match(out, /^SIMPLE ENGLISH SKILL ACTIVE AUTOMATICALLY/);
  assert.match(out, /CLASSIFY FIRST/);
  assert.match(out, /STE-BRIDGE ACTIVE \(caveman mode: off\)/);
  assert.match(out, /sole style for this session/);
  assert.doesNotMatch(out, /Precedence: caveman wins/);
  assert.ok(out.length <= activate.MAX_CHARS, `payload is ${out.length} chars`);
});

test('ste on, caveman on: the ruleset plus the precedence rule', () => {
  const out = activate.buildContext({ ste: true, caveman: 'full' }, PROMPT);
  assert.match(out, /^SIMPLE ENGLISH SKILL ACTIVE AUTOMATICALLY/);
  assert.match(out, /STE-BRIDGE ACTIVE \(caveman mode: full\)/);
  assert.match(
    out,
    /Precedence: caveman wins for ordinary turns\. STE wins whenever caveman itself says to drop compression \(security warnings, irreversible actions, multi-step sequences, ambiguity, or the user asking to clarify\)\./
  );
  assert.match(out, /not to unrestricted normal English/);
  assert.ok(out.length <= activate.MAX_CHARS, `payload is ${out.length} chars`);
});

test('ste off emits nothing, whatever caveman is doing', () => {
  assert.equal(activate.buildContext({ ste: false, caveman: 'off' }, PROMPT), '');
  assert.equal(activate.buildContext({ ste: false, caveman: 'ultra' }, PROMPT), '');
});

test('the frontmatter of the vendored prompt is stripped before injection', () => {
  const out = activate.buildContext({ ste: true, caveman: 'off' }, '---\nname: x\n---\nBODY TEXT');
  assert.doesNotMatch(out, /name: x/);
  assert.match(out, /BODY TEXT/);
});

test('a missing prompt file falls back to the condensed ruleset, bridge intact', () => {
  const out = activate.buildContext({ ste: true, caveman: 'lite' }, '');
  assert.match(out, /Apply ASD-STE100 Simplified Technical English/);
  assert.match(out, /STE-BRIDGE ACTIVE \(caveman mode: lite\)/);
});

test('an oversized prompt degrades to the fallback rather than blowing the cap', () => {
  const out = activate.buildContext({ ste: true, caveman: 'full' }, 'x'.repeat(activate.MAX_CHARS * 2));
  assert.ok(out.length <= activate.MAX_CHARS, `payload is ${out.length} chars`);
  assert.match(out, /Apply ASD-STE100 Simplified Technical English/);
  assert.match(out, /Precedence: caveman wins/);
});

test('caveman one-shot modes are treated as no standing compressed style', () => {
  for (const mode of ['commit', 'review', 'compress']) {
    const out = activate.buildContext({ ste: true, caveman: mode }, PROMPT);
    assert.match(out, /sole style for this session/, `mode: ${mode}`);
  }
});

test('running the hook end to end emits the ruleset, and nothing when ste is off', () => {
  const { config, root } = sandbox();
  const env = { ...process.env, XDG_CONFIG_HOME: root, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const run = () => execFileSync(process.execPath, [path.join(HOOKS, 'ste-activate.js')], {
    input: JSON.stringify({ session_id: 't', hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    env
  });

  const on = run();
  assert.match(on, /^SIMPLE ENGLISH SKILL ACTIVE AUTOMATICALLY/);
  assert.match(on, /STE-BRIDGE ACTIVE/);

  config.writeState({ ste: false, caveman: 'off' });
  assert.equal(run(), '');
  assert.equal(fs.existsSync(config.getStatePath()), true);
});
