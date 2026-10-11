import { MutatorCatalog } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { StockDefaultName } from './StockCatalog.schema.js'

type StockCatalogEntry = Omit<typeof MutatorCatalog.Entry.Encoded, 'name' | 'tier'> & {
  readonly name: StockDefaultName
  readonly tier: 'default'
}

const ATOMIC_UPDATE_DATA_FIRST = `import { Effect, Ref } from 'effect'

export const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
`

const ATOMIC_UPDATE_DATA_FIRST_REPLACEMENT =
  'Effect.flatMap(Effect.succeed(ref), self => Effect.flatMap(Ref.get(self), s => Effect.flatMap(Ref.make(s), snap => Effect.flatMap(Ref.update(snap, n => n + 1), b => Effect.flatMap(Effect.yieldNow, () => Effect.flatMap(Ref.get(snap), a => Effect.as(Ref.set(self, a), b)))))))'

const ATOMIC_UPDATE_DATA_LAST = `import { Effect, pipe, Ref } from 'effect'

export const bumpPiped = (ref: Ref.Ref<number>) => pipe(ref, Ref.update((n: number) => n + 1))
`

const ATOMIC_UPDATE_DATA_LAST_REPLACEMENT =
  'self => Effect.flatMap(Ref.get(self), s => Effect.flatMap(Ref.make(s), snap => Effect.flatMap(Ref.update(snap, (n: number) => n + 1), b => Effect.flatMap(Effect.yieldNow, () => Effect.flatMap(Ref.get(snap), a => Effect.as(Ref.set(self, a), b))))))'

const ATOMIC_UPDATE_WITHOUT_EFFECT = `import { Ref } from 'effect'

export const withoutEffect = (ref: Ref.Ref<number>) => Ref.update(ref, (n) => n + 1)
`

const SYNCHRONIZATION_GUARDED = `import { Effect, Semaphore } from 'effect'

export const guarded = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  Semaphore.withPermits(sem, 1, effect)
`

const SYNCHRONIZATION_FROZEN_PIPE = `import { Effect, pipe } from 'effect'

export const frozen = (effect: Effect.Effect<number>) => pipe(effect, Effect.uninterruptible)
`

const SYNCHRONIZATION_MASKED = `import { Effect } from 'effect'

export const masked = (effect: Effect.Effect<number>) => Effect.uninterruptibleMask((restore) => restore(effect))
`

const SYNCHRONIZATION_GUARD_ON_THE_SPOT = `import { Effect, Semaphore } from 'effect'

export const methodForm = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  sem.withPermits(1)(effect)
`

const FINALIZER_ENSURING = `import { Effect, Ref } from 'effect'

export const ensuringDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.ensuring(effect, Ref.set(closed, true))
`

const FINALIZER_ENSURING_REPLACEMENT =
  'Effect.onExitIf(effect, exit => exit._tag === "Success" || !exit.cause.reasons.some(reason => reason._tag === "Interrupt"), () => Ref.set(closed, true))'

const FINALIZER_ON_ERROR = `import { Effect, Ref } from 'effect'

export const onErrorDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.onError(effect, () => Ref.set(closed, true))
`

const FINALIZER_ON_ERROR_REPLACEMENT =
  'Effect.onErrorIf(effect, cause => !cause.reasons.some(reason => reason._tag === "Interrupt"), () => Ref.set(closed, true))'

const FINALIZER_ACQUIRE_RELEASE = `import { Effect, Ref } from 'effect'

export const acquireReleaseTwoArg = (acquire: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.acquireRelease(acquire, () => Ref.getAndSet(closed, true))
`

const FINALIZER_ACQUIRE_RELEASE_REPLACEMENT =
  'Effect.flatMap(Effect.interruptible(acquire), a => Effect.acquireRelease(Effect.succeed(a), () => Ref.getAndSet(closed, true)))'

const FINALIZER_ACQUIRE_USE_RELEASE = `import { Effect, Ref } from 'effect'

export const acquireUseReleaseBrackets = (
  acquire: Effect.Effect<number>,
  use: (a: number) => Effect.Effect<number>,
  closed: Ref.Ref<boolean>,
) => Effect.acquireUseRelease(acquire, use, () => Ref.set(closed, true))
`

const FINALIZER_ACQUIRE_USE_RELEASE_REPLACEMENT =
  'Effect.acquireUseRelease(acquire, use, (a, exit) => exit._tag === "Success" || !exit.cause.reasons.some(reason => reason._tag === "Interrupt") ? (() => Ref.set(closed, true))() : Effect.void)'

const FINALIZER_LOCAL_HELPER = `import { Effect, Ref } from 'effect'

const ensuring = (effect: Effect.Effect<number>, cleanup: Effect.Effect<void>) => effect

export const localEnsuringRefusal = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  ensuring(effect, Ref.set(closed, true))
`

const REFINEMENT_BOUND = `import { Schema as S } from 'effect'

export const Positive = S.Number.check(S.isGreaterThan(0))
`

const REFINEMENT_BETWEEN = `import * as S from 'effect/Schema'

export const Digit = S.Int.check(S.isBetween({ minimum: 1, maximum: 9 }))
`

const REFINEMENT_MIN_LENGTH = `import * as S from 'effect/Schema'

export const Pair = S.String.check(S.isMinLength(2))
`

const REFINEMENT_LOCAL_HELPER = `const isGreaterThan = (n: number) => (x: number) => x > n

export const positive = isGreaterThan(0)
`

const REFINEMENT_TWO_CHECKS = `import * as S from 'effect/Schema'

export const Slug = S.String.check(S.isMinLength(1), S.isPattern(/^[a-z]+$/))
`

const REFINEMENT_PIPED_CHECK = `import * as S from 'effect/Schema'

export const Count = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))
`

const REFINEMENT_LOCAL_CHECK = `const box = { check: (n: number) => n > 0 }

export const checked = box.check(1)
`

const entries = [
  {
    id: 'arithmetic-operator',
    name: 'ArithmeticOperator',
    tier: 'default',
    definition:
      'A binary arithmetic operator: `+` becomes `-`, `-` becomes `+`, `*` becomes `/`, `/` becomes `*` and `%` becomes `*`. A string or template literal on either side is refused, as is a private name on the left.',
    examples: [
      { before: 'const x = 1 + 2;', after: ['1 - 2'] },
      { before: "const x = 'a' + 'b';", after: [] },
    ],
  },
  {
    id: 'array-declaration',
    name: 'ArrayDeclaration',
    tier: 'default',
    definition:
      "An array literal becomes `[]` and an empty one becomes `['Stryker was here']`; `Array(1, 2)` becomes `Array()` and `Array()` becomes `Array([])`. A call that is not `Array` is refused.",
    examples: [
      { before: 'const x = [1];', after: ['[]'] },
      { before: 'const x = [];', after: ['["Stryker was here"]'] },
      { before: 'const x = Array(1, 2);', after: ['Array()'] },
      { before: 'const x = Array();', after: ['Array([])'] },
      { before: 'const x = someCall(1, 2);', after: [] },
    ],
  },
  {
    id: 'arrow-function',
    name: 'ArrowFunction',
    tier: 'default',
    definition:
      'An arrow function shorthand body becomes `undefined`. A block body, and a body that already is `undefined`, are refused.',
    examples: [
      { before: 'const x = () => 1;', after: ['() => undefined'] },
      { before: 'const x = () => { return 1; };', after: [] },
    ],
  },
  {
    id: 'assignment-operator',
    name: 'AssignmentOperator',
    tier: 'default',
    definition:
      'A compound assignment operator: `+=` becomes `-=`, `*=` becomes `/=`, `%=` becomes `*=`, `<<=` becomes `>>=`, `&=` becomes `|=`, `&&=` becomes `||=` and `??=` becomes `&&=`. A compound assignment whose right side is string-like is refused, except for the logical assignments.',
    examples: [
      { before: 'let x = 1; x += 2;', after: ['x -= 2'] },
      { before: "let s = 'a'; s += 'b';", after: [] },
    ],
  },
  {
    id: 'block-statement',
    name: 'BlockStatement',
    tier: 'default',
    definition:
      'A non-empty block becomes `{}`. An empty block, and a derived constructor body that references `super` while the class initializes properties, are refused.',
    examples: [
      { before: 'function f() { const x = 1; }', after: ['{}'] },
      { before: 'function f() {}', after: [] },
    ],
  },
  {
    id: 'boolean-literal',
    name: 'BooleanLiteral',
    tier: 'default',
    definition:
      '`true` becomes `false`, `false` becomes `true`, and a prefix `!` collapses to its operand. A literal that is not a boolean is refused.',
    examples: [
      { before: 'const x = true;', after: ['false'] },
      { before: 'const x = !a;', after: ['a'] },
      { before: 'const x = 1;', after: [] },
    ],
  },
  {
    id: 'conditional-expression',
    name: 'ConditionalExpression',
    tier: 'default',
    definition:
      'A condition becomes `true` and `false`; a loop test becomes `false`; a condition under `&&` becomes `true` and one under `||` becomes `false`. A statement the rule does not match is refused.',
    examples: [
      { before: 'if (a) { f(); }', after: ['true', 'false'] },
      { before: 'while (a) { f(); }', after: ['false'] },
    ],
  },
  {
    id: 'equality-operator',
    name: 'EqualityOperator',
    tier: 'default',
    definition:
      'An ordering comparison becomes its two alternatives (`<` becomes `<=` and `>=`) and an equality comparison flips (`===` becomes `!==`, `!=` becomes `==`).',
    examples: [
      { before: 'const x = a === b;', after: ['a !== b'] },
      { before: 'const x = a < b;', after: ['a <= b', 'a >= b'] },
    ],
  },
  {
    id: 'logical-operator',
    name: 'LogicalOperator',
    tier: 'default',
    definition:
      '`&&` becomes `||`, `||` becomes `&&` and `??` becomes `&&`. An expression that is not logical is refused.',
    examples: [
      { before: 'const x = a && b;', after: ['a || b'] },
      { before: 'const x = a ?? b;', after: ['a && b'] },
      { before: 'const x = a + b;', after: [] },
    ],
  },
  {
    id: 'method-expression',
    name: 'MethodExpression',
    tier: 'default',
    definition:
      'A known method call becomes its opposite (`toLowerCase` becomes `toUpperCase`) or, for a removal method, a call of the object itself (`arr.filter(p)` becomes `arr()`). A `super` call, an unknown method and a string-literal key are refused.',
    examples: [
      { before: 'const x = "HELLO".toLowerCase();', after: ['"HELLO".toUpperCase()'] },
      { before: 'const x = arr.filter(p);', after: ['arr()'] },
      { before: "const x = arr['filter'](p);", after: [] },
    ],
  },
  {
    id: 'object-literal',
    name: 'ObjectLiteral',
    tier: 'default',
    definition: 'A non-empty object literal becomes `{}`; an empty one is refused.',
    examples: [
      { before: 'const x = { a: 1 };', after: ['{}'] },
      { before: 'const x = {};', after: [] },
    ],
  },
  {
    id: 'optional-chaining',
    name: 'OptionalChaining',
    tier: 'default',
    definition:
      'An optional access becomes the plain one: `a?.b` becomes `a.b`, `a?.[k]` becomes `a[k]` and `a?.()` becomes `a()`. A member that is not optional is refused.',
    examples: [
      { before: 'const x = a?.b;', after: ['a.b'] },
      { before: 'const x = a?.[k];', after: ['a[k]'] },
      { before: 'const x = a.b;', after: [] },
    ],
  },
  {
    id: 'regex',
    name: 'Regex',
    tier: 'default',
    definition:
      'A regular-expression literal, or the string of `new RegExp(...)`, loses anchors, quantifiers, lookarounds or class negations — one mutant per mutation, emitted anchors first. Alternations and groups are refused.',
    examples: [
      { before: 'const x = /a+/;', after: ['/a/'] },
      { before: 'const x = /a|b/;', after: [] },
    ],
  },
  {
    id: 'string-literal',
    name: 'StringLiteral',
    tier: 'default',
    definition:
      "A non-empty string becomes `\"\"` and an empty one becomes 'Stryker was here!'; a template literal's first quasi is mutated. A directive, an import or export specifier, a property key, a JSX attribute and a literal type are refused.",
    examples: [
      { before: 'const x = "hello";', after: ['""'] },
      { before: "'use strict';", after: [] },
    ],
  },
  {
    id: 'unary-operator',
    name: 'UnaryOperator',
    tier: 'default',
    definition:
      '`+x` becomes `-x`, `-x` becomes `+x` and `~x` becomes `x`. `!`, `typeof`, `void` and `delete` are refused.',
    examples: [
      { before: 'const x = -a;', after: ['+a'] },
      { before: 'const x = ~a;', after: ['a'] },
      { before: 'const x = typeof y;', after: [] },
    ],
  },
  {
    id: 'update-operator',
    name: 'UpdateOperator',
    tier: 'default',
    definition: '`++` becomes `--` and `--` becomes `++`, prefix or postfix.',
    examples: [{ before: 'let x = 1; x++;', after: ['x--'] }],
  },
  {
    id: 'atomic-update-split',
    name: 'AtomicUpdateSplit',
    tier: 'default',
    definition:
      'A `Ref` or `SynchronizedRef` atomic update — `modify`, `modifySome`, `update`, `updateSome`, `updateAndGet`, `getAndUpdate` — is split into a read, a snapshot update and a write, so a lost update survives. The `Effect` module has to be in scope, and the reference and the handler have to be movable.',
    examples: [
      { before: ATOMIC_UPDATE_DATA_FIRST, after: [ATOMIC_UPDATE_DATA_FIRST_REPLACEMENT] },
      { before: ATOMIC_UPDATE_DATA_LAST, after: [ATOMIC_UPDATE_DATA_LAST_REPLACEMENT] },
      { before: ATOMIC_UPDATE_WITHOUT_EFFECT, after: [] },
    ],
  },
  {
    id: 'synchronization-removal',
    name: 'SynchronizationRemoval',
    tier: 'default',
    definition:
      'The lock a call takes is dropped: `Semaphore.withPermits(sem, n, effect)` and `Semaphore.withPermit(sem, effect)` become the guarded effect, their piped forms become `self => self`, `Effect.uninterruptible(effect)` becomes `effect`, and `Effect.uninterruptibleMask(f)` becomes `Effect.suspend(() => f(Effect.interruptible))`. A guard that is not droppable, and a method-form call whose guard is built on the spot, are refused.',
    examples: [
      { before: SYNCHRONIZATION_GUARDED, after: ['effect'] },
      { before: SYNCHRONIZATION_FROZEN_PIPE, after: ['self => self'] },
      {
        before: SYNCHRONIZATION_MASKED,
        after: ['Effect.suspend(() => (restore => restore(effect))(Effect.interruptible))'],
      },
      { before: SYNCHRONIZATION_GUARD_ON_THE_SPOT, after: [] },
    ],
  },
  {
    id: 'finalizer-escape',
    name: 'FinalizerEscape',
    tier: 'default',
    definition:
      'A finalizer is kept only for the path that did not interrupt: `Effect.ensuring(effect, fin)` re-runs `fin` when the exit was not an interruption, `Effect.onError(effect, h)` re-runs `h` when the cause carries none, a release bracket wraps its release the same way, and `Effect.onInterrupt(effect, h)` drops the handler. A handler built by a call, and a cleanup that yields while it is moved, are refused.',
    examples: [
      { before: FINALIZER_ENSURING, after: [FINALIZER_ENSURING_REPLACEMENT] },
      { before: FINALIZER_ON_ERROR, after: [FINALIZER_ON_ERROR_REPLACEMENT] },
      { before: FINALIZER_ACQUIRE_RELEASE, after: [FINALIZER_ACQUIRE_RELEASE_REPLACEMENT] },
      { before: FINALIZER_ACQUIRE_USE_RELEASE, after: [FINALIZER_ACQUIRE_USE_RELEASE_REPLACEMENT] },
      { before: FINALIZER_LOCAL_HELPER, after: [] },
    ],
  },
  {
    id: 'refinement-boundary',
    name: 'RefinementBoundary',
    tier: 'default',
    definition:
      'A Schema bound moves by one inclusivity step: `isGreaterThan` and `isGreaterThanOrEqualTo` swap, as do `isLessThan` and `isLessThanOrEqualTo`; `isBetween` toggles one exclusivity flag per mutant; `isMinLength(n)` becomes `isMinLength(n + 1)` and `isMaxLength(n)` becomes `isMaxLength(n - 1)`. A swap needs the Schema module in scope, and a bound or flag the mutant could not change, a non-literal `isBetween` options object, and a local function sharing a check name are refused.',
    examples: [
      { before: REFINEMENT_BOUND, after: ['S.isGreaterThanOrEqualTo(0)'] },
      {
        before: REFINEMENT_BETWEEN,
        after: [
          'S.isBetween({ minimum: 1, maximum: 9, exclusiveMinimum: true })',
          'S.isBetween({ minimum: 1, maximum: 9, exclusiveMaximum: true })',
        ],
      },
      { before: REFINEMENT_MIN_LENGTH, after: ['S.isMinLength(2 + 1)'] },
      { before: REFINEMENT_LOCAL_HELPER, after: [] },
    ],
  },
  {
    id: 'refinement-removal',
    name: 'RefinementRemoval',
    tier: 'default',
    definition:
      'One Schema refinement is removed, so the schema accepts what it refused: a `.check(...)` or `S.check(...)` with several checks loses one per mutant; a method `.check(c)` with one check becomes its schema, and a piped `S.check(c)` becomes `self => self`. A `check` that does not resolve to the Schema module, and a lone `S.check(c)` outside a pipe, are refused.',
    examples: [
      {
        before: REFINEMENT_TWO_CHECKS,
        after: ['S.String.check(S.isPattern(/^[a-z]+$/))', 'S.String.check(S.isMinLength(1))'],
      },
      { before: REFINEMENT_BOUND, after: ['S.Number'] },
      { before: REFINEMENT_PIPED_CHECK, after: ['self => self'] },
      { before: REFINEMENT_LOCAL_CHECK, after: [] },
    ],
  },
] as const satisfies ReadonlyArray<StockCatalogEntry>

export const StockCatalog: typeof MutatorCatalog.Catalog.Encoded = { provider: 'stryker', entries }

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Option = await import('effect/Option')

  const namesOfTier = (tier: MutatorCatalog.TierValue): ReadonlyArray<string> =>
    Option.match(S.decodeOption(MutatorCatalog.Catalog)(StockCatalog), {
      onNone: () => [],
      onSome: (catalog) => catalog.entries.filter((entry) => entry.tier === tier).map((entry) => entry.name),
    })

  const vocabularyOf = (tier: MutatorCatalog.TierValue): ReadonlyArray<string> =>
    tier === 'default' ? StockDefaultName.literals : []

  const sameNames = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
    left.length === right.length && Arr.every(left, (name) => right.includes(name))

  it.prop(
    '∀t_StockNames_≡VocabularyOfTier',
    { of: [MutatorCatalog.Tier], subject: namesOfTier },
    (subject, [tier]) => sameNames(subject(tier), vocabularyOf(tier)),
  )
}
