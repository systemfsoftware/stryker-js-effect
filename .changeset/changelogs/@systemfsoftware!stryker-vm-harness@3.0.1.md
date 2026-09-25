## 3.0.1

### Patch Changes

- The packages now build on the latest `@systemfsoftware/effect-cell-types` 10.2 cell kinds, with no change to their published behavior.

  - `@systemfsoftware/stryker-test-contribution` exports its evaluator as `Judge`, `TestContribution`, and `TestContributionEvaluator`, and now depends on `effect` directly.

- The vm runner now honours Vitest's `passWithNoTests`. A test file that registers no tests no longer fails the dry run when its Vitest project sets `passWithNoTests: true`, and still fails with `No test suite found in file <path>` when the option is false or unset. The option applies per project, as in Vitest: a root-level `test.passWithNoTests` covers every project, and one project in `test.projects` can opt in while another does not.

- Projects that install `@systemfsoftware/stryker-js` and `vitest`, but not the vm runner package directly, now complete a `testRunner: 'vm'` dry run under pnpm's default isolated `node_modules` layout, instead of failing with a `Cannot find module` error for the vm runner's own package. The project's own `vitest` is still the one that runs your tests.

- The vm runner no longer rewrites `import.meta.vitest` text that is not an expression. A string, template literal, comment or regex literal that mentions `import.meta.vitest` now reaches your code unchanged, so suites whose fixtures contain it, such as lint-rule tests, pass on the vm runner as they do under Vitest. In-source `if (import.meta.vitest)` tests still register and run, and `import.meta.vitest` inside a template `${…}` substitution still evaluates to the Vitest API.

- The vm runner now gives the Vitest API to every module a suite loads that imports `vitest`, not only to files inside the project directory. A Vitest `setupFiles` entry, helper module or workspace package outside the project used to receive a runner-less `vitest` and stop the whole run with "Vitest failed to find the runner"; its `beforeEach` and `it` calls now register against the current test file, as they do under Vitest. Dependencies under `node_modules` stay shared across test files, and `@effect/vitest` and `@systemfsoftware/effect-gherkin-spec` behave as before.
