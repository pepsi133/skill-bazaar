'use strict';
// Shared test scaffolding.
//
// Every test runs against a throwaway XDG_CONFIG_HOME under the OS temp
// directory, so no test can read or write the real ~/.config/ste or
// ~/.config/caveman. `sandbox()` asserts that before it hands the paths back.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const PLUGIN_ROOT = path.join(__dirname, '..');
const HOOKS = path.join(PLUGIN_ROOT, 'hooks');

function freshConfig() {
  // Re-require after an env change is not needed (paths resolve per call), but
  // clearing the cache keeps each test file independent.
  delete require.cache[require.resolve(path.join(HOOKS, 'ste-config.js'))];
  return require(path.join(HOOKS, 'ste-config.js'));
}

// Every sandbox this process created, removed when the process exits so a run
// leaves no `ste-test-*` directories behind in the OS temp directory.
const SANDBOXES = [];
let cleanupRegistered = false;

function cleanupSandboxes() {
  while (SANDBOXES.length > 0) {
    const dir = SANDBOXES.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // Best effort: a failed cleanup must never fail the run.
    }
  }
}

// Point XDG_CONFIG_HOME at a new temp directory and return the resolved paths.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ste-test-'));
  SANDBOXES.push(root);
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    // 'exit' fires for a normal end and for an explicit process.exit; the extra
    // signal handlers cover an interrupted run.
    process.on('exit', cleanupSandboxes);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => { cleanupSandboxes(); process.exit(1); });
    }
  }
  process.env.XDG_CONFIG_HOME = root;
  delete process.env.STE_CONFIG_DIR;
  delete process.env.CAVEMAN_DEFAULT_MODE;
  const config = freshConfig();
  const statePath = config.getStatePath();
  const cavemanPath = config.getCavemanConfigPath();
  // Refuse to run if anything resolved outside the sandbox.
  assert.ok(statePath.startsWith(root + path.sep), `state path escaped sandbox: ${statePath}`);
  assert.ok(cavemanPath.startsWith(root + path.sep), `caveman path escaped sandbox: ${cavemanPath}`);
  assert.ok(!statePath.startsWith(os.homedir() + path.sep), 'state path is inside the real home');
  return { root, config, statePath, cavemanPath };
}

function writeRaw(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

module.exports = { HOOKS, PLUGIN_ROOT, cleanupSandboxes, freshConfig, sandbox, writeRaw };
