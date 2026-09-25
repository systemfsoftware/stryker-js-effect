import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const ShardSchema = S.Struct({ index: S.Int, count: S.Int })
export type Shard = S.Schema.Type<typeof ShardSchema>

export const MeasuredSchema = S.Struct({ seconds: S.Number, sha: S.String })
export type Measured = S.Schema.Type<typeof MeasuredSchema>

export const TimingRecordSchema = S.Struct({
  version: S.Literal(1),
  packages: S.Record(S.String, MeasuredSchema),
})
export type TimingRecord = S.Schema.Type<typeof TimingRecordSchema>

export const EntrySchema = S.Struct({
  package: S.String,
  seconds: S.Number,
  exitCode: S.Union([S.Int, S.Null]),
  shard: S.optional(ShardSchema),
})
export type Entry = S.Schema.Type<typeof EntrySchema>

export const PartSchema = S.Struct({ job: S.String, entries: S.Array(EntrySchema) })
export type Part = S.Schema.Type<typeof PartSchema>

export type MutationPackage = { readonly name: string; readonly dir: string }

export const JobSchema = S.Struct({
  id: S.String,
  name: S.String,
  packages: S.Array(S.String),
  dirs: S.Array(S.String),
  filters: S.String,
  predicted: S.Number,
  shard: S.optional(ShardSchema),
})
export type Job = S.Schema.Type<typeof JobSchema>
export const JobsSchema = S.Array(JobSchema)
export const JobOrNullSchema = S.NullOr(JobSchema)

export type Plan = { readonly jobs: readonly Job[] }

export type PlanOptions = { readonly target: number; readonly maxJobs: number; readonly unknownSeconds: number }

export const OutcomeSchema = S.Literals(['success', 'failure'] as const)
export type Outcome = S.Schema.Type<typeof OutcomeSchema>

export const PartMetaSchema = S.Struct({
  package: S.String,
  outcome: OutcomeSchema,
  shard: S.optional(ShardSchema),
})
export type PartMeta = S.Schema.Type<typeof PartMetaSchema>

export const ReportSchema = S.StructWithRest(
  S.Struct({ schemaVersion: S.String, files: S.Record(S.String, S.Unknown) }),
  [S.Record(S.String, S.Unknown)],
)
export type Report = S.Schema.Type<typeof ReportSchema>

export const PnpmWorkspaceSchema = S.Struct({ packages: S.Array(S.String) })

export const PackageManifestSchema = S.Struct({
  name: S.optional(S.String),
  scripts: S.optional(S.Record(S.String, S.String)),
})

export type StagedPart = { readonly meta: PartMeta; readonly report?: Report; readonly stream?: string }

export type CombinedPart = {
  readonly meta: Omit<PartMeta, 'shard'>
  readonly report?: Report
  readonly stream?: string
}

export const emptyRecord: TimingRecord = { version: 1, packages: {} }

export const decodeInput = <Schema extends S.ConstraintDecoder<unknown>>(
  schema: Schema,
  input: unknown,
  source: string,
): Schema['Type'] =>
  Result.getOrThrowWith(
    S.decodeUnknownResult(schema)(input),
    (error) => new Error(`${source}: ${error.message}`),
  )

export const decodeJson = <Schema extends S.ConstraintDecoder<unknown>>(
  schema: Schema,
  text: string,
  source: string,
): Schema['Type'] => decodeInput(S.fromJsonString(schema), text, source)

export const decodeJsonOption = <Schema extends S.ConstraintDecoder<unknown>>(
  schema: Schema,
  text: string,
): Option.Option<Schema['Type']> => S.decodeUnknownOption(S.fromJsonString(schema))(text)

export const slugOf = (name: string): string => name.replace(/^@[^/]+\//, '')

export const minutes = (seconds: number): string =>
  `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`

const predictedOf = (record: TimingRecord, options: PlanOptions) => (pkg: MutationPackage): number =>
  record.packages[pkg.name]?.seconds ?? options.unknownSeconds

type Bin = { packages: MutationPackage[]; seconds: number }

const balance = (items: readonly (readonly [MutationPackage, number])[], count: number): Bin[] => {
  const bins: Bin[] = Array.from({ length: count }, () => ({ packages: [], seconds: 0 }))
  for (const [pkg, seconds] of [...items].sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))) {
    const bin = bins.reduce((least, candidate) => (candidate.seconds < least.seconds ? candidate : least))
    bin.packages.push(pkg)
    bin.seconds += seconds
  }
  return bins.filter((bin) => bin.packages.length > 0)
}

export const planJobs = (
  packages: readonly MutationPackage[],
  record: TimingRecord,
  options: PlanOptions,
): Plan => {
  const predict = predictedOf(record, options)
  const oversized = packages.filter((pkg) => predict(pkg) > options.target)
  const whole = packages.filter((pkg) => predict(pkg) <= options.target).map((pkg) => [pkg, predict(pkg)] as const)

  const shardJobs: Job[] = []
  for (const pkg of [...oversized].sort((a, b) => a.name.localeCompare(b.name))) {
    const seconds = predict(pkg)
    const count = Math.ceil(seconds / options.target)
    const slug = slugOf(pkg.name)
    for (let index = 1; index <= count; index++) {
      shardJobs.push({
        id: `${slug}-${index}`,
        name: `${slug} ${index}/${count}`,
        packages: [pkg.name],
        dirs: [pkg.dir],
        filters: `--filter=${pkg.name}`,
        predicted: Math.round(seconds / count),
        shard: { index, count },
      })
    }
  }

  const budget = Math.max(1, options.maxJobs - shardJobs.length)
  const total = whole.reduce((sum, [, seconds]) => sum + seconds, 0)
  let count = Math.min(budget, Math.max(1, Math.ceil(total / options.target)))
  let bins = balance(whole, count)
  while (count < budget && bins.some((bin) => bin.seconds > options.target)) bins = balance(whole, ++count)

  const wholeJobs = bins.map((bin, i): Job => {
    const sorted = [...bin.packages].sort((a, b) => a.name.localeCompare(b.name))
    const names = sorted.map((pkg) => pkg.name)
    return {
      id: `group-${i + 1}`,
      name: names.map(slugOf).join(', '),
      packages: names,
      dirs: sorted.map((pkg) => pkg.dir),
      filters: names.map((name) => `--filter=${name}`).join(' '),
      predicted: Math.round(bin.seconds),
    }
  })
  return { jobs: [...shardJobs, ...wholeJobs] }
}

export const mergeRecord = (previous: TimingRecord, parts: readonly Part[], sha: string): TimingRecord => {
  const packages: Record<string, Measured> = { ...previous.packages }
  const byPackage = new Map<string, Entry[]>()
  for (const entry of parts.flatMap((part) => part.entries)) {
    byPackage.set(entry.package, [...(byPackage.get(entry.package) ?? []), entry])
  }
  for (const [name, entries] of byPackage) {
    const count = entries[0]?.shard?.count
    if (count === undefined) {
      packages[name] = { seconds: Math.max(...entries.map((entry) => entry.seconds)), sha }
      continue
    }
    const indices = new Set(entries.map((entry) => entry.shard?.index))
    const complete = Array.from({ length: count }, (_unused, i) => i + 1).every((index) => indices.has(index))
    if (complete) packages[name] = { seconds: entries.reduce((sum, entry) => sum + entry.seconds, 0), sha }
  }
  return { version: 1, packages }
}

export const summaryTable = (parts: readonly Part[], target: number, taskName = 'mutation'): string => {
  const rows = parts.flatMap((part) => {
    const total = part.entries.reduce((sum, entry) => sum + entry.seconds, 0)
    const flag = total > target ? ' ⚠ over target' : ''
    return part.entries.map((entry) => {
      const shard = entry.shard === undefined ? '' : ` (shard ${entry.shard.index}/${entry.shard.count})`
      const status = entry.exitCode === 0 ? 'passed' : entry.exitCode === null ? 'unknown' : 'failed'
      return `| ${part.job}${flag} | ${entry.package}${shard} | ${minutes(entry.seconds)} | ${status} |`
    })
  })
  return [
    `### ${taskName} timings (target ${minutes(target)} per job)`,
    '',
    '| Job | Package | Time | Result |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

const tagOf = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || !('_tag' in value)) return undefined
  return value._tag
}

const countMutantLines = (text: string): number => {
  let n = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (tagOf(parsed) === 'mutant') n += 1
  }
  return n
}

const isCompleteReport = (text: string): boolean => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  if (!('schemaVersion' in parsed) || !('files' in parsed)) return false
  const { schemaVersion, files } = parsed
  return typeof schemaVersion === 'string' && schemaVersion.length > 0 &&
    typeof files === 'object' && files !== null
}

export type ReportState = { reportText: string | null; streamText: string | null }

export const loadState = async (
  reportsDir: string,
  readFile: (path: string) => Promise<string>,
): Promise<ReportState> => {
  const reportText = await readFile(`${reportsDir}/mutation-report.json`).catch(() => null)
  const streamText = await readFile(`${reportsDir}/mutation-stream.jsonl`).catch(() => null)
  return { reportText, streamText }
}

export interface SummaryInput {
  readonly package: string
  readonly outcome: Outcome
  readonly reportsDir: string
}

export const buildSummary = (input: SummaryInput, state: ReportState): string => {
  const reportPath = `${input.reportsDir}/mutation-report.json`
  const streamPath = `${input.reportsDir}/mutation-stream.jsonl`
  const lines = [`#### Mutation · **${input.package}**`, '', `- **Stryker outcome**: **${input.outcome}**`]

  if (state.reportText !== null) {
    if (isCompleteReport(state.reportText)) {
      lines.push(`- **Report**: **${reportPath}** (complete)`)
    } else {
      lines.push(
        `- **Report**: **${reportPath}** present but not a valid Stryker report (missing schemaVersion or files) — the report job will fail on this part.`,
      )
    }
    return `${lines.join('\n')}\n`
  }

  const mutants = state.streamText === null ? 0 : countMutantLines(state.streamText)
  if (mutants === 0) {
    lines.push(
      `- **Result**: no final report and zero completed mutants — infrastructure failure (missing binary, crashed run or timeout). Stream: **${streamPath}**`,
    )
  } else {
    lines.push(
      `- **Result**: no final report (run interrupted) — ${mutants} completed mutant(s) recorded, marked incomplete in the merged report. Stream: **${streamPath}**`,
    )
  }
  return `${lines.join('\n')}\n`
}

export const buildRequireError = (input: SummaryInput, state: ReportState): string | null => {
  if (state.reportText !== null) return null
  const mutants = state.streamText === null ? 0 : countMutantLines(state.streamText)
  if (mutants === 0) {
    return [
      `::error title=Mutation produced no report::${input.package}: stryker exited '${input.outcome}' with zero mutant results — infrastructure failure (missing binary, crashed run or timeout), not a score outcome. Stream artifact: ${input.reportsDir}/mutation-stream.jsonl`,
    ].join('')
  }
  return [
    `::error title=Mutation produced no report::${input.package}: stryker exited '${input.outcome}' after ${mutants} completed mutant(s) without a final report — infrastructure failure, not a score outcome. Partial stream: ${input.reportsDir}/mutation-stream.jsonl`,
  ].join('')
}

export const combineParts = (parts: readonly StagedPart[]): Map<string, CombinedPart> => {
  const byPackage = Map.groupBy(parts, (part) => part.meta.package)
  const combined = new Map<string, CombinedPart>()
  for (const [dir, shards] of [...byPackage].sort(([a], [b]) => a.localeCompare(b))) {
    const outcome: Outcome = shards.every((part) => part.meta.outcome === 'success') ? 'success' : 'failure'
    const expected = shards[0]?.meta.shard?.count ?? 1
    const sameCount = shards.every((part) => (part.meta.shard?.count ?? 1) === expected)
    const indices = new Set(shards.map((part) => part.meta.shard?.index ?? 1))
    const reports = shards.flatMap((part) => (part.report === undefined ? [] : [part.report]))
    const complete = sameCount && indices.size === expected && reports.length === shards.length

    const owners = new Map<string, number>()
    for (const part of shards) {
      for (const file of Object.keys(part.report?.files ?? {})) {
        const other = owners.get(file)
        if (other !== undefined) {
          throw new Error(
            `${dir}: shards ${other} and ${part.meta.shard?.index} both mutated ${file}; ` +
              `shardMutate's file expansion missed a file Stryker's mutate patterns match.`,
          )
        }
        owners.set(file, part.meta.shard?.index ?? 1)
      }
    }

    const streams = shards.flatMap((part) => (part.stream === undefined ? [] : [part.stream]))
    const [first] = reports
    combined.set(dir, {
      meta: { package: dir, outcome },
      ...(complete && first !== undefined
        ? { report: { ...first, files: Object.assign({}, ...reports.map((report) => report.files)) } }
        : {}),
      ...(streams.length === 0 ? {} : { stream: streams.map((stream) => stream.trimEnd()).join('\n') + '\n' }),
    })
  }
  return combined
}
