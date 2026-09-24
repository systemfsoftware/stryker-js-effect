---
"@systemfsoftware/stryker-js": minor
---

The vm runner now runs Vitest suites that use module mocking (`vi.mock`, `vi.doMock`, automocking, spies), snapshot assertions with update modes and custom snapshot paths, test environments (`node`, `jsdom`, `happy-dom`), setup files, `globals` and `define`, `provide`/`inject`, in-source tests, and a project's own Vitest config — `include`, `exclude`, `alias`, `projects`, `isolate`, timeouts, mock-reset and fake-timer options, JSX/TSX and other custom transforms, and `import.meta.env`. Suites that need Vitest browser mode still fail with an error naming `testRunner: 'vitest'`.

As under `vitest run`, a discovered test file that registers no tests fails with `No test suite found in file <path>`, so a mutant that removes every test from an in-source test block is killed rather than surviving.
