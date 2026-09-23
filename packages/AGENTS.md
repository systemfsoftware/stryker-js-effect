# packages/*

Workspace product packages. Parent: the repository root `AGENTS.md`.

## Rules

| ID           | Rule                                                                                                                                                                                                                                                                                                                                                                                   | Gate                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **SCHEMA-1** | Worker-protocol payloads MUST omit optional schema fields instead of writing `undefined`: effect rc.116 `optionalKey` rejects present-undefined keys, so a `fileName: string \| undefined` field assigned straight into a payload passes typecheck and fails decode (`Expected string at ["fileName"]`) only when the packed worker runs. Build optional fields by conditional spread. | `review` — payload builders spread optional keys conditionally instead of assigning undefined |

_OBS-1 (root) applies here: when a mutation or e2e run fails, diagnose from the exported spans and the packed-bundle stack lines, not from print statements._
