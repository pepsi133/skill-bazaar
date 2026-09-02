'use strict';
// UserPromptSubmit hook: command parsing, caveman mirroring, persistence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { HOOKS, PLUGIN_ROOT, cleanupSandboxes, sandbox, writeRaw } = require('./helpers');

test.after(cleanupSandboxes);

const tracker = require(path.join(HOOKS, 'ste-mode-tracker.js'));

const ON = { ste: true, caveman: 'off', cavemanLastMode: 'full' };
const BOTH = { ste: true, caveman: 'full', cavemanLastMode: 'full' };

// --- /ste command ---------------------------------------------------------

test('/ste on turns the bridge on and re-injects the ruleset this turn', () => {
  sandbox();
  const r = tracker.decide('/ste on', { ste: false, caveman: 'off' });
  assert.equal(r.state.ste, true);
  assert.match(r.context, /^STE-BRIDGE ON\./);
  assert.match(r.context, /SIMPLE ENGLISH SKILL ACTIVE AUTOMATICALLY/);
  assert.match(r.context, /CLASSIFY FIRST/);
});

test('/ste off turns the bridge off and says so in one line', () => {
  sandbox();
  const r = tracker.decide('/ste off', ON);
  assert.equal(r.state.ste, false);
  assert.equal(r.context, tracker.STE_OFF_MESSAGE);
  assert.doesNotMatch(r.context, /CLASSIFY FIRST/);
});

test('/ste status reports both states and changes neither', () => {
  sandbox();
  const r = tracker.decide('/ste status', BOTH);
  assert.deepEqual(r.state, BOTH);
  assert.match(r.context, /ste: on/);
  assert.match(r.context, /caveman: full/);
});

test('case and extra spacing do not change how /ste parses', () => {
  sandbox();
  for (const p of ['/STE ON', '  /ste   on  ', '/Ste\ton', '/ste:ste on']) {
    assert.equal(tracker.decide(p, { ste: false, caveman: 'off' }).state.ste, true, `prompt: ${p}`);
  }
});

test('a bare /ste and an unknown argument report instead of toggling', () => {
  sandbox();
  for (const p of ['/ste', '/ste onn', '/ste enable']) {
    const r = tracker.decide(p, ON);
    assert.deepEqual(r.state, ON, `prompt: ${p}`);
    assert.match(r.context, /STE-BRIDGE STATUS/, `prompt: ${p}`);
  }
});

test('/ste inside a longer sentence is not a command', () => {
  sandbox();
  const r = tracker.decide('please explain /ste on to me', ON);
  assert.doesNotMatch(r.context, /STE-BRIDGE STATUS/);
});

// --- caveman mirroring ----------------------------------------------------

test('/caveman <mode> is mirrored for every mode caveman accepts', () => {
  sandbox();
  const cases = {
    '/caveman lite': 'lite',
    '/caveman full': 'full',
    '/caveman ultra': 'ultra',
    '/caveman wenyan-lite': 'wenyan-lite',
    '/caveman wenyan': 'wenyan',
    '/caveman wenyan-ultra': 'wenyan-ultra',
    '/caveman wenyan-full': 'wenyan',
    '/caveman off': 'off',
    '/caveman stop': 'off',
    '/caveman disable': 'off',
    '/caveman:caveman ultra': 'ultra'
  };
  for (const [prompt, expected] of Object.entries(cases)) {
    assert.equal(tracker.cavemanModeFrom(prompt.toLowerCase()), expected, `prompt: ${prompt}`);
  }
});

test('a bare /caveman resolves caveman own default mode', () => {
  const { cavemanPath } = sandbox();
  assert.equal(tracker.cavemanModeFrom('/caveman'), 'full');
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'lite' }));
  assert.equal(tracker.cavemanModeFrom('/caveman'), 'lite');
});

test('an unknown /caveman argument leaves the mode untouched', () => {
  sandbox();
  assert.equal(tracker.cavemanModeFrom('/caveman turbo'), null);
});

test('/caveman-stats never changes the mode and injects nothing', () => {
  sandbox();
  for (const p of ['/caveman-stats', '/caveman-stats --share', '/caveman:caveman-stats --all']) {
    assert.equal(tracker.CAVEMAN_STATS_RE.test(p), true, `regex: ${p}`);
    const r = tracker.decide(p, BOTH);
    assert.deepEqual(r.state, BOTH, `prompt: ${p}`);
    assert.equal(r.context, '', `prompt: ${p}`);
  }
});

test('the one-shot caveman commands are deliberately not persisted', () => {
  sandbox();
  for (const p of ['/caveman-commit', '/caveman-review', '/caveman-compress']) {
    assert.equal(tracker.cavemanModeFrom(p), null, `prompt: ${p}`);
  }
});

test('"stop caveman" mid-sentence turns caveman off', () => {
  sandbox();
  const prompts = [
    'stop caveman',
    'ok, please stop caveman and answer normally',
    'can you disable caveman for this file?',
    'turn off caveman now',
    'caveman off please deactivate',
    'switch to normal mode'
  ];
  for (const p of prompts) {
    assert.equal(tracker.cavemanModeFrom(p), 'off', `prompt: ${p}`);
  }
});

test('natural-language activation resolves caveman default and respects negation', () => {
  sandbox();
  assert.equal(tracker.cavemanModeFrom('activate caveman'), 'full');
  assert.equal(tracker.cavemanModeFrom('turn on caveman mode'), 'full');
  assert.equal(tracker.cavemanModeFrom('talk like a caveman'), 'full');
  assert.equal(tracker.cavemanModeFrom('please deactivate caveman'), 'off');
});

test('an ordinary prompt changes nothing', () => {
  sandbox();
  assert.equal(tracker.cavemanModeFrom('why is this component re-rendering?'), null);
  const r = tracker.decide('why is this component re-rendering?', ON);
  assert.deepEqual(r.state, ON);
  assert.equal(r.context, '');
});

// --- per-turn reinforcement ----------------------------------------------

test('both on: one line of precedence, and nothing longer', () => {
  sandbox();
  const r = tracker.decide('fix the migration', BOTH);
  assert.equal(r.context, tracker.precedenceLine('full'));
  assert.match(r.context, /caveman \(full\) is the default style/);
  assert.equal(r.context.split('\n').length, 1);
});

test('ste on with caveman off stays silent per turn', () => {
  sandbox();
  assert.equal(tracker.decide('fix the migration', ON).context, '');
});

test('ste off stays silent per turn even when caveman is on', () => {
  sandbox();
  assert.equal(tracker.decide('fix the migration', { ste: false, caveman: 'full' }).context, '');
});

// --- end to end -----------------------------------------------------------

function runTracker(prompt, root) {
  return execFileSync(process.execPath, [path.join(HOOKS, 'ste-mode-tracker.js')], {
    input: JSON.stringify({ prompt, hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: root, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
  });
}

test('running the hook persists /ste off and the next activate emits nothing', () => {
  const { root, config, statePath } = sandbox();
  const out = runTracker('/ste off', root);
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /STE-BRIDGE OFF/);
  assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), { ste: false, caveman: 'off', cavemanLastMode: 'full' });
  assert.deepEqual(config.readState(), { ste: false, caveman: 'off', cavemanLastMode: 'full' });

  const activated = execFileSync(process.execPath, [path.join(HOOKS, 'ste-activate.js')], {
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: root, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
  });
  assert.equal(activated, '');
});

test('running the hook writes caveman defaultMode and keeps other keys', () => {
  const { root, cavemanPath, statePath } = sandbox();
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'lite', keepMe: true }));
  runTracker('/caveman full', root);
  assert.deepEqual(JSON.parse(fs.readFileSync(cavemanPath, 'utf8')), { defaultMode: 'full', keepMe: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), { ste: true, caveman: 'full', cavemanLastMode: 'full' });
});

test('the hook never writes caveman session flag file', () => {
  const { root } = sandbox();
  const claudeDir = path.join(root, 'fake-claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  execFileSync(process.execPath, [path.join(HOOKS, 'ste-mode-tracker.js')], {
    input: JSON.stringify({ prompt: '/caveman ultra' }),
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: root, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
  });
  assert.equal(fs.existsSync(path.join(claudeDir, '.caveman-active')), false);
});

test('malformed hook input exits 0 and emits nothing', () => {
  const { root } = sandbox();
  const out = execFileSync(process.execPath, [path.join(HOOKS, 'ste-mode-tracker.js')], {
    input: 'not json at all',
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: root, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
  });
  assert.equal(out, '');
});

// --- blast radius of a persistent "off" -----------------------------------
//
// Writing caveman's defaultMode changes every later session, so only an
// explicit instruction earns it. Everything caveman treats as a session-only
// toggle stays session-only here, which means no write to either file.

test('only an explicit deactivation persists caveman off', () => {
  sandbox();
  const persists = [
    'stop caveman',
    'Stop caveman.',
    'stop caveman please',
    'please stop caveman now',
    'turn off caveman',
    'turn off caveman. now fix the failing test.',
    'deactivate caveman\nand keep going',
    '/caveman off',
    '/caveman:caveman off',
    '/caveman stop',
    '/caveman disable'
  ];
  for (const p of persists) {
    const intent = tracker.cavemanIntentFrom(p.toLowerCase());
    assert.equal(intent.mode, 'off', `prompt: ${p}`);
    assert.equal(intent.persistCaveman, true, `prompt: ${p}`);
  }
});

test('a deactivation quoted in code is never persisted', () => {
  sandbox();
  const quoted = [
    'how do I\n```\nstop caveman\n```\nin the docs?',
    'run `stop caveman`',
    '`stop caveman` is the phrase the hook matches',
    'example:\n```\nstop caveman',
    'document `turn off caveman` and `/caveman off` in the readme'
  ];
  for (const p of quoted) {
    assert.equal(tracker.isExplicitStop(p), false, `prompt: ${p}`);
  }
});

test('a deactivation buried in a sentence is session-only, not persisted', () => {
  sandbox();
  const sessionOnly = [
    'ok, please stop caveman and answer normally',
    'can you disable caveman for this file?',
    'i think we should turn off caveman before the release notes',
    'caveman off please deactivate',
    'normal mode',
    'switch to normal mode',
    'put the printer in normal mode'
  ];
  for (const p of sessionOnly) {
    const intent = tracker.cavemanIntentFrom(p);
    assert.equal(intent.mode, 'off', `prompt: ${p}`);
    assert.equal(intent.persistCaveman, false, `prompt: ${p}`);
    assert.equal(intent.persistState, false, `prompt: ${p}`);
  }
});

test('a session-only deactivation leaves both files byte-identical', () => {
  const { root, cavemanPath, statePath, config } = sandbox();
  config.writeState({ ste: true, caveman: 'full', cavemanLastMode: 'full' });
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'full', keepMe: true }));
  const cavemanBefore = fs.readFileSync(cavemanPath);
  const stateBefore = fs.readFileSync(statePath);
  for (const p of ['put the printer in normal mode', 'normal mode', 'ok, please stop caveman and answer normally']) {
    runTracker(p, root);
    assert.deepEqual(fs.readFileSync(cavemanPath), cavemanBefore, `prompt: ${p}`);
    assert.deepEqual(fs.readFileSync(statePath), stateBefore, `prompt: ${p}`);
  }
});

test('an explicit "stop caveman" does write off', () => {
  const { root, cavemanPath } = sandbox();
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'full' }));
  runTracker('stop caveman', root);
  assert.equal(JSON.parse(fs.readFileSync(cavemanPath, 'utf8')).defaultMode, 'off');
});

test('deactivation changes defaultMode and nothing else in caveman config', () => {
  const { root, cavemanPath } = sandbox();
  const before = { defaultMode: 'ultra', theme: 'dark', nested: { a: 1 }, list: [1, 2] };
  writeRaw(cavemanPath, JSON.stringify(before));
  runTracker('stop caveman', root);
  const after = JSON.parse(fs.readFileSync(cavemanPath, 'utf8'));
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  assert.deepEqual(after, { ...before, defaultMode: 'off' });
});

// --- the ste gate ---------------------------------------------------------

test('with ste off the hook parses no caveman command and writes nothing', () => {
  const { root, config, cavemanPath, statePath } = sandbox();
  config.writeState({ ste: false, caveman: 'full', cavemanLastMode: 'full' });
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'full', keepMe: true }));
  const cavemanBefore = fs.readFileSync(cavemanPath);
  const stateBefore = fs.readFileSync(statePath);
  for (const p of ['stop caveman', '/caveman off', '/caveman ultra', 'activate caveman']) {
    assert.equal(runTracker(p, root), '', `prompt: ${p}`);
    assert.deepEqual(fs.readFileSync(cavemanPath), cavemanBefore, `prompt: ${p}`);
    assert.deepEqual(fs.readFileSync(statePath), stateBefore, `prompt: ${p}`);
  }
});

test('with ste off decide reports no writes for any caveman prompt', () => {
  sandbox();
  const off = { ste: false, caveman: 'full', cavemanLastMode: 'full' };
  for (const p of ['stop caveman', '/caveman off', '/caveman ultra']) {
    const r = tracker.decide(p, off);
    assert.equal(r.persistState, false, `prompt: ${p}`);
    assert.equal(r.persistCaveman, false, `prompt: ${p}`);
    assert.equal(r.context, '', `prompt: ${p}`);
    assert.deepEqual(r.state, off, `prompt: ${p}`);
  }
});

// --- the "default is off" hint --------------------------------------------

test('a bare caveman activation while the default is off explains itself', () => {
  const { cavemanPath } = sandbox();
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'off' }));
  for (const p of ['/caveman', '/caveman:caveman', 'activate caveman', 'turn on caveman mode']) {
    const r = tracker.decide(p, ON);
    assert.match(
      r.context,
      /caveman default is off; run \/caveman <mode> \(full\|lite\|ultra\) — ste will remember it\./,
      `prompt: ${p}`
    );
    assert.match(r.context, /Last mode you chose: full\./, `prompt: ${p}`);
    assert.equal(r.context.split('\n').length, 1, `prompt: ${p}`);
    assert.equal(r.persistState, false, `prompt: ${p}`);
    assert.equal(r.persistCaveman, false, `prompt: ${p}`);
  }
});

test('no hint when caveman has a real default: the command just works', () => {
  const { cavemanPath } = sandbox();
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'lite' }));
  const r = tracker.decide('/caveman', ON);
  assert.doesNotMatch(r.context, /caveman default is off/);
  assert.equal(r.state.caveman, 'lite');
  assert.equal(r.persistState, true);
  assert.equal(r.persistCaveman, false, 'a bare /caveman must not rewrite caveman own default');
});

test('cavemanLastMode records explicit modes and the hint names it', () => {
  const { root, cavemanPath, statePath } = sandbox();
  runTracker('/caveman ultra', root);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).cavemanLastMode, 'ultra');
  runTracker('/caveman off', root);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')),
    { ste: true, caveman: 'off', cavemanLastMode: 'ultra' });
  assert.equal(JSON.parse(fs.readFileSync(cavemanPath, 'utf8')).defaultMode, 'off');
  const out = runTracker('/caveman', root);
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /Last mode you chose: ultra\./);
});

// --- argument tails -------------------------------------------------------

test('/ste on junk runs the command and names the tail it ignored', () => {
  sandbox();
  const on = tracker.decide('/ste on junk extra', { ste: false, caveman: 'off' });
  assert.equal(on.state.ste, true);
  assert.match(on.context, /^STE-BRIDGE: ignored extra arguments after "\/ste on": "junk extra"\./m);
  assert.match(on.context, /STE-BRIDGE ON\./);
  assert.match(on.context, /CLASSIFY FIRST/);

  const off = tracker.decide('/ste off whatever', ON);
  assert.equal(off.state.ste, false);
  assert.match(off.context, /ignored extra arguments after "\/ste off": "whatever"\./);
  assert.match(off.context, /STE-BRIDGE OFF\./);

  const status = tracker.decide('/ste bogus tail here', ON);
  assert.deepEqual(status.state, ON);
  assert.match(status.context, /ignored extra arguments after "\/ste bogus": "tail here"\./);
  assert.match(status.context, /STE-BRIDGE STATUS/);
});
