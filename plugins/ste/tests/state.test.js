'use strict';
// State file: hardened read, validated write, caveman config merge.

const test = require('node:test');
const os = require('node:os');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanupSandboxes, sandbox, writeRaw } = require('./helpers');

test.after(cleanupSandboxes);

test('a missing state file yields the defaults: ste on, caveman off', () => {
  const { config } = sandbox();
  assert.deepEqual(config.readState(), { ste: true, caveman: 'off', cavemanLastMode: 'full' });
});

test('a valid state file round-trips through write and read', () => {
  const { config, statePath } = sandbox();
  assert.equal(config.writeState({ ste: false, caveman: 'ultra' }), true);
  assert.deepEqual(config.readState(), { ste: false, caveman: 'ultra', cavemanLastMode: 'full' });
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
});

test('a symlinked state file is refused and the defaults are used', () => {
  const { config, statePath, root } = sandbox();
  const secret = path.join(root, 'secret.json');
  writeRaw(secret, JSON.stringify({ ste: false, caveman: 'ultra' }));
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.symlinkSync(secret, statePath);
  assert.deepEqual(config.readState(), { ste: true, caveman: 'off', cavemanLastMode: 'full' });
});

test('a state file over the size cap is refused', () => {
  const { config, statePath } = sandbox();
  const padded = JSON.stringify({ ste: false, caveman: 'ultra', pad: 'x'.repeat(config.MAX_STATE_BYTES) });
  writeRaw(statePath, padded);
  assert.ok(padded.length > config.MAX_STATE_BYTES);
  assert.deepEqual(config.readState(), { ste: true, caveman: 'off', cavemanLastMode: 'full' });
});

test('a state file just under the size cap is still read', () => {
  const { config, statePath } = sandbox();
  const pad = 'x'.repeat(config.MAX_STATE_BYTES - 200);
  writeRaw(statePath, JSON.stringify({ ste: false, caveman: 'lite', pad }));
  assert.deepEqual(config.readState(), { ste: false, caveman: 'lite', cavemanLastMode: 'full' });
});

test('bad field values fall back per field, not wholesale', () => {
  const { config, statePath } = sandbox();
  writeRaw(statePath, JSON.stringify({ ste: 'yes', caveman: 'lite' }));
  assert.deepEqual(config.readState(), { ste: true, caveman: 'lite', cavemanLastMode: 'full' });
  writeRaw(statePath, JSON.stringify({ ste: false, caveman: '../../etc/passwd' }));
  assert.deepEqual(config.readState(), { ste: false, caveman: 'off', cavemanLastMode: 'full' });
});

test('malformed JSON, a non-object, and an empty file all yield the defaults', () => {
  const { config, statePath } = sandbox();
  for (const body of ['{not json', '[]', '', 'null', '"full"']) {
    writeRaw(statePath, body);
    assert.deepEqual(config.readState(), { ste: true, caveman: 'off', cavemanLastMode: 'full' }, `body: ${body}`);
  }
});

test('a directory in place of the state file yields the defaults', () => {
  const { config, statePath } = sandbox();
  fs.mkdirSync(statePath, { recursive: true });
  assert.deepEqual(config.readState(), { ste: true, caveman: 'off', cavemanLastMode: 'full' });
});

test('writeState refuses to persist a value readState would reject', () => {
  const { config } = sandbox();
  config.writeState({ ste: 'yes', caveman: 'nonsense' });
  assert.deepEqual(config.readState(), { ste: true, caveman: 'off', cavemanLastMode: 'full' });
});

test('writeState refuses a symlinked target rather than clobbering it', () => {
  const { config, statePath, root } = sandbox();
  const victim = path.join(root, 'victim.txt');
  writeRaw(victim, 'untouched');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.symlinkSync(victim, statePath);
  assert.equal(config.writeState({ ste: false, caveman: 'full' }), false);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
});

test('writeCavemanDefaultMode merges and preserves every other key', () => {
  const { config, cavemanPath } = sandbox();
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'lite', theme: 'dark', nested: { a: 1 } }));
  assert.equal(config.writeCavemanDefaultMode('ultra'), true);
  const after = JSON.parse(fs.readFileSync(cavemanPath, 'utf8'));
  assert.deepEqual(after, { defaultMode: 'ultra', theme: 'dark', nested: { a: 1 } });
});

test('writeCavemanDefaultMode creates the directory when caveman has no config yet', () => {
  const { config, cavemanPath } = sandbox();
  assert.equal(fs.existsSync(cavemanPath), false);
  assert.equal(config.writeCavemanDefaultMode('off'), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(cavemanPath, 'utf8')), { defaultMode: 'off' });
});

test('writeCavemanDefaultMode rejects a mode outside caveman VALID_MODES', () => {
  const { config, cavemanPath } = sandbox();
  assert.equal(config.writeCavemanDefaultMode('turbo'), false);
  assert.equal(fs.existsSync(cavemanPath), false);
});

test('readCavemanDefaultMode mirrors caveman: env, then config, then full', () => {
  const { config, cavemanPath } = sandbox();
  assert.equal(config.readCavemanDefaultMode(), 'full');
  writeRaw(cavemanPath, JSON.stringify({ defaultMode: 'LITE' }));
  assert.equal(config.readCavemanDefaultMode(), 'lite');
  process.env.CAVEMAN_DEFAULT_MODE = 'ultra';
  assert.equal(config.readCavemanDefaultMode(), 'ultra');
  delete process.env.CAVEMAN_DEFAULT_MODE;
});

test('a symlinked caveman config is refused on read', () => {
  const { config, cavemanPath, root } = sandbox();
  const secret = path.join(root, 'caveman-secret.json');
  writeRaw(secret, JSON.stringify({ defaultMode: 'ultra' }));
  fs.mkdirSync(path.dirname(cavemanPath), { recursive: true });
  fs.symlinkSync(secret, cavemanPath);
  assert.equal(config.readCavemanDefaultMode(), 'full');
});

test('the mode whitelist matches caveman VALID_MODES exactly', () => {
  const { config } = sandbox();
  assert.deepEqual(config.VALID_CAVEMAN_MODES, [
    'off', 'lite', 'full', 'ultra',
    'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
    'commit', 'review', 'compress'
  ]);
});

// --- cavemanLastMode ------------------------------------------------------

test('cavemanLastMode round-trips and defaults to full', () => {
  const { config } = sandbox();
  assert.equal(config.readState().cavemanLastMode, 'full');
  config.writeState({ ste: true, caveman: 'off', cavemanLastMode: 'ultra' });
  assert.equal(config.readState().cavemanLastMode, 'ultra');
});

test('cavemanLastMode refuses off and anything outside the whitelist', () => {
  const { config, statePath } = sandbox();
  assert.equal(config.normalizeCavemanLastMode('off'), null);
  assert.equal(config.normalizeCavemanLastMode('turbo'), null);
  assert.equal(config.normalizeCavemanLastMode('WENYAN'), 'wenyan');
  for (const bad of ['off', 'turbo', 7, null]) {
    writeRaw(statePath, JSON.stringify({ ste: true, caveman: 'off', cavemanLastMode: bad }));
    assert.equal(config.readState().cavemanLastMode, 'full', `value: ${bad}`);
  }
});

// --- directory hardening --------------------------------------------------

test('a symlinked config dir owned by this user is followed, not refused', () => {
  const { config, root } = sandbox();
  const real = path.join(root, 'real-config');
  fs.mkdirSync(real, { recursive: true });
  const link = path.join(root, 'linked');
  fs.symlinkSync(real, link);
  assert.notEqual(config.resolveWritableDir(path.join(link, 'ste')), null);
  assert.equal(config.writeFileHardened(path.join(link, 'ste', 'state.json'), '{"ste":true}'), true);
  assert.equal(fs.readFileSync(path.join(real, 'ste', 'state.json'), 'utf8'), '{"ste":true}');
});

test('a config dir whose PARENT is a symlink to another user is refused', (t) => {
  const { config, root } = sandbox();
  if (typeof process.getuid !== 'function') return t.skip('no uid on this platform');
  // A directory that exists, is writable, and is owned by someone else. The
  // shared temp directory is root-owned on Linux and macOS.
  const foreign = os.tmpdir();
  if (fs.statSync(foreign).uid === process.getuid()) return t.skip('temp dir is owned by this user');

  // link -> /tmp stands in for a ~/.config symlinked into a foreign-owned tree.
  // The config dir under it is <foreign>/ste, and nothing may be created there.
  const link = path.join(root, 'link');
  fs.symlinkSync(foreign, link);
  const victimDir = path.join(foreign, 'ste');
  if (fs.existsSync(victimDir)) return t.skip(`${victimDir} already exists`);

  assert.equal(config.resolveWritableDir(path.join(link, 'ste')), null);
  assert.equal(config.writeFileHardened(path.join(link, 'ste', 'state.json'), '{}'), false);
  assert.equal(fs.existsSync(victimDir), false, 'refusal still created a directory in a foreign-owned tree');
});
