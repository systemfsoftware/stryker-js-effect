# @systemfsoftware/stryker-js-typescript-checker

## Rules

| ID       | Obligation                                                                     | Gate                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **TSC1** | Only `src/Compiler.ts` interacts with `typescript/unstable/*`                  | `git grep -ln "typescript/unstable" -- packages/stryker-js-typescript-checker/src/`                                                  |
| **TSC4** | Mutant attribution workflow `checkMutants` passes property tests               | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker exec vitest run src/__tests__/check-mutants.workflow.property.test.ts` |
| **TSC5** | `testResources/**` fixtures excluded from lint                                 | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker lint`                                                                  |
| **TSC6** | Manifest ships `dist/index.mjs` and `schema/`; must rebuild after source edits | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker build`                                                                 |
