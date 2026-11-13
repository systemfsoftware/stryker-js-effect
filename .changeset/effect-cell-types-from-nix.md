---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-html-reporter": patch
"@systemfsoftware/stryker-js-instrumenter": patch
"@systemfsoftware/stryker-js-plugin-runtime": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
---

`@systemfsoftware/effect-cell-types` is now 12.1.3, taken from the systemfsoftware flake's tarball instead of the npm registry, whose newest release is 12.0.0. A consumer that installs these packages from tarballs maps `@systemfsoftware/effect-cell-types@*` to that tarball, as it already does for the stryker packages. effect and the @effect packages resolve at 4.1.4.
