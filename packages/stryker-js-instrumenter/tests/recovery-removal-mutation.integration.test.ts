import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect } from 'effect'

import { instrument, stockOptions } from './__fixtures__/instrument.js'

const RECOVERY_REMOVAL = 'RecoveryRemoval'

const PIPED_CATCH_TAG_SOURCE = `import { Effect } from 'effect'

export const withFallback = (program: Effect.Effect<number, { readonly _tag: 'NotFound' }>, fallback: number) =>
  program.pipe(Effect.catchTag('NotFound', () => Effect.succeed(fallback)))
`

const DATA_FIRST_CATCH_TAG_SOURCE = `import { Effect } from 'effect'

export const withFallback = (program: Effect.Effect<number, { readonly _tag: 'NotFound' }>) =>
  Effect.catchTag(program, 'NotFound', () => Effect.succeed(0))
`

const PIPED_CATCH_TAG_OR_ELSE_SOURCE = `import { Effect, pipe } from 'effect'

export const withFallback = (program: Effect.Effect<number, { readonly _tag: 'NotFound' }>) =>
  pipe(program, Effect.catchTag('NotFound', () => Effect.succeed(0), () => Effect.succeed(1)))
`

const DATA_FIRST_CATCH_TAG_OR_ELSE_SOURCE = `import { Effect } from 'effect'

export const withFallback = (program: Effect.Effect<number, { readonly _tag: 'NotFound' }>) =>
  Effect.catchTag(program, 'NotFound', () => Effect.succeed(0), () => Effect.succeed(1))
`

const PIPED_CATCH_TAG_LIST_SOURCE = `import { Effect } from 'effect'

type Missing = { readonly _tag: 'NotFound' } | { readonly _tag: 'Gone' }

export const withFallback = (program: Effect.Effect<number, Missing>) =>
  program.pipe(Effect.catchTag(['NotFound', 'Gone'], () => Effect.succeed(0)))
`

const DATA_FIRST_CATCH_SOURCE = `import { Effect } from 'effect'

export const withFallback = (program: Effect.Effect<number, string>) => Effect.catch(program, () => Effect.succeed(0))
`

const DATA_FIRST_CATCH_IF_SOURCE = `import { Effect } from 'effect'

export const withFallback = (program: Effect.Effect<number, string>, isMissing: (error: string) => boolean) =>
  Effect.catchIf(program, isMissing, () => Effect.succeed(0))
`

const DATA_FIRST_CATCH_REASON_SOURCE = `import { Effect } from 'effect'

export const withFallback = (program: Effect.Effect<number, AiError>) =>
  Effect.catchReason(program, 'AiError', 'RateLimit', () => Effect.succeed(0))
`

const PIPED_OR_ELSE_SUCCEED_SOURCE = `import { Effect } from 'effect'

export const withFallback = (program: Effect.Effect<number, string>) => program.pipe(Effect.orElseSucceed(() => 0))
`

const LITERAL_CASES = [
  { recovery: 'piped catchTag', source: PIPED_CATCH_TAG_SOURCE, replacement: 'self => self' },
  { recovery: 'data-first catchTag', source: DATA_FIRST_CATCH_TAG_SOURCE, replacement: 'program' },
  { recovery: 'piped catchTag with an orElse', source: PIPED_CATCH_TAG_OR_ELSE_SOURCE, replacement: 'self => self' },
  {
    recovery: 'data-first catchTag with an orElse',
    source: DATA_FIRST_CATCH_TAG_OR_ELSE_SOURCE,
    replacement: 'program',
  },
  { recovery: 'piped catchTag over a tag list', source: PIPED_CATCH_TAG_LIST_SOURCE, replacement: 'self => self' },
  { recovery: 'data-first catch', source: DATA_FIRST_CATCH_SOURCE, replacement: 'program' },
  { recovery: 'data-first catchIf', source: DATA_FIRST_CATCH_IF_SOURCE, replacement: 'program' },
  { recovery: 'data-first catchReason', source: DATA_FIRST_CATCH_REASON_SOURCE, replacement: 'program' },
  { recovery: 'piped orElseSucceed', source: PIPED_OR_ELSE_SUCCEED_SOURCE, replacement: 'self => self' },
] as const

const CATCH_TAGS_SOURCE = `import { Effect } from 'effect'

type Missing = { readonly _tag: 'NotFound' } | { readonly _tag: 'Gone' }

export const withFallbacks = (program: Effect.Effect<number, Missing>) =>
  Effect.catchTags(program, { NotFound: () => Effect.succeed(0), Gone: () => Effect.succeed(1) })
`

const CATCH_REASONS_SOURCE = `import { Effect } from 'effect'

export const withFallbacks = (program: Effect.Effect<number, AiError>) =>
  program.pipe(Effect.catchReasons('AiError', { RateLimit: () => Effect.succeed(0), Timeout: () => Effect.succeed(1) }))
`

const HANDLER_BUILT_BY_CALL_IN_RECORD_SOURCE = `import { Effect } from 'effect'

type Missing = { readonly _tag: 'NotFound' } | { readonly _tag: 'Gone' }

declare const recoverWith: (value: number) => () => Effect.Effect<number>

export const withFallbacks = (program: Effect.Effect<number, Missing>) =>
  Effect.catchTags(program, { NotFound: recoverWith(0), Gone: () => Effect.succeed(1) })
`

const RECORD_CASES = [
  {
    record: 'a data-first catchTags record',
    source: CATCH_TAGS_SOURCE,
    replacements: [
      'Effect.catchTags(program, { Gone: () => Effect.succeed(1) })',
      'Effect.catchTags(program, { NotFound: () => Effect.succeed(0) })',
    ],
  },
  {
    record: 'a piped catchReasons record',
    source: CATCH_REASONS_SOURCE,
    replacements: [
      "Effect.catchReasons('AiError', { Timeout: () => Effect.succeed(1) })",
      "Effect.catchReasons('AiError', { RateLimit: () => Effect.succeed(0) })",
    ],
  },
  {
    record: 'a record whose other handler is built by a call',
    source: HANDLER_BUILT_BY_CALL_IN_RECORD_SOURCE,
    replacements: ['Effect.catchTags(program, { NotFound: recoverWith(0) })'],
  },
] as const

const LOCAL_CATCH_TAG_SOURCE =
  `const catchTag = (program: number, _tag: string, recover: () => number) => program || recover()

export const withFallback = (program: number) => catchTag(program, 'NotFound', () => 0)
`

const SHADOWED_EFFECT_SOURCE = `import { Effect } from 'effect'

export const shadowed = (
  Effect: { catchTag: (program: number, tag: string, recover: () => number) => number },
  program: number,
) => Effect.catchTag(program, 'NotFound', () => 0)
`

const HANDLER_BUILT_BY_CALL_SOURCE = `import { Effect } from 'effect'

declare const recoverWith: (value: number) => () => Effect.Effect<number>

export const withFallback = (program: Effect.Effect<number, { readonly _tag: 'NotFound' }>) =>
  program.pipe(Effect.catchTag('NotFound', recoverWith(0)))
`

const TAG_LIST_BUILT_BY_CALL_SOURCE = `import { Effect } from 'effect'

type Missing = { readonly _tag: 'NotFound' } | { readonly _tag: 'Gone' }

declare const tagOf: (index: number) => 'Gone'

export const withFallback = (program: Effect.Effect<number, Missing>) =>
  program.pipe(Effect.catchTag(['NotFound', tagOf(1)], () => Effect.succeed(0)))
`

const SPREAD_RECORD_SOURCE = `import { Effect } from 'effect'

type Missing = { readonly _tag: 'NotFound' } | { readonly _tag: 'Gone' }

declare const shared: { readonly Gone: () => Effect.Effect<number> }

export const withFallbacks = (program: Effect.Effect<number, Missing>) =>
  Effect.catchTags(program, { ...shared, NotFound: () => Effect.succeed(0) })
`

const STORED_DATA_LAST_SOURCE = `import { Effect } from 'effect'

export const recover = Effect.catchTag('NotFound', () => Effect.succeed(0), () => Effect.succeed(1))
`

const REFUSAL_CASES = [
  { situation: 'a local helper sharing the covered name', source: LOCAL_CATCH_TAG_SOURCE },
  { situation: 'an Effect parameter shadowing the import', source: SHADOWED_EFFECT_SOURCE },
  { situation: 'a handler the module would have to build with a call', source: HANDLER_BUILT_BY_CALL_SOURCE },
  { situation: 'a tag list the module would have to build with a call', source: TAG_LIST_BUILT_BY_CALL_SOURCE },
  { situation: 'a handler record that spreads another record', source: SPREAD_RECORD_SOURCE },
  { situation: 'a data-last recovery stored for later', source: STORED_DATA_LAST_SOURCE },
] as const

const instrumentSource = (source: string, excludedMutations: readonly string[] = []) =>
  instrument(
    [{ name: '/tmp/recovery-removal-probe.ts', content: source, mutate: true }],
    stockOptions({ ignorers: [], excludedMutations: [...excludedMutations] }),
  )

const recoveryMutantsOf = (result: { readonly mutants: readonly Mutant.Mutant[] }): readonly Mutant.Mutant[] =>
  result.mutants.filter((mutant) => mutant.mutatorName === RECOVERY_REMOVAL)

const Feature = makeFeature({ it })

Feature('Exposing untested recoveries by letting the typed failure through')
  .live('parses real source with the oxc parser')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'The <recovery> is removed word for word as promised',
      LITERAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a module with one covered recovery')('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'mutants',
            ({ source }: { source: string }) => Effect.map(instrumentSource(source), recoveryMutantsOf),
          ),
          Then('the one proposed mutant spells the unrecovered effect word for word')(
            ({ mutants }: { mutants: readonly Mutant.Mutant[] }, expect) =>
              expect(mutants.map((mutant) => mutant.replacement)).toEqual([row.replacement]),
          ),
        ),
    )

    scenarioOutline(
      'Each removable handler of <record> is dropped in a mutant of its own',
      RECORD_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a module with one handler record')('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'mutants',
            ({ source }: { source: string }) => Effect.map(instrumentSource(source), recoveryMutantsOf),
          ),
          Then('every proposed mutant keeps the call and all handlers but one')(
            ({ mutants }: { mutants: readonly Mutant.Mutant[] }, expect) =>
              expect(mutants.map((mutant) => mutant.replacement)).toEqual(row.replacements),
          ),
        ),
    )

    scenarioOutline(
      'A <situation> is left alone',
      REFUSAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given(row.situation)('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'count',
            ({ source }: { source: string }) =>
              Effect.map(instrumentSource(source), (result) => recoveryMutantsOf(result).length),
          ),
          Then('no mutant is proposed')(({ count }: { count: number }, expect) => expect(count).toBe(0)),
        ),
    )

    scenario(
      'A run that excludes the recovery removal still reports its mutants, ignored',
      Gherkin.Do.pipe(
        Given('a module with a two-handler record')('source', () => Effect.succeed(CATCH_TAGS_SOURCE)),
        When('the module is instrumented with the recovery removal excluded')(
          'mutants',
          ({ source }: { source: string }) =>
            Effect.map(instrumentSource(source, [RECOVERY_REMOVAL]), recoveryMutantsOf),
        ),
        Then('both mutants are reported as ignored for the exclusion')(
          ({ mutants }: { mutants: readonly Mutant.Mutant[] }, expect) =>
            expect(mutants.map((mutant) => [mutant.status, mutant.statusReason])).toEqual([
              ['Ignored', `excluded-mutator: Ignored because of excluded mutation "${RECOVERY_REMOVAL}"`],
              ['Ignored', `excluded-mutator: Ignored because of excluded mutation "${RECOVERY_REMOVAL}"`],
            ]),
        ),
      ),
    )
  })
