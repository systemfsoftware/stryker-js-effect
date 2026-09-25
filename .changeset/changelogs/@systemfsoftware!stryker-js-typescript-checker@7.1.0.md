## 7.1.0

### Patch Changes

- The checker no longer looks dead while it type-checks. A check that runs longer than the host's connection patience window used to leave the checker unable to answer the host, dropping its connection mid-run; long checks are now answered and the connection survives them.

- The typescript checker no longer discards `include`, `exclude`, `files`, `extends`, and any other unrecognized top-level key from the tsconfig it rewrites. Projects that list files outside the default include patterns, import their own package manifest, or extend a shared preset now type-check during mutation runs the same way they do under `tsc`; only the compiler options the checker intentionally overrides still differ, and single-project mode alone drops `references`. Referenced projects are covered too: every tsconfig a build-mode project references is rewritten with those same overrides, so a library that opts into `noUnusedLocals` (or any option the checker overrides) is checked under the checker's settings instead of its own.
