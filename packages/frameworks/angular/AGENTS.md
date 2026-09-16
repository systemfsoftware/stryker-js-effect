# AGENTS.md — `@systemfsoftware/stryker-js-angular`

The Angular framework plugin: it claims the `html` format for `.html`, `.htm`,
and `.vue` files, gives the core the script regions of a document to mutate, and
bundles the `angular-signal-io` ignore rule so the Angular compiler's identity
objects are never mutated. It ships as a `Framework` contribution plus a plain
ignorer entry — the dual protocol the loader merges — and it depends inward only:
on `@systemfsoftware/stryker-js-language`, on
`@systemfsoftware/stryker-js-plugin-interface`, on
`@systemfsoftware/stryker-framework-interface`, and on `angular-html-parser`.
Root `AGENTS.md` governs.

## Rules

| ID       | Rule                                                                                                                                              | Gate                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **SAN1** | The claim is exactly `html` over `.html`, `.htm`, `.vue`, and every script region parses as the format its `type`/`lang` attribute names.         | `pnpm --filter @systemfsoftware/stryker-js-angular test`      |
| **SAN2** | Template expressions are never script regions: a region is the text between a `<script>` tag's tags, and `isExpression` is always `false`.        | `pnpm --filter @systemfsoftware/stryker-js-angular test`      |
| **SAN3** | Every ignore reason is the string the Angular compiler requires, verbatim — the rule is a faithful move, not a rewrite.                           | `pnpm --filter @systemfsoftware/stryker-js-angular test`      |
| **SAN4** | No dependency on `@systemfsoftware/stryker-js-instrumenter` or `@systemfsoftware/stryker-js-engine` in any dependency block.                      | `review` — the reviewer reads the dependency blocks           |
| **SAN5** | `angular-html-parser` is a hard dependency of the format: no peer resolution, no version guard, no unbundled compiler lookup.                     | `review` — the reviewer reads the format service              |
| **SAN6** | The published surface is exactly what `etc/stryker-js-angular.api.md` lists; the report is regenerated with `pnpm api:update`, never hand-edited. | `pnpm --filter @systemfsoftware/stryker-js-angular api:check` |

SAN4's reviewer decides one thing: whether the plugin still depends inward only.

- `wrong:` `"@systemfsoftware/stryker-js-instrumenter"` or `"@systemfsoftware/stryker-js-engine"` anywhere under `dependencies` or `devDependencies`.
- `right:` the four inward dependencies and the test-only parser tooling.

SAN5's reviewer decides one thing: whether the format resolves its parser like a normal dependency.

- `wrong:` a dynamic `import('angular-html-parser')` guarded by a peer lookup or a version comparison.
- `right:` the parser imported once, used by the parse and disable-type-checks hooks.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-angular build
pnpm --filter @systemfsoftware/stryker-js-angular typecheck
pnpm --filter @systemfsoftware/stryker-js-angular test
pnpm --filter @systemfsoftware/stryker-js-angular lint
pnpm --filter @systemfsoftware/stryker-js-angular api:check
pnpm --filter @systemfsoftware/stryker-js-angular attw
```
