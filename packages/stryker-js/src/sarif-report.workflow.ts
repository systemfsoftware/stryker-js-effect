import { Workflow } from '@systemfsoftware/effect-cell-types'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { failureNotificationsOf, SarifFailureNotification } from './sarif-failure.schema.js'
import { SurvivorRef } from './surfacing.schema.js'

const SARIF_SCHEMA_URI = 'https://json.schemastore.org/sarif-2.1.0.json'
const MUTANT_STATUSES = S.Literals([
  'CompileError',
  'Ignored',
  'Killed',
  'NoCoverage',
  'Pending',
  'RuntimeError',
  'Survived',
  'Timeout',
])
const SURVIVOR_LEVELS: Record<string, 'warning' | 'note'> = { Survived: 'warning', NoCoverage: 'note' }

const decodeMutantStatus = S.decodeOption(MUTANT_STATUSES)
const encodeUriSegment = encodeURIComponent

const uriOf = (fileName: string): string =>
  Arr.join(Arr.map(fileName.split('/'), (segment) => encodeUriSegment(segment.toWellFormed())), '/')

const SarifToolSchema = S.Struct({
  name: S.String,
  version: S.String,
  informationUri: S.String,
})

type SarifTool = typeof SarifToolSchema.Type

const SarifRuleSchema = S.Struct({
  id: S.String,
  name: S.String,
  shortDescription: S.Struct({ text: S.String }),
})

const SarifRegionSchema = S.Struct({
  startLine: S.Natural,
  startColumn: S.Natural,
  endLine: S.Natural,
  endColumn: S.Natural,
})

const SarifPhysicalLocationSchema = S.Struct({
  physicalLocation: S.Struct({
    artifactLocation: S.Struct({ uri: S.String }),
    region: SarifRegionSchema,
  }),
})

const SarifResultSchema = S.Struct({
  ruleId: S.String,
  ruleIndex: S.Natural,
  level: S.Literals(['warning', 'note']),
  message: S.Struct({ text: S.String }),
  locations: S.Array(SarifPhysicalLocationSchema),
  partialFingerprints: S.Struct({ primaryLocationLineHash: S.String }),
})

const SarifDriverSchema = S.Struct({
  name: S.String,
  version: S.String,
  informationUri: S.String,
  rules: S.Array(SarifRuleSchema),
})

const SarifLogSchema = S.Struct({
  $schema: S.Literal(SARIF_SCHEMA_URI),
  version: S.Literal('2.1.0'),
  runs: S.Array(
    S.Struct({
      tool: S.Struct({ driver: SarifDriverSchema }),
      results: S.Array(SarifResultSchema),
    }),
  ),
})

export type SarifLog = typeof SarifLogSchema.Type

type SarifResult = typeof SarifResultSchema.Type

const SarifInvocationSchema = S.Struct({
  executionSuccessful: S.Literal(false),
  exitCode: Plugin.ExitCode,
  toolExecutionNotifications: S.Array(SarifFailureNotification),
})

const SarifFailureLogSchema = S.Struct({
  $schema: S.Literal(SARIF_SCHEMA_URI),
  version: S.Literal('2.1.0'),
  runs: S.Array(
    S.Struct({
      tool: S.Struct({ driver: SarifDriverSchema }),
      invocations: S.Array(SarifInvocationSchema),
      results: S.Array(SarifResultSchema),
    }),
  ),
})

export type SarifFailureLog = typeof SarifFailureLogSchema.Type

const failureLogOf = (tool: SarifTool, source: FailureReportSource): SarifFailureLog => ({
  $schema: SARIF_SCHEMA_URI,
  version: '2.1.0',
  runs: [{
    tool: {
      driver: {
        name: tool.name,
        version: tool.version,
        informationUri: tool.informationUri,
        rules: [],
      },
    },
    invocations: [{
      executionSuccessful: false,
      exitCode: source.exitCode,
      toolExecutionNotifications: failureNotificationsOf(source.records),
    }],
    results: [],
  }],
})

const SarifReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SarifReportDecision')
type SarifReportTypeId = typeof SarifReportTypeId

export class SarifReportRendered extends S.TaggedClass<SarifReportRendered>()('SarifReportRendered', {
  log: SarifLogSchema,
}) {
  readonly [SarifReportTypeId] = SarifReportTypeId
}

export class SarifReportTruncated extends S.TaggedClass<SarifReportTruncated>()('SarifReportTruncated', {
  log: SarifLogSchema,
  omitted: S.Natural,
}) {
  readonly [SarifReportTypeId] = SarifReportTypeId
}

export class SarifFailureReportRendered extends S.TaggedClass<SarifFailureReportRendered>()(
  'SarifFailureReportRendered',
  { log: SarifFailureLogSchema },
) {
  readonly [SarifReportTypeId] = SarifReportTypeId
}

export const SarifReportDecision = S.Union([
  SarifReportRendered,
  SarifReportTruncated,
  SarifFailureReportRendered,
])
export type SarifReportDecision = typeof SarifReportDecision.Type

export class SurvivorsReportSource extends S.TaggedClass<SurvivorsReportSource>()('SurvivorsReportSource', {
  report: Report.MutationTestResult,
  survivors: S.Array(SurvivorRef),
  maxResults: S.Natural,
}) {}

export class FailureReportSource extends S.TaggedClass<FailureReportSource>()('FailureReportSource', {
  records: S.NonEmptyArray(FailureRecord.FailureRecord),
  exitCode: Plugin.ExitCode,
}) {}

export const SarifReportSource = S.Union([SurvivorsReportSource, FailureReportSource])
export type SarifReportSource = typeof SarifReportSource.Type

export class SarifReportCommand extends S.TaggedClass<SarifReportCommand>()('SarifReportCommand', {
  source: SarifReportSource,
  tool: SarifToolSchema,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface SurvivorEntry {
  readonly fileName: string
  readonly mutant: Report.MutantResult
  readonly level: 'warning' | 'note'
  readonly id: string
}

const entryOf = (fileName: string, mutant: Report.MutantResult): Option.Option<SurvivorEntry> =>
  Option.flatMap(
    decodeMutantStatus(mutant.status),
    (status) =>
      Option.map(
        Option.fromNullishOr(SURVIVOR_LEVELS[status]),
        (level): SurvivorEntry => ({ fileName, mutant, level, id: mutant.id }),
      ),
  )

const entriesByIdOf = (report: Report.MutationTestResult): HashMap.HashMap<string, SurvivorEntry> =>
  HashMap.fromIterable(
    Arr.flatMap(
      Object.entries(report.files),
      ([fileName, file]) =>
        Arr.flatMap(file.mutants, (mutant) =>
          Option.toArray(
            Option.map(entryOf(fileName, mutant), (entry): readonly [string, SurvivorEntry] => [mutant.id, entry]),
          )),
    ),
  )

const ruleIndexIn = (ruleNames: ReadonlyArray<string>, mutatorName: string): number =>
  Option.getOrThrow(Arr.findFirstIndex(ruleNames, (name) => name === mutatorName))

interface Surfaced {
  readonly ref: SurvivorRef
  readonly entry: SurvivorEntry
}

const surfacedOf = (source: SurvivorsReportSource): ReadonlyArray<Surfaced> => {
  const byId = entriesByIdOf(source.report)
  return Arr.flatMap(
    source.survivors,
    (ref) => Option.toArray(Option.map(HashMap.get(byId, ref.id), (entry): Surfaced => ({ ref, entry }))),
  )
}

const messageOf = (entry: SurvivorEntry): string =>
  Option.getOrElse(Option.fromNullishOr(entry.mutant.description), () => entry.mutant.mutatorName)

const resultOf = (ruleNames: ReadonlyArray<string>) => (surfaced: Surfaced): SarifResult => ({
  ruleId: surfaced.entry.mutant.mutatorName,
  ruleIndex: ruleIndexIn(ruleNames, surfaced.entry.mutant.mutatorName),
  level: surfaced.entry.level,
  message: { text: messageOf(surfaced.entry) },
  locations: [{
    physicalLocation: {
      artifactLocation: { uri: uriOf(surfaced.entry.fileName) },
      region: {
        startLine: surfaced.entry.mutant.location.start.line,
        startColumn: surfaced.entry.mutant.location.start.column,
        endLine: surfaced.entry.mutant.location.end.line,
        endColumn: surfaced.entry.mutant.location.end.column,
      },
    },
  }],
  partialFingerprints: { primaryLocationLineHash: surfaced.entry.id },
})

const ruleOf = (mutatorName: string) => ({
  id: mutatorName,
  name: mutatorName,
  shortDescription: { text: mutatorName },
})

const logOf = (tool: SarifTool, results: ReadonlyArray<Surfaced>): SarifLog => {
  const ruleNames = Arr.dedupe(
    Arr.sort(Arr.map(results, (surfaced) => surfaced.entry.mutant.mutatorName), Order.String),
  )
  return {
    $schema: SARIF_SCHEMA_URI,
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: tool.name,
          version: tool.version,
          informationUri: tool.informationUri,
          rules: Arr.map(ruleNames, ruleOf),
        },
      },
      results: Arr.map(results, resultOf(ruleNames)),
    }],
  }
}

const decideSurvivors = (tool: SarifTool, source: SurvivorsReportSource): SarifReportDecision => {
  const surfaced = surfacedOf(source)
  const results = Arr.take(surfaced, source.maxResults)
  const log = logOf(tool, results)
  return Boolean.match(Arr.length(results) === Arr.length(surfaced), {
    onTrue: () => SarifReportRendered.make({ log }),
    onFalse: () => SarifReportTruncated.make({ log, omitted: Arr.length(surfaced) - Arr.length(results) }),
  })
}

const decide = (command: SarifReportCommand): SarifReportDecision =>
  Match.value(command.source).pipe(
    Match.tag('SurvivorsReportSource', (source) => decideSurvivors(command.tool, source)),
    Match.tag('FailureReportSource', (source) =>
      SarifFailureReportRendered.make({ log: failureLogOf(command.tool, source) })),
    Match.exhaustive,
  )

export const sarifReport = Workflow.make({
  command: SarifReportCommand,
  decision: SarifReportDecision,
  error: S.Never,
  decide: (command): Result.Result<SarifReportDecision, never> => Result.succeed(decide(command)),
})
