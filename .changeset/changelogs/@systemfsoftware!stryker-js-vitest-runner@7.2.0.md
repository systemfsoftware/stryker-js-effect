## 7.2.0

### Major Changes

- Vitest 4 is no longer supported: the `vitest` peer dependency is now `^5`. Upgrade your project to Vitest 5 before upgrading these packages.

### Minor Changes

- Projects using `@systemfsoftware/stryker-js` as a CLI tool no longer receive warnings or automatic installs for `effect`. The peer dependency is now optional, required only when importing programmatic APIs from the package.

  `@systemfsoftware/stryker-js-vitest-runner` and `@systemfsoftware/stryker-test-contribution` no longer declare a peer dependency on `effect`.
