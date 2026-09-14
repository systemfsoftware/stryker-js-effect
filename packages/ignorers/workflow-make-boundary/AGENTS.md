# AGENTS.md — `@systemfsoftware/stryker-ignorer-workflow-make-boundary`

Stryker ignorer that restricts the mutation population to `Workflow.make` and `Workflow.total` decision bodies: mutants outside those bodies are excluded from the population by design. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                      | Gate                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SP1** | An ignored mutant is out of population by construction: no `Workflow.make` or `Workflow.total` decision body contains it. | `pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary test` |
| **SP2** | Every new ignore pattern arrives with a test demonstrating the mutant sits outside every decider body.                    | `pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary test` |
| **SP3** | Register through the plain ignorer protocol only; never bypass other mutation stages.                                     | `review`                                                                     |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary test
pnpm --filter @systemfsoftware/stryker-ignorer-workflow-make-boundary lint
```
