#!/usr/bin/env node
// ste — UserPromptSubmit hook.
//
// Two jobs:
//
//   1. Own the /ste command. `/ste on`, `/ste off`, `/ste status` update this
//      plugin's state file and confirm through additionalContext. `/ste on`
//      re-injects the full ruleset so the change takes effect on this turn
//      instead of the next session.
//
//   2. Watch for caveman mode changes and persist them. The prompt patterns
//      below are copied from caveman's own hooks/caveman-mode-tracker.js
//      (@ ef6050c5e184) so both plugins agree on what a given sentence means.
//      caveman writes a session flag file; this hook writes "defaultMode" into
//      caveman's config.json instead, which is what caveman-activate.js reads
//      at ITS SessionStart. That, and not hook ordering, is why the setting
//      survives into the next session. This hook never touches caveman's flag
//      file: caveman's own tracker owns that for the current session.
//
// Two rules bound the blast radius of that second job:
//
//   * When "ste" is false this hook is inert. It does not look for caveman
//     commands and it writes nothing at all. "/ste off" means off.
//   * Writing caveman's config.json changes the default of EVERY later session,
//     so only an unambiguous instruction earns a write: "/caveman <mode>",
//     "/caveman off", or a deactivation phrase that is the whole prompt or a
//     sentence of its own. Everything caveman treats as a session-only toggle
//     ("normal mode", "stop caveman" buried inside a longer sentence) stays
//     session-only here too: this hook then writes nothing to either file.
//
// Always exits 0. Never blocks a prompt. Node standard library only, no
// network, no child processes.

const {
  DEFAULT_STATE,
  INDEPENDENT_CAVEMAN_MODES,
  VALID_CAVEMAN_MODES,
  readCavemanDefaultMode,
  readState,
  writeCavemanDefaultMode,
  writeState
} = require('./ste-config');
const { buildContext, pluginRoot, readPrompt, MAX_CHARS } = require('./ste-activate');

// /ste, /ste:ste (plugin-qualified form), with an optional argument and an
// optional tail. The tail is captured rather than left to fail the match, so
// "/ste on junk" is a recognised command with junk after it instead of a
// prompt this hook silently ignores.
const STE_COMMAND_RE = /^\/ste(?::ste)?(?:\s+(\S+)(?:\s+(.*?))?)?\s*$/;

// caveman's stats command. It must never change a mode — caveman's own tracker
// returns before its mode parsing for this, and so does this one.
const CAVEMAN_STATS_RE = /^\/caveman(?::caveman)?-stats(?:\s+(.*))?$/;

// Copied verbatim from caveman-mode-tracker.js.
const CAVEMAN_ACTIVATE_RE_A = /\b(activate|enable|turn on|start|talk like)\b.*\bcaveman\b/i;
const CAVEMAN_ACTIVATE_RE_B = /\bcaveman\b.*\b(mode|activate|enable|turn on|start)\b/i;
const CAVEMAN_NEGATION_RE = /\b(stop|disable|turn off|deactivate)\b/i;
const CAVEMAN_DEACTIVATE_RE_A = /\b(stop|disable|deactivate|turn off)\b.*\bcaveman\b/i;
const CAVEMAN_DEACTIVATE_RE_B = /\bcaveman\b.*\b(stop|disable|deactivate|turn off)\b/i;
const CAVEMAN_NORMAL_MODE_RE = /\bnormal mode\b/i;

// Explicit, persistent deactivation.
//
// caveman deletes its session flag for any of the patterns above, wherever they
// appear in a sentence. Deleting a flag costs one session; writing
// "defaultMode": "off" costs every session until someone changes it back. So a
// write needs the stronger signal: the deactivation must be the ENTIRE trimmed
// prompt, or one whole sentence of it — nothing else in that sentence except
// leading politeness ("please", "ok,") and a trailing "now"/"please"/"thanks".
//
// Decided cases, all covered by tests:
//   "stop caveman"                              -> persists off (whole prompt)
//   "please stop caveman now"                   -> persists off (politeness only)
//   "turn off caveman. now fix the test."       -> persists off (own sentence)
//   "ok, please stop caveman and answer normally" -> session only (extra clause)
//   "can you disable caveman for this file?"    -> session only (extra clause)
//   "normal mode" / "put it in normal mode"     -> session only, always
const CAVEMAN_STOP_SENTENCE_RE = new RegExp(
  '^(?:please|ok|okay|hey|yo)?[,!]?\\s*' +
  '(?:please[,]?\\s+)?' +
  '(?:(?:stop|disable|deactivate|turn\\s+off)\\s+caveman|caveman[,]?\\s+(?:stop|disable|deactivate|off|turn\\s+off))' +
  '(?:\\s+mode)?' +
  '(?:[,]?\\s+(?:now|please|thanks|thank\\s+you))*' +
  '[.!]?$',
  'i'
);

// Sentence boundaries for the rule above. Newlines count: a deactivation on its
// own line is as unambiguous as one ended with a full stop.
const SENTENCE_SPLIT_RE = /[.!?;\n]+/;

// Quoted text is not an instruction. Asking about the phrase — pasting it in a
// fenced block, or naming it in backticks while writing docs — must never write
// "defaultMode": "off". Both spans are removed before the check below, so only
// what the user is actually saying is matched:
//   "how do I\n```\nstop caveman\n```\nin the docs?"  -> no write
//   "run `stop caveman`"                             -> no write
//   "stop caveman"                                   -> writes, as before
// An unclosed fence runs to the end of the prompt: half a code block is still
// quoting, not commanding. Each span becomes a newline rather than nothing, so a
// removed span is a sentence boundary and a stop phrase can never be assembled
// out of the text on either side of it.
const FENCED_BLOCK_RE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

function stripCodeSpans(prompt) {
  return prompt.replace(FENCED_BLOCK_RE, '\n').replace(INLINE_CODE_RE, '\n');
}

function isExplicitStop(prompt) {
  const whole = stripCodeSpans(prompt).trim();
  if (CAVEMAN_STOP_SENTENCE_RE.test(whole)) return true;
  return whole
    .split(SENTENCE_SPLIT_RE)
    .some((sentence) => sentence.trim() !== '' && CAVEMAN_STOP_SENTENCE_RE.test(sentence.trim()));
}

const STE_OFF_MESSAGE =
  'STE-BRIDGE OFF. Simple Technical English is no longer enforced. The setting is saved and applies to later sessions until "/ste on".';

// Bare "/caveman" or "activate caveman" while caveman's stored default is off.
// caveman's own tracker resolves the default, gets "off", and writes no flag —
// the command silently does nothing. One line explains it and names the way out.
const cavemanOffHint = (lastMode) =>
  `STE-BRIDGE: caveman default is off; run /caveman <mode> (full|lite|ultra) — ste will remember it. Last mode you chose: ${lastMode}.`;

// One line, per turn, when both styles are live. caveman's own tracker already
// reinforces caveman every turn; this only adds the half caveman cannot state.
const precedenceLine = (mode) =>
  `STE-BRIDGE: caveman (${mode}) is the default style. On the turns caveman itself says to drop compression — security warnings, irreversible actions, multi-step sequences, ambiguity, or the user asking to clarify — write Simple Technical English instead of unrestricted normal English: full grammar, articles and "that" kept, no contractions, active voice, modals can/will/must only.`;

function statusMessage(state) {
  return [
    'STE-BRIDGE STATUS.',
    `ste: ${state.ste ? 'on' : 'off'}`,
    `caveman: ${state.caveman}`,
    state.ste && state.caveman !== 'off' && !INDEPENDENT_CAVEMAN_MODES.has(state.caveman)
      ? 'Both are on, so caveman wins for ordinary turns and STE wins on the turns caveman drops compression.'
      : state.ste
        ? 'STE is the sole style; caveman is not styling replies.'
        : 'STE is off; this plugin adds no style instruction.'
  ].join('\n');
}

// Resolve what a prompt asks of caveman, mirroring caveman's own order:
// natural-language activation, then slash commands, then deactivation.
//
// Returns { mode, persistState, persistCaveman, hint }:
//   mode          the mode caveman will be in for this turn, or null for no
//                 change. This is what caveman's own tracker would conclude.
//   persistState  record `mode` in this plugin's state.json.
//   persistCaveman write `mode` as caveman's defaultMode, changing every later
//                 session. Explicit forms only — see CAVEMAN_STOP_SENTENCE_RE.
//   hint          the user asked for caveman without naming a mode while the
//                 stored default is "off", which caveman's own tracker turns
//                 into a no-op. Say so.
function cavemanIntentFrom(prompt) {
  let mode = null;
  let persistState = false;
  let persistCaveman = false;
  let hint = false;
  // A "/caveman <mode>" command is already explicit and already decided. The
  // deactivation pass below must not downgrade it: "/caveman stop" matches
  // caveman's own deactivation regex, and it is a command, not a sentence.
  let slashExplicit = false;

  if ((CAVEMAN_ACTIVATE_RE_A.test(prompt) || CAVEMAN_ACTIVATE_RE_B.test(prompt)) &&
      !CAVEMAN_NEGATION_RE.test(prompt)) {
    const resolved = readCavemanDefaultMode();
    if (resolved === 'off') {
      // caveman's tracker resolves the default, sees "off", and writes no flag.
      // Nothing happens, and nothing on screen says why. This is that line.
      hint = true;
    } else {
      // Activation without a named mode: record what caveman is doing this
      // session, but do not rewrite caveman's own default.
      mode = resolved;
      persistState = true;
    }
  }

  if (prompt.startsWith('/caveman')) {
    const parts = prompt.split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1] || '';
    if (cmd === '/caveman' || cmd === '/caveman:caveman') {
      if (!arg) {
        const resolved = readCavemanDefaultMode();
        if (resolved === 'off') {
          hint = true;
          mode = null;
          persistState = false;
        } else {
          mode = resolved;
          persistState = true;
          persistCaveman = false;
        }
      } else {
        let explicit = null;
        if (arg === 'off' || arg === 'stop' || arg === 'disable') {
          explicit = 'off';
        } else if (arg === 'wenyan-full') {
          // caveman's canonical alias — its config stores this as 'wenyan'.
          explicit = 'wenyan';
        } else if (VALID_CAVEMAN_MODES.includes(arg) && !INDEPENDENT_CAVEMAN_MODES.has(arg)) {
          explicit = arg;
        }
        // Unknown argument: leave the mode alone rather than overwrite silently.
        if (explicit !== null) {
          mode = explicit;
          persistState = true;
          persistCaveman = true;
          hint = false;
          slashExplicit = true;
        }
      }
    }
    // /caveman-commit, /caveman-review, /caveman-compress are one-shot modes
    // with their own skills. caveman keeps them in its session flag only, never
    // in config.json, so persisting one here would wrongly make it the default
    // style of every later session. Ignored on purpose.
  }

  if (!slashExplicit &&
      (CAVEMAN_DEACTIVATE_RE_A.test(prompt) ||
       CAVEMAN_DEACTIVATE_RE_B.test(prompt) ||
       CAVEMAN_NORMAL_MODE_RE.test(prompt))) {
    mode = 'off';
    hint = false;
    // "normal mode" never names caveman, so it can never satisfy
    // CAVEMAN_STOP_SENTENCE_RE: it is always session-only, exactly as it is for
    // caveman itself, which deletes its flag and leaves its default alone.
    const explicit = isExplicitStop(prompt);
    persistState = explicit;
    persistCaveman = explicit;
  }

  return { mode, persistState, persistCaveman, hint };
}

// Backwards-compatible view: just the mode caveman would land in this turn.
function cavemanModeFrom(prompt) {
  return cavemanIntentFrom(prompt).mode;
}

// Decision function:
//   (prompt, currentState) -> { state, context, persistState, persistCaveman }
//
// `context` is the text to inject, or '' for nothing. `persistState` means
// "write state.json"; `persistCaveman` means "write caveman's defaultMode".
// Both are explicit rather than inferred from a diff, because a session-only
// toggle changes `state` for this turn while writing nothing at all.
//
// It performs no writes itself; the only read it makes is this plugin's own
// bundled prompt file, on the `/ste on` path, plus caveman's config through
// cavemanIntentFrom. The tests drive every branch through this function.
function decide(prompt, state) {
  const text = String(prompt || '').trim().toLowerCase();
  // Fill any field a caller left out (the tests pass partial states), so every
  // comparison below has something real on both sides.
  const current = { ...DEFAULT_STATE, ...state };
  const next = { ...current };

  const steMatch = STE_COMMAND_RE.exec(text);
  if (steMatch) {
    const arg = steMatch[1] || 'status';
    const tail = (steMatch[2] || '').trim();
    // Extra words after a good argument are ignored, but never in silence: the
    // command still runs and the reply names what was dropped.
    const tailNote = tail ? `STE-BRIDGE: ignored extra arguments after "/ste ${arg}": "${tail}".\n` : '';

    if (arg === 'on') {
      next.ste = true;
      const injected = buildContext(next, readPrompt(pluginRoot()));
      const confirmation = tailNote + 'STE-BRIDGE ON. The setting is saved and applies to later sessions. Acknowledge in one line, then answer normally.\n\n';
      const combined = confirmation + injected;
      return {
        state: next,
        context: combined.length <= MAX_CHARS ? combined : confirmation.trim(),
        persistState: next.ste !== current.ste,
        persistCaveman: false
      };
    }
    if (arg === 'off') {
      next.ste = false;
      return {
        state: next,
        context: tailNote + STE_OFF_MESSAGE,
        persistState: next.ste !== current.ste,
        persistCaveman: false
      };
    }
    // Anything else, including a bare /ste and an unknown argument, reports
    // rather than changes. A typo must not silently flip the style.
    return {
      state,
      context: tailNote + statusMessage(state),
      persistState: false,
      persistCaveman: false
    };
  }

  // "/ste off" means off: no caveman parsing, no reads of caveman's config, no
  // writes to either file. Everything below this line is gated on it.
  if (!current.ste) {
    return { state, context: '', persistState: false, persistCaveman: false };
  }

  // caveman's stats command blocks the prompt in caveman's own hook and never
  // touches a mode. Change nothing and say nothing.
  if (CAVEMAN_STATS_RE.test(text)) {
    return { state, context: '', persistState: false, persistCaveman: false };
  }

  const intent = cavemanIntentFrom(text);
  let persistState = false;

  if (intent.mode !== null) {
    // `next.caveman` always reflects this turn, so the context below is right
    // even when nothing is written.
    next.caveman = intent.mode;
    if (intent.persistState && intent.mode !== current.caveman) {
      persistState = true;
    }
    if (intent.persistCaveman && intent.mode !== 'off' &&
        intent.mode !== current.cavemanLastMode &&
        !INDEPENDENT_CAVEMAN_MODES.has(intent.mode)) {
      next.cavemanLastMode = intent.mode;
      persistState = true;
    }
  }

  if (intent.hint) {
    return {
      state: next,
      context: cavemanOffHint(next.cavemanLastMode),
      persistState,
      persistCaveman: intent.persistCaveman
    };
  }
  if (next.caveman === 'off' || INDEPENDENT_CAVEMAN_MODES.has(next.caveman)) {
    // STE alone. SessionStart already injected the full ruleset; repeating it
    // every turn would cost more than it buys.
    return { state: next, context: '', persistState, persistCaveman: intent.persistCaveman };
  }
  return {
    state: next,
    context: precedenceLine(next.caveman),
    persistState,
    persistCaveman: intent.persistCaveman
  };
}

function emit(context) {
  if (!context) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context
    }
  }));
}

function main() {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const before = readState();
      const { state, context, persistState, persistCaveman } = decide(data.prompt, before);
      if (persistState) {
        writeState(state);
      }
      if (persistCaveman) {
        // Persist for caveman's next SessionStart. Merges, so any other key in
        // caveman's config.json survives. Reached only for an explicit command
        // or an explicit deactivation sentence, and never while ste is off.
        writeCavemanDefaultMode(state.caveman);
      }
      emit(context);
    } catch (e) {
      // Silent fail: a style hook must never break a turn.
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  CAVEMAN_STATS_RE,
  CAVEMAN_STOP_SENTENCE_RE,
  STE_COMMAND_RE,
  STE_OFF_MESSAGE,
  cavemanIntentFrom,
  cavemanModeFrom,
  cavemanOffHint,
  decide,
  isExplicitStop,
  precedenceLine,
  statusMessage
};
