# packages/toolchain

Shared build, linting, and testing presets for workspace packages.

## Boundaries

- Changes to configuration presets affect the entire workspace build graph and require testing consumers across all sub-packages.
- Do not add direct runtime dependencies to toolchain config packages.
