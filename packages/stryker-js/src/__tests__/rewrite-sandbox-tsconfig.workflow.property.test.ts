import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  rewriteSandboxTsconfig,
  RewriteSandboxTsconfigCommand,
  type RewriteSandboxTsconfigDecision,
  TsconfigParsed,
  TsconfigRewritten,
  TsconfigSkipped,
} from '../rewrite-sandbox-tsconfig.workflow.js'
import { type TSConfig, TsConfigSchema } from '../Sandbox.schema.js'

const rewrittenKeys: ReadonlyArray<string> = ['include', 'exclude', 'files', 'extends', 'references', 'path']

const listOf = (value: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> => [value ?? []].flat()

const drawnEntriesOf = (config: TSConfig): ReadonlyArray<string> => [
  ...listOf(config.files),
  ...listOf(config.include),
  ...listOf(config.exclude),
  ...listOf(config.extends),
  ...(config.references ?? []).map((reference) => reference.path),
]

const escapingOf = (config: TSConfig, bits: ReadonlyArray<boolean>): HashSet.HashSet<string> =>
  HashSet.fromIterable(
    Arr.filter(drawnEntriesOf(config), (_entry, index) => bits[index % bits.length] === true),
  )

const commandOf = (config: TSConfig, escaping: HashSet.HashSet<string>): RewriteSandboxTsconfigCommand =>
  RewriteSandboxTsconfigCommand.make({
    tsconfig: TsconfigParsed.make({
      config,
      relativeToBasePath: HashMap.fromIterable(
        Arr.map(
          drawnEntriesOf(config),
          (entry) => [entry, HashSet.has(escaping, entry) ? '../outside' : 'inside'] as const,
        ),
      ),
    }),
  })

const expectedEntryOf = (escaping: HashSet.HashSet<string>) => (entry: string): string =>
  HashSet.has(escaping, entry) ? `../../${entry.split('\\').join('/')}` : entry

const sameJson = <A>(left: A, right: A): boolean => JSON.stringify(left) === JSON.stringify(right)

const rewrittenOf = (decision: RewriteSandboxTsconfigDecision) =>
  Match.value(decision).pipe(
    Match.tag('TsconfigRewritten', (rewritten) => Option.some(rewritten)),
    Match.tag('TsconfigSkipped', 'TsconfigKept', () => Option.none()),
    Match.exhaustive,
  )

const decisionOf = (
  subject: typeof rewriteSandboxTsconfig,
  config: TSConfig,
  escaping: HashSet.HashSet<string>,
) => Option.flatMap(Result.getSuccess(subject(commandOf(config, escaping))), rewrittenOf)

const entriesRewritten = (config: TSConfig, rewritten: TSConfig, escaping: HashSet.HashSet<string>): boolean => {
  const expected = (entries: ReadonlyArray<string> | undefined) => entries?.map(expectedEntryOf(escaping))
  return sameJson(rewritten.include, expected(config.include)) &&
    sameJson(rewritten.exclude, expected(config.exclude)) &&
    sameJson(rewritten.files, expected(config.files)) &&
    sameJson(listOf(rewritten.extends), expected(listOf(config.extends))) &&
    sameJson(
      rewritten.references?.map((reference) => reference.path),
      expected(config.references?.map((reference) => reference.path)),
    )
}

const referencedTsconfigOf = (path: string): string => path.endsWith('.json') ? path : `${path}/tsconfig.json`

const otherKeysOf = (config: object): ReadonlyArray<string> =>
  Object.keys(config).filter((key) => !rewrittenKeys.includes(key))

const keepsOtherKeys = (original: object, written: object): boolean =>
  otherKeysOf(original).every((key) => sameJson(Reflect.get(written, key), Reflect.get(original, key)))

describe('rewriteSandboxTsconfig', () => {
  it.prop(
    '∀tsconfig_Rewrite_≡EscapingEntriesTwoLevelsUpOthersUnchanged',
    { of: [TsConfigSchema, S.Array(S.Boolean)], subject: rewriteSandboxTsconfig },
    (subject, [config, bits]) => {
      const escaping = escapingOf(config, bits)
      return Option.exists(
        decisionOf(subject, config, escaping),
        (decision) => entriesRewritten(config, decision.config, escaping),
      )
    },
  )

  it.prop(
    '∀tsconfig_Follow_≡NonEscapingExtendsThenNonEscapingReferenceTsconfigs',
    { of: [TsConfigSchema, S.Array(S.Boolean)], subject: rewriteSandboxTsconfig },
    (subject, [config, bits]) => {
      const escaping = escapingOf(config, bits)
      const kept = (entry: string) => !HashSet.has(escaping, entry)
      return Option.exists(decisionOf(subject, config, escaping), (decision) =>
        sameJson(decision.follow, [
          ...listOf(config.extends).filter(kept),
          ...(config.references ?? []).map((reference) => reference.path).filter(kept).map(referencedTsconfigOf),
        ]))
    },
  )

  it.prop(
    '∀tsconfig_EncodedRewrite_≡KeepsEveryKeyOutsideTheRewrittenFive',
    { of: [TsConfigSchema, S.Array(S.Boolean)], subject: rewriteSandboxTsconfig },
    (subject, [config, bits]) =>
      Option.exists(
        decisionOf(subject, config, escapingOf(config, bits)),
        (decision) =>
          Option.exists(S.encodeOption(TsConfigSchema)(decision.config), (encoded) =>
            keepsOtherKeys(config, encoded) &&
            Arr.every(
              Arr.zip(config.references ?? [], encoded.references ?? []),
              ([reference, written]) => keepsOtherKeys(reference, written),
            )),
      ),
  )

  it.prop(
    '∀command_Decision_≡SkippedWhenMissingKeptWithItsReasonWhenUnparsableRewrittenWhenParsed',
    { of: [RewriteSandboxTsconfigCommand], subject: rewriteSandboxTsconfig },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          Match.value(command.tsconfig).pipe(
            Match.tag('TsconfigMissing', () => S.is(TsconfigSkipped)(decision)),
            Match.tag('TsconfigUnparsable', ({ reason }) =>
              Match.value(decision).pipe(
                Match.tag('TsconfigKept', (kept) => kept.reason === reason),
                Match.tag('TsconfigSkipped', 'TsconfigRewritten', () => false),
                Match.exhaustive,
              )),
            Match.tag('TsconfigParsed', () => S.is(TsconfigRewritten)(decision)),
            Match.exhaustive,
          ),
      }),
  )
})
