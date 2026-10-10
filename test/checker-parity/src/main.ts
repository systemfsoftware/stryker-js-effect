import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  BootAsymmetry,
  compareSides,
  CompareSidesCommand,
  ComparisonDecision,
  ParityBroken,
  TelemetryMissingViolation,
  VerdictMismatch,
  type Violation,
  ZeroSnapshotUpdates,
} from './compare-sides.workflow.js'
import { ISOLATED_DECLARATIONS_PROJECT } from './corpus.js'
import { ParityLine } from './Parity.schema.js'
import { parseArgs, type ParsedCompare, refusalOutsideCi, runShard, ShellFailure, shellFailure } from './run-side.js'

const decodeParityLine = S.decodeResult(S.fromJsonString(ParityLine))

const GITHUB_ACTIONS_ENV = 'GITHUB_ACTIONS'
const GITHUB_STEP_SUMMARY_ENV = 'GITHUB_STEP_SUMMARY'
const SHARD_FILE = /^shard-([1-9][0-9]*)\.ndjson$/u

const write = (text: string): void => {
  process.stdout.write(text)
}

const printFailure = (failure: ShellFailure): void => {
  process.stderr.write(`${failure.code}: ${failure.reason}\nnext action: ${failure.nextAction}\n`)
}

const appendSummary = (markdown: string): Effect.Effect<void, ShellFailure> => {
  const summaryPath = process.env[GITHUB_STEP_SUMMARY_ENV]
  return process.env[GITHUB_ACTIONS_ENV] === 'true' && summaryPath !== undefined && summaryPath !== ''
    ? Effect.tryPromise({
      try: () => fs.appendFile(summaryPath, markdown, 'utf8'),
      catch: (cause) =>
        shellFailure(
          'io-failed',
          `Could not append to $GITHUB_STEP_SUMMARY: ${String(cause)}`,
          'Check the runner exposes GITHUB_STEP_SUMMARY.',
        ),
    })
    : Effect.void
}

const collectShardFiles = (
  dirs: readonly string[],
): Effect.Effect<ReadonlyMap<number, readonly string[]>, ShellFailure> =>
  Effect.tryPromise({
    try: async () => {
      const byShard = new Map<number, string[]>()
      for (const dir of dirs) {
        const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true })
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.ndjson')) continue
          const match = SHARD_FILE.exec(entry.name)
          if (match === null) continue
          const shard = Number(match[1])
          byShard.set(shard, [...(byShard.get(shard) ?? []), path.join(entry.parentPath, entry.name)])
        }
      }
      return byShard
    },
    catch: (cause) =>
      shellFailure(
        'shard-incomplete',
        `Could not list the compare directories: ${String(cause)}`,
        'Check every compare directory exists and is readable.',
      ),
  })

const readParityLines = (content: string, file: string): Result.Result<readonly ParityLine[], ShellFailure> => {
  const decoded: ParityLine[] = []
  for (const raw of content.split('\n')) {
    if (raw.trim().length === 0) continue
    const line = decodeParityLine(raw)
    if (Result.isFailure(line)) {
      return Result.fail(
        shellFailure(
          'decode-failed',
          `${file} holds a line that is not a parity line`,
          `Fix or delete the malformed line in ${file}.`,
        ),
      )
    }
    decoded.push(line.success)
  }
  return Result.succeed(decoded)
}

interface LoadedShards {
  readonly lines: readonly ParityLine[]
  readonly projectToShard: ReadonlyMap<string, number>
}

const loadShards = (dirs: readonly string[], count: number): Effect.Effect<LoadedShards, ShellFailure> =>
  Effect.gen(function*() {
    const byShard = yield* collectShardFiles(dirs)
    for (let shard = 1; shard <= count; shard += 1) {
      const files = byShard.get(shard) ?? []
      if (files.length !== 1) {
        return yield* Effect.fail(
          shellFailure(
            'shard-incomplete',
            `Shard ${shard}/${count} contributed ${files.length} shard files, expected exactly one.`,
            `Download artifact checker-parity-$GITHUB_RUN_ID-${shard} (file shard-${shard}.ndjson) and pass its directory.`,
          ),
        )
      }
      const file = files[0] ?? ''
      const content = yield* Effect.tryPromise({
        try: () => fs.readFile(file, 'utf8'),
        catch: (cause) =>
          shellFailure('shard-incomplete', `Could not read ${file}: ${String(cause)}`, `Check ${file} is readable.`),
      })
      if (content.trim().length === 0) {
        return yield* Effect.fail(
          shellFailure(
            'shard-incomplete',
            `Shard ${shard}/${count} wrote an empty ${path.basename(file)}.`,
            `Rerun the checker-parity (${shard}) leg; read artifact checker-parity-$GITHUB_RUN_ID-${shard}.`,
          ),
        )
      }
    }
    const files = [...byShard.entries()].flatMap(([shard, paths]) => paths.map((file) => ({ shard, file })))
    const contents = yield* Effect.forEach(
      files,
      ({ shard, file }) =>
        Effect.map(
          Effect.tryPromise({
            try: () => fs.readFile(file, 'utf8'),
            catch: (cause) =>
              shellFailure('decode-failed', `Could not read ${file}: ${String(cause)}`, `Check ${file} is readable.`),
          }),
          (content) => ({ shard, file, content }),
        ),
      { concurrency: 1 },
    )
    const decoded = yield* Effect.fromResult(
      Result.all(
        contents.map(({ shard, file, content }) =>
          Result.map(readParityLines(content, file), (lines) => lines.map((line) => ({ line, shard })))
        ),
      ),
    )
    const entries = decoded.flat()
    return {
      lines: entries.map((entry) => entry.line),
      projectToShard: new Map(
        entries.flatMap((entry) => ('project' in entry.line ? [[entry.line.project, entry.shard] as const] : [])),
      ),
    }
  })

const describeViolation = (violation: Violation): string =>
  S.is(VerdictMismatch)(violation)
    ? `${violation.code} ${violation.project} ${violation.mutantId} ${violation.fileName}:${violation.line} main=${
      JSON.stringify(violation.main)
    } branch=${JSON.stringify(violation.branch)}`
    : S.is(BootAsymmetry)(violation)
    ? `${violation.code} ${violation.project} failed on ${violation.failedSide}`
    : S.is(ZeroSnapshotUpdates)(violation)
    ? `${violation.code} ${violation.project}`
    : S.is(TelemetryMissingViolation)(violation)
    ? `${violation.code} ${violation.side} ${violation.project} expected ${violation.expectedSpans} received ${violation.receivedSpans}`
    : `${violation.code}`

const projectOf = (violation: Violation): string | undefined =>
  S.is(VerdictMismatch)(violation) || S.is(BootAsymmetry)(violation) || S.is(ZeroSnapshotUpdates)(violation) ||
    S.is(TelemetryMissingViolation)(violation)
    ? violation.project
    : undefined

const annotationOf = (violation: Violation, shard: number | undefined): string => {
  const runId = process.env['GITHUB_RUN_ID'] ?? '<run-id>'
  const k = shard ?? '<k>'
  const location = S.is(VerdictMismatch)(violation) ? ` file=${violation.fileName},line=${violation.line}` : ''
  const message = `${
    describeViolation(violation)
  } Next action: ${violation.nextAction} (artifact checker-parity-${runId}-${k}, file shard-${k}.ndjson)`
  return `::error${location},title=${violation.code}::${message}`
}

const summaryMarkdown = (decision: typeof ComparisonDecision.Type): string => {
  const summary = decision.summary
  const verdict = S.is(ParityBroken)(decision) ? 'FAIL' : 'pass'
  const codes = S.is(ParityBroken)(decision) ? [...new Set(decision.violations.map((violation) => violation.code))] : []
  const ratios = (side: typeof summary.main): string =>
    `${side.mutants} mutants, ${side.checkCalls} check calls, ${side.phaseMs} ms, ${
      side.snapshotUpdatesPerMutant.toFixed(3)
    } updates/mutant (${side.countsDerived ? 'derived' : 'observed'}), ${
      side.emitBuildsPerMutant.toFixed(3)
    } emit builds/mutant`
  return [
    `### checker-parity: ${verdict}`,
    '',
    `- violations: ${S.is(ParityBroken)(decision) ? decision.violations.length : 0}${
      codes.length === 0 ? '' : ` (${codes.join(', ')})`
    }`,
    `- projects: ${summary.measuredProjectCount} measured of ${summary.projectCount}, ${summary.excludedCachedProjectCount} cached-excluded, ${summary.skipped.length} skipped`,
    `- main: ${ratios(summary.main)}`,
    `- branch: ${ratios(summary.branch)}`,
    `- shortcuts: ${summary.shortcutCount.overall} overall, ${summary.shortcutCount.isolatedDeclarations} on the isolatedDeclarations fixture`,
    '',
  ].join('\n')
}

const compare = (parsed: ParsedCompare): Effect.Effect<number, ShellFailure> =>
  Effect.gen(function*() {
    const loaded = yield* loadShards(parsed.dirs, parsed.shards)
    const command = CompareSidesCommand.make({
      lines: [...loaded.lines],
      gates: parsed.gates,
      isolatedDeclarationsProject: ISOLATED_DECLARATIONS_PROJECT,
    })
    const decision = Result.getOrThrow(compareSides(command))
    const encoded = yield* Effect.fromResult(
      Result.mapError(S.encodeResult(S.fromJsonString(ComparisonDecision))(decision), (issue) =>
        shellFailure(
          'io-failed',
          `Could not encode the compare summary: ${issue.message}`,
          'Inspect the compare decision schema.',
        )),
    )
    yield* Effect.tryPromise({
      try: () => fs.writeFile(parsed.summary, encoded, 'utf8'),
      catch: (cause) =>
        shellFailure(
          'io-failed',
          `Could not write ${parsed.summary}: ${String(cause)}`,
          `Check the directory of ${parsed.summary} is writable.`,
        ),
    })

    if (S.is(ParityBroken)(decision)) {
      for (const violation of decision.displayed) {
        write(`${describeViolation(violation)} Next action: ${violation.nextAction}\n`)
        if (process.env[GITHUB_ACTIONS_ENV] === 'true') {
          const project = projectOf(violation)
          write(`${annotationOf(violation, project === undefined ? undefined : loaded.projectToShard.get(project))}\n`)
        }
      }
      if (decision.omittedCount > 0) {
        write(`${decision.omittedCount} more in ${parsed.summary}\n`)
      }
    } else {
      write(`parity holds over ${loaded.lines.length} lines across ${parsed.shards} shards\n`)
    }
    yield* appendSummary(summaryMarkdown(decision))
    return S.is(ParityBroken)(decision) ? 1 : 0
  })

const program = Effect.gen(function*() {
  const parsed = parseArgs(process.argv.slice(2))
  if (Result.isFailure(parsed)) {
    printFailure(parsed.failure)
    return 2
  }
  const refusal = refusalOutsideCi(parsed.success, process.env)
  if (refusal !== undefined) {
    printFailure(refusal)
    return 2
  }
  return parsed.success._tag === 'run'
    ? yield* runShard(parsed.success.command).pipe(Effect.as(0))
    : yield* compare(parsed.success)
})

const result = await Effect.runPromise(
  Effect.result(program.pipe(Effect.provide(Engine.nodePlatformLayer))),
)
process.exitCode = Result.match(result, {
  onFailure: (failure) => {
    printFailure(failure)
    return 2
  },
  onSuccess: (code) => code,
})
