---
"@systemfsoftware/stryker-js-language": major
"@systemfsoftware/stryker-js-plugin-runtime": major
"@systemfsoftware/stryker-js-vitest-runner": major
---

Every module Stryker loads — config files, `extends` targets, plugins, and the vitest runner's own vitest — now resolves and imports through Node's ECMAScript module system: a bare specifier resolves against the user's project through `findPackageJSON`, the package's `exports` map (or a legacy `main`) selects the entry file, and dynamic `import()` loads it. Isolated dependency layouts and ESM-only plugin packages now load, with no `createRequire` or `require` in shipped code. An unresolvable bare specifier warns with a machine-readable reason; the run fails at prepare only when nothing provides the configured runner or checker. Node.js 22.18.0 or later is required (`>=22.18.0`).

To migrate, install Node.js 22.18.0 or later. Bare plugin specifiers keep working, but a plugin package must publish an ES module entry through `exports` or `main`.
