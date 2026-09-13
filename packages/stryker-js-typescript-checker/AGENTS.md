# AGENTS.md — `@systemfsoftware/stryker-js-typescript-checker`

TypeScript checker plugin for the mutation engine — TS7 native: each mutant is type-checked against the project's own compiler configuration, and the resulting diagnostics are attributed to mutants.

> The mutation-testing subtree group file did not travel with this package, and neither the contract lane nor the api-extractor surface (`etc/*.api.md`) is carried in this repository.

## Rules

| ID       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gate                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TSC1** | Only `src/Compiler.ts` drives the TypeScript language service (`typescript/unstable/{ast,fs,sync}`). The single other importer, `src/Checker.ts`, reads nothing from it beyond `DiagnosticCategory` and the `Diagnostic` type: no program, no file system, no snapshot.                                                                                                                                                                                    | `git grep -ln "typescript/unstable" -- packages/stryker-js-typescript-checker/src` lists `Compiler.ts` and `Checker.ts` and nothing else                    |
| **TSC2** | The checker refuses instead of degrading: an installed TypeScript below 7.0 fails with `UnsupportedTypeScriptVersionError` (`minimumSupportedTypeScriptVersion` in `src/Compiler.ts` is `{ major: 7, minor: 0, patch: 0 }`), and a compile error in the dry-run init fails it with `CheckerFailed` before any mutant is checked.                                                                                                                           | `review` — the reviewer confirms the version guard runs before a check starts and that dry-run errors fail the checker rather than becoming mutant verdicts |
| **TSC3** | Mutants are applied in memory only: `HybridFileSystem.mutateFile`/`resetFile` rewrite the `ScriptFile` held in the overlay, never the sandbox source on disk, and a `*.tsbuildinfo` is never answered from that overlay (`readFile` returns `null`, `fileExists` returns `false`) so a stale build info cannot answer for a mutated source.                                                                                                                | `review` — the reviewer confirms no write reaches the sandbox source and that `*.tsbuildinfo` is refused by the overlay                                     |
| **TSC4** | Attribution is the pure workflow `checkMutants` in `src/check-mutants.workflow.ts`: one related mutant is a definitive `compileError`, several are `RetestRequired` (answered by solo rounds), none leaves the check failed as `DiagnosticWithoutFileError`/`DiagnosticInUnrelatedFileError`. Every decision partitions the mutants — `CheckFinished` results cover them all, `RetestRequired` splits a non-empty `needsRetest` disjoint from its results. | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker exec vitest run src/__tests__/check-mutants.workflow.property.test.ts`                        |
| **TSC5** | `testResources/**` are real TypeScript projects the integration checker compiles (`single-project`, `project-references`, `nodenext-project`, `errors/**`). They stay out of lint (`ignorePatterns`) and out of the vitest include; never reformat or "fix" them — a scenario must remain a compilable project.                                                                                                                                            | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker lint` and `... test` both exit 0 with the fixtures untouched                                  |
| **TSC6** | Rebuild after a source change (subtree rule): the manifest exports `./dist/index.mjs` and ships `dist` with `schema`, and the CLI loads this plugin as an installed package at run time — so an unbuilt edit is not what the next run checks.                                                                                                                                                                                                              | `pnpm --filter @systemfsoftware/stryker-js-typescript-checker build`                                                                                        |
| **TSC7** | This package carries no `stryker.config.json` and enrolls no mutation run of its own — never add one.                                                                                                                                                                                                                                                                                                                                                      | `git ls-files 'packages/stryker-js-typescript-checker/stryker.config.json'` prints nothing                                                                  |

### Calibration pairs

**TSC2**

- `wrong:` checking mutants with whatever TypeScript is installed, or letting the dry run's compile errors come back as `compileError` verdicts on mutants.
- `right:` `guardTSVersion` fails with `UnsupportedTypeScriptVersionError` before a run starts; `init` refuses with `CheckerFailed` when the dry run does not compile.

**TSC3**

- `wrong:` writing mutant text into the sandbox file, or letting `fileExists` answer `true` for a `.tsbuildinfo` the overlay never loaded.
- `right:` `mutateFile` replaces `content` on the in-memory `ScriptFile`; `readFile`/`fileExists` special-case `*.tsbuildinfo` to `null`/`false`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-typescript-checker build
pnpm --filter @systemfsoftware/stryker-js-typescript-checker typecheck
pnpm --filter @systemfsoftware/stryker-js-typescript-checker lint
pnpm --filter @systemfsoftware/stryker-js-typescript-checker test
pnpm --filter @systemfsoftware/stryker-js-typescript-checker attw
```
