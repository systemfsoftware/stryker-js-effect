# apps

Application entrypoints and executables.

## Boundaries

- Executable bundles must inline internal workspace dependencies or restrict runtime dependencies to `node:` builtins.
- Binaries point to gitignored `dist/` targets; manifests must retain `prepare` scripts to ensure shims resolve after fresh installs.
- Container-backed contract test lanes and self-mutation lanes are intentionally excluded.
- Bundled reporters (e.g. `reporters/html.mjs`) must escape report data via `escapeHtmlTags` before interpolation.
