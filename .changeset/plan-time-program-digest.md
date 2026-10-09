---
"@systemfsoftware/stryker-js": minor
"@systemfsoftware/stryker-js-typescript-checker": patch
---

The TypeScript checker now resolves a tsconfig `extends` that names a package subpath through that package's `exports` map, as TypeScript does. Before, the lookup only tried the literal path under `node_modules`; a package that maps the subpath elsewhere made the checker report no program digest, so no CompileError verdict in that project could be reused.

`stryker plan` now asks the checker for the program digest when the previous incremental report holds a CompileError verdict, and reuses those verdicts on the same terms as the run. Before, the plan always passed no digest and scheduled every CompileError mutant. With `inPlace: true` the plan still schedules them, because an in-place run digests the instrumented files. A checker that cannot produce a digest now logs a warning naming the checker, the project and the reason instead of failing silently. `Engine` exports `planRequest`.
