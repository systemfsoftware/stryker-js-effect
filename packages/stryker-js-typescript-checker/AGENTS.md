# @systemfsoftware/stryker-js-typescript-checker

TypeScript type-checker plugin: validates mutants ahead of test execution using TS7 language service.

## Rules

| ID       | Obligation                                                                          | Gate                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **TSC1** | Only `src/Compiler.ts` interacts with `typescript/unstable/*` language service APIs | `git grep -ln "typescript/unstable" -- packages/stryker-js-typescript-checker/src/` returns only `Compiler.ts` and `Checker.ts`      |
| **TSC2** | Checker rejects TypeScript versions below 7.0.0 and dry-run compile errors          | `review`                                                                                                                             |
| **TSC3** | Mutants applied strictly in-memory via `HybridFileSystem`; `.tsbuildinfo` ignored   | `review`                                                                                                                             |
| **TSC4** | Mutant attribution workflow `checkMutants` correctly partitions compile diagnostics | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker exec vitest run src/__tests__/check-mutants.workflow.property.test.ts` |
| **TSC5** | `testResources/**` fixtures excluded from lint and root vitest discovery            | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker lint`                                                                  |
| **TSC6** | Manifest ships `dist/index.mjs` and `schema/`; must be rebuilt after source edits   | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker build`                                                                 |
| **TSC7** | No `stryker.config.json` or self-mutation lane enrolled in this package             | `git ls-files 'packages/stryker-js-typescript-checker/stryker.config.json'` returns 0 files                                          |

### Calibration pairs

- **TSC2** — `wrong:` executing dry-run against TypeScript 5.x or treating dry-run syntax errors as mutant kills; `right:` `guardTSVersion` throws `UnsupportedTypeScriptVersionError` when version < 7.0.0.
- **TSC3** — `wrong:` writing mutant contents to physical disk; `right:` updating virtual `ScriptFile` snapshot in overlay memory.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-typescript-checker build
pnpm --filter @systemfsoftware/stryker-js-typescript-checker typecheck
pnpm --filter @systemfsoftware/stryker-js-typescript-checker lint
pnpm --filter @systemfsoftware/stryker-js-typescript-checker test
pnpm --filter @systemfsoftware/stryker-js-typescript-checker attw
```
