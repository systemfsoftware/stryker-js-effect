---
title: Resolving an optional ESM peer from the consumer's install
date: 2026-09-16
category: tooling-decisions
module: framework plugin peer resolution
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "A plugin package declares an optional peer it must import at runtime"
  - "The peer publishes an exports map with no require condition"
  - "A test double stands in for a peer that exposes a VERSION or capability flag"
tags: [peer-resolution, esm, vitest, optional-peer, refusal-as-data]
---

# Resolving an optional ESM peer from the consumer's install

## Context

A framework plugin declares its compiler as an optional peer and resolves it
when its module is evaluated — a top-level `await import(...)` in the plugin's
entry module — so the version it reads is the version the consumer installed,
not one bundled at publish time. Two mechanisms look interchangeable and are
not: `Module.createRequire(<project>/package.json).resolve(specifier)` followed
by `import(resolvedPath)`, and a bare `import(specifier)`.

`createRequire().resolve()` applies CommonJS resolution. A peer whose exports map
declares only an `import` condition cannot be resolved that way at all — the
resolver reports that no `exports` main is defined, and a resolver that treats
that as "peer missing" reports a missing package for an installed one. A bare
`import(specifier)` instead resolves against the importing module, which is the
right install only when the plugin happens to be nested under the consumer.

The install's types are a second identity. An AST peer such as `oxc-walker`
carries `@oxc-project/types` as its own peer dependency; a package that imports
those types transitively while the shared interface package resolves a different
version ends up with two structurally similar but unrelated `Node` types, and a
value that is correct at runtime fails to compile — or worse, passes behind an
assertion. Declaring the types package in each package that peers with the
walker (both at the same catalog version) collapses it to one copy.

## Guidance

Resolve project-first and fall back to ESM resolution, then import by URL:

```ts
const resolved = trySync(() => requireFromProject.resolve(specifier))
const url = resolved.ok ? pathToFileURL(resolved.value).href : import.meta.resolve(specifier)
return import(url)
```

The require path keeps the consumer's project as the anchor when the peer is
CommonJS-resolvable; the `import.meta.resolve` path is the only one that can see
an ESM-only peer and it inherits the plugin's own install, which pnpm links to
the consumer's tree. Importing the _URL_ rather than the bare path also keeps the
call correct on Windows drive letters.

Resolve at module evaluation and export the refusal, not an error: the plugin's
entry awaits the peer at its top level, classifies the outcome, and exports
either its framework or a `FrameworkRefusal` value. Only structured resolver
codes (`ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`) classify as a missing peer —
any other failure while importing the peer is left to propagate, so a peer that
is present but broken surfaces as a plugin that crashed on import, never as a
fabricated "peer missing". The refusal carries the peer name, a typed reason
(`PeerMissing` or `PeerVersionUnsupported`), and a human-readable detail; the
host reads the value, refuses the run before instrumentation as a configuration
error (exit 2), and a crashing module stays an internal error (exit 4). Nothing
in the plugin throws for an expected peer state, so no caller has to catch.

For a version-parameterized peer double in tests, do not put the parameter in a
URL query. A test runner's module loader may drop the query before the module
executes, so the double silently reads its default and the assertion tests the
default rather than the case under test. Put the parameter in the module's own
source: a generated `data:` module, or a real fixture module that derives its
version from the manifest so it cannot drift from the declared range.

## Why This Matters

The failure is silent in both directions: a require-only resolver reports an
installed peer as missing (a wrong refusal that looks like a configuration
error), and a query-parameterized double reports a default version (a green test
that certifies the wrong branch). Neither surfaces as a compile error, and both
cost a debugging cycle because the refusal and the pass are plausible.

## When to Apply

- Any plugin or adapter package that accepts an optional peer and imports it.
- Any package whose entry must keep loading when an optional peer is absent.
- Any test double standing in for a versioned or capability-flagged peer.
- Any package that consumes AST types through a peer's dependency rather than
  declaring them itself.

## Examples

A double that stays honest about the version it simulates reads the declared
range instead of hardcoding it:

```ts
import manifest from '../../package.json' with { type: 'json' }
const floor = manifest.peerDependencies.svelte.replace('>=', '').split('.').slice(0, 2).join('.')
export const VERSION = `${floor}.0`
```

The entry that owns the resolution exports the refusal as a value:

```ts
let contribution: FrameworkContribution
try {
  contribution = frameworkOf(await loadCompiler(), await loadWalker())
} catch (cause) {
  contribution = isResolutionError(cause)
    ? refusal('PeerMissing', `the "${PEER}" peer is not installed`)
    : raise(cause)
}
export const strykerFrameworks: readonly FrameworkContribution[] = [contribution]
```

## Related

- `docs/solutions/tooling-decisions/workspace-source-condition-dev-resolution.md`
- `docs/solutions/build-errors/suite-imports-package-dist-rebuild-before-trusting.md`
