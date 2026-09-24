import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
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
import { strykerVersion } from '../stryker-package.js'
import { PriorReportDocument, type PriorReportMutant } from './Survivors.schema.js'

export interface SurvivorsAdmissionInput {
  readonly cliOptions: PartialStrykerOptions
  readonly mode: OutputMode
  readonly basePath: string
}

export interface SurvivorsAdmissionAnswer {
  readonly admission: Admitted | NoSurvivors
  readonly resolvedOptions: StrykerOptions
  readonly priorReportPath: string
}

type SurvivorsRaw = typeof AdmitSurvivorsRunCommand.Encoded & {
  readonly resolvedOptions: StrykerOptions
  readonly priorReportPath: string
}

const DEFAULT_SURVIVORS_PRIOR_REPORT = 'reports/mutation-report.json'

const EMPTY_CONFIG: Record<string, string> = {}

type HashContent = (content: string) => string

type ResolveAbsolutePath = (file: string) => string

type RelativizeFileName = (fileName: string) => Effect.Effect<string, never, never>

const hashContent: HashContent = (content) => bytesToHex(sha256(utf8ToBytes(content)))

const priorSourceHashes = (priorReport: PriorReportDocument, hash: HashContent) =>
  Object.fromEntries(Object.entries(priorReport.files).map(([file, fileResult]) => [file, hash(fileResult.source)]))

const reportMutantToMutant = (
  file: string,
  mutant: PriorReportMutant,
  resolveAbsolutePath: ResolveAbsolutePath,
  relativize: RelativizeFileName,
) =>
  Effect.map(relativize(resolveAbsolutePath(file)), (fileName) => ({
    id: mutant.id,
    fileName,
    relativeFileName: fileName,
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement ?? mutant.mutatorName,
    location: {
      start: {
        line: mutant.location.start.line - 1,
        column: mutant.location.start.column - 1,
      },
      end: {
        line: mutant.location.end.line - 1,
        column: mutant.location.end.column - 1,
      },
    },
  }))

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

const resolveSurvivorsRunOptions = (cliOptions: PartialStrykerOptions, mode: OutputMode) =>
  readConfig(cliOptions, { command: 'run', mode })

const priorReportPathOf = (resolved: StrykerOptions) =>
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
      (file) =>
        Effect.map(readSourceFile(file), (content): readonly [string, string] => [file, hashContent(content)]),
      { concurrency: SOURCE_HASH_CONCURRENCY },
    ),
    (pairs): Record<string, string> => Object.fromEntries(pairs),
  )

export const survivorsAdmissionCell = Sandwich.named('stryker.survivors_admission')((input: SurvivorsAdmissionInput) =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const resolvedOptions = yield* resolveSurvivorsRunOptions(input.cliOptions, input.mode)
    const priorReportPath = priorReportPathOf(resolvedOptions)
    const resolveAbsolutePath: ResolveAbsolutePath = (file) => pathService.resolve(file)
    const relativize = (fileName: string | undefined) =>
      Effect.orDie(S.decodeEffect(RelativeNormalizedFileName)({ fileName, basePath: input.basePath }))
    const read = yield* readPriorReport(priorReportPath)
    const sourceContentHashes = yield* currentSourceHashesFor(priorReportFileKeys(read.raw))
    return yield* Boolean.match(read.found, {
      onFalse: () =>
        Effect.succeed<SurvivorsRaw>({
          currentConfig: resolvedOptions,
          frameworkVersion: strykerVersion,
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
              frameworkVersion: strykerVersion,
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
    Effect.succeed({
      admission: Admitted.make({ survivors: [...admitted.survivors], mutateSpans: [...admitted.mutateSpans] }),
      resolvedOptions: raw.resolvedOptions,
      priorReportPath: raw.priorReportPath,
    }),
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
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  const sourceArb = Arbitrary.schema(Schema.String.check(Schema.isMaxLength(64)))

  it.prop('∀s_HashContent_∈Sha256Hex', [sourceArb], ([source]) =>
    /^[0-9a-f]{64}$/.test(hashContent(source)))

  it.prop('∀ab_HashContent_DistinctPerDraw', [sourceArb, sourceArb], ([a, b]) =>
    a === b || hashContent(a) !== hashContent(b))
}
