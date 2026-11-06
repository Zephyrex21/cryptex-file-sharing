// One command that runs what CI runs: lint, unit tests, and (when its
// dependencies are installed) the e2e suite. Used by `npm run verify` and by the
// pre-push git hook, so a push that would fail CI is stopped on your machine.
//   SKIP_VERIFY=1 git push      skip once (CI will still check it)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SKIP_VERIFY) { console.log("verify: skipped (SKIP_VERIFY set)"); process.exit(0); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  ["lint", ["run", "lint"], root],
  ["unit tests", ["test"], root],
];
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!fs.existsSync(path.join(root, "e2e", "node_modules"))) {
  console.log("verify: e2e skipped — run `npm ci` inside e2e/ to include it (CI always runs it)");
} else if (nodeMajor < 22) {
  // e2e's jsdom/undici needs Node 22+ (that is why CI runs the e2e job on 22).
  console.log(`verify: e2e skipped — it needs Node 22+ and this is Node ${nodeMajor} (CI runs it on 22)`);
} else {
  steps.push(["e2e", ["test"], path.join(root, "e2e")]);
}

for (const [name, args, cwd] of steps) {
  console.log(`\n▶ verify: ${name}`);
  const r = spawnSync(npm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\n✖ verify: ${name} failed — fix it before pushing (CI would fail the same way).`);
    console.error("  Tip: `npm run test:node20` runs the unit tests on Node 20, like CI's oldest job.");
    process.exit(r.status || 1);
  }
}
console.log("\n✔ verify: everything CI checks passed.");
