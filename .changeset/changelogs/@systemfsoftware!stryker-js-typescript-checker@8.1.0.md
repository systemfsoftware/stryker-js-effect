## 8.1.0

### Minor Changes

- The package publishes a second entry point at `./runtime` for tooling that drives the compiler in process: `CheckerRuntime.layer`, its shape type, the `TypeScriptCompiler` tag and the `nodes` accessor. A mutant's `CompileError` reason now renders the diagnostic the way `tsc` does, code included, so a consumer matching that text matches the code form.

### Patch Changes

- Updated dependencies:
  - @systemfsoftware/stryker-js-instrumenter@11.0.0
  - @systemfsoftware/stryker-js-plugin-interface@11.0.0
