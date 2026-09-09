// Changesets versions package.json only; JSR reads jsr.json. Run after `changeset version`
// (wired into `pnpm pkg:version`) so the two never drift.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const jsrPath = "jsr.json";
const jsr = JSON.parse(readFileSync(jsrPath, "utf8"));
if (jsr.version !== pkg.version) {
  jsr.version = pkg.version;
  writeFileSync(jsrPath, `${JSON.stringify(jsr, null, 2)}\n`);
  console.log(`jsr.json version → ${pkg.version}`);
}
