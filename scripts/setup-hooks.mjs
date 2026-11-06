// Runs on `npm install` / `npm ci` (the "prepare" script): points git at the
// tracked .githooks folder so the pre-push check is on for every clone.
// Silent and harmless where git or a .git folder doesn't exist (CI, Docker, Render).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  if (fs.existsSync(path.join(root, ".git"))) {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "ignore" });
    try { fs.chmodSync(path.join(root, ".githooks", "pre-push"), 0o755); } catch { /* Windows: git runs it via sh regardless */ }
  }
} catch { /* not a git checkout, or git missing — nothing to set up */ }
