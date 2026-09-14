# AGENTS.md — `@systemfsoftware/stryker-ignorer-workflow-make-boundary`

Stryker ignorer that restricts the mutation population to `Workflow.make` and `Workflow.total` decision bodies: mutants outside those bodies are excluded from the population by design. The AST shapes it decides over arrive as Standard Schema validators from `@systemfsoftware/stryker-ignorer-interface`, its only runtime dependency, and nothing here imports Effect — at run time or in `devDependencies`. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                      | Gate                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SP1** | An ignored mutant is out of population by construction: no `Workflow.make` or `Workflow.total` decision body contains it. | `pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary test` |
| **SP2** | Every new ignore pattern arrives with a test demonstrating the mutant sits outside every decider body.                    | `pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary test` |
| **SP3** | Register through the plain ignorer protocol only; never bypass other mutation stages.                                     | `review`                                                                     |
| **SP4** | No `effect` or `@effect/*` import in any source or built file, and no such key in any dependency block.                   | `pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary lint` |
| **SP5** | Every behavior is pinned by a case table through `IgnoreTester` — no FastCheck generator and no snapshot call.            | `pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary lint` |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary test
pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary lint
```
