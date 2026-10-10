import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ExtendsArraySchema,
  extendsEntriesOf,
  referencePathsOf,
  type TSConfig,
  TsConfigSchema,
} from './Sandbox.schema.js'

const RewriteSandboxTsconfigTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RewriteSandboxTsconfig')
type RewriteSandboxTsconfigTypeId = typeof RewriteSandboxTsconfigTypeId

export const TsconfigMissing = S.TaggedStruct('TsconfigMissing', {})

export const TsconfigUnparsable = S.TaggedStruct('TsconfigUnparsable', { reason: S.String })

export const TsconfigParsed = S.TaggedStruct('TsconfigParsed', {
  config: TsConfigSchema,
  relativeToBasePath: S.HashMap(S.String, S.String),
})

export class RewriteSandboxTsconfigCommand
  extends S.TaggedClass<RewriteSandboxTsconfigCommand>()('RewriteSandboxTsconfigCommand', {
    tsconfig: S.Union([TsconfigMissing, TsconfigUnparsable, TsconfigParsed]),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class TsconfigSkipped extends S.TaggedClass<TsconfigSkipped>()('TsconfigSkipped', {}) {
  readonly [RewriteSandboxTsconfigTypeId] = RewriteSandboxTsconfigTypeId
}

export class TsconfigKept extends S.TaggedClass<TsconfigKept>()('TsconfigKept', { reason: S.String }) {
  readonly [RewriteSandboxTsconfigTypeId] = RewriteSandboxTsconfigTypeId
}

export class TsconfigRewritten extends S.TaggedClass<TsconfigRewritten>()('TsconfigRewritten', {
  config: TsConfigSchema,
  follow: S.Array(S.String),
}) {
  readonly [RewriteSandboxTsconfigTypeId] = RewriteSandboxTsconfigTypeId
}

export const RewriteSandboxTsconfigDecision = S.Union([TsconfigSkipped, TsconfigKept, TsconfigRewritten])
export type RewriteSandboxTsconfigDecision = typeof RewriteSandboxTsconfigDecision.Type

type Parsed = typeof TsconfigParsed.Type
type FileArrayKey = 'exclude' | 'files' | 'include'

const escapes = (parsed: Parsed, entry: string): boolean =>
  Option.exists(HashMap.get(parsed.relativeToBasePath, entry), (relative) => relative.startsWith('..'))

const escapedReferenceOf = (entry: string): string => `../../${entry.replaceAll('\\', '/')}`

const rewriteOf = (parsed: Parsed) => (entry: string): string =>
  Boolean.match(escapes(parsed, entry), { onTrue: () => escapedReferenceOf(entry), onFalse: () => entry })

const followedOf = (parsed: Parsed, entries: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.filter(entries, (entry) => !escapes(parsed, entry))

const referencedTsconfigOf = (referencePath: string): string =>
  Boolean.match(referencePath.endsWith('.json'), {
    onTrue: () => referencePath,
    onFalse: () => `${referencePath}/tsconfig.json`,
  })

const rewrittenFileArray = <K extends FileArrayKey>(
  parsed: Parsed,
  key: K,
): { readonly [P in K]?: ReadonlyArray<string> } =>
  Option.match(Option.fromUndefinedOr(parsed.config[key]), {
    onNone: () => ({}),
    onSome: (entries) => Record.singleton(key, Arr.map(entries, rewriteOf(parsed))),
  })

const rewrittenExtends = (parsed: Parsed): Pick<TSConfig, 'extends'> =>
  Match.value(parsed.config.extends).pipe(
    Match.when(Predicate.isUndefined, () => ({})),
    Match.when(Predicate.isString, (entry) => ({ extends: rewriteOf(parsed)(entry) })),
    Match.when(S.is(ExtendsArraySchema), (entries) => ({ extends: Arr.map(entries, rewriteOf(parsed)) })),
    Match.exhaustive,
  )

const rewrittenReferences = (parsed: Parsed): Pick<TSConfig, 'references'> =>
  Option.match(Option.fromUndefinedOr(parsed.config.references), {
    onNone: () => ({}),
    onSome: (references) => ({
      references: Arr.map(references, (reference) => ({ ...reference, path: rewriteOf(parsed)(reference.path) })),
    }),
  })

const rewrittenOf = (parsed: Parsed): TsconfigRewritten =>
  TsconfigRewritten.make({
    config: {
      ...parsed.config,
      ...rewrittenFileArray(parsed, 'include'),
      ...rewrittenFileArray(parsed, 'exclude'),
      ...rewrittenFileArray(parsed, 'files'),
      ...rewrittenExtends(parsed),
      ...rewrittenReferences(parsed),
    },
    follow: [
      ...followedOf(parsed, extendsEntriesOf(parsed.config)),
      ...Arr.map(followedOf(parsed, referencePathsOf(parsed.config)), referencedTsconfigOf),
    ],
  })

const decide = (command: RewriteSandboxTsconfigCommand): Result.Result<RewriteSandboxTsconfigDecision, never> =>
  Result.succeed(
    Match.value(command.tsconfig).pipe(
      Match.tagsExhaustive({
        TsconfigMissing: (): RewriteSandboxTsconfigDecision => TsconfigSkipped.make({}),
        TsconfigUnparsable: ({ reason }): RewriteSandboxTsconfigDecision => TsconfigKept.make({ reason }),
        TsconfigParsed: (parsed): RewriteSandboxTsconfigDecision => rewrittenOf(parsed),
      }),
    ),
  )

export const rewriteSandboxTsconfig = Workflow.make({
  command: RewriteSandboxTsconfigCommand,
  decision: RewriteSandboxTsconfigDecision,
  error: S.Never,
  decide,
})
