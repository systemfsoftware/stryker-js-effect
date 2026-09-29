import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

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

const SarifToolSchema = S.Struct({
  name: S.String,
  version: S.String,
  informationUri: S.String,
})

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

export const SarifReportDecision = S.Union([SarifReportRendered, SarifReportTruncated])
export type SarifReportDecision = typeof SarifReportDecision.Type

export class SarifReportCommand extends S.TaggedClass<SarifReportCommand>()('SarifReportCommand', {
  report: Report.MutationTestResult,
  survivors: S.Array(SurvivorRef),
  tool: SarifToolSchema,
  maxResults: S.Natural,
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

const uriOf = (fileName: string): string => Arr.join(Arr.map(fileName.split('/'), encodeUriSegment), '/')

interface Surfaced {
  readonly ref: SurvivorRef
  readonly entry: SurvivorEntry
}

const surfacedOf = (command: SarifReportCommand): ReadonlyArray<Surfaced> => {
  const byId = entriesByIdOf(command.report)
  return Arr.flatMap(
    command.survivors,
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

const logOf = (command: SarifReportCommand, results: ReadonlyArray<Surfaced>): SarifLog => {
  const ruleNames = Arr.dedupe(
    Arr.sort(Arr.map(results, (surfaced) => surfaced.entry.mutant.mutatorName), Order.String),
  )
  return {
    $schema: SARIF_SCHEMA_URI,
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: command.tool.name,
          version: command.tool.version,
          informationUri: command.tool.informationUri,
          rules: Arr.map(ruleNames, ruleOf),
        },
      },
      results: Arr.map(results, resultOf(ruleNames)),
    }],
  }
}

const decide = (command: SarifReportCommand): SarifReportDecision => {
  const surfaced = surfacedOf(command)
  const results = Arr.take(surfaced, command.maxResults)
  const log = logOf(command, results)
  return Boolean.match(Arr.length(results) === Arr.length(surfaced), {
    onTrue: () => SarifReportRendered.make({ log }),
    onFalse: () => SarifReportTruncated.make({ log, omitted: Arr.length(surfaced) - Arr.length(results) }),
  })
}

export const sarifReport = Workflow.make({
  command: SarifReportCommand,
  decision: SarifReportDecision,
  error: S.Never,
  decide: (command): Result.Result<SarifReportDecision, never> => Result.succeed(decide(command)),
})
