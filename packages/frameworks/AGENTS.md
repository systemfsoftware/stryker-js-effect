# packages/frameworks

Format plugins that hand the core the script regions of a framework file, plus the types-only interface both sides depend on.

## Boundaries

- `@systemfsoftware/stryker-framework-interface` is types only and Effect-free: no source or built file exports a value or a class, and no dependency block names `effect` or `@effect/*`. Gate: `pnpm --filter @systemfsoftware/stryker-framework-interface build`, plus the preset's `no-restricted-imports` ban under `pnpm lint`.
- The interface tier re-exports the AST vocabulary from `@systemfsoftware/stryker-ignorer-interface` (`export type *`), never re-derives it, and keeps that package in `dependencies` so the emitted declaration holds one physical copy of the recursive node type. Gate: `pnpm --filter @systemfsoftware/stryker-framework-interface build`.
- A framework plugin depends inward only — the language, the plugin interface, and the framework interface — and never on `@systemfsoftware/stryker-js-instrumenter` or `@systemfsoftware/stryker-js-engine` in any dependency block. Gate: `review` — the reviewer reads the dependency blocks; `wrong:` either engine package anywhere under `dependencies` or `devDependencies`, `right:` the inward dependencies plus that package's own test tooling.
- A plugin owns exactly the extensions its claim names; when two plugins claim one extension, the earlier module in plugin order wins and the loser is reported as shadowed. Gate: `pnpm --filter @systemfsoftware/stryker-js-engine test`.
- A script region is the text between a `<script>` tag's tags, and only the formats that declare template expressions produce expression regions. Gate: `pnpm --filter @systemfsoftware/stryker-js-angular test` and `pnpm --filter @systemfsoftware/stryker-js-svelte test`.
- The Angular plugin's parser is a hard dependency: no peer lookup, no version guard. The Svelte plugin's compiler is the opposite — an optional peer resolved when its layer is built, where a missing compiler refuses the run as a missing peer and one below the supported range as an unsupported version, with the manifest's `peerDependencies.svelte` stating the guard's range. Gate: `pnpm --filter @systemfsoftware/stryker-js-svelte test`.
- The instrumentation header lands in a module script, only once mutants land in the file, and never a second time: a component without mutants prints byte-identical to its input. Gate: `pnpm --filter @systemfsoftware/stryker-js-svelte test`.
- Every ignore reason a plugin emits is the string its framework requires, verbatim. Gate: `pnpm --filter @systemfsoftware/stryker-js-angular test`.
- Each package's published surface is exactly its `etc/*.api.md` report; regenerate it with `api:update`, never hand-edit it. Gate: `pnpm --filter <package> api:check`.
