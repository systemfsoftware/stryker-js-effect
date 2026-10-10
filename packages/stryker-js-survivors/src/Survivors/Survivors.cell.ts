import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { type OutputMode, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { Reports } from '@systemfsoftware/stryker-js-contracts'
import { Configuration } from '@systemfsoftware/stryker-js-contracts'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import { Engine } from '@systemfsoftware/stryker-js-engine'
import {
  admitSurvivorsRun,
  AdmitSurvivorsRunCommand,
  Admitted,
  SurvivorsRejection,
} from '../admit-survivors-run.workflow.js'

export type SurvivorsSettled = void | Reports.MutationTestDone

export interface AdmittedRun {
  readonly admitted: Admitted
  readonly resolvedOptions: Options.StrykerOptions
  readonly priorReportPath: string
}

export interface SurvivorsSettlement {
  readonly runAdmitted: (run: AdmittedRun) => Effect.Effect<SurvivorsSettled, never, Engine.EnginePorts>
  readonly reportNoSurvivors: (resolvedOptions: Options.StrykerOptions) => Effect.Effect<SurvivorsSettled>
}

export interface SurvivorsAdmissionInput {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly mode: OutputMode.OutputMode
  readonly configOverlay: Configuration.ConfigOverlay
  readonly basePath: string
  readonly settle: SurvivorsSettlement
}

const DEFAULT_SURVIVORS_PRIOR_REPORT = `reports/${Reports.MutationReportFileName.literal}`

const EMPTY_CONFIG: Record<string, string> = {}

type HashContent = (content: string) => string

type ResolveAbsolutePath = (file: string) => string

type RelativizeFileName = (fileName: string) => string

const hashContent: HashContent = (content) => bytesToHex(sha256(utf8ToBytes(content)))

const priorSourceHashes = (priorReport: Reports.PriorReportDocument, hash: HashContent) =>
  Object.fromEntries(Object.entries(priorReport.files).map(([file, fileResult]) => [file, hash(fileResult.source)]))

const survivorLocationOf = (mutant: Reports.PriorReportMutant) => ({
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
  mutant: Reports.PriorReportMutant,
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
  priorReport: Reports.PriorReportDocument,
  resolveAbsolutePath: ResolveAbsolutePath,
  relativize: RelativizeFileName,
) =>
  Object.entries(priorReport.files).flatMap(([file, fileResult]) =>
    fileResult.mutants
      .filter((mutant) => S.is(Mutant.SurvivorStatusSchema)(mutant.status))
      .map((mutant) => reportMutantToMutant(file, mutant, resolveAbsolutePath, relativize))
  )

const resolveAbsolutePathOf = (basePath: string): ResolveAbsolutePath => (file) => `${basePath}/${file}`

const priorReportPathOf = (resolved: Options.StrykerOptions) =>
  Option.getOrElse(
    Option.filter(Option.fromUndefinedOr(resolved['survivorsPriorReport']), Predicate.isString),
    () => DEFAULT_SURVIVORS_PRIOR_REPORT,
  )

export interface PriorReportRead<A = unknown> {
  readonly found: boolean
  readonly raw: A
}

const resolveSurvivorsRunOptions = Effect.fn(SpanTaxonomy.Spans.survivorsAdmissionResolveOptions.name)(
  function*(input: {
    readonly cliOptions: Options.PartialStrykerOptions
    readonly mode: OutputMode.OutputMode
    readonly configOverlay: Configuration.ConfigOverlay
  }) {
    return yield* Engine.readConfig(input.cliOptions, {
      command: 'run',
      mode: input.mode,
      overlay: input.configOverlay,
    })
  },
)

const readPriorReport = Effect.fn(SpanTaxonomy.Spans.survivorsAdmissionReadPriorReport.name)(
  function*(priorReportPath: string) {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(priorReportPath).pipe(
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
          Match.orElse(() =>
            Effect.fail(Configuration.ConfigFileUnreadableError.make({ file: priorReportPath, cause }))
          ),
        )),
    )
  },
)

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

const readSourceFile = Effect.fn(SpanTaxonomy.Spans.survivorsAdmissionReadSource.name)(function*(file: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(file).pipe(
    Effect.mapError((cause) => Configuration.ConfigFileUnreadableError.make({ file, cause })),
  )
})

const SOURCE_HASH_CONCURRENCY = 24

const currentSourceHashesFor = Effect.fn(SpanTaxonomy.Spans.survivorsAdmissionHashSources.name)(
  function*(files: readonly string[]) {
    const pairs = yield* Effect.forEach(
      files,
      (file) => Effect.map(readSourceFile(file), (content): readonly [string, string] => [file, hashContent(content)]),
      { concurrency: SOURCE_HASH_CONCURRENCY },
    )
    return Object.fromEntries(pairs)
  },
)

export type SurvivorsRaw = typeof AdmitSurvivorsRunCommand.Encoded & {
  readonly resolvedOptions: Options.StrykerOptions
  readonly priorReportPath: string
}

const survivorsRawOf = (input: {
  readonly read: PriorReportRead
  readonly resolvedOptions: Options.StrykerOptions
  readonly priorReportPath: string
  readonly basePath: string
  readonly sourceContentHashes: Record<string, string>
  readonly frameworkVersion: string
}) => {
  const { read, resolvedOptions, priorReportPath, basePath, sourceContentHashes, frameworkVersion } = input
  const relativize: RelativizeFileName = (fileName) => Configuration.relativeNormalizedFileName(fileName, basePath)
  const resolveAbsolutePath = resolveAbsolutePathOf(basePath)
  return Boolean.match(read.found, {
    onFalse: () =>
      Effect.succeed<SurvivorsRaw>({
        currentConfig: resolvedOptions,
        frameworkVersion,
        priorReport: undefined,
        priorSourceHashes: {},
        priorSurvivors: [],
        sourceContentHashes,
        resolvedOptions,
        priorReportPath,
      }),
    onTrue: () =>
      Effect.fromResult(Result.match(S.decodeUnknownResult(Reports.PriorReportDocument)(read.raw), {
        onFailure: (error) => Result.fail(error),
        onSuccess: (document) =>
          Result.succeed<SurvivorsRaw>({
            currentConfig: resolvedOptions,
            frameworkVersion,
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
}

const readSurvivorsAdmission = Effect.fn(SpanTaxonomy.Spans.survivorsAdmissionGather.name)(
  function*(input: SurvivorsAdmissionInput) {
    const resolvedOptions = yield* resolveSurvivorsRunOptions({
      cliOptions: input.cliOptions,
      mode: input.mode,
      configOverlay: input.configOverlay,
    })
    const priorReportPath = priorReportPathOf(resolvedOptions)
    const read = yield* readPriorReport(priorReportPath)
    const sourceContentHashes = yield* currentSourceHashesFor(priorReportFileKeys(read.raw))
    const raw = yield* survivorsRawOf({
      read,
      resolvedOptions,
      priorReportPath,
      basePath: input.basePath,
      sourceContentHashes,
      frameworkVersion: (yield* Run.EngineIdentity).framework.version,
    })
    return { ...raw, settle: input.settle }
  },
)

export const survivorsAdmissionCell = Sandwich.named(SpanTaxonomy.Spans.survivorsAdmission.name)(readSurvivorsAdmission)
  .decide(admitSurvivorsRun)
  .write({
    Admitted: (admitted, raw) =>
      Effect.flatMap(
        S.decodeEffect(Admitted)(admitted),
        (decoded) =>
          raw.settle.runAdmitted({
            admitted: decoded,
            resolvedOptions: raw.resolvedOptions,
            priorReportPath: raw.priorReportPath,
          }),
      ),
    NoSurvivors: (_outcome, raw) => raw.settle.reportNoSurvivors(raw.resolvedOptions),
    SurvivorsRejection: (rejection) => Effect.fail(SurvivorsRejection.make(rejection)),
    CommandRejected: ({ issue }) => Effect.fail(SurvivorsRejection.make({ reason: 'mismatch', remediation: issue })),
  })
