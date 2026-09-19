## 6.1.0

### Minor Changes

- Types that appear on the published CLI and instrumenter APIs are now exported.

### Patch Changes

- Installing the CLI no longer nests the HTML reporter, plugin-interface, plugin-runtime, instrumenter, or ignorer-interface packages. The CLI still includes the HTML reporter. Those packages remain installable on their own.

- Installing the CLI no longer depends on minimatch. mutate and ignorePatterns still accept the same glob syntax.
