#!/usr/bin/env node
// ste — shared state resolver for the SimpleEnglish/caveman bridge.
//
// Two files matter to this plugin:
//
//   1. Its own state:  $XDG_CONFIG_HOME/ste/state.json  else  ~/.config/ste/state.json
//      Shape: {"ste": <boolean>, "caveman": "<caveman mode>",
//              "cavemanLastMode": "<caveman mode, never off>"}
//      Missing file, unreadable file, or a bad value for a field => that field
//      falls back to its default. Defaults:
//      {"ste": true, "caveman": "off", "cavemanLastMode": "full"}.
//      "cavemanLastMode" remembers the last mode the user asked for explicitly,
//      so the hint shown while caveman's default is "off" can name it.
//
//   2. caveman's own config: $XDG_CONFIG_HOME/caveman/config.json else
//      ~/.config/caveman/config.json, field "defaultMode".
//      caveman's SessionStart hook (caveman-activate.js) rewrites the active
//      mode from that file on every session start, so writing "defaultMode"
//      there is what makes a caveman toggle survive into the next session.
//      This module only ever merges the one key; every other key is preserved.
//
// The read/write hardening mirrors caveman's own hooks/caveman-config.js:
// refuse a symlink at the target path, cap the read, whitelist the values,
// and write atomically through a temp file + rename with 0600 permissions.
// Without that, a local attacker who can write into the config directory could
// point state.json at a secret and have every reader inject those bytes into
// model context.
//
// Node standard library only. No network. No child processes.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Must stay identical to VALID_MODES in caveman's hooks/caveman-config.js.
// Checked against caveman @ ef6050c5e184.
const VALID_CAVEMAN_MODES = [
  'off', 'lite', 'full', 'ultra',
  'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
  'commit', 'review', 'compress'
];

// Caveman modes that are one-shot behaviours with their own slash commands.
// caveman's tracker never treats them as a persistent style, and neither do we.
const INDEPENDENT_CAVEMAN_MODES = new Set(['commit', 'review', 'compress']);

const DEFAULT_STATE = Object.freeze({ ste: true, caveman: 'off', cavemanLastMode: 'full' });

// state.json holds two scalars. 4 KiB is far more than that needs and small
// enough that a symlink to a large secret is refused before it is read.
const MAX_STATE_BYTES = 4096;
// caveman's config.json is a small user config; cap it too rather than trust it.
const MAX_CAVEMAN_CONFIG_BYTES = 65536;

function configDirFor(appName, envDir) {
  if (envDir) {
    return path.join(envDir, appName);
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, appName);
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      appName
    );
  }
  return path.join(os.homedir(), '.config', appName);
}

function getConfigDir() {
  return configDirFor('ste', process.env.STE_CONFIG_DIR);
}

function getStatePath() {
  return path.join(getConfigDir(), 'state.json');
}

function getCavemanConfigDir() {
  return configDirFor('caveman');
}

function getCavemanConfigPath() {
  return path.join(getCavemanConfigDir(), 'config.json');
}

// Symlink-safe, size-capped read. Returns the file text, or null on any
// anomaly (missing, a symlink, not a regular file, over the cap, unreadable).
function readFileHardened(filePath, maxBytes) {
  try {
    let st;
    try {
      st = fs.lstatSync(filePath);
    } catch (e) {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > maxBytes) return null;

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | O_NOFOLLOW);
      const buf = Buffer.alloc(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.slice(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
}

function readJsonHardened(filePath, maxBytes) {
  const raw = readFileHardened(filePath, maxBytes);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

// Check one directory that may itself be a symlink (a legitimate pattern: a
// ~/.config symlinked onto another drive), verifying the real target is a
// directory owned by this user. Returns the real directory, or null to refuse.
// Same ownership rules as caveman's safeWriteFlag.
function resolveDirIfSafe(dir) {
  try {
    const st = fs.lstatSync(dir);
    if (!st.isSymbolicLink()) return dir;
    const real = fs.realpathSync(dir);
    const realStat = fs.statSync(real);
    if (!realStat.isDirectory()) return null;
    if (typeof process.getuid === 'function') {
      // Unix: the real target must be owned by the user running the hook.
      if (realStat.uid !== process.getuid()) return null;
      return real;
    }
    // Windows has no uid; fall back to "the target lives under this user's home".
    const home = path.resolve(os.homedir()).toLowerCase();
    const normalized = path.resolve(real).toLowerCase();
    if (normalized !== home && !normalized.startsWith(home + path.sep)) return null;
    return real;
  } catch (e) {
    return null;
  }
}

// Resolve the directory a config file will be written into.
//
// caveman's safeWriteFlag checks only the immediate parent of the file it
// writes. This checks two levels: the config directory itself (~/.config/ste,
// ~/.config/caveman) AND its own parent (~/.config). A symlink planted one
// level up is the same attack with one more step, and the extra check is two
// lstat calls.
//
// The grandparent is validated BEFORE the leaf directory is created, so a
// refusal never leaves an empty directory behind inside an attacker-chosen or
// foreign-owned target.
//
// Returns the real directory to write into, or null to refuse.
function resolveWritableDir(dir) {
  const parent = path.dirname(dir);
  if (parent !== dir) {
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch (e) {
      return null;
    }
    if (resolveDirIfSafe(parent) === null) return null;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return null;
  }
  return resolveDirIfSafe(dir);
}

// Atomic, symlink-refusing write. Returns true on success, false on refusal or
// any filesystem error — a failed write is never fatal to a hook.
function writeFileHardened(filePath, content) {
  try {
    const realDir = resolveWritableDir(path.dirname(filePath));
    if (realDir === null) return false;
    const realPath = path.join(realDir, path.basename(filePath));

    // The target must never be a symlink: that is the clobber vector.
    try {
      if (fs.lstatSync(realPath).isSymbolicLink()) return false;
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }

    const tempPath = path.join(realDir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tempPath, flags, 0o600);
      fs.writeSync(fd, String(content));
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tempPath, realPath);
    return true;
  } catch (e) {
    return false;
  }
}

function normalizeCavemanMode(value) {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  if (!VALID_CAVEMAN_MODES.includes(mode)) return null;
  return mode;
}

// "cavemanLastMode" records a mode the user chose on purpose, so "off" is not a
// legal value for it: the whole point of the field is to name a mode worth
// going back to. Whitelist is VALID_CAVEMAN_MODES minus 'off'.
function normalizeCavemanLastMode(value) {
  const mode = normalizeCavemanMode(value);
  if (mode === null || mode === 'off') return null;
  return mode;
}

// Read this plugin's state. Never throws. Every field validates independently,
// so one bad value does not discard the other.
function readState() {
  const parsed = readJsonHardened(getStatePath(), MAX_STATE_BYTES);
  if (parsed === null) return { ...DEFAULT_STATE };
  const state = { ...DEFAULT_STATE };
  if (typeof parsed.ste === 'boolean') {
    state.ste = parsed.ste;
  }
  const mode = normalizeCavemanMode(parsed.caveman);
  if (mode !== null) {
    state.caveman = mode;
  }
  const lastMode = normalizeCavemanLastMode(parsed.cavemanLastMode);
  if (lastMode !== null) {
    state.cavemanLastMode = lastMode;
  }
  return state;
}

// Write this plugin's state, validating first so a caller cannot persist a
// value that readState would then reject. Returns true on success.
function writeState(state) {
  const out = {
    ste: typeof state.ste === 'boolean' ? state.ste : DEFAULT_STATE.ste,
    caveman: normalizeCavemanMode(state.caveman) || DEFAULT_STATE.caveman,
    cavemanLastMode: normalizeCavemanLastMode(state.cavemanLastMode) || DEFAULT_STATE.cavemanLastMode
  };
  return writeFileHardened(getStatePath(), JSON.stringify(out, null, 2) + '\n');
}

// caveman's own resolution order, mirrored: CAVEMAN_DEFAULT_MODE, then
// config.json defaultMode, then 'full'. Used only where caveman itself would
// use it — resolving a bare "activate caveman" with no explicit mode.
function readCavemanDefaultMode() {
  const envMode = normalizeCavemanMode(process.env.CAVEMAN_DEFAULT_MODE);
  if (envMode !== null) return envMode;
  const config = readJsonHardened(getCavemanConfigPath(), MAX_CAVEMAN_CONFIG_BYTES);
  if (config !== null) {
    const mode = normalizeCavemanMode(config.defaultMode);
    if (mode !== null) return mode;
  }
  return 'full';
}

// Persist a caveman mode into caveman's own config.json, merging so that every
// other key the user has set survives. This is the whole persistence mechanism
// for the caveman half: caveman-activate.js reads defaultMode at ITS
// SessionStart, so the value written here is what the next session starts in.
// Returns true on success.
function writeCavemanDefaultMode(mode) {
  const normalized = normalizeCavemanMode(mode);
  if (normalized === null) return false;
  const existing = readJsonHardened(getCavemanConfigPath(), MAX_CAVEMAN_CONFIG_BYTES) || {};
  const merged = { ...existing, defaultMode: normalized };
  return writeFileHardened(getCavemanConfigPath(), JSON.stringify(merged, null, 2) + '\n');
}

module.exports = {
  DEFAULT_STATE,
  INDEPENDENT_CAVEMAN_MODES,
  MAX_CAVEMAN_CONFIG_BYTES,
  MAX_STATE_BYTES,
  VALID_CAVEMAN_MODES,
  getCavemanConfigDir,
  getCavemanConfigPath,
  getConfigDir,
  getStatePath,
  normalizeCavemanLastMode,
  normalizeCavemanMode,
  resolveWritableDir,
  readCavemanDefaultMode,
  readFileHardened,
  readJsonHardened,
  readState,
  writeCavemanDefaultMode,
  writeFileHardened,
  writeState
};
