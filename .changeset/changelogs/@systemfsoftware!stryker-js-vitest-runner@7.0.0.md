## 7.0.0

### Major Changes

- The runner now requires vitest 4.1 or later, and the peer dependency says so:
  `vitest >=4.1.0`.

  Upgrade vitest to 4.1 or later before upgrading this package. Projects that must
  stay below 4.1 should stay on the previous release.

  The published bundle now also inlines `oxc-parser` and `@eslint-community/regexpp`
  so they ship inside the runner's install. Consumers that previously resolved those
  packages as transitive dependencies from another tool should now take them from
  the runner's published bundle.
