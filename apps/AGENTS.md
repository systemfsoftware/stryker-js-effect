# apps

Application entrypoints and executables.

## Boundaries

- Executable bundles must inline internal workspace dependencies or restrict runtime dependencies to `node:` builtins.
- Entrypoint binaries must define executable permissions and shebangs via tsdown build config.
