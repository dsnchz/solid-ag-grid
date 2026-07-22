// typescript-eslint hard-rejects TypeScript 7 (peer <6.1.0). Root `typescript` is 7.x
// (native tsc drives typecheck + both emit passes); this hook gives the lint toolchain
// a PRIVATE TypeScript 5.9 by converting its peer into a direct dependency. Linting is
// untyped in eslint.config.ts, so the parser's TS version only affects syntax support.
// Remove when typescript-eslint supports TS 7.
function readPackage(pkg) {
  if (pkg.name === "typescript-eslint" || (pkg.name || "").startsWith("@typescript-eslint/")) {
    if (pkg.peerDependencies && pkg.peerDependencies.typescript) {
      delete pkg.peerDependencies.typescript;
      pkg.dependencies = { ...pkg.dependencies, typescript: "^5.9.0" };
    }
  }
  return pkg;
}
module.exports = { hooks: { readPackage } };
