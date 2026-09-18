---
"@systemfsoftware/stryker-js-plugin-runtime": major
"@systemfsoftware/stryker-js-vitest-runner": major
---

Every module Stryker loads — config files, `extends` targets, plugins, and the vitest runner's own vitest — now resolves and imports through Node's native ECMAScript module system: `import.meta.resolve` resolves each bare specifier from the consuming module, and dynamic `import()` loads the resolved URL. The package's `exports` map (or a legacy `main`) selects the entry file, ESM-only plugin packages load, and no require-based loader ships in any package. An unresolvable bare specifier warns with a machine-readable reason; the run fails at prepare only when nothing provides the configured runner or checker. Node.js 22.18.0 or later is required.

To migrate, install Node.js 22.18.0 or later. Bare plugin specifiers keep working, but a plugin package must publish an ES module entry through `exports` or `main`, and the plugin must be resolvable from where Stryker itself is installed.
