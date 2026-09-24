import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitSurvivorsRun,
  AdmitSurvivorsRunCommand,
  Admitted,
  NoSurvivors,
  SurvivorsRejection,
} from '../admit-survivors-run.workflow.js'
import { ConfigFileUnreadableError } from '../ConfigError.schema.js'
import { RelativeNormalizedFileName } from '../matching.schema.js'
import type { OutputMode } from '../output-mode.schema.js'
import { readConfig } from '../run/load-config.cell.js'
import { StrykerPackage } from '../stryker-package.schema.js'
import { PriorReportDocument, type PriorReportMutant } from './Survivors.schema.js'

export interface SurvivorsAdmissionInput {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly mode: OutputMode
  readonly basePath: string
}

export interface SurvivorsAdmissionAnswer {
  readonly admission: Admitted | NoSurvivors
  readonly resolvedOptions: Options.StrykerOptions
  readonly priorReportPath: string
}

type SurvivorsRaw = typeof AdmitSurvivorsRunCommand.Encoded & {
  readonly resolvedOptions: Options.StrykerOptions
  readonly priorReportPath: string
}

const DEFAULT_SURVIVORS_PRIOR_REPORT = 'reports/mutation-report.json'

const EMPTY_CONFIG: Record<string, string> = {}

type HashContent = (content: string) => string

type ResolveAbsolutePath = (file: string) => string

type RelativizeFileName = (fileName: string) => string

const hashContent: HashContent = (content) => bytesToHex(sha256(utf8ToBytes(content)))

const priorSourceHashes = (priorReport: PriorReportDocument, hash: HashContent) =>
  Object.fromEntries(Object.entries(priorReport.files).map(([file, fileResult]) => [file, hash(fileResult.source)]))

const survivorLocationOf = (mutant: PriorReportMutant) => ({
  start: {
    line: mutant.location.start.line,
    column: mutant.location.start.column,
  },
  end: {
    line: mutant.location.end.line,
    column: mutant.location.end.column,
  },
})

const reportMutantToMutant = (
  file: string,
  mutant: PriorReportMutant,
  resolveAbsolutePath: ResolveAbsolutePath,
  relativize: RelativizeFileName,
) => {
  const fileName = resolveAbsolutePath(file)
  return {
    _tag: 'Mutant' as const,
    id: mutant.id,
    fileName,
    relativeFileName: relativize(fileName),
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement ?? mutant.mutatorName,
    location: survivorLocationOf(mutant),
  }
}

const extractSurvivors = (
  priorReport: PriorReportDocument,
  resolveAbsolutePath: ResolveAbsolutePath,
  relativize: RelativizeFileName,
) =>
  Object.entries(priorReport.files).flatMap(([file, fileResult]) =>
    fileResult.mutants
      .filter((mutant) => mutant.status === 'Survived')
      .map((mutant) => reportMutantToMutant(file, mutant, resolveAbsolutePath, relativize))
  )

const resolveAbsolutePathOf = (basePath: string): ResolveAbsolutePath => (file) => `${basePath}/${file}`

const resolveSurvivorsRunOptions = (cliOptions: Options.PartialStrykerOptions, mode: OutputMode) =>
  readConfig(cliOptions, { command: 'run', mode })

const priorReportPathOf = (resolved: Options.StrykerOptions) =>
  Option.getOrElse(
    Option.filter(Option.fromUndefinedOr(resolved['survivorsPriorReport']), Predicate.isString),
    () => DEFAULT_SURVIVORS_PRIOR_REPORT,
  )

interface PriorReportRead<A = unknown> {
  readonly found: boolean
  readonly raw: A
}

const readPriorReport = (priorReportPath: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(priorReportPath).pipe(
      Effect.map((text): PriorReportRead => ({
        found: true,
        raw: Result.match(S.decodeResult(S.fromJsonString(S.Unknown))(text), {
          onFailure: () => text,
          onSuccess: (value) => value,
        }),
      })),
      Effect.catchTag('PlatformError', (cause) =>
        Match.value(cause.reason).pipe(
          Match.tag('NotFound', () => Effect.succeed<PriorReportRead>({ found: false, raw: undefined })),
          Match.orElse(() => Effect.fail(ConfigFileUnreadableError.make({ file: priorReportPath, cause }))),
        )),
    ))

const priorReportFileKeys = <A = unknown>(raw: A) =>
  Option.getOrElse(
    Option.map(
      Option.flatMap(
        Option.liftPredicate(raw, Match.record),
        (document) => Option.liftPredicate(document['files'], Match.record),
      ),
      (files) => Object.keys(files),
    ),
    (): readonly string[] => [],
  )

const readSourceFile = (file: string) =>
  Effect.flatMap(
    FileSystem.FileSystem,
    (fs) => fs.readFileString(file).pipe(Effect.mapError((cause) => ConfigFileUnreadableError.make({ file, cause }))),
  )

const SOURCE_HASH_CONCURRENCY = 24

const currentSourceHashesFor = (files: readonly string[]) =>
  Effect.map(
    Effect.forEach(
      files,
      (file) => Effect.map(readSourceFile(file), (content): readonly [string, string] => [file, hashContent(content)]),
      { concurrency: SOURCE_HASH_CONCURRENCY },
    ),
    (pairs): Record<string, string> => Object.fromEntries(pairs),
  )

export const survivorsAdmissionCell = Sandwich.named('stryker.survivors_admission')((input: SurvivorsAdmissionInput) =>
  Effect.gen(function*() {
    const resolvedOptions = yield* resolveSurvivorsRunOptions(input.cliOptions, input.mode)
    const priorReportPath = priorReportPathOf(resolvedOptions)
    const relativize: RelativizeFileName = (fileName) =>
      RelativeNormalizedFileName.fromAbsolute(fileName, input.basePath).fileName
    const resolveAbsolutePath = resolveAbsolutePathOf(input.basePath)
    const read = yield* readPriorReport(priorReportPath)
    const sourceContentHashes = yield* currentSourceHashesFor(priorReportFileKeys(read.raw))
    return yield* Boolean.match(read.found, {
      onFalse: () =>
        Effect.succeed<SurvivorsRaw>({
          currentConfig: resolvedOptions,
          frameworkVersion: StrykerPackage.version,
          priorReport: undefined,
          priorSourceHashes: {},
          priorSurvivors: [],
          sourceContentHashes,
          resolvedOptions,
          priorReportPath,
        }),
      onTrue: () =>
        Effect.fromResult(Result.match(S.decodeUnknownResult(PriorReportDocument)(read.raw), {
          onFailure: (error) => Result.fail(error),
          onSuccess: (document) =>
            Result.succeed<SurvivorsRaw>({
              currentConfig: resolvedOptions,
              frameworkVersion: StrykerPackage.version,
              priorReport: {
                config: Option.getOrElse(Option.fromNullishOr(document.config), () => EMPTY_CONFIG),
                frameworkVersion: Option.getOrUndefined(
                  Option.flatMap(
                    Option.fromNullishOr(document.framework),
                    (framework) => Option.fromNullishOr(framework.version),
                  ),
                ),
              },
              priorSourceHashes: priorSourceHashes(document, hashContent),
              priorSurvivors: extractSurvivors(document, resolveAbsolutePath, relativize),
              sourceContentHashes,
              resolvedOptions,
              priorReportPath,
            }),
        })),
    })
  })
).decide(admitSurvivorsRun).write({
  Admitted: (admitted, raw) =>
    Effect.map(
      S.decodeEffect(Admitted)(admitted),
      (admission) => ({
        admission,
        resolvedOptions: raw.resolvedOptions,
        priorReportPath: raw.priorReportPath,
      }),
    ),
  NoSurvivors: (_outcome, raw) =>
    Effect.succeed({
      admission: NoSurvivors.make(),
      resolvedOptions: raw.resolvedOptions,
      priorReportPath: raw.priorReportPath,
    }),
  SurvivorsRejection: (rejection) => Effect.fail(SurvivorsRejection.make(rejection)),
  CommandRejected: ({ issue }) => Effect.fail(SurvivorsRejection.make({ reason: 'mismatch', remediation: issue })),
})

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')
  const { Arbitrary } = await import('effect/unstable/arbitrary')

  const SourceText = Schema.String.check(Schema.isPattern(/^\P{Surrogate}*$/u), Schema.isMaxLength(64))

  const KNOWN_SHA256_VECTORS = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['✓', '1dabba21cdad44541f6b15796f8d22978fc7ea10c46aeceeeeb66c23b3ac7604'],
  ] as const

  it.prop('∀s_HashContent_∈Sha256Hex', [SourceText], ([source]) => /^[0-9a-f]{64}$/.test(hashContent(source)))

  it.prop(
    '∀ab_HashContent_DistinctPerDraw',
    [SourceText, SourceText],
    ([a, b]) => a === b || hashContent(a) !== hashContent(b),
  )

  it.prop(
    '∀kv_HashContent_≡KnownAnswerVectors',
    [Arbitrary.Constant(KNOWN_SHA256_VECTORS)],
    ([vectors]) => vectors.every(([content, digest]) => hashContent(content) === digest),
  )
}
