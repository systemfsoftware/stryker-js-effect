# @systemfsoftware/oxlint-ignorer-config

The lint preset for an ignorer package. It imports no family preset: the rule
set is assembled from oxlint's built-in plugins and categories, so an ignorer
authored outside this repo is graded by the same bar as the ones in it.

## Install

```bash
pnpm add -D @systemfsoftware/oxlint-ignorer-config oxlint
```

## Use

`oxlint.config.ts`

```ts
import preset from '@systemfsoftware/oxlint-ignorer-config'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [preset],
})
```

Add `"lint": "oxlint . --format=${f:-default}"` to your scripts.

## What the preset holds you to

| Rule                                                                                                                        | Why it is here                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `complexity` `['error', { max: 2, variant: 'modified' }]` on `**/src/**`                                                    | One path per decision: `match`/`map`/`fold` are calls, not control flow.                                                      |
| `typescript/consistent-type-assertions` (`never`), `no-unsafe-*`, `no-explicit-any`, `no-non-null-assertion`                | An ignorer reads foreign AST data, so it decodes instead of asserting.                                                        |
| `no-restricted-imports`                                                                                                     | No `effect`, `@effect/*`, the family Effect presets, the family lint packs, or `@systemfsoftware/stryker-js-*` in an ignorer. |
| `vitest/no-focused-tests`, `vitest/no-conditional-expect`                                                                   | A test earns its place by observing a decision.                                                                               |
| `eqeqeq`, `prefer-const`, `no-var`, `no-else-return`, `no-lonely-if`, `unicorn/*`, `import/no-cycle`, `promise/param-names` | Ordinary strictness, plus `@oxc-plugin`-free correctness/suspicious/perf at error and `nursery` at warn.                      |

Test and fixture paths relax the assertion rules, because a case table may
build a fixture by assertion — the decision may not.

## Writing an ignorer

Author against `@systemfsoftware/stryker-ignorer-interface`: it publishes the
entry contract (`{ name, shouldIgnore(node, ancestors) }` — typed positions,
nearest first) and the AST vocabulary types. This preset is the lint half of
that pair.

## Gates

- `pnpm typecheck` — `tsc --noEmit --incremental`, and `checkJs` covers `lib/base.js`.
- `pnpm api:check` — API Extractor validates `lib/base.d.ts` against `etc/oxlint-ignorer-config.api.md`.
