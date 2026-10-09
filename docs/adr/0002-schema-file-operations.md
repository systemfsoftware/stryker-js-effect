---
status: "accepted"
date: 2026-10-09
decision-makers: ["ryan"]
---

# Pure operations over a schema's data live in its schema file

## Context and Problem Statement

ADR-0001 (line 60) sends functions over a schema's data to an unsuffixed sibling module named after the type, such as `Location.ts`, and never into the schema file. Three facts make that sibling a bad home:

- The mutation run grades only `src/**/*.workflow.ts` and `src/**/*.schema.ts`, so an unsuffixed module is never mutated, and CONST-T4 wants code that can be wrong to be graded.
- `make-body-purity` refuses a workflow's reference to any local module except a relative `*.schema.js` or `*.schema.ts` specifier, so a workflow cannot call an operation that sits in an unsuffixed sibling.
- The effect-schema lint's `schema-file-exports-schemas-only` rule already accepts an exported operation whose declared parameter or return type names a type the same file declares.

Splitting `Checker/Checker.protocol.ts` forced the question: its shared operations (`commandFailed`, `compileErrorAnswersOf`, `singletonGroupsOf`) are used by two cells, and the workflows that replace its decisions need the types they work on.

## Decision Drivers

- Code that can be wrong is graded by mutation (CONST-T4).
- A workflow can call every pure operation over the types its command and decision carry.
- Each pure operation has one home; nothing is copied privately into the modules that use it.
- Every module keeps one suffix from the ADR-0001 taxonomy.

## Considered Options

- An unsuffixed sibling named after the type (ADR-0001 line 60 as written).
- A private copy of the operation in each workflow that needs it.
- The type's own `*.schema.ts`.
- A new suffix for operation modules.

## Decision Outcome

Chosen option: "the type's own `*.schema.ts`", because it is the only option that is both mutated and importable from a workflow without copying code.

A `*.schema.ts` holds its declarations (schemas, tagged classes, tagged errors, type aliases, interfaces) and pure operations whose signatures name a type the file declares. It holds no I/O, services, layers, clocks, randomness or `throw`, and no `Workflow.make`. A decision that chooses an outcome stays in its own `*.workflow.ts`, which may import the operations.

An operation's laws sit in its schema file's in-source `import.meta.vitest` block, beside the refusal laws ADR-0001 already puts there, because `src/__tests__/` admits only `<stem>.workflow.property.test.ts`. Those blocks already run (`includeSource` in `packages/toolchain/vitest-config/lib/base.js`; `packages/stryker-js-plugin-interface/src/Location.schema.ts` is an example). Each law names the operation in the `it.prop` `subject` slot, draws Schema-derived input, and checks it against an oracle that does not re-derive the answer the way the code does. An operation that only builds a `Map` or `Set`, or only wraps a library, gets no laws. A workflow that calls the operation is graded by its own property file as well.

### Consequences

- Good, because operations are mutated where they live and every workflow can reach them.
- Good, because no operation is copied.
- Bad, because schema files grow, and behaviour sits beside declarations.

### Confirmation

- Review checks each changed schema file against this record and the ADR-0001 taxonomy table.
- The effect-schema lint's `schema-file-exports-schemas-only` and `schema-file-imports-pure-modules-only` rules refuse an export that names no same-file type and an impure import.

## Pros and Cons of the Options

### An unsuffixed sibling named after the type

- Good, because schema files stay declaration-only.
- Bad, because the sibling is never mutated and no workflow may import it.

### A private copy in each workflow

- Good, because each workflow is self-contained.
- Bad, because the copies drift, and a fix must find every one of them.

### The type's own `*.schema.ts`

- Good, because it is mutated and importable from workflows.
- Bad, because schema files carry behaviour as well as declarations.

### A new suffix for operation modules

- Good, because declarations and operations stay in separate files.
- Bad, because the new suffix sits outside both the mutation population and what a workflow may import, so it has the sibling's problems plus a taxonomy change.
