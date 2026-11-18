// The folder a test run writes in: $TMPDIR when set, else .ai_local/tmp/ at the repository root. The run removes
// its own folder, and the .ai_local folders it made when they are left empty.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export function makeTmp(prefix) {
  let base = process.env.TMPDIR;
  if (!base) {
    base = path.join(root, ".ai_local", "tmp");
    fs.mkdirSync(base, { recursive: true });
  }
  return fs.mkdtempSync(path.join(base, prefix));
}
export function removeTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (let d = path.dirname(dir); d.startsWith(path.join(root, ".ai_local")); d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }
  }
}
