// Changesets publishes a prerelease to `latest` while every published version is a prerelease
// (its "only-pre" rule: `npm i` must resolve something before the first stable release), so the
// pre tag (`next`) is never moved and `@next` installs keep the previous release. Run after
// `changeset publish` (wired into `pnpm pkg:publish`): it points the pre tag at the version just
// published. npm reads the one-time password from NPM_CONFIG_OTP, as changeset publish does, so
// `NPM_CONFIG_OTP=<code> pnpm pkg:publish` covers both writes with one code.
// `--dry-run` prints the decision without writing.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
const prePath = ".changeset/pre.json";
const tag = existsSync(prePath) ? JSON.parse(readFileSync(prePath, "utf8")).tag : undefined;

if (!tag || !version.includes(`-${tag}.`)) {
  console.log(`${name}@${version}: not a ${tag ?? "pre-mode"} prerelease; dist-tags left alone`);
  process.exit(0);
}

const distTags = JSON.parse(
  execFileSync("npm", ["view", name, "dist-tags", "--json"], { encoding: "utf8" }),
);
if (distTags[tag] === version) {
  console.log(`${name}: ${tag} already → ${version}`);
  process.exit(0);
}

const args = ["dist-tag", "add", `${name}@${version}`, tag];
if (dryRun) {
  console.log(`would run: npm ${args.join(" ")} (${tag} is ${distTags[tag] ?? "unset"})`);
  process.exit(0);
}
execFileSync("npm", args, { stdio: "inherit" });
