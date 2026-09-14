---
title: A boundary contract needs the function it calls, not a schema it cannot use
date: 2026-09-14
category: tooling-decisions
module: ignorer-family
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Defining the descriptor a host loads from a plugin module"
  - "Tempted to re-declare a foreign spec's types so a package can stay dependency-free"
  - "Debating whether a loaded entry should carry a validator the host already calls"
tags: [standard-schema, boundary, plugin-contract, inlining, types]
---

# A boundary contract needs the function it calls, not a schema it cannot use

## Context

The plain-ignorer family had the host decode every loaded entry against a `schema` member the
ignorer declared, described as a Standard Schema validator (KTD1/KTD5 of the superseded plan).
Two costs surfaced in review:

- the host re-declared the member's shape in its own toolkit (`effect/Schema`), so the same
  contract lived twice and could drift;
- the spec's types were hand-copied into the interface package, which then had to stay in step
  with `@standard-schema/spec` by hand.

The host never used that validator for anything the decision function did not already do: a
loaded entry is registered as an `Ignore` contribution and `shouldIgnore(path)` is called.

## Guidance

Ship the smallest contract the host actually consumes — `{ name, shouldIgnore }` — and let the
package that owns the AST supply its types:

```ts
export interface PlainIgnorer {
  readonly name: string
  shouldIgnore(path: NodePath): string | undefined
}
```

The host then owns its own load check and mirrors nothing:

```ts
export const PlainIgnorerSchema = S.Struct({
  name: S.String,
  shouldIgnore: S.declare(isShouldIgnore),
})
```

Take the spec's types from the spec package, never from a hand copy, and inline them so the
published declarations stay dependency-free: `@standard-schema/spec` (jsr, catalog-pinned) as a
devDependency, resolved into the package's emitted declarations by the build (build output, not
tracked). Verified after `pnpm run build` in `packages/ignorers/interface` by reading its emitted
declarations — no `@standard-schema/spec` reference survives there.

The corollary for a host that wants a validator: convert the host's own schema where it needs
one (`Schema.toStandardSchemaV1`), rather than pushing a validator requirement onto the plugin
author.

## Applicability

Applies to any host/plugin boundary where the host validates an entry and then calls a function
on it. Where the host genuinely decides on the declared validator (filtering, generating, or
composing from it), keep the member — and keep it sourced from the spec package, inlined.
